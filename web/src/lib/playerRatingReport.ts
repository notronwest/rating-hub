/**
 * Aggregates a player's recent games into the shape the Player Rating
 * Report renders. Pure data — no coach notes required, which is the whole
 * point of this flavor of report (players who weren't coached still
 * deserve a takeaway).
 *
 * Sliding window: the most recent N games by `played_at`, default 6. As
 * new games land, old ones fall out and the numbers refresh — matches the
 * older PDF the club's been handing out.
 */
import type {
  DepthDistribution,
  GamePlayer,
  GamePlayerShotType,
  GamePlayerCourtZone,
  KitchenArrivalFraction,
  OutcomeStats,
  ShotAccuracyDistribution,
} from "../types/database";

export interface GameRowForReport {
  id: string;
  played_at: string;
  session_name: string | null;
  pbvision_video_id: string;
  gp: GamePlayer;
  shotTypes: GamePlayerShotType[];
  courtZones: GamePlayerCourtZone[];
}

export interface SkillRatings {
  overall: number | null;
  serve: number | null;
  return_: number | null;
  offense: number | null;
  defense: number | null;
  agility: number | null;
  consistency: number | null;
}

export interface KeyStats {
  shotsInPct: number | null;
  servesInPct: number | null;
  serveDeepPct: number | null;
  returnsInPct: number | null;
  returnDeepPct: number | null;
  /** Average count per game of `shot_type === "reset"`. */
  resetsAvg: number | null;
  kitchenOnServePct: number | null;
  kitchenOnReturnPct: number | null;
  /** Average share of team shots hit by this player (0-100). */
  teamShotPct: number | null;
  /** Percent of 3rd shots that stayed in. Useful on its own + feeds
   *  the auto-bullet about "3rd shots staying legal". */
  thirdShotsInPct: number | null;
}

export interface PerGameSnapshot {
  game: GameRowForReport;
  ratings: SkillRatings;
  stats: KeyStats;
  wentWell: string[];
  workOn: string[];
}

export interface PlayerRatingReport {
  ratings: SkillRatings;
  stats: KeyStats;
  perGame: PerGameSnapshot[];
  /** Trend samples in chronological order — oldest first. */
  trend: Array<{ playedAt: string; overall: number | null }>;
  wentWell: string[];
  workOn: string[];
}

// ─────────────────────────── Thresholds ───────────────────────────
//
// Heuristic bullets use the same four-tier scale as the UI badges so
// the text and the color-coded numbers agree:
//
//   Good+ (≥ 71%)  → "What's working"
//   Needs work (< 60%) → "Work on"
//   OK (60–70%)    → unmentioned; neither callout.
//
// Stats that don't map cleanly onto "higher is better" still use their
// historical thresholds below.

const GOOD_FLOOR = 71;
const NEEDS_WORK_CEILING = 60;

// ─────────────────────────── Entry point ───────────────────────────

export function buildPlayerRatingReport(
  games: GameRowForReport[],
): PlayerRatingReport {
  // Per-game snapshots first — we need them both as the "last 6 games"
  // list and as the source of truth for the sliding-window averages.
  const perGame: PerGameSnapshot[] = games.map((g) => {
    const ratings = ratingsFor(g.gp);
    const stats = keyStatsFor(g);
    const { wentWell, workOn } = autoBullets(stats);
    return { game: g, ratings, stats, wentWell, workOn };
  });

  // Aggregate — average of per-game values, skipping nulls. Per-game
  // "shot quality" style percentages average cleanly because each game is
  // one point; we don't attempt a weighted-by-total-shots average because
  // a short game shouldn't dominate a long one *more* than the player
  // already felt it.
  const ratings: SkillRatings = {
    overall: avgNullable(perGame.map((p) => p.ratings.overall)),
    serve: avgNullable(perGame.map((p) => p.ratings.serve)),
    return_: avgNullable(perGame.map((p) => p.ratings.return_)),
    offense: avgNullable(perGame.map((p) => p.ratings.offense)),
    defense: avgNullable(perGame.map((p) => p.ratings.defense)),
    agility: avgNullable(perGame.map((p) => p.ratings.agility)),
    consistency: avgNullable(perGame.map((p) => p.ratings.consistency)),
  };

  const stats: KeyStats = {
    shotsInPct: avgNullable(perGame.map((p) => p.stats.shotsInPct)),
    servesInPct: avgNullable(perGame.map((p) => p.stats.servesInPct)),
    serveDeepPct: avgNullable(perGame.map((p) => p.stats.serveDeepPct)),
    returnsInPct: avgNullable(perGame.map((p) => p.stats.returnsInPct)),
    returnDeepPct: avgNullable(perGame.map((p) => p.stats.returnDeepPct)),
    resetsAvg: avgNullable(perGame.map((p) => p.stats.resetsAvg)),
    kitchenOnServePct: avgNullable(perGame.map((p) => p.stats.kitchenOnServePct)),
    kitchenOnReturnPct: avgNullable(perGame.map((p) => p.stats.kitchenOnReturnPct)),
    teamShotPct: avgNullable(perGame.map((p) => p.stats.teamShotPct)),
    thirdShotsInPct: avgNullable(perGame.map((p) => p.stats.thirdShotsInPct)),
  };

  const { wentWell, workOn } = autoBullets(stats);

  // Trend uses oldest → newest, same as a line chart expects.
  const trend = [...perGame]
    .sort(
      (a, b) =>
        new Date(a.game.played_at).getTime() - new Date(b.game.played_at).getTime(),
    )
    .map((p) => ({ playedAt: p.game.played_at, overall: p.ratings.overall }));

  return { ratings, stats, perGame, trend, wentWell, workOn };
}

