import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../supabase";
import type { Player, PlayerAggregate } from "../types/database";
import RatingsOverTime, { type RatingSnapshot } from "../components/charts/RatingsOverTime";
import WinRateDonut from "../components/charts/WinRateDonut";
import ShotTypeDonut from "../components/charts/ShotTypeDonut";
import PlayStyleGauge from "../components/charts/PlayStyleGauge";
import ServeSpeedHistogram from "../components/charts/ServeSpeedHistogram";
import PlayerRatingReportEmbed from "../components/report/PlayerRatingReportEmbed";
import SendRatingReportPdfButton from "../components/report/SendRatingReportPdfButton";

// Colored "Skill Ratings" cards restored from the earlier profile
// layout. Colors intentionally match the RatingsOverTime chart below so
// a reader can visually tie a card (e.g. orange Serve) to its line on
// the trend chart. The Overall rating is rendered separately in a
// bigger format beside the cards.
const RATING_CARDS: { key: string; label: string; color: string }[] = [
  { key: "serve", label: "Serve", color: "#e8710a" },
  { key: "return", label: "Return", color: "#0d904f" },
  { key: "offense", label: "Offense", color: "#d93025" },
  { key: "defense", label: "Defense", color: "#9334e6" },
  { key: "agility", label: "Agility", color: "#00bcd4" },
  { key: "consistency", label: "Consistency", color: "#e91e90" },
];

interface GamePlayerStats {
  played_at: string | null;
  shot_selection: Record<string, number> | null;
  serve_depth: Record<string, number> | null;
  return_depth: Record<string, number> | null;
  serve_speed_dist: number[] | null;
  kitchen_arrivals_summary: { serving_side?: number; receiving_side?: number } | null;
  num_rallies: number | null;
  num_rallies_won: number | null;
}

type ViewMode = "sessions" | "games";

