/**
 * First-4-shots scripted-start analysis.
 *
 * Pickleball orthodoxy says the first four shots of a rally ought to be
 * played to script: deep serve, deep return + returner up to the kitchen by
 * the 4th, 3rd-shot drop (or a drive recovered by the same player's 5th
 * shot drop), and the 4th struck out of the air if possible. This module
 * evaluates per-player compliance against each of those four criteria.
 *
 * Shot index semantics: 0 = serve, 1 = return, 2 = 3rd, 3 = 4th, 4 = 5th.
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
}

/** One attempt at a criterion — `passed` tells the coach whether the player
 *  executed it; `seekMs` is where playback should start to review it; `note`
 *  is a tiny "why did this fail" blurb for the drill-down list. */
export interface ScriptEvent {
  rallyId: string;
  rallyIndex: number;
  rallyStartMs: number;
  seekMs: number;
  passed: boolean;
  note?: string;
}

export interface ScriptCounter {
  total: number;
  correct: number;
  events: ScriptEvent[];
}

export interface PlayerScript {
  player: PlayerInfo;
  deepServe: ScriptCounter;
  deepReturnPlusKitchen: ScriptCounter;
  /** Drops (the canonical 3rd). */
  thirdDrop: ScriptCounter;
  /** Drives followed by the same player hitting a 5th-shot drop. */
  thirdDriveThenFifthDrop: ScriptCounter;
  fourthVolley: ScriptCounter;
  /** Simple unweighted average of the four rates; a single headline %. */
  compositePct: number;
}

// ── Criterion helpers ───────────────────────────────────────────────────────

function shotEndZone(shot: RallyShot): string | null {
  const z = (shot.trajectory as { end?: { zone?: string } } | null)?.end?.zone;
  return typeof z === "string" ? z : null;
}

/** "Was this struck out of the air?" — combines explicit signals from the
 *  compact `vol` flag, augmented `shot_type === "volley"`, and a contact-
 *  height fallback for shots hit from the kitchen / mid-court at height. */
function isVolley(shot: RallyShot): boolean {
  if (shot.shot_type === "volley") return true;
  const raw = shot.raw_data as Record<string, unknown> | null;
  if (raw && !!raw.vol) return true;
  // Final fallback: contact above typical groundstroke height and ball was
  // still airborne at start of trajectory (landing z ~0 doesn't apply here).
  if (shot.contact_z != null && shot.contact_z > 2.5) return true;
  return false;
}

/**
 * Returner's team's kitchen line, expressed in PBV court coords. Team 0 plays
 * the far half (y 0–22), team 1 the near half (y 22–44). Kitchen extends 7ft
 * from the net on each side.
 */
function kitchenLineForTeam(team: number): { line: number; minY: number; maxY: number } {
  if (team === 0) return { line: 15, minY: 12.5, maxY: 22 };
  return { line: 29, minY: 22, maxY: 31.5 };
}

function returnerAtKitchen(
  returner: PlayerInfo,
  fourthShot: RallyShot,
): boolean {
  const { minY, maxY } = kitchenLineForTeam(returner.team);

  // If the returner hit the 4th shot themselves, we can trust their
  // contact point over the snapshotted player_positions array. PB Vision's
  // position samples sometimes lag the ball by 1–2 frames and put the
  // player a half-foot short of the kitchen when their paddle is clearly
  // past the NVZ line. Also — volleying the 4th is a definitive "at the
  // kitchen" signal; no coach would coach against that.
  if (fourthShot.player_index === returner.player_index) {
    if (isVolley(fourthShot)) return true;
    const cy = fourthShot.contact_y;
    if (cy != null && cy >= minY && cy <= maxY) return true;
  }

  // Fall back to the player_positions snapshot for the more common case
  // where a partner hit the 4th shot.
  const positions = fourthShot.player_positions;
  if (!positions) return false;
  const pos = positions[returner.player_index];
  if (!pos || pos.y == null) return false;
  return pos.y >= minY && pos.y <= maxY;
}

// ── Main scorer ─────────────────────────────────────────────────────────────

