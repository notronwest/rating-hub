/**
 * Defensive beats analysis.
 *
 * Walks every rally-ending attacker-winner and attributes responsibility to
 * one of the two defenders based on classic pickleball coverage rules:
 *
 *   - The defender DIRECTLY across from the shooter (same half of court,
 *     x-wise) owns the line and their own body.
 *   - The DIAGONAL defender owns the middle and their own body.
 *
 * For each beat we classify where on the court the ball landed (line,
 * middle, body-of-direct, body-of-diagonal) and tag the defender who was
 * responsible. Aggregating per-player gives a "how you got beat" breakdown.
 */

import type { RallyShot } from "../types/database";

export interface PlayerInfo {
  id: string;
  display_name: string;
  player_index: number;
  team: number;
  avatar_url: string | null;
}

export interface RallyInfo {
  id: string;
  rally_index: number;
  start_ms: number;
  winning_team: number | null;
}

export type BeatZone =
  | "line"              // ball hugged a sideline on direct defender's side
  | "body_direct"       // ball landed at direct defender's x
  | "middle"            // ball between defenders (diagonal defender's turf)
  | "body_diagonal"     // ball at diagonal defender's x
  | "opposite_line"     // ball hugged the far sideline (diagonal's line)
  | "unclassified";     // fell into a gap we couldn't classify

export type BeatRole =
  | "direct_line"
  | "direct_body"
  | "diagonal_middle"
  | "diagonal_body"
  | "diagonal_line"
  | "ambiguous";

export interface BeatEvent {
  rallyId: string;
  rallyIndex: number;
  /** Where playback should start to review this beat (ms since video start). */
  seekMs: number;
  shotIndex: number;
  attackerIndex: number;
  attackerTeam: number;
  directIndex: number;
  diagonalIndex: number;
  responsibleIndex: number;
  zone: BeatZone;
  role: BeatRole;
  landX: number;
  landY: number;
  /** Distance from the direct defender to where the shooter *should* have been
   *  covered — a large value flags positioning drift. */
  directDrift: number;
  /** For middle beats: how far the diagonal defender was from the center line. */
  diagonalDrift: number;
}

