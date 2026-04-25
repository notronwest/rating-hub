/**
 * StatReviewPanel — the new "📐 Stats to Review" section on the Coach
 * Review page. Sits between WMPC Analysis and the Review Queue.
 *
 * Each entry the coach added on the Game Stats view becomes a topic row
 * here, scoped to the currently-selected player. Topics render via the
 * exported `TopicItem` shell from WmpcAnalysisPanel — same FPTM editor,
 * drills, overall note, instance timeline, and looped video clip as a
 * WMPC pattern. Recommendations persist on the existing
 * `analysis_topic_recommendations` table using the stat_key as the
 * topic_id, so no new editor or schema is needed.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  listStatReviews,
  listTopicRecommendations,
  upsertTopicRecommendation,
} from "../../lib/coachApi";
import {
  buildStatReviewTopic,
  fetchAugmentedInsights,
  statRequiresAugmented,
} from "../../lib/statReviewSource";
import { isTopicAddressed, type TopicRecommendation } from "../../lib/reviewTopics";
import type { CoachStatReview } from "../../types/coach";
import type { PlayerInfo } from "../../lib/firstFourShots";
import type { Rally, RallyShot } from "../../types/database";
import { TopicItem } from "./WmpcAnalysisPanel";

interface Props {
  analysisId: string | null;
  player: PlayerInfo | null;
  /** All players in the game — needed to map shot player_indexes back
   *  to teams when computing per-rally pass/fail. */
  players: PlayerInfo[];
  rallies: Pick<Rally, "id" | "rally_index" | "start_ms" | "winning_team" | "shot_count">[];
  shots: RallyShot[];
  /** Game's PB Vision video id and session — used to lazy-fetch augmented
   *  insights when a kitchen-arrival stat is added. */
  pbvVideoId: string;
  sessionIndex: number;
  /** For the video player on each expanded topic. */
  playbackId: string | null;
  posterUrl: string;
  /** Deep link target for the empty state — points back at Game Stats. */
  orgSlug: string;
  gameId: string;
  /** Coach-tagged flags from Analyze. Used to decorate timeline tiles
   *  for rallies the coach has already flagged, matching WmpcAnalysisPanel. */
  flags?: Array<{ shot_id: string }>;
}

