/**
 * Review topics — the WMPC Analysis section on the Coach Review page
 * presents a fixed list of analytical topics for each player. Every topic
 * has a score (X/Y), a list of pass / fail instances each pinned to a
 * video timestamp, and (optionally) a coach recommendation.
 *
 * This module is the single place that maps from the raw analyzers
 * (firstFourShots, defensiveBeats) into the topic view model used by the
 * UI. Adding a new topic = new entry in TOPIC_DEFS + populator.
 */

import {
  computePlayerScripts,
  type PlayerInfo,
  type RallyInfo as ScriptRallyInfo,
  type ScriptCounter,
  type ScriptEvent,
} from "./firstFourShots";
import {
  analyzeDefensiveCoverage,
  type RallyInfo as BeatRallyInfo,
  type CoverageEvent,
  type PlayerCoverageSummary,
} from "./defensiveBeats";
import type { RallyShot } from "../types/database";

/** Stable id used as the DB key for recommendations.
 *
 *  Originally a strict union of WMPC pattern ids; now a plain string
 *  so the new "Stats to Review" topics (stat.kitchen_arrival.serving,
 *  stat.rally_win, stat.shot_share, etc.) flow through the same
 *  TopicItem UI without runtime casts. The known WMPC ids are still
 *  enumerated by TOPIC_DEFS / buildReviewTopics. */
export type TopicId = string;

export interface TopicInstance {
  id: string;            // unique within topic
  rallyId: string;
  rallyIndex: number;
  seekMs: number;
  passed: boolean;
  note?: string;
}

export interface ReviewTopic {
  id: TopicId;
  section: "script" | "beats";
  icon: string;
  title: string;
  subtitle: string;       // descriptor shown in the collapsed row
  correct: number;
  total: number;
  pct: number;             // 0–100
  instances: TopicInstance[];
  /** Recommendation + dismiss state from DB — null if nothing saved yet. */
  recommendation: TopicRecommendation | null;
}

export interface TopicRecommendation {
  id: string;
  recommendation: string | null;
  tags: string[];
  dismissed: boolean;
  fptm: unknown;
  drills: string | null;
  updated_at: string;
}

/** True iff this topic counts as "addressed" for progress tracking. */
export function isTopicAddressed(t: ReviewTopic): boolean {
  const r = t.recommendation;
  if (!r) return false;
  if (r.dismissed) return true;
  if (r.recommendation && r.recommendation.trim().length > 0) return true;
  if (r.drills && r.drills.trim().length > 0) return true;
  const fptm = r.fptm as Record<string, unknown> | null;
  if (fptm && Object.keys(fptm).length > 0) return true;
  return false;
}

/** Map a ScriptCounter into a TopicInstance[] (one per event). */
function scriptCounterToInstances(
  counter: ScriptCounter,
  prefix: string,
): TopicInstance[] {
  return counter.events.map((ev: ScriptEvent, i: number) => ({
    id: `${prefix}-${ev.rallyId}-${i}`,
    rallyId: ev.rallyId,
    rallyIndex: ev.rallyIndex,
    seekMs: ev.seekMs,
    passed: ev.passed,
    note: ev.note,
  }));
}

function coverageEventsToInstances(
  events: CoverageEvent[],
  prefix: string,
): TopicInstance[] {
  return events.map((ev, i) => ({
    id: `${prefix}-${ev.rallyId}-${i}`,
    rallyId: ev.rallyId,
    rallyIndex: ev.rallyIndex,
    seekMs: ev.seekMs,
    passed: ev.passed,
    // Fail zone gives a useful hint in the list; passes don't need one
    note: ev.passed ? undefined : `beat · ${ev.zone}`,
  }));
}

/**
 * Build the full 6-topic list for one player, wired up with recommendations.
 */