export interface PlayerBeatSummary {
  player: PlayerInfo;
  /** Times the player was the direct defender and was beat… */
  asDirectLine: number;
  asDirectBody: number;
  asDirectTotal: number;
  /** Times the player was the diagonal defender and was beat… */
  asDiagonalMiddle: number;
  asDiagonalBody: number;
  asDiagonalLine: number;
  asDiagonalTotal: number;
  /** Sum across both roles — easy headline number. */
  totalBeats: number;
  /** Average direct-defender drift on events where this player was direct. */
  avgDirectDrift: number;
  /** Average diagonal-defender drift on events where this player was diagonal. */
  avgDiagonalDrift: number;
  /** Sample of the raw events so a detail view can render them. */
  events: BeatEvent[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

const COURT_WIDTH = 20;
const CENTER_X = COURT_WIDTH / 2;
const BODY_RADIUS = 2.5;    // ±ft around defender's x
const SIDELINE_BAND = 3.0;  // within N ft of a sideline = "line"

function isShotFault(shot: RallyShot): boolean {
  const errs = shot.shot_errors as { faults?: Record<string, boolean> } | null;
  if (!errs) return false;
  const f = errs.faults;
  if (f && Object.values(f).some(Boolean)) return true;
  return false;
}

/**
 * Identify which defender is "direct" and which is "diagonal" given the
 * shooter's x. Direct = same court half; diagonal = the other.
 */
function splitDefenders(
  shooterX: number,
  defA: { idx: number; x: number; y: number },
  defB: { idx: number; x: number; y: number },
): { direct: typeof defA; diagonal: typeof defA } {
  const shooterOnLeft = shooterX < CENTER_X;
  const aLeft = defA.x < CENTER_X;
  const bLeft = defB.x < CENTER_X;

  // Normal case: one defender per half
  if (aLeft !== bLeft) {
    const leftDef = aLeft ? defA : defB;
    const rightDef = aLeft ? defB : defA;
    return shooterOnLeft
      ? { direct: leftDef, diagonal: rightDef }
      : { direct: rightDef, diagonal: leftDef };
  }
  // Both on same side — positioning error. Call the closer-x one "direct".
  const dA = Math.abs(defA.x - shooterX);
  const dB = Math.abs(defB.x - shooterX);
  return dA <= dB
    ? { direct: defA, diagonal: defB }
    : { direct: defB, diagonal: defA };
}

function classifyZone(args: {
  shooterX: number;
  landX: number;
  directX: number;
  diagonalX: number;
}): { zone: BeatZone; role: BeatRole } {
  const { shooterX, landX, directX, diagonalX } = args;
  const shooterOnLeft = shooterX < CENTER_X;

  // Body — ball at a defender's x within ~2.5ft
  if (Math.abs(landX - directX) <= BODY_RADIUS) {
    return { zone: "body_direct", role: "direct_body" };
  }
  if (Math.abs(landX - diagonalX) <= BODY_RADIUS) {
    return { zone: "body_diagonal", role: "diagonal_body" };
  }

  // Line — near a sideline
  const onLeftLine = landX < SIDELINE_BAND;
  const onRightLine = landX > COURT_WIDTH - SIDELINE_BAND;
  if (onLeftLine || onRightLine) {
    const lineOnShootersSide =
      (onLeftLine && shooterOnLeft) || (onRightLine && !shooterOnLeft);
    return lineOnShootersSide
      ? { zone: "line", role: "direct_line" }
      : { zone: "opposite_line", role: "diagonal_line" };
  }

  // Middle — strictly between the two defenders
  const lo = Math.min(directX, diagonalX);
  const hi = Math.max(directX, diagonalX);
  if (landX > lo && landX < hi) {
    return { zone: "middle", role: "diagonal_middle" };
  }

  return { zone: "unclassified", role: "ambiguous" };
}

// ── Main analysis ──────────────────────────────────────────────────────────

export function analyzeDefensiveBeats(
  shots: RallyShot[],
  rallies: RallyInfo[],
  players: PlayerInfo[],
): { events: BeatEvent[]; perPlayer: PlayerBeatSummary[] } {
  const byRally = new Map<string, RallyShot[]>();
  for (const s of shots) {
    if (!byRally.has(s.rally_id)) byRally.set(s.rally_id, []);
    byRally.get(s.rally_id)!.push(s);
  }
  for (const [, arr] of byRally) arr.sort((a, b) => a.shot_index - b.shot_index);

  const byIdx = new Map(players.map((p) => [p.player_index, p]));
  const events: BeatEvent[] = [];

  for (const rally of rallies) {
    const arr = byRally.get(rally.id) ?? [];
    if (arr.length === 0) continue;
    const end = arr.find((s) => s.is_final);
    if (!end) continue;

    // v1 scope: only analyze rally-ending WINNERS (no faults). Serves
    // ending the rally (aces) are excluded too — not a typical "beat".
    if (end.shot_index < 2) continue;
    if (isShotFault(end)) continue;
    if (end.player_index == null) continue;
    if (end.contact_x == null || end.land_x == null || end.land_y == null) continue;
    if (!end.player_positions || end.player_positions.length < 4) continue;

    const attacker = byIdx.get(end.player_index);
    if (!attacker) continue;

    // Defenders: opposing team's two indices. Gather their positions from the
    // snapshot on the attacker's contact.
    const defenders = players
      .filter((p) => p.team !== attacker.team)
      .map((p) => ({
        idx: p.player_index,
        x: end.player_positions![p.player_index]?.x ?? NaN,
        y: end.player_positions![p.player_index]?.y ?? NaN,
      }))
      .filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
    if (defenders.length !== 2) continue;

    const { direct, diagonal } = splitDefenders(end.contact_x, defenders[0], defenders[1]);
    const { zone, role } = classifyZone({
      shooterX: end.contact_x,
      landX: end.land_x,
      directX: direct.x,
      diagonalX: diagonal.x,
    });

    let responsibleIndex: number;
    switch (role) {
      case "direct_line":
      case "direct_body":
        responsibleIndex = direct.idx;
        break;
      case "diagonal_middle":
      case "diagonal_body":
      case "diagonal_line":
        responsibleIndex = diagonal.idx;
        break;
      default:
        continue; // ambiguous — skip
    }

    // Drift: how far each defender was from where they *should* be.
    //   Direct should shadow the shooter's x on their half of the court.
    //   Diagonal should be near the center (middle coverage).
    const directIdealX = end.contact_x; // mirror the shooter
    const directDrift = Math.abs(direct.x - directIdealX);
    const diagonalDrift = Math.abs(diagonal.x - CENTER_X);

    // Seek slightly before the winning contact so the coach sees the rally
    // flow into the beat (clamp to rally start so we don't jump outside).
    const seekMs = Math.max(rally.start_ms, end.start_ms - 2500);

    events.push({
      rallyId: rally.id,
      rallyIndex: rally.rally_index,
      seekMs,
      shotIndex: end.shot_index,
      attackerIndex: attacker.player_index,
      attackerTeam: attacker.team,
      directIndex: direct.idx,
      diagonalIndex: diagonal.idx,
      responsibleIndex,
      zone,
      role,
      landX: end.land_x,
      landY: end.land_y,
      directDrift,
      diagonalDrift,
    });
  }

  // Aggregate per defender
  const perPlayer: PlayerBeatSummary[] = players.map((p) => ({
    player: p,
    asDirectLine: 0,
    asDirectBody: 0,
    asDirectTotal: 0,
    asDiagonalMiddle: 0,
    asDiagonalBody: 0,
    asDiagonalLine: 0,
    asDiagonalTotal: 0,
    totalBeats: 0,
    avgDirectDrift: 0,
    avgDiagonalDrift: 0,
    events: [],
  }));
  const byPlayerIdx = new Map(perPlayer.map((s) => [s.player.player_index, s]));

  const driftAcc = new Map<number, { direct: number[]; diagonal: number[] }>();
  for (const p of players) {
    driftAcc.set(p.player_index, { direct: [], diagonal: [] });
  }

  for (const ev of events) {
    // Attribute to responsible defender (primary beat count)
    const resp = byPlayerIdx.get(ev.responsibleIndex);
    if (resp) {
      resp.totalBeats++;
      resp.events.push(ev);
      switch (ev.role) {
        case "direct_line":
          resp.asDirectLine++;
          resp.asDirectTotal++;
          break;
        case "direct_body":
          resp.asDirectBody++;
          resp.asDirectTotal++;
          break;
        case "diagonal_middle":
          resp.asDiagonalMiddle++;
          resp.asDiagonalTotal++;
          break;
        case "diagonal_body":
          resp.asDiagonalBody++;
          resp.asDiagonalTotal++;
          break;
        case "diagonal_line":
          resp.asDiagonalLine++;
          resp.asDiagonalTotal++;
          break;
      }
    }
    // Accumulate drift stats for each role (for averages later)
    driftAcc.get(ev.directIndex)?.direct.push(ev.directDrift);
    driftAcc.get(ev.diagonalIndex)?.diagonal.push(ev.diagonalDrift);
  }

  for (const ps of perPlayer) {
    const d = driftAcc.get(ps.player.player_index);
    if (d && d.direct.length > 0) {
      ps.avgDirectDrift = d.direct.reduce((a, b) => a + b, 0) / d.direct.length;
    }
    if (d && d.diagonal.length > 0) {
      ps.avgDiagonalDrift = d.diagonal.reduce((a, b) => a + b, 0) / d.diagonal.length;
    }
  }

  return { events, perPlayer };
}

/** Short human labels for a beat role. */
export const BEAT_ROLE_LABELS: Record<BeatRole, string> = {
  direct_line: "Beat down the line",
  direct_body: "Beat at your body",
  diagonal_middle: "Beat through the middle",
  diagonal_body: "Beat at your body (cross)",
  diagonal_line: "Beat on the far line",
  ambiguous: "Unclassified",
};

// ── Defensive COVERAGE analysis ─────────────────────────────────────────
//
// Coverage gives the coach successful defenses + failed defenses in a single
// X/Y metric per defensive role (direct, diagonal). Every rally that ended
// with an opposing team's shot counts as a "defense attempt" against the two
// defenders on the receiving team — they either held (pass) or got beat
// (fail). This is the data the WMPC Review surface uses.

export type CoverageRole = "direct" | "diagonal";

export interface CoverageEvent {
  rallyId: string;
  rallyIndex: number;
  rallyStartMs: number;
  seekMs: number;
  role: CoverageRole;
  passed: boolean;
  /** For fails: which sub-zone got beat (line/body/middle). For passes this
   *  is the zone the attacker tried but the defense held. */
  zone: BeatZone;
  landX: number;
  landY: number;
  directDrift: number;
  diagonalDrift: number;
}

export interface PlayerCoverageSummary {
  player: PlayerInfo;
  directAttempts: number;
  directPasses: number;
  directFails: number;
  diagonalAttempts: number;
  diagonalPasses: number;
  diagonalFails: number;
  events: CoverageEvent[];
}

/**
 * Walk every rally. For the final opposing shot, classify the two defenders
 * (direct + diagonal) and attribute either a pass (rally won by the defense)
 * or a fail (beat — rally ended against the defense). Returns per-player
 * coverage summaries plus the raw events for timeline rendering.
 */
export function analyzeDefensiveCoverage(
  shots: RallyShot[],
  rallies: RallyInfo[],
  players: PlayerInfo[],
): { events: CoverageEvent[]; perPlayer: PlayerCoverageSummary[] } {
  const byRally = new Map<string, RallyShot[]>();
  for (const s of shots) {
    if (!byRally.has(s.rally_id)) byRally.set(s.rally_id, []);
    byRally.get(s.rally_id)!.push(s);
  }
  for (const [, arr] of byRally) arr.sort((a, b) => a.shot_index - b.shot_index);

  const byIdx = new Map(players.map((p) => [p.player_index, p]));
  const events: CoverageEvent[] = [];

  for (const rally of rallies) {
    const arr = byRally.get(rally.id) ?? [];
    if (arr.length === 0) continue;

    // Find the decisive opposing shot. If the rally ended on a winner, it's
    // that shot. If it ended on a fault (the loser's shot), step back to the
    // previous shot — the defender-stressing one.
    const end = arr.find((s) => s.is_final);
    if (!end) continue;
    if (end.shot_index < 2) continue;           // exclude serve-enders

    const faulted = isShotFault(end);
    const decisive = faulted
      ? arr.find((s) => s.shot_index === end.shot_index - 1)
      : end;
    if (!decisive || decisive.player_index == null) continue;
    if (decisive.contact_x == null || decisive.land_x == null) continue;
    if (!decisive.player_positions || decisive.player_positions.length < 4) continue;

    const attacker = byIdx.get(decisive.player_index);
    if (!attacker) continue;

    // Receivers are the opposing team's two players
    const defenders = players
      .filter((p) => p.team !== attacker.team)
      .map((p) => ({
        idx: p.player_index,
        x: decisive.player_positions![p.player_index]?.x ?? NaN,
        y: decisive.player_positions![p.player_index]?.y ?? NaN,
      }))
      .filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
    if (defenders.length !== 2) continue;

    const { direct, diagonal } = splitDefenders(decisive.contact_x, defenders[0], defenders[1]);
    const { zone, role: beatRole } = classifyZone({
      shooterX: decisive.contact_x,
      landX: decisive.land_x,
      directX: direct.x,
      diagonalX: diagonal.x,
    });

    // "Pass" when the defenders' team won this rally; "fail" when the
    // attackers did. Faults by the attacker are excluded above (their
    // shot isn't a stress test of defense).
    const defenderTeam = attacker.team === 0 ? 1 : 0;
    const defendersPassed = rally.winning_team === defenderTeam;

    const directIdealX = decisive.contact_x;
    const directDrift = Math.abs(direct.x - directIdealX);
    const diagonalDrift = Math.abs(diagonal.x - CENTER_X);
    const seekMs = Math.max(rally.start_ms, decisive.start_ms - 2500);

    // Attribute one event to each role (direct + diagonal). For a fail, only
    // the responsible defender's role is "failed"; the other role is "passed"
    // UNLESS the beat zone unambiguously belongs to them (e.g., a middle beat
    // counts against diagonal, line against direct).
    //
    // Simplified: we credit BOTH defenders' roles on a pass (they both held).
    // On a fail, only the role responsible gets the fail; the other gets a
    // neutral (excluded from both passes and fails — doesn't muddle the
    // stat).
    if (defendersPassed) {
      events.push({
        rallyId: rally.id, rallyIndex: rally.rally_index, rallyStartMs: rally.start_ms, seekMs,
        role: "direct", passed: true, zone, landX: decisive.land_x, landY: decisive.land_y!,
        directDrift, diagonalDrift,
      });
      events.push({
        rallyId: rally.id, rallyIndex: rally.rally_index, rallyStartMs: rally.start_ms, seekMs,
        role: "diagonal", passed: true, zone, landX: decisive.land_x, landY: decisive.land_y!,
        directDrift, diagonalDrift,
      });
      // Record on both defenders' player index
      // (per-player accounting happens in the per-player aggregation loop below)
    } else {
      // Rally lost to this attacking shot → a beat attributable to one role.
      const failedRole: CoverageRole =
        beatRole === "diagonal_middle" || beatRole === "diagonal_body" || beatRole === "diagonal_line"
          ? "diagonal"
          : beatRole === "direct_line" || beatRole === "direct_body"
          ? "direct"
          : "direct"; // ambiguous → credit to direct as a best guess
      events.push({
        rallyId: rally.id, rallyIndex: rally.rally_index, rallyStartMs: rally.start_ms, seekMs,
        role: failedRole, passed: false, zone, landX: decisive.land_x, landY: decisive.land_y!,
        directDrift, diagonalDrift,
      });
    }
  }

  // Aggregate per player. We need to map events back to actual defender
  // player ids — the events themselves don't carry that, so we re-walk the
  // rallies, matching by rally id.
  const byRallyId = new Map(rallies.map((r) => [r.id, r]));
  const perPlayer: PlayerCoverageSummary[] = players.map((p) => ({
    player: p,
    directAttempts: 0, directPasses: 0, directFails: 0,
    diagonalAttempts: 0, diagonalPasses: 0, diagonalFails: 0,
    events: [],
  }));
  const byPlayerIdx = new Map(perPlayer.map((s) => [s.player.player_index, s]));

  for (const ev of events) {
    const rally = byRallyId.get(ev.rallyId);
    if (!rally) continue;
    const arr = byRally.get(rally.id) ?? [];
    const end = arr.find((s) => s.is_final);
    if (!end) continue;
    const faulted = isShotFault(end);
    const decisive = faulted
      ? arr.find((s) => s.shot_index === end.shot_index - 1)
      : end;
    if (!decisive || decisive.player_index == null) continue;
    const attacker = byIdx.get(decisive.player_index);
    if (!attacker) continue;
    const defenders = players
      .filter((p) => p.team !== attacker.team)
      .map((p) => ({
        idx: p.player_index,
        x: decisive.player_positions![p.player_index]?.x ?? NaN,
        y: decisive.player_positions![p.player_index]?.y ?? NaN,
      }))
      .filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y));
    if (defenders.length !== 2) continue;
    const { direct, diagonal } = splitDefenders(decisive.contact_x!, defenders[0], defenders[1]);

    const who = ev.role === "direct" ? direct : diagonal;
    const summary = byPlayerIdx.get(who.idx);
    if (!summary) continue;

    if (ev.role === "direct") {
      summary.directAttempts++;
      if (ev.passed) summary.directPasses++; else summary.directFails++;
    } else {
      summary.diagonalAttempts++;
      if (ev.passed) summary.diagonalPasses++; else summary.diagonalFails++;
    }
    summary.events.push(ev);
  }

  return { events, perPlayer };
}
