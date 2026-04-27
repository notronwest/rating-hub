/**
 * Stat Review topic source — given a coach-added stat (player + stat_key),
 * builds a ReviewTopic with per-rally pass/fail instances so the existing
 * TopicItem UI (FPTM editor, drills, overall note, instance timeline,
 * video clip) can render it without changes.
 *
 * Stat keys handled:
 *   stat.rally_win           — every rally, pass = team won
 *   stat.rally_win.short     — rallies of length 1–5 only
 *   stat.rally_win.medium    — rallies of length 6–10 only
 *   stat.rally_win.long      — rallies of length 11+ only
 *   stat.shot_share          — pass = player hit ≥1 shot in the rally
 *   stat.kitchen_arrival.serving   — needs PB Vision augmented JSON
 *   stat.kitchen_arrival.returning — needs PB Vision augmented JSON
 *
 * Augmented insights are public on PB Vision's API; this module fetches
 * them lazily and caches per-video in module scope.
 */

import type { Rally, RallyShot } from "../types/database";
import type { PlayerInfo } from "./firstFourShots";
import type {
  ReviewTopic,
  TopicId,
  TopicInstance,
  TopicMode,
  TopicRecommendation,
} from "./reviewTopics";

export type StatKey =
  | "stat.rally_win"
  | "stat.rally_win.short"
  | "stat.rally_win.medium"
  | "stat.rally_win.long"
  | "stat.shot_share"
  | "stat.kitchen_arrival.serving"
  | "stat.kitchen_arrival.returning";

interface StatDef {
  icon: string;
  title: string;
  subtitle: string;
}

const STAT_DEFS: Record<string, StatDef> = {
  "stat.rally_win": {
    icon: "🏆",
    title: "Rallies Won",
    subtitle: "Pass = team won the rally",
  },
  "stat.rally_win.short": {
    icon: "🏆",
    title: "Rallies Won — Short",
    subtitle: "1–5 shots · pass = team won",
  },
  "stat.rally_win.medium": {
    icon: "🏆",
    title: "Rallies Won — Medium",
    subtitle: "6–10 shots · pass = team won",
  },
  "stat.rally_win.long": {
    icon: "🏆",
    title: "Rallies Won — Long",
    subtitle: "11+ shots · pass = team won",
  },
  "stat.shot_share": {
    icon: "🎯",
    title: "Shot Distribution",
    subtitle: "Pass = player hit at least one shot in the rally",
  },
  "stat.kitchen_arrival.serving": {
    icon: "🥒",
    title: "Kitchen Arrival — Serving",
    subtitle: "Pass = closed to the kitchen on rallies the team served",
  },
  "stat.kitchen_arrival.returning": {
    icon: "🥒",
    title: "Kitchen Arrival — Returning",
    subtitle: "Pass = closed to the kitchen on rallies the team returned",
  },
};

export function getStatDef(statKey: string): StatDef {
  return (
    STAT_DEFS[statKey] ?? {
      icon: "📊",
      title: statKey,
      subtitle: "Custom stat",
    }
  );
}

// ─────────────────────────── PB Vision augmented JSON fetcher ───────────────────────────

interface AugmentedRally {
  start_ms: number;
  end_ms: number;
  scoring_info?: { likely_bad?: boolean };
  players?: Array<{
    had_arrival_opportunity?: boolean;
    kitchen_arrivals?: Array<{ since_ms?: number }>;
  }>;
  shots?: Array<{ player_id?: number }>;
}

interface AugmentedInsights {
  rallies: AugmentedRally[];
}

const augmentedCache = new Map<string, Promise<AugmentedInsights>>();

