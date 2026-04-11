import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../supabase";
import type { Player, PlayerAggregate, PlayerGameHistoryEntry } from "../types/database";

const RATING_LABELS: { key: string; label: string }[] = [
  { key: "overall", label: "Overall" },
  { key: "serve", label: "Serve" },
  { key: "return", label: "Return" },
  { key: "offense", label: "Offense" },
  { key: "defense", label: "Defense" },
  { key: "agility", label: "Agility" },
  { key: "consistency", label: "Consistency" },
];

export default function PlayerDetailPage() {
  const { orgId, slug } = useParams();
  const [player, setPlayer] = useState<Player | null>(null);
  const [agg, setAgg] = useState<PlayerAggregate | null>(null);
  const [games, setGames] = useState<PlayerGameHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId || !slug) return;

    (async () => {
      // Get org UUID
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgId)
        .single();
      if (!org) { setLoading(false); return; }

      // Get player
      const { data: p } = await supabase
        .from("players")
        .select("*")
        .eq("org_id", org.id)
        .eq("slug", slug)
        .single();
      if (!p) { setLoading(false); return; }
      setPlayer(p);

      // Get aggregates + game history in parallel
      const [aggRes, histRes] = await Promise.all([
        supabase
          .from("player_aggregates")
          .select("*")
          .eq("player_id", p.id)
          .maybeSingle(),
        supabase
          .from("v_player_game_history")
          .select("*")
          .eq("player_id", p.id)
          .order("played_at", { ascending: false }),
      ]);

      setAgg(aggRes.data);
      setGames(histRes.data ?? []);
      setLoading(false);
    })();
  }, [orgId, slug]);

  if (loading) return <p>Loading…</p>;
  if (!player) return <p>Player not found.</p>;

  return (
    <div>
      {/* Header */}
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>
        {player.display_name}
      </h2>
      {agg && (
        <div style={{ display: "flex", gap: 24, fontSize: 14, color: "#666", marginBottom: 24 }}>
          <span>{agg.games_played} games</span>
          <span>{agg.win_rate != null ? `${(agg.win_rate * 100).toFixed(0)}% win rate` : ""}</span>
          <span>Peak: {agg.peak_rating_overall?.toFixed(2) ?? "—"}</span>
        </div>
      )}

      {/* Rating Cards */}
      {agg && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 12, marginBottom: 32 }}>
          {RATING_LABELS.map(({ key, label }) => {
            const latest = agg[`latest_rating_${key}` as keyof PlayerAggregate] as number | null;
            const avg = agg[`avg_rating_${key}` as keyof PlayerAggregate] as number | null;
            return (
              <div
                key={key}
                style={{
                  padding: "14px 16px",
                  border: "1px solid #e2e2e2",
                  borderRadius: 10,
                  background: key === "overall" ? "#f0f4ff" : "#fff",
                }}
              >
                <div style={{ fontSize: 11, color: "#888", textTransform: "uppercase", letterSpacing: 0.5 }}>
                  {label}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>
                  {latest?.toFixed(2) ?? "—"}
                </div>
                <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>
                  avg {avg?.toFixed(2) ?? "—"}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Game History */}
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Game History</h3>

      {games.length === 0 ? (
        <p style={{ color: "#999" }}>No games found.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Date", "Session", "Score", "W/L", "Rating", "Shots"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "8px 12px",
                    textAlign: h === "Date" || h === "Session" ? "left" : "right",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#666",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
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
                <td style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0", fontSize: 13 }}>
                  {g.played_at ? new Date(g.played_at).toLocaleDateString() : "—"}
                </td>
                <td style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0" }}>
                  <Link
                    to={`/org/${orgId}/games/${g.game_id}`}
                    style={{ color: "#1a73e8", textDecoration: "none", fontSize: 14 }}
                  >
                    {g.session_name || g.pbvision_video_id}
                  </Link>
                </td>
                <td style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0", textAlign: "right", fontSize: 14 }}>
                  {g.team0_score != null && g.team1_score != null
                    ? `${g.team0_score}–${g.team1_score}`
                    : "—"}
                </td>
                <td style={{ padding: "8px 12px", borderBottom: "1px solid #f0f0f0", textAlign: "right" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 600,
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