export function buildReviewTopics(args: {
  player: PlayerInfo;
  shots: RallyShot[];
  rallies: Array<ScriptRallyInfo & BeatRallyInfo>;
  players: PlayerInfo[];
  recommendationsByTopic: Map<TopicId, TopicRecommendation>;
}): ReviewTopic[] {
  const { player, shots, rallies, players, recommendationsByTopic } = args;

  // Script topics
  const scripts = computePlayerScripts(shots, rallies, players);
  const mine = scripts.find((s) => s.player.id === player.id);

  // Defensive coverage
  const coverage = analyzeDefensiveCoverage(shots, rallies, players);
  const myCoverage: PlayerCoverageSummary | undefined = coverage.perPlayer.find(
    (c) => c.player.id === player.id,
  );

  const pct = (c: number, t: number) => (t > 0 ? Math.round((c / t) * 100) : 0);

  const topics: ReviewTopic[] = [];

  if (mine) {
    topics.push({
      id: "script.deep_serve",
      section: "script",
      icon: "🎬",
      title: "Deep serve",
      subtitle: "Scripted opening · serve lands in the deep zone",
      correct: mine.deepServe.correct,
      total: mine.deepServe.total,
      pct: pct(mine.deepServe.correct, mine.deepServe.total),
      instances: scriptCounterToInstances(mine.deepServe, "serve"),
      recommendation: recommendationsByTopic.get("script.deep_serve") ?? null,
    });
    topics.push({
      id: "script.deep_return_kitchen",
      // Copy reflects the relaxed rule — the only explicit failure mode on
      // the return side is a short return; otherwise reaching the kitchen is
      // what matters.
      section: "script",
      icon: "🎬",
      title: "Deep return + kitchen",
      subtitle: "Scripted opening · return (not short) & arrival at the NVZ",
      correct: mine.deepReturnPlusKitchen.correct,
      total: mine.deepReturnPlusKitchen.total,
      pct: pct(mine.deepReturnPlusKitchen.correct, mine.deepReturnPlusKitchen.total),
      instances: scriptCounterToInstances(mine.deepReturnPlusKitchen, "retkt"),
      recommendation: recommendationsByTopic.get("script.deep_return_kitchen") ?? null,
    });
    topics.push({
      id: "script.third_drop",
      section: "script",
      icon: "🎬",
      title: "3rd-shot drop",
      subtitle: "Scripted opening · reset to the kitchen by the 5th shot",
      correct: mine.thirdDrop.correct,
      total: mine.thirdDrop.total,
      pct: pct(mine.thirdDrop.correct, mine.thirdDrop.total),
      instances: scriptCounterToInstances(mine.thirdDrop, "third"),
      recommendation: recommendationsByTopic.get("script.third_drop") ?? null,
    });
    topics.push({
      id: "script.fourth_volley",
      section: "script",
      icon: "🎬",
      title: "4th out of the air",
      subtitle: "Scripted opening · 4th shot taken as a volley",
      correct: mine.fourthVolley.correct,
      total: mine.fourthVolley.total,
      pct: pct(mine.fourthVolley.correct, mine.fourthVolley.total),
      instances: scriptCounterToInstances(mine.fourthVolley, "fourth"),
      recommendation: recommendationsByTopic.get("script.fourth_volley") ?? null,
    });
  }

  if (myCoverage) {
    topics.push({
      id: "beats.direct",
      section: "beats",
      icon: "🛡",
      title: "Direct defender coverage",
      subtitle: "Line + own body · attacks at your sideline/body",
      correct: myCoverage.directPasses,
      total: myCoverage.directAttempts,
      pct: pct(myCoverage.directPasses, myCoverage.directAttempts),
      instances: coverageEventsToInstances(
        myCoverage.events.filter((e) => e.role === "direct"),
        "direct",
      ),
      recommendation: recommendationsByTopic.get("beats.direct") ?? null,
    });
    topics.push({
      id: "beats.diagonal",
      section: "beats",
      icon: "🛡",
      title: "Diagonal defender coverage",
      subtitle: "Middle + cross-body · attacks through the gap & at you",
      correct: myCoverage.diagonalPasses,
      total: myCoverage.diagonalAttempts,
      pct: pct(myCoverage.diagonalPasses, myCoverage.diagonalAttempts),
      instances: coverageEventsToInstances(
        myCoverage.events.filter((e) => e.role === "diagonal"),
        "diagonal",
      ),
      recommendation: recommendationsByTopic.get("beats.diagonal") ?? null,
    });
  }

  return topics;
}