export function fetchAugmentedInsights(
  videoId: string,
  sessionNum: number,
): Promise<AugmentedInsights> {
  const key = `${videoId}:${sessionNum}`;
  let pending = augmentedCache.get(key);
  if (pending) return pending;
  pending = (async () => {
    const url = `https://api-2o2klzx4pa-uc.a.run.app/video/${videoId}/insights.json?sessionNum=${sessionNum}&format=augmented`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Augmented insights HTTP ${r.status}`);
    return r.json() as Promise<AugmentedInsights>;
  })();
  augmentedCache.set(key, pending);
  // Drop a failed promise from the cache so a later retry can fire.
  pending.catch(() => augmentedCache.delete(key));
  return pending;
}

// ─────────────────────────── Per-rally instance builders ───────────────────────────

interface BuilderArgs {
  player: PlayerInfo;
  /** Every player in the game, keyed by player_index, used to map shot
   *  contributions back to teams. */
  playersByIndex: Map<number, PlayerInfo>;
  rallies: Pick<Rally, "id" | "rally_index" | "start_ms" | "winning_team" | "shot_count">[];
  shots: RallyShot[];
  augmented?: AugmentedInsights | null;
}

function bucketOf(shotCount: number | null): "short" | "medium" | "long" {
  const n = shotCount ?? 0;
  if (n <= 5) return "short";
  if (n <= 10) return "medium";
  return "long";
}

/** Find the team that served a given rally — by looking at shot_index 0. */
function servingTeamOf(
  rallyId: string,
  shots: RallyShot[],
  playersByIndex: Map<number, PlayerInfo>,
): number | null {
  const serve = shots.find((s) => s.rally_id === rallyId && s.shot_index === 0);
  if (!serve || serve.player_index == null) return null;
  return playersByIndex.get(serve.player_index)?.team ?? null;
}

function rallyWinInstances(args: BuilderArgs, bucket?: "short" | "medium" | "long"): TopicInstance[] {
  const { player, rallies } = args;
  return rallies
    .filter((r) => bucket == null || bucketOf(r.shot_count) === bucket)
    .map((r) => ({
      id: `${r.id}-rally-win`,
      rallyId: r.id,
      rallyIndex: r.rally_index,
      seekMs: r.start_ms,
      passed: r.winning_team === player.team,
      note: r.winning_team === player.team ? undefined : "Team lost the rally",
    }));
}

function shotShareInstances(args: BuilderArgs): TopicInstance[] {
  const { player, rallies, shots } = args;
  // Group shots by rally, count how many this player hit.
  const myShotsByRally = new Map<string, number>();
  for (const s of shots) {
    if (s.player_index !== player.player_index) continue;
    myShotsByRally.set(s.rally_id, (myShotsByRally.get(s.rally_id) ?? 0) + 1);
  }
  return rallies.map((r) => {
    const mine = myShotsByRally.get(r.id) ?? 0;
    return {
      id: `${r.id}-shot-share`,
      rallyId: r.id,
      rallyIndex: r.rally_index,
      seekMs: r.start_ms,
      passed: mine > 0,
      note: mine > 0 ? `Hit ${mine} shot${mine === 1 ? "" : "s"}` : "Didn't hit a shot",
    };
  });
}

function kitchenArrivalInstances(
  args: BuilderArgs,
  side: "serving" | "returning",
): TopicInstance[] {
  const { player, rallies, shots, playersByIndex, augmented } = args;
  if (!augmented) return [];
  const out: TopicInstance[] = [];
  for (let i = 0; i < augmented.rallies.length; i++) {
    const aRally = augmented.rallies[i];
    if (aRally.scoring_info?.likely_bad) continue;
    const dbRally = rallies.find((r) => r.rally_index === i);
    if (!dbRally) continue;

    const servingTeam = servingTeamOf(dbRally.id, shots, playersByIndex);
    if (servingTeam == null) continue;
    const playerWasOnServingSide = servingTeam === player.team;
    const matchesSide =
      side === "serving" ? playerWasOnServingSide : !playerWasOnServingSide;
    if (!matchesSide) continue;

    const playerEntry = aRally.players?.[player.player_index];
    if (!playerEntry) continue;
    if (!playerEntry.had_arrival_opportunity) continue; // skip — not in the denominator

    const arrived = (playerEntry.kitchen_arrivals?.length ?? 0) > 0;
    out.push({
      id: `${dbRally.id}-kitchen-${side}`,
      rallyId: dbRally.id,
      rallyIndex: dbRally.rally_index,
      seekMs: dbRally.start_ms,
      passed: arrived,
      note: arrived ? undefined : "Didn't reach the kitchen",
    });
  }
  return out;
}

// ─────────────────────────── Public entrypoint ───────────────────────────

/** Build a ReviewTopic for one (player, stat_key) — instances list may be
 *  empty when augmented data is still loading or when a kitchen-arrival
 *  stat has no opportunities. The TopicItem renders gracefully on empty. */
export function buildStatReviewTopic(args: {
  statKey: string;
  player: PlayerInfo;
  playersByIndex: Map<number, PlayerInfo>;
  rallies: Pick<Rally, "id" | "rally_index" | "start_ms" | "winning_team" | "shot_count">[];
  shots: RallyShot[];
  augmented?: AugmentedInsights | null;
  recommendation?: TopicRecommendation | null;
}): ReviewTopic {
  const def = getStatDef(args.statKey);
  const builderArgs: BuilderArgs = {
    player: args.player,
    playersByIndex: args.playersByIndex,
    rallies: args.rallies,
    shots: args.shots,
    augmented: args.augmented ?? null,
  };

  let instances: TopicInstance[] = [];
  switch (args.statKey) {
    case "stat.rally_win":
      instances = rallyWinInstances(builderArgs);
      break;
    case "stat.rally_win.short":
      instances = rallyWinInstances(builderArgs, "short");
      break;
    case "stat.rally_win.medium":
      instances = rallyWinInstances(builderArgs, "medium");
      break;
    case "stat.rally_win.long":
      instances = rallyWinInstances(builderArgs, "long");
      break;
    case "stat.shot_share":
      instances = shotShareInstances(builderArgs);
      break;
    case "stat.kitchen_arrival.serving":
      instances = kitchenArrivalInstances(builderArgs, "serving");
      break;
    case "stat.kitchen_arrival.returning":
      instances = kitchenArrivalInstances(builderArgs, "returning");
      break;
    default:
      instances = [];
  }

  const correct = instances.filter((i) => i.passed).length;
  const total = instances.length;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  // Rally-outcome stats reframe as "watch the rallies" rather than
  // pass/fail per attempt — coach is reviewing team tactics, not
  // grading execution. Every rally still gets a green-won / red-lost
  // tint for at-a-glance team-vs-team signal.
  const mode: TopicMode = args.statKey.startsWith("stat.rally_win")
    ? "outcome"
    : "skill";

  return {
    id: args.statKey as TopicId,
    section: "script", // unused for stat reviews; satisfies the type
    icon: def.icon,
    title: def.title,
    subtitle: def.subtitle,
    correct,
    total,
    pct,
    instances,
    recommendation: args.recommendation ?? null,
    mode,
  };
}

/** Returns true if a given stat_key requires PB Vision augmented insights
 *  to compute its instances (so the panel knows when to fire the fetch). */
export function statRequiresAugmented(statKey: string): boolean {
  return statKey === "stat.kitchen_arrival.serving" ||
    statKey === "stat.kitchen_arrival.returning";
}