// ─────────────────────────── Per-game derivations ───────────────────────────

function ratingsFor(gp: GamePlayer): SkillRatings {
  return {
    overall: gp.rating_overall,
    serve: gp.rating_serve,
    return_: gp.rating_return,
    offense: gp.rating_offense,
    defense: gp.rating_defense,
    agility: gp.rating_agility,
    consistency: gp.rating_consistency,
  };
}

function keyStatsFor(g: GameRowForReport): KeyStats {
  const gp = g.gp;

  const serveInPct = depthInPct(gp.serve_depth);
  const returnInPct = depthInPct(gp.return_depth);
  const serveDeepPct = depthDeepPct(gp.serve_depth);
  const returnDeepPct = depthDeepPct(gp.return_depth);
  const shotsInPct = accuracyInPct(gp.shot_accuracy);

  // 3rd-shots-in% — the old PDF shows this per game; synthesize from
  // game_player_shot_types where possible. Fallback to the game's overall
  // shotsInPct if we only have aggregate data.
  const thirdShotsInPct = thirdShotInPct(g.shotTypes) ?? shotsInPct;

  // Reset count — sum of `reset` shot rows if present.
  const resetsAvg = countShotType(g.shotTypes, "reset");

  return {
    shotsInPct,
    servesInPct: serveInPct,
    serveDeepPct,
    returnsInPct: returnInPct,
    returnDeepPct,
    resetsAvg,
    kitchenOnServePct: arrivalPct(gp.kitchen_arrival_pct?.serving?.oneself ?? null),
    kitchenOnReturnPct: arrivalPct(gp.kitchen_arrival_pct?.returning?.oneself ?? null),
    teamShotPct: gp.total_team_shot_pct,
    thirdShotsInPct,
  };
}

// ─────────────────────────── Heuristic bullets ───────────────────────────

export function autoBullets(s: KeyStats): { wentWell: string[]; workOn: string[] } {
  const wentWell: string[] = [];
  const workOn: string[] = [];

  // Every stat on this list is "bigger is better" and fits the four-tier
  // scale. Good+ lands in the wentWell column, Needs Work lands in
  // workOn, OK is silent (the coach sees the number on the card but it
  // doesn't push either narrative).
  const tiered: Array<{
    value: number | null;
    goodCopy: string;
    workCopy: string;
  }> = [
    {
      value: s.shotsInPct,
      goodCopy: `Good overall shot-in rate (${fmtPct(s.shotsInPct)})`,
      workCopy: `Overall shot-in rate low (${fmtPct(s.shotsInPct)})`,
    },
    {
      value: s.servesInPct,
      goodCopy: `High serve-in rate (${fmtPct(s.servesInPct)})`,
      workCopy: `Serve-in rate low (${fmtPct(s.servesInPct)})`,
    },
    {
      value: s.serveDeepPct,
      goodCopy: `Served deep often (${fmtPct(s.serveDeepPct)})`,
      workCopy: `Increase serve depth (${fmtPct(s.serveDeepPct)})`,
    },
    {
      value: s.returnsInPct,
      goodCopy: `Solid return consistency (${fmtPct(s.returnsInPct)})`,
      workCopy: `Return-in rate low (${fmtPct(s.returnsInPct)})`,
    },
    {
      value: s.returnDeepPct,
      goodCopy: `Deep returns (${fmtPct(s.returnDeepPct)})`,
      workCopy: `Hit returns deeper (${fmtPct(s.returnDeepPct)})`,
    },
    {
      value: s.thirdShotsInPct,
      goodCopy: `3rd shots staying legal/in (${fmtPct(s.thirdShotsInPct)})`,
      workCopy: `3rd shots missing the box (${fmtPct(s.thirdShotsInPct)})`,
    },
    {
      value: s.kitchenOnServePct,
      goodCopy: `Getting to kitchen on serve (${fmtPct(s.kitchenOnServePct)})`,
      workCopy: `Arrive at kitchen more on serve (${fmtPct(s.kitchenOnServePct)})`,
    },
    {
      value: s.kitchenOnReturnPct,
      goodCopy: `Getting to kitchen on return (${fmtPct(s.kitchenOnReturnPct)})`,
      workCopy: `Arrive at kitchen more on return (${fmtPct(s.kitchenOnReturnPct)})`,
    },
  ];

  for (const { value, goodCopy, workCopy } of tiered) {
    if (value == null) continue;
    if (value >= GOOD_FLOOR) wentWell.push(goodCopy);
    else if (value < NEEDS_WORK_CEILING) workOn.push(workCopy);
    // OK zone (60–70) is silent — the coach sees the OK badge on the
    // card but we don't force it into either list.
  }

  return { wentWell, workOn };
}

