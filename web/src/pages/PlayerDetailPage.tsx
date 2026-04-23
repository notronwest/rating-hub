import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../supabase";
import type { Player, PlayerAggregate } from "../types/database";
import RatingsOverTime, { type RatingSnapshot } from "../components/charts/RatingsOverTime";
import WinRateDonut from "../components/charts/WinRateDonut";
import ShotTypeDonut from "../components/charts/ShotTypeDonut";
import PlayStyleGauge from "../components/charts/PlayStyleGauge";
import ServeSpeedHistogram from "../components/charts/ServeSpeedHistogram";
import DepthDonut from "../components/charts/DepthDonut";
import KitchenArrivalBars, { buildKitchenData } from "../components/charts/KitchenArrivalBars";
import CoachFeedback from "../components/CoachFeedback";

const RATING_CARDS: { key: string; label: string; color: string }[] = [
  { key: "serve", label: "Serve", color: "#e8710a" },
  { key: "return", label: "Return", color: "#0d904f" },
  { key: "offense", label: "Offense", color: "#d93025" },
  { key: "defense", label: "Defense", color: "#9334e6" },
  { key: "agility", label: "Agility", color: "#00bcd4" },
  { key: "consistency", label: "Consistency", color: "#e91e90" },
];

interface GameHistoryRow {
  game_id: string;
  pbvision_video_id: string;
  session_name: string | null;
  played_at: string | null;
  team: number;
  won: boolean | null;
  team0_score: number | null;
  team1_score: number | null;
  rating_overall: number | null;
  shot_count: number | null;
  session_id: string | null;
  session_label: string | null;
  session_played_date: string | null;
}

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
  const [games, setGames] = useState<GameHistoryRow[]>([]);
  const [gameStats, setGameStats] = useState<GamePlayerStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("sessions");

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
          .select(`
            game_id, team, won, rating_overall, shot_count,
            games!inner (
              id, pbvision_video_id, session_name, played_at,
              team0_score, team1_score, session_id,
              sessions ( id, label, played_date )
            )
          `)
          .eq("player_id", p.id)
          .order("created_at", { ascending: false }),
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

      // Flatten game history
      const rows: GameHistoryRow[] = (histRes.data ?? []).map((gp: Record<string, unknown>) => {
        const g = gp.games as Record<string, unknown>;
        const s = g?.sessions as Record<string, unknown> | null;
        return {
          game_id: g?.id as string,
          pbvision_video_id: g?.pbvision_video_id as string,
          session_name: g?.session_name as string | null,
          played_at: g?.played_at as string | null,
          team: gp.team as number,
          won: gp.won as boolean | null,
          team0_score: g?.team0_score as number | null,
          team1_score: g?.team1_score as number | null,
          rating_overall: gp.rating_overall as number | null,
          shot_count: gp.shot_count as number | null,
          session_id: g?.session_id as string | null,
          session_label: s?.label as string | null,
          session_played_date: s?.played_date as string | null,
        };
      });
      rows.sort((a, b) => {
        if (!a.played_at && !b.played_at) return 0;
        if (!a.played_at) return 1;
        if (!b.played_at) return -1;
        return b.played_at.localeCompare(a.played_at);
      });
      setGames(rows);

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
      setLoading(false);
    })();
  }, [orgId, slug]);

  if (loading) return <p>Loading…</p>;
  if (!player) return <p>Player not found.</p>;

  // Aggregate stats across all games for charts
  const avgShotSelection = aggregateAvg(gameStats.map((g) => g.shot_selection));
  const avgServeDepth = aggregateAvg(gameStats.map((g) => g.serve_depth));
  const avgReturnDepth = aggregateAvg(gameStats.map((g) => g.return_depth));
  const avgServeSpeed = aggregateSpeedDist(gameStats.map((g) => g.serve_speed_dist));
  const totalRallies = gameStats.reduce((s, g) => s + (g.num_rallies ?? 0), 0);
  const totalRalliesWon = gameStats.reduce((s, g) => s + (g.num_rallies_won ?? 0), 0);

  // Recent = last 10 games
  const recentGames = games.slice(0, 10);
  const recentWon = recentGames.filter((g) => g.won).length;

  // Kitchen arrival data for bar charts
  const kitchenData = buildKitchenData(gameStats);

  // Session grouping
  const sessionGroups: { sessionId: string; label: string; playedDate: string | null; games: GameHistoryRow[] }[] = [];
  if (view === "sessions") {
    const map = new Map<string, { label: string; playedDate: string | null; games: GameHistoryRow[] }>();
    for (const g of games) {
      const key = g.session_id ?? `ungrouped-${g.game_id}`;
      if (!map.has(key)) {
        map.set(key, {
          label: g.session_label ?? "Session",
          playedDate: g.session_played_date ?? g.played_at?.slice(0, 10) ?? null,
          games: [],
        });
      }
      map.get(key)!.games.push(g);
    }
    for (const [sessionId, group] of map) {
      sessionGroups.push({
        sessionId: sessionId.startsWith("ungrouped-") ? "" : sessionId,
        ...group,
      });
    }
  }

  const toggleStyle = (active: boolean): React.CSSProperties => ({
    padding: "6px 14px",
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    borderTop: active ? "1px solid #1a73e8" : "1px solid #ddd",
    borderBottom: active ? "1px solid #1a73e8" : "1px solid #ddd",
    borderRight: active ? "1px solid #1a73e8" : "1px solid #ddd",
    borderLeft: active ? "1px solid #1a73e8" : "1px solid #ddd",
    background: active ? "#e8f0fe" : "#fff",
    color: active ? "#1a73e8" : "#555",
    cursor: "pointer",
  });

  return (
    <div style={{ maxWidth: 960 }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap", marginBottom: 28 }}>
        {/* Left: name + meta */}
        <div style={{ flex: "1 1 300px" }}>
          <h2 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4, marginTop: 0 }}>
            {player.display_name}
          </h2>
          <div style={{ fontSize: 14, color: "#666", marginBottom: 8 }}>
            {agg ? `${agg.games_played} games` : ""}
          </div>
          <Link
            to={`/org/${orgId}/players/${player.slug}/rating-report`}
            style={{
              display: "inline-block",
              padding: "6px 12px",
              fontSize: 12,
              fontWeight: 600,
              background: "#1a73e8",
              color: "#fff",
              border: "1px solid #1a73e8",
              borderRadius: 6,
              textDecoration: "none",
              fontFamily: "inherit",
            }}
          >
            📄 Rating report
          </Link>
        </div>

        {/* Center: overall rating */}
        {agg?.latest_rating_overall && (
          <div style={{ textAlign: "center", minWidth: 120 }}>
            <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 1 }}>
              Overall Rating
            </div>
            <div style={{ fontSize: 48, fontWeight: 800, color: "#1a73e8", lineHeight: 1.1 }}>
              {agg.latest_rating_overall.toFixed(2)}
            </div>
          </div>
        )}

        {/* Right: 6 rating cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, flex: "0 0 auto" }}>
          {RATING_CARDS.map(({ key, label, color }) => {
            const val = agg?.[`latest_rating_${key}` as keyof PlayerAggregate] as number | null;
            return (
              <div
                key={key}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  background: color + "18",
                  borderLeft: `3px solid ${color}`,
                  minWidth: 90,
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase" }}>{label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, color }}>{val?.toFixed(2) ?? "—"}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Coach Feedback (only renders if there's any) ── */}
      <CoachFeedback playerId={player.id} orgId={orgId ?? ""} />

      {/* ── Ratings Over Time ── */}
      <div style={{ marginBottom: 28 }}>
        <RatingsOverTime data={ratingSnapshots} />
      </div>

      {/* ── Player Overview: Win rates + Play Style + Shot Type ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 20,
          marginBottom: 28,
          background: "#f8f9fa",
          border: "1px solid #e2e2e2",
          borderRadius: 12,
          padding: 20,
        }}
      >
        {agg && (
          <WinRateDonut
            title="Games Won"
            won={agg.games_won}
            total={agg.games_played}
            recentWon={recentWon}
            recentTotal={recentGames.length}
          />
        )}
        {totalRallies > 0 && (
          <WinRateDonut
            title="Rallies Won"
            won={totalRalliesWon}
            total={totalRallies}
          />
        )}
        {avgShotSelection && <PlayStyleGauge shotSelection={avgShotSelection} />}
        {avgShotSelection && <ShotTypeDonut shotSelection={avgShotSelection} />}
      </div>

      {/* ── Serve Speed ── */}
      {avgServeSpeed && (
        <div style={{ marginBottom: 28 }}>
          <ServeSpeedHistogram distribution={avgServeSpeed} />
        </div>
      )}

      {/* ── Depth charts ── */}
      {(avgServeDepth || avgReturnDepth) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 }}>
          {avgServeDepth && (
            <div style={{ background: "#fff", border: "1px solid #e2e2e2", borderRadius: 12, padding: 20 }}>
              <DepthDonut title="Serve Depth" depth={avgServeDepth} />
            </div>
          )}
          {avgReturnDepth && (
            <div style={{ background: "#fff", border: "1px solid #e2e2e2", borderRadius: 12, padding: 20 }}>
              <DepthDonut title="Return Depth" depth={avgReturnDepth} />
            </div>
          )}
        </div>
      )}

      {/* ── Kitchen Arrival ── */}
      {kitchenData.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 }}>
          <KitchenArrivalBars title="Serving Kitchen Arrival %" side="serving" data={kitchenData} />
          <KitchenArrivalBars title="Returning Kitchen Arrival %" side="receiving" data={kitchenData} />
        </div>
      )}

      {/* ── Game History ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 0, marginBottom: 16, marginTop: 8 }}>
        <button
          onClick={() => setView("sessions")}
          style={{ ...toggleStyle(view === "sessions"), borderRadius: "6px 0 0 6px" }}
        >
          Sessions
        </button>
        <button
          onClick={() => setView("games")}
          style={{ ...toggleStyle(view === "games"), borderRadius: "0 6px 6px 0", borderLeftWidth: 0 }}
        >
          All Games
        </button>
      </div>

      {games.length === 0 ? (
        <p style={{ color: "#999" }}>No games found.</p>
      ) : view === "sessions" ? (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Date", "Session", "Games", "Record"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "10px 12px",
                    textAlign: h === "Games" || h === "Record" ? "center" : "left",
                    fontSize: 12, fontWeight: 600, color: "#666",
                    textTransform: "uppercase", letterSpacing: 0.5,
                    borderBottom: "2px solid #eee",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sessionGroups.map((sg) => {
              const wins = sg.games.filter((g) => g.won === true).length;
              const losses = sg.games.filter((g) => g.won === false).length;
              return (
                <tr
                  key={sg.sessionId || sg.games[0]?.game_id}
                  style={{ transition: "background 0.1s" }}
                  onMouseOver={(e) => (e.currentTarget.style.background = "#f8f9fa")}
                  onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", fontSize: 13, color: "#666", whiteSpace: "nowrap" }}>
                    {sg.playedDate
                      ? new Date(sg.playedDate + "T12:00:00").toLocaleDateString(undefined, {
                          weekday: "short", month: "short", day: "numeric", year: "numeric",
                        })
                      : "—"}
                  </td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", fontSize: 14 }}>
                    {sg.sessionId ? (
                      <Link
                        to={`/org/${orgId}/sessions/${sg.sessionId}?from=player&slug=${slug}`}
                        style={{ color: "#1a73e8", textDecoration: "none", fontWeight: 500 }}
                      >
                        {sg.label}
                      </Link>
                    ) : (
                      <span style={{ color: "#333", fontWeight: 500 }}>{sg.label}</span>
                    )}
                  </td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", textAlign: "center", fontWeight: 600 }}>
                    {sg.games.length}
                  </td>
                  <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", textAlign: "center" }}>
                    <span style={{ color: "#1e7e34", fontWeight: 600 }}>{wins}W</span>
                    <span style={{ color: "#999", margin: "0 4px" }}>–</span>
                    <span style={{ color: "#c62828", fontWeight: 600 }}>{losses}L</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Date", "Game", "Score", "W/L", "Rating", "Shots"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "8px 12px",
                    textAlign: h === "Date" || h === "Game" ? "left" : "right",
                    fontSize: 12, fontWeight: 600, color: "#666",
                    textTransform: "uppercase", letterSpacing: 0.5,
                    borderBottom: "2px solid #eee",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {games.map((g) => (
              <tr
                key={g.game_id}
                style={{ transition: "background 0.1s" }}
                onMouseOver={(e) => (e.currentTarget.style.background = "#f8f9fa")}
                onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <td style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0", fontSize: 13, color: "#666" }}>
                  {g.played_at ? new Date(g.played_at).toLocaleDateString() : "—"}
                </td>
                <td style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0" }}>
                  <Link
                    to={`/org/${orgId}/games/${g.game_id}?from=player&slug=${slug}`}
                    style={{ color: "#1a73e8", textDecoration: "none", fontSize: 14 }}
                  >
                    {g.session_name || g.pbvision_video_id}
                  </Link>
                </td>
                <td style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0", textAlign: "right", fontSize: 14 }}>
                  {g.team0_score != null && g.team1_score != null ? `${g.team0_score}–${g.team1_score}` : "—"}
                </td>
                <td style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0", textAlign: "right" }}>
                  <span
                    style={{
                      display: "inline-block", padding: "2px 8px", borderRadius: 4,
                      fontSize: 12, fontWeight: 600,
                      background: g.won ? "#e6f4ea" : "#fce8e6",
                      color: g.won ? "#1e7e34" : "#c62828",
                    }}
                  >
                    {g.won ? "W" : "L"}
                  </span>
                </td>
                <td style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0", textAlign: "right", fontWeight: 600, fontSize: 14 }}>
                  {g.rating_overall?.toFixed(2) ?? "—"}
                </td>
                <td style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0", textAlign: "right", fontSize: 13, color: "#666" }}>
                  {g.shot_count ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
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