export function computePlayerScripts(
  shots: RallyShot[],
  rallies: RallyInfo[],
  players: PlayerInfo[],
): PlayerScript[] {
  // Group shots by rally, keeping shot_index order
  const byRally = new Map<string, RallyShot[]>();
  for (const s of shots) {
    if (!byRally.has(s.rally_id)) byRally.set(s.rally_id, []);
    byRally.get(s.rally_id)!.push(s);
  }
  for (const [, ss] of byRally) ss.sort((a, b) => a.shot_index - b.shot_index);

  const byIdx = new Map(players.map((p) => [p.player_index, p]));

  // Initialize per-player counters
  const result: Record<number, PlayerScript> = {};
  for (const p of players) {
    result[p.player_index] = {
      player: p,
      deepServe: { total: 0, correct: 0, events: [] },
      deepReturnPlusKitchen: { total: 0, correct: 0, events: [] },
      thirdDrop: { total: 0, correct: 0, events: [] },
      thirdDriveThenFifthDrop: { total: 0, correct: 0, events: [] },
      fourthVolley: { total: 0, correct: 0, events: [] },
      compositePct: 0,
    };
  }

  // Walk each rally and apply the four rules
  for (const rally of rallies) {
    const rallyShots = byRally.get(rally.id) ?? [];
    if (rallyShots.length === 0) continue;

    const shot0 = rallyShots.find((s) => s.shot_index === 0);
    const shot1 = rallyShots.find((s) => s.shot_index === 1);
    const shot2 = rallyShots.find((s) => s.shot_index === 2);
    const shot3 = rallyShots.find((s) => s.shot_index === 3);
    const shot4 = rallyShots.find((s) => s.shot_index === 4);

    const baseEv = {
      rallyId: rally.id,
      rallyIndex: rally.rally_index,
      rallyStartMs: rally.start_ms,
    };

    // 1) Deep serve — attributed to the server
    if (shot0 && shot0.player_index != null) {
      const server = byIdx.get(shot0.player_index);
      if (server && result[server.player_index]) {
        const bucket = result[server.player_index].deepServe;
        bucket.total++;
        const passed = shotEndZone(shot0) === "deep";
        if (passed) bucket.correct++;
        bucket.events.push({
          ...baseEv,
          seekMs: shot0.start_ms,
          passed,
          note: passed
            ? undefined
            : `Landed ${shotEndZone(shot0) ?? "unknown"} — not deep`,
        });
      }
    }

    // 2) Return-not-short + returner reached kitchen by 4th shot — attributed
    //    to the returner.
    //
    // Original rule required the return to land in PBV's "deep" zone; per
    // coaching policy we've relaxed that. The return only fails if PBV
    // explicitly tagged it "short" — mid-court / medium returns are still
    // acceptable as long as the returner gets to the kitchen. This stops
    // the topic from penalizing returns that are plenty deep enough to
    // coach from, just not maximally deep.
    if (shot1 && shot1.player_index != null) {
      const returner = byIdx.get(shot1.player_index);
      if (returner && result[returner.player_index]) {
        const bucket = result[returner.player_index].deepReturnPlusKitchen;
        bucket.total++;
        const endZone = shotEndZone(shot1);
        const returnWasShort = endZone === "short";
        // Kitchen check — the returner either closed up themselves OR their
        // partner pounced on a 3rd-shot drive out of the air. The second case
        // is a deliberate exemption: if the serving team drove the 3rd and
        // the returning team volleyed it, the returning partnership IS at
        // the net as a pair, which is the point of the scripted start.
        let reachedKitchen = shot3 ? returnerAtKitchen(returner, shot3) : false;
        let partnerPouncedOnDrive = false;
        if (!reachedKitchen && shot3 && shot3.player_index != null) {
          const fourthHitter = byIdx.get(shot3.player_index);
          const thirdWasDrive = shot2?.shot_type === "drive";
          if (
            fourthHitter &&
            fourthHitter.team === returner.team &&
            fourthHitter.player_index !== returner.player_index &&
            thirdWasDrive &&
            isVolley(shot3)
          ) {
            partnerPouncedOnDrive = true;
            reachedKitchen = true;
          }
        }
        const passed = !returnWasShort && reachedKitchen;
        if (passed) bucket.correct++;
        let note: string | undefined;
        if (returnWasShort && !reachedKitchen) {
          note = "Short return · didn't reach kitchen";
        } else if (returnWasShort) {
          note = "Short return";
        } else if (!reachedKitchen) {
          const pos = shot3?.player_positions?.[returner.player_index];
          const yStr = pos?.y != null ? ` (y=${pos.y.toFixed(1)})` : "";
          note = `Short of the kitchen${yStr}`;
        } else if (partnerPouncedOnDrive) {
          note = "Partner volleyed the 3rd-shot drive out of the air";
        }
        bucket.events.push({
          ...baseEv,
          seekMs: shot1.start_ms,
          passed,
          note,
        });
      }
    }

    // 3) 3rd-shot pattern — attributed to the 3rd-shot hitter.
    //
    // Rules (per WMPC coaching policy):
    //   • 3rd is a drop → pass, UNLESS the 5th is a drive (still fail — the
    //     serving team abandoned the drop strategy too early).
    //   • 3rd is a drive and the rally ends before the 5th → pass (the drive
    //     wasn't returned successfully — that counts as "the drive worked").
    //   • 3rd is a drive and the 5th is a drop (same player OR partner) →
    //     pass (serving team resets to the kitchen on the 5th).
    //   • 3rd is a drive and the 5th is a drive → fail (no reset attempt).
    //   • Any other 3rd type (lob, speedup, etc.) → fail.
    //
    // `thirdDriveThenFifthDrop` is kept for the per-player card UI but is no
    // longer used by the Review topic — `thirdDrop` now encodes the full
    // rule.
    if (shot2 && shot2.player_index != null) {
      const thirdHitter = byIdx.get(shot2.player_index);
      if (thirdHitter && result[thirdHitter.player_index]) {
        const p = result[thirdHitter.player_index];
        const type = shot2.shot_type;
        const fifthType = shot4?.shot_type ?? null;
        // True when the 5th was hit by the serving team (same team as the
        // 3rd-shot hitter). PB Vision occasionally attributes phantom shots
        // to either side — the team check keeps us honest when that happens.
        const fifthBySameTeam =
          !!shot4 &&
          shot4.player_index != null &&
          byIdx.get(shot4.player_index)?.team === thirdHitter.team;

        let passed: boolean;
        let note: string | undefined;
        // The clip should start at the shot that DECIDES the outcome — the
        // 5th when the rule depends on it, otherwise the 3rd.
        let seekMs = shot2.start_ms;

        if (type === "drop") {
          if (shot4 && fifthBySameTeam && fifthType === "drive") {
            passed = false;
            note = "3rd was a drop, but 5th was a drive";
            seekMs = shot4.start_ms;
          } else {
            passed = true;
          }
        } else if (type === "drive") {
          if (!shot4) {
            // Rally ended before the 5th — the drive wasn't returned. Pass.
            passed = true;
            note = "Drive · opponent didn't return";
          } else if (fifthBySameTeam && fifthType === "drop") {
            passed = true;
            const samePlayer = shot4.player_index === shot2.player_index;
            note = samePlayer
              ? "Drive → own-drop on 5th"
              : "Drive → partner's drop on 5th";
            seekMs = shot4.start_ms;
          } else if (fifthBySameTeam && fifthType === "drive") {
            passed = false;
            note = "Drive on 3rd, drive on 5th — no reset";
            seekMs = shot4.start_ms;
          } else {
            passed = false;
            note = `Drive on 3rd · 5th was ${fifthType ?? "?"}`;
            seekMs = shot4.start_ms;
          }
        } else {
          passed = false;
          note = `3rd was a ${type ?? "?"}`;
        }

        p.thirdDrop.total++;
        if (passed) p.thirdDrop.correct++;
        p.thirdDrop.events.push({ ...baseEv, seekMs, passed, note });

        // Keep the secondary "drive → own-drop on 5th" counter populated for
        // the Patterns player card, which surfaces it as a sub-stat.
        if (type === "drive") {
          p.thirdDriveThenFifthDrop.total++;
          const recovered =
            !!shot4 &&
            shot4.player_index === shot2.player_index &&
            shot4.shot_type === "drop";
          if (recovered) p.thirdDriveThenFifthDrop.correct++;
          p.thirdDriveThenFifthDrop.events.push({
            ...baseEv,
            seekMs: shot4?.start_ms ?? shot2.start_ms,
            passed: recovered,
            note: recovered
              ? "Recovered — dropped on 5th"
              : shot4
              ? `5th was ${shot4.shot_type ?? "?"}, not drop`
              : "No 5th shot logged",
          });
        }
      }
    }

    // 4) 4th shot out of the air — attributed to the 4th-shot hitter
    if (shot3 && shot3.player_index != null) {
      const fourthHitter = byIdx.get(shot3.player_index);
      if (fourthHitter && result[fourthHitter.player_index]) {
        const bucket = result[fourthHitter.player_index].fourthVolley;
        bucket.total++;
        const passed = isVolley(shot3);
        if (passed) bucket.correct++;
        bucket.events.push({
          ...baseEv,
          seekMs: shot3.start_ms,
          passed,
          note: passed
            ? undefined
            : `Let it bounce (contact ${shot3.contact_z?.toFixed(1) ?? "?"} ft)`,
        });
      }
    }
  }

  // Composite: mean of rates over rules where the player has ≥1 attempt. Rules
  // with no attempts are omitted so a player who never served isn't punished.
  for (const ps of Object.values(result)) {
    const rates: number[] = [];
    for (const c of [ps.deepServe, ps.deepReturnPlusKitchen, ps.thirdDrop, ps.fourthVolley]) {
      if (c.total > 0) rates.push(c.correct / c.total);
    }
    ps.compositePct = rates.length
      ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100)
      : 0;
  }

  return Object.values(result).sort(
    (a, b) => a.player.player_index - b.player.player_index,
  );
}

export function ratePct(c: ScriptCounter): number {
  if (c.total === 0) return 0;
  return Math.round((c.correct / c.total) * 100);
}