export default function StatReviewPanel({
  analysisId,
  player,
  players,
  rallies,
  shots,
  pbvVideoId,
  sessionIndex,
  playbackId,
  posterUrl,
  orgSlug,
  gameId,
  flags = [],
}: Props) {
  const flaggedRallyIds = useMemo(() => {
    const shotToRally = new Map(shots.map((s) => [s.id, s.rally_id]));
    const out = new Set<string>();
    for (const f of flags) {
      const rallyId = shotToRally.get(f.shot_id);
      if (rallyId) out.add(rallyId);
    }
    return out;
  }, [shots, flags]);
  const [reviews, setReviews] = useState<CoachStatReview[]>([]);
  const [recsByStat, setRecsByStat] = useState<Map<string, TopicRecommendation>>(
    new Map(),
  );
  const [augmented, setAugmented] = useState<Awaited<
    ReturnType<typeof fetchAugmentedInsights>
  > | null>(null);
  const [openStatKey, setOpenStatKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Load stat reviews + matching recommendations when (analysis, player) changes.
  useEffect(() => {
    if (!analysisId || !player) {
      setReviews([]);
      setRecsByStat(new Map());
      return;
    }
    let cancelled = false;
    setLoading(true);
    Promise.all([
      listStatReviews(analysisId),
      listTopicRecommendations(analysisId, player.id),
    ])
      .then(([rs, recs]) => {
        if (cancelled) return;
        setReviews(rs.filter((r) => r.player_id === player.id));
        const m = new Map<string, TopicRecommendation>();
        for (const r of recs) {
          if (!r.topic_id.startsWith("stat.")) continue;
          m.set(r.topic_id, {
            id: r.id,
            recommendation: r.recommendation,
            tags: r.tags,
            dismissed: r.dismissed,
            fptm: r.fptm,
            drills: r.drills,
            updated_at: r.updated_at,
          });
        }
        setRecsByStat(m);
      })
      .catch((e) => console.error("StatReviewPanel load failed:", e))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [analysisId, player?.id]);

  // Reset open topic when the player switches.
  useEffect(() => {
    setOpenStatKey(null);
  }, [player?.id]);

  // Lazy-fetch augmented insights as soon as any kitchen-arrival stat is
  // present in the visible list. One fetch per game, cached at the module
  // level — switching players doesn't refetch.
  useEffect(() => {
    if (!pbvVideoId) return;
    if (!reviews.some((r) => statRequiresAugmented(r.stat_key))) return;
    if (augmented) return;
    let cancelled = false;
    fetchAugmentedInsights(pbvVideoId, sessionIndex)
      .then((data) => {
        if (!cancelled) setAugmented(data);
      })
      .catch((e) => console.error("Augmented fetch failed:", e));
    return () => {
      cancelled = true;
    };
  }, [reviews, pbvVideoId, sessionIndex, augmented]);

  // Build topic objects from the stat reviews + recs + game data.
  const playersByIndex = useMemo(
    () => new Map(players.map((p) => [p.player_index, p])),
    [players],
  );
  const topics = useMemo(() => {
    if (!player) return [];
    return reviews.map((r) =>
      buildStatReviewTopic({
        statKey: r.stat_key,
        player,
        playersByIndex,
        rallies,
        shots,
        augmented,
        recommendation: recsByStat.get(r.stat_key) ?? null,
      }),
    );
  }, [reviews, player, playersByIndex, rallies, shots, augmented, recsByStat]);

  const addressedCount = topics.filter(isTopicAddressed).length;

  async function saveTopic(
    statKey: string,
    patch: {
      recommendation?: string | null;
      tags?: string[];
      dismissed?: boolean;
      fptm?: unknown;
      drills?: string | null;
    },
  ) {
    if (!analysisId || !player) return;
    const current = recsByStat.get(statKey);
    const next = await upsertTopicRecommendation({
      analysisId,
      playerId: player.id,
      topicId: statKey,
      recommendation: patch.recommendation ?? current?.recommendation ?? null,
      tags: patch.tags ?? current?.tags ?? [],
      dismissed: patch.dismissed ?? current?.dismissed ?? false,
      fptm: patch.fptm ?? current?.fptm ?? null,
      drills: patch.drills ?? current?.drills ?? null,
    });
    setRecsByStat((prev) => {
      const m = new Map(prev);
      m.set(statKey, {
        id: next.id,
        recommendation: next.recommendation,
        tags: next.tags,
        dismissed: next.dismissed,
        fptm: next.fptm,
        drills: next.drills,
        updated_at: next.updated_at,
      });
      return m;
    });
  }

  function handleToggle(statKey: string) {
    setOpenStatKey((prev) => (prev === statKey ? null : statKey));
  }

  function advanceFrom(statKey: string) {
    const idx = topics.findIndex((t) => t.id === statKey);
    const next = topics[idx + 1];
    setOpenStatKey(next?.id ?? null);
  }

  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 10,
        overflow: "hidden",
        marginBottom: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 14px",
          fontSize: 13,
          fontWeight: 700,
          background: "#fafafa",
          borderBottom: "1px solid #eee",
        }}
      >
        <span>📐 Stats to Review</span>
        <span style={{ fontWeight: 400, color: "#666", fontSize: 12 }}>
          Per-stat rally instances pulled from Game Stats.
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "#666", fontWeight: 500 }}>
          {loading
            ? "Loading…"
            : topics.length === 0
            ? "Nothing to review"
            : `${addressedCount} of ${topics.length} addressed`}
        </span>
      </div>

      {topics.length === 0 ? (
        <EmptyState orgSlug={orgSlug} gameId={gameId} hasPlayer={!!player} />
      ) : (
        topics.map((t) => (
          <TopicItem
            key={t.id}
            topic={t}
            isOpen={openStatKey === t.id}
            onToggle={() => handleToggle(t.id)}
            playbackId={playbackId}
            posterUrl={posterUrl}
            onSave={(patch) => saveTopic(t.id, patch)}
            onAdvance={() => advanceFrom(t.id)}
            flaggedRallyIds={flaggedRallyIds}
            shots={shots}
          />
        ))
      )}
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────

function EmptyState({
  orgSlug,
  gameId,
  hasPlayer,
}: {
  orgSlug: string;
  gameId: string;
  hasPlayer: boolean;
}) {
  return (
    <div
      style={{
        padding: "20px 16px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        textAlign: "center",
        color: "#666",
        fontSize: 13,
      }}
    >
      <div style={{ fontSize: 24 }}>📐</div>
      <div style={{ fontWeight: 600, color: "#333" }}>
        No stats added to review yet
      </div>
      <div style={{ maxWidth: 520, lineHeight: 1.5 }}>
        Open the{" "}
        <Link
          to={`/org/${orgSlug}/games/${gameId}`}
          style={{ color: "#1a73e8", textDecoration: "none", fontWeight: 600 }}
        >
          Game Stats view
        </Link>{" "}
        and click <b>+ Add to review</b> next to any per-player stat
        (Kitchen Arrival, Shot Distribution, Rallies Won). Each added stat
        becomes its own coachable topic here — same shell as a WMPC pattern
        with FPTM diagnosis, drills, and a per-rally instance timeline.
      </div>
      {!hasPlayer && (
        <div
          style={{
            fontSize: 12,
            color: "#999",
            fontStyle: "italic",
            marginTop: 4,
          }}
        >
          Pick a player above to see only their added stats.
        </div>
      )}
    </div>
  );
}