// ─────────────────────────── Helpers ───────────────────────────

function depthInPct(d: DepthDistribution | null): number | null {
  if (!d) return null;
  const total = d.deep + d.medium + d.shallow + d.net + d.out;
  if (total === 0) return null;
  return ((d.deep + d.medium + d.shallow) / total) * 100;
}

function depthDeepPct(d: DepthDistribution | null): number | null {
  if (!d) return null;
  const total = d.deep + d.medium + d.shallow + d.net + d.out;
  if (total === 0) return null;
  return (d.deep / total) * 100;
}

function accuracyInPct(a: ShotAccuracyDistribution | null): number | null {
  if (!a) return null;
  const total = a.in + a.out + a.net;
  if (total === 0) return null;
  return (a.in / total) * 100;
}

function arrivalPct(f: KitchenArrivalFraction | null): number | null {
  if (!f || !f.denominator || f.denominator <= 0) return null;
  return (f.numerator / f.denominator) * 100;
}

function thirdShotInPct(shotTypes: GamePlayerShotType[]): number | null {
  // PB Vision's shot_types table tracks per-type totals, not per-position
  // within a rally, so this is an approximation: drive + drop + reset are
  // the canonical 3rd-shot species. We weight each type's in% by its
  // count, where in% = 100 - net% - out%.
  const third = shotTypes.filter((s) =>
    ["drive", "drop", "reset"].includes(s.shot_type),
  );
  if (third.length === 0) return null;
  let weightedIn = 0;
  let total = 0;
  for (const s of third) {
    const c = s.count ?? 0;
    if (c === 0) continue;
    const os = (s.outcome_stats ?? {}) as OutcomeStats;
    const net = os.net_fault_percentage ?? 0;
    const out = os.out_fault_percentage ?? 0;
    const inPct = Math.max(0, 100 - net - out);
    weightedIn += inPct * c;
    total += c;
  }
  if (total === 0) return null;
  return weightedIn / total;
}

function countShotType(shotTypes: GamePlayerShotType[], type: string): number | null {
  const row = shotTypes.find((s) => s.shot_type === type);
  return row ? row.count : 0;
}

function avgNullable(values: Array<number | null>): number | null {
  const ok = values.filter((v): v is number => v != null);
  if (ok.length === 0) return null;
  return ok.reduce((a, b) => a + b, 0) / ok.length;
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

export function fmtRating(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(2);
}

export function fmtStat(v: number | null, unit = ""): string {
  if (v == null) return "—";
  if (unit === "%") return `${v.toFixed(1)}%`;
  return v.toFixed(1);
}

// ─────────────────────────── Performance tiers ───────────────────────────
//
// Shared 4-tier scale used to color-grade "bigger is better" percentages
// across the report (shots in %, kitchen arrival %, etc.). Not every stat
// makes sense on this scale — team-shot % peaks at 50, for example — so
// callers opt in per-stat.

export type PerfTier = "needs_work" | "ok" | "good" | "great";

export interface PerfTierSpec {
  tier: PerfTier;
  label: string;
  /** Background fill for badges / bar segments. */
  color: string;
  /** Muted tint for card backgrounds. */
  tint: string;
}

const TIERS: Record<PerfTier, PerfTierSpec> = {
  needs_work: { tier: "needs_work", label: "Needs work", color: "#c62828", tint: "#fdecea" },
  ok: { tier: "ok", label: "OK", color: "#d97706", tint: "#fff3cd" },
  good: { tier: "good", label: "Good", color: "#1e7e34", tint: "#e6f4ea" },
  great: { tier: "great", label: "Great", color: "#0b6ea8", tint: "#e7f1fa" },
};

/** Map a 0-100 percentage to a tier spec. Thresholds:
 *   < 60       → Needs work
 *   60–70      → OK
 *   71–89      → Good
 *   90–100     → Great
 * `null` input returns `null` — callers render a neutral fallback. */
export function classifyPct(v: number | null): PerfTierSpec | null {
  if (v == null) return null;
  if (v < 60) return TIERS.needs_work;
  if (v <= 70) return TIERS.ok;
  if (v <= 89) return TIERS.good;
  return TIERS.great;
}

export const PERF_TIERS = TIERS;
