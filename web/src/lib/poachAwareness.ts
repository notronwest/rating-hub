/**
 * Net poach awareness analyzer.
 *
 * Identifies any incoming shot in a rally where a player at the kitchen
 * could have stepped over to volley a ball that would otherwise have
 * been their partner's. If the player took it themselves it's a
 * successful poach; if their partner played it it's a missed poach
 * opportunity. Both flow into a single per-player ScriptCounter that
 * the WMPC Analysis panel renders as pass/fail instances on a video
 * timeline.
 *
 * Heuristic — applied to every shot N (1..end-1) of every rally:
 *   - The shot at index N was hit by team A. Whoever's playing the
 *     next shot N+1 is on team B (the receiving side for this shot).
 *   - For each team-B player D:
 *     · D is at or near the kitchen line at the moment shot N was
 *       struck (D.y inside the team's kitchen zone, with a forgiving
 *       transition buffer on the baseline side).
 *     · Minimum distance from D's (x, y) to the line segment from
 *       shot N's contact point to its landing point is ≤ POACH_REACH_FT.
 *       Closest-point-on-segment handles the common case where the
 *       ball lands short of D — D would step forward + lateral to
 *       intercept, and that combined motion is what the distance
 *       measures.
 *     · Ball is naturally heading to PARTNER's side (partner is
 *       laterally closer to the landing point than D). Without this,
 *       every ball D played in their own lane would count as a poach.
 *   - Pass: D hit shot N+1 (poached). Fail: partner hit it (missed).
 *
 * Shot 0 (the serve) is intentionally skipped — there's no "poach"
 * concept on a serve since both receiving-team players are obligated
 * to let it bounce.
 */

import type { RallyShot } from "../types/database";
import type { PlayerInfo, RallyInfo, ScriptCounter } from "./firstFourShots";

/** How far the player at the kitchen could plausibly cover (in court
 *  feet — combines lateral step + forward step + paddle reach). 6 ft
 *  is calibrated against a 4-game test set: at 4 ft most opportunities
 *  fail the reach test even when the eye says the player could've
 *  gotten there with anticipation; at 8 ft you start surfacing
 *  unrealistic "missed" calls. 6 ft splits the difference. */
const POACH_REACH_FT = 6;

/** Generous "is D up at the net" check. The strict kitchen zone
 *  (firstFourShots.kitchenLineForTeam) sometimes excludes a returner's
 *  partner who's a step short — they're clearly trying to be at the
 *  net but PB Vision sampled them mid-stride. The buffer keeps them
 *  in the analysis. Pure baseline players (D.y far from the kitchen
 *  line) are still excluded. */
function isAtNet(team: number, y: number): boolean {
  // For team 0 (plays y ∈ [0, 22]), the kitchen zone is y ∈ [15, 22].
  // We accept anyone in [10, 22] — i.e. within ~5 ft of the kitchen line.
  if (team === 0) return y >= 10 && y <= 22;
  // Team 1 (plays y ∈ [22, 44]) mirrors that: kitchen y ∈ [22, 29],
  // accept y ∈ [22, 34].
  return y >= 22 && y <= 34;
}

/** "1st", "2nd", "3rd" … "Nth" — for prose in the per-instance note. */
function shotOrdinal(shotIdx: number): string {
  // shot_index is 0-based; the 1st shot of the rally is index 0.
  const n = shotIdx + 1;
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** Minimum 2D distance from a point to a line segment. */
function distanceToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export interface PoachAnalysis {
  player: PlayerInfo;
  poach: ScriptCounter;
}

export function analyzePoachOpportunities(
  shots: RallyShot[],
  rallies: RallyInfo[],
  players: PlayerInfo[],
): PoachAnalysis[] {
  const byRally = new Map<string, RallyShot[]>();
  for (const s of shots) {
    if (!byRally.has(s.rally_id)) byRally.set(s.rally_id, []);
    byRally.get(s.rally_id)!.push(s);
  }
  for (const [, ss] of byRally) ss.sort((a, b) => a.shot_index - b.shot_index);

  const byIdx = new Map(players.map((p) => [p.player_index, p]));

  const result: Record<number, PoachAnalysis> = {};
  for (const p of players) {
    result[p.player_index] = {
      player: p,
      poach: { total: 0, correct: 0, events: [] },
    };
  }

  for (const rally of rallies) {
    const rallyShots = byRally.get(rally.id) ?? [];
    if (rallyShots.length < 2) continue;

    // Walk every shot whose successor exists. We need both the incoming
    // shot's geometry (to test reach) and the next shot's hitter (to
    // know who actually played it).
    //
    // Skip shot 0 (the serve) — both receiving players must let it
    // bounce, so there's no poach concept.
    for (let i = 1; i < rallyShots.length - 1; i++) {
      const shot = rallyShots[i];
      const next = rallyShots[i + 1];
      if (shot.player_index == null || next.player_index == null) continue;

      const hitter = byIdx.get(shot.player_index);
      const nextHitter = byIdx.get(next.player_index);
      if (!hitter || !nextHitter) continue;
      // Both shots must alternate teams — skip phantom same-team double
      // hits PB Vision occasionally records.
      if (hitter.team === nextHitter.team) continue;

      const receivingTeam = nextHitter.team;
      const positions = shot.player_positions;
      if (!positions) continue;

      // Shot geometry needed for the reach test.
      const cx = shot.contact_x;
      const cy = shot.contact_y;
      const lx = shot.land_x;
      const ly = shot.land_y;
      if (cx == null || cy == null || lx == null || ly == null) continue;

      // Evaluate each receiving-team player as a potential D.
      for (const D of players) {
        if (D.team !== receivingTeam) continue;
        const dPos = positions[D.player_index];
        if (!dPos || dPos.x == null || dPos.y == null) continue;
        if (!isAtNet(D.team, dPos.y)) continue;

        // Reach test — closest distance from D to the ball's flight
        // path. Handles balls landing short of D (steps forward) and
        // balls passing wide of D (steps lateral).
        const reach = distanceToSegment(dPos.x, dPos.y, cx, cy, lx, ly);
        if (reach > POACH_REACH_FT) continue;

        // Find D's partner — the other receiving-team player.
        const partner = players.find(
          (p) => p.team === receivingTeam && p.player_index !== D.player_index,
        );
        if (!partner) continue;
        const partnerPos = positions[partner.player_index];
        if (!partnerPos || partnerPos.x == null) continue;

        // Ball must be on partner's side — partner laterally closer to
        // the landing point than D. Filters out D's natural-lane plays.
        const ballToPartner = Math.abs(partnerPos.x - lx);
        const ballToD = Math.abs(dPos.x - lx);
        if (ballToPartner > ballToD) continue;

        // True poach setup: D could've reached, ball was partner's lane.
        const counter = result[D.player_index].poach;
        counter.total++;
        const passed = next.player_index === D.player_index;
        if (passed) counter.correct++;
        counter.events.push({
          rallyId: rally.id,
          rallyIndex: rally.rally_index,
          rallyStartMs: rally.start_ms,
          seekMs: shot.start_ms,
          passed,
          note: passed
            ? `Poached the ${shotOrdinal(i)} · ball within ${reach.toFixed(1)} ft`
            : `Partner played the ${shotOrdinal(i)} · ball was ${reach.toFixed(1)} ft away`,
        });
      }
    }
  }

  return Object.values(result).sort(
    (a, b) => a.player.player_index - b.player.player_index,
  );
}