export default function PlayerDetailPage() {
  const { orgId, slug } = useParams();
  const [player, setPlayer] = useState<Player | null>(null);
  const [agg, setAgg] = useState<PlayerAggregate | null>(null);
  const [ratingSnapshots, setRatingSnapshots] = useState<RatingSnapshot[]>([]);
  const [gameStats, setGameStats] = useState<GamePlayerStats[]>([]);
  const [recentStats, setRecentStats] = useState<{
    recentWon: number;
    recentTotal: number;
  }>({ recentWon: 0, recentTotal: 0 });
  // Return-speed distribution, computed from rally_shots (PBV doesn't
  // export an aggregated return_speed_dist on game_players the way it
  // does for serve). Same 17-bucket shape as serve_speed_dist so the
  // existing histogram component renders it directly.
  const [returnSpeedDist, setReturnSpeedDist] = useState<number[] | null>(null);
  const [loading, setLoading] = useState(true);
  // Sliding-window size for the embedded rating report. Matches the
  // options on the standalone /rating-report page.
  const [windowSize, setWindowSize] = useState<number>(6);
  const WINDOW_OPTIONS = [3, 6, 10, 20];

  useEffect(() => {
    if (!orgId || !slug) return;

    (async () => {
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgId)
        .single();
      if (!org) { setLoading(false); return; }

      const { data: p } = await supabase
        .from("players")
        .select("*")
        .eq("org_id", org.id)
        .eq("slug", slug)
        .single();
      if (!p) { setLoading(false); return; }
      setPlayer(p);

      // We still need the 10-most-recent win/loss slice for the Games Won
      // donut (the embed only covers the last 6 games so it doesn't
      // replace that stat). `histRes` is a lighter query than before —
      // just won + played_at.
      const [aggRes, snapshotRes, histRes, statsRes] = await Promise.all([
        supabase
          .from("player_aggregates")
          .select("*")
          .eq("player_id", p.id)
          .maybeSingle(),
        supabase
          .from("player_rating_snapshots")
          .select("played_at, rating_overall, rating_serve, rating_return, rating_offense, rating_defense, rating_agility, rating_consistency")
          .eq("player_id", p.id)
          .order("played_at", { ascending: true }),
        supabase
          .from("game_players")
          .select("won, games!inner(played_at)")
          .eq("player_id", p.id)
          .order("created_at", { ascending: false })
          .limit(10),
        supabase
          .from("game_players")
          .select(`
            shot_selection, serve_depth, return_depth, serve_speed_dist,
            kitchen_arrivals_summary, num_rallies, num_rallies_won,
            games!inner ( played_at )
          `)
          .eq("player_id", p.id)
          .order("created_at", { ascending: true }),
      ]);

      setAgg(aggRes.data);
      setRatingSnapshots(snapshotRes.data ?? []);

      const recentRows = (histRes.data ?? []) as Array<{ won: boolean | null }>;
      setRecentStats({
        recentWon: recentRows.filter((r) => r.won === true).length,
        recentTotal: recentRows.length,
      });

      // Flatten game stats for charts
      const stats: GamePlayerStats[] = (statsRes.data ?? []).map((gp: Record<string, unknown>) => {
        const g = gp.games as Record<string, unknown>;
        return {
          played_at: g?.played_at as string | null,
          shot_selection: gp.shot_selection as Record<string, number> | null,
          serve_depth: gp.serve_depth as Record<string, number> | null,
          return_depth: gp.return_depth as Record<string, number> | null,
          serve_speed_dist: gp.serve_speed_dist as number[] | null,
          kitchen_arrivals_summary: gp.kitchen_arrivals_summary as { serving_side?: number; receiving_side?: number } | null,
          num_rallies: gp.num_rallies as number | null,
          num_rallies_won: gp.num_rallies_won as number | null,
        };
      });
      setGameStats(stats);

      // ── Return speed distribution ──
      // PBV doesn't expose a game_players.return_speed_dist, so we
      // derive it from rally_shots. For each game the player played,
      // remember the player_index (it varies per game) — then pull
      // this player's return shots and bucket their mph into the same
      // 17-wide buckets the serve histogram uses.
      const { data: gpIndices } = await supabase
        .from("game_players")
        .select("game_id, player_index")
        .eq("player_id", p.id);
      const indexByGame = new Map<string, number>(
        (gpIndices ?? []).map((g: Record<string, unknown>) => [
          g.game_id as string,
          g.player_index as number,
        ]),
      );
      if (indexByGame.size > 0) {
        const gameIds = Array.from(indexByGame.keys());
        // Two filters: shot_type='return' AND rally_shots belonging to
        // one of this player's games. speed_mph is nullable, so we
        // skip nulls client-side (Supabase has no compound "not null"
        // filter on foreign keys worth the complexity here).
        const { data: returnShots } = await supabase
          .from("rally_shots")
          .select("speed_mph, player_index, rallies!inner(game_id)")
          .eq("shot_type", "return")
          .in("rallies.game_id", gameIds);
        const speeds: number[] = ((returnShots ?? []) as Array<{
          speed_mph: number | null;
          player_index: number | null;
          rallies: { game_id: string };
        }>)
          .filter((r) => {
            if (r.speed_mph == null || r.player_index == null) return false;
            // player_index varies per game — only keep shots that this
            // player actually hit.
            return indexByGame.get(r.rallies.game_id) === r.player_index;
          })
          .map((r) => r.speed_mph as number);
        setReturnSpeedDist(speeds.length > 0 ? bucketSpeeds(speeds) : null);
      }

      setLoading(false);
    })();
  }, [orgId, slug]);

  if (loading) return <p>Loading…</p>;
  if (!player) return <p>Player not found.</p>;

  // Aggregate stats for the kept chart blocks. Depth + kitchen-bar
  // aggregates were removed when those sections moved to the embedded
  // rating report.
  const avgShotSelection = aggregateAvg(gameStats.map((g) => g.shot_selection));
  const avgServeSpeed = aggregateSpeedDist(gameStats.map((g) => g.serve_speed_dist));
  const totalRallies = gameStats.reduce((s, g) => s + (g.num_rallies ?? 0), 0);
  const totalRalliesWon = gameStats.reduce((s, g) => s + (g.num_rallies_won ?? 0), 0);

  // Match the Ratings Over Time chart to the selected window. The raw
  // snapshots are already in ascending chronological order; take the
  // trailing `windowSize` entries so the chart scopes to the same
  // games as the Skill Ratings + Rating Report below. When a player
  // has fewer snapshots than the window, we just show what's there.
  const windowedSnapshots =
    ratingSnapshots.length > windowSize
      ? ratingSnapshots.slice(-windowSize)
      : ratingSnapshots;

  return (
    <div style={{ maxWidth: 960 }}>
      {/* ── Page nav ── The SendRatingReportPdfButton captures the whole
            `.ppd-page` container below (embed + kept stat blocks), so
            what the coach sees is what the player gets. ── */}
      <div
        className="ppd-noprint"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <Link
          to={`/org/${orgId}/players`}
          style={{ fontSize: 12, color: "#1a73e8", textDecoration: "none" }}
        >
          ← All players
        </Link>
        <span style={{ flex: 1 }} />
        {/* Window-size toggle — picks how many of the most recent
            games feed the rating report. Default 6 matches the PDF
            the club has historically distributed. */}
        <span style={{ fontSize: 11, color: "#888" }}>Window:</span>
        <div
          style={{
            display: "inline-flex",
            border: "1px solid #e2e2e2",
            borderRadius: 6,
            overflow: "hidden",
          }}
        >
          {WINDOW_OPTIONS.map((n) => {
            const active = n === windowSize;
            return (
              <button
                key={n}
                onClick={() => setWindowSize(n)}
                style={{
                  padding: "5px 10px",
                  fontSize: 12,
                  fontWeight: active ? 700 : 500,
                  background: active ? "#1a73e8" : "#fff",
                  color: active ? "#fff" : "#333",
                  border: "none",
                  borderRight: "1px solid #e2e2e2",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {n}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => window.print()}
          style={{
            padding: "5px 12px",
            fontSize: 12,
            fontWeight: 600,
            background: "#fff",
            color: "#1a73e8",
            border: "1px solid #1a73e8",
            borderRadius: 6,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          🖨 Print / Save as PDF
        </button>
        <SendRatingReportPdfButton
          targetSelector=".ppd-page"
          playerId={player.id}
          playerEmail={player.email}
          playerDisplayName={player.display_name}
        />
      </div>

      {/* ── ppd-page: the PDF capture target.
            The embed owns the layout end-to-end now. We inject the
            color-coded Skill Ratings cards via `skillRatingsSlot`
            (replaces the default sparkline row) and the kept
            page-level charts via `afterSkillRatingsSlot` so they
            land between Skill Ratings and the Key Stats block. ── */}
      <div className="ppd-page">
        <PlayerRatingReportEmbed
          playerId={player.id}
          windowSize={windowSize}
          skillRatingsSlot={
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(6, 1fr)",
                gap: 10,
              }}
            >
              {RATING_CARDS.map(({ key, label, color }) => {
                const val = agg?.[
                  `latest_rating_${key}` as keyof PlayerAggregate
                ] as number | null;
                return (
                  <div
                    key={key}
                    style={{
                      padding: "10px 14px",
                      borderRadius: 8,
                      background: color + "18",
                      borderLeft: `3px solid ${color}`,
                      textAlign: "center",
                    }}
                  >
                    <div
                      style={{
                        fontSize: 10,
                        color: "#888",
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                        fontWeight: 700,
                      }}
                    >
                      {label}
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color }}>
                      {val?.toFixed(2) ?? "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          }
          afterSkillRatingsSlot={
            <>
              {/* Ratings Over Time — same color palette as the cards
                  above so lines visually tie back. */}
              <div style={{ marginBottom: 28 }}>
                <RatingsOverTime data={windowedSnapshots} />
              </div>

              {/* Player Overview: Win rates + Play Style + Shot Type.
                  Fixed 4-column grid so at PDF letter width all four
                  donuts fit in one row — `auto-fit` was wrapping Shot
                  Type onto a second row which put a page break
                  between its heading and its chart. The outer block
                  AND each chart both carry break-inside:avoid so
                  html2pdf keeps the whole thing on one page. */}
              <div
                className="ppd-overview-grid"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
                  gap: 12,
                  marginBottom: 28,
                  background: "#f8f9fa",
                  border: "1px solid #e2e2e2",
                  borderRadius: 12,
                  padding: 16,
                  breakInside: "avoid",
                  pageBreakInside: "avoid",
                }}
              >
                {agg && (
                  <div style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
                    <WinRateDonut
                      title="Games Won"
                      won={agg.games_won}
                      total={agg.games_played}
                      recentWon={recentStats.recentWon}
                      recentTotal={recentStats.recentTotal}
                    />
                  </div>
                )}
                {totalRallies > 0 && (
                  <div style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
                    <WinRateDonut
                      title="Rallies Won"
                      won={totalRalliesWon}
                      total={totalRallies}
                    />
                  </div>
                )}
                {avgShotSelection && (
                  <div style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
                    <PlayStyleGauge shotSelection={avgShotSelection} />
                  </div>
                )}
                {avgShotSelection && (
                  <div style={{ breakInside: "avoid", pageBreakInside: "avoid" }}>
                    <ShotTypeDonut shotSelection={avgShotSelection} />
                  </div>
                )}
              </div>

              {/* Serve Speed + Return Speed, side by side. Serve uses
                  PBV's pre-bucketed distribution; Return is bucketed
                  client-side from rally_shots since PBV doesn't emit
                  an aggregated return distribution. One column falls
                  back to full width if the other side is empty. */}
              {(avgServeSpeed || returnSpeedDist) && (
                <div
                  className="ppd-speed-grid"
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      avgServeSpeed && returnSpeedDist ? "1fr 1fr" : "1fr",
                    gap: 20,
                    marginBottom: 28,
                    // Keep both speed histograms on one page together.
                    // Individually each card has break-inside: avoid,
                    // but the grid wasn't atomic — which caused the
                    // Serve card's title to end up on a different page
                    // from its chart body when the earlier content
                    // pushed it over a boundary.
                    breakInside: "avoid",
                    pageBreakInside: "avoid",
                  }}
                >
                  {avgServeSpeed && (
                    <ServeSpeedHistogram
                      distribution={avgServeSpeed}
                      title="Serve Speed"
                      color="#5e35b1"
                    />
                  )}
                  {returnSpeedDist && (
                    <ServeSpeedHistogram
                      distribution={returnSpeedDist}
                      title="Return Speed"
                      color="#0d904f"
                    />
                  )}
                </div>
              )}
            </>
          }
        />
      </div>
    </div>
  );
}

// ── Utility: average a list of Record<string, number> objects ──

function aggregateAvg(
  items: (Record<string, number> | null | undefined)[],
): Record<string, number> | null {
  const valid = items.filter((x): x is Record<string, number> => x != null);
  if (valid.length === 0) return null;
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const item of valid) {
    for (const [k, v] of Object.entries(item)) {
      sums[k] = (sums[k] ?? 0) + v;
      counts[k] = (counts[k] ?? 0) + 1;
    }
  }
  const result: Record<string, number> = {};
  for (const k of Object.keys(sums)) {
    result[k] = sums[k] / counts[k];
  }
  return result;
}

function aggregateSpeedDist(
  items: (number[] | null | undefined)[],
): number[] | null {
  const valid = items.filter((x): x is number[] => x != null && x.length > 0);
  if (valid.length === 0) return null;
  const len = valid[0].length;
  const result = new Array(len).fill(0);
  for (const arr of valid) {
    for (let i = 0; i < len; i++) {
      result[i] += arr[i] ?? 0;
    }
  }
  for (let i = 0; i < len; i++) {
    result[i] /= valid.length;
  }
  return result;
}

// Bucket a flat list of mph values into the same 17-bin distribution
// shape PBV uses for serve_speed_dist. Makes the values directly
// renderable by ServeSpeedHistogram. Bucket boundaries:
//   0: < 15,     1..14: 15–17.5, 17.5–20, …, 47.5–50,
//   15: 50–55,   16: ≥ 55.
function bucketSpeeds(speeds: number[]): number[] {
  const buckets = new Array(17).fill(0);
  for (const s of speeds) {
    if (s < 15) buckets[0]++;
    else if (s >= 55) buckets[16]++;
    else if (s >= 50) buckets[15]++;
    else {
      const idx = 1 + Math.floor((s - 15) / 2.5);
      buckets[Math.max(1, Math.min(14, idx))]++;
    }
  }
  const total = speeds.length;
  if (total === 0) return buckets;
  return buckets.map((b) => b / total);
}
