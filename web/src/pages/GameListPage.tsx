import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../supabase";

interface GameRow {
  id: string;
  session_name: string | null;
  played_at: string | null;
  team0_score: number | null;
  team1_score: number | null;
  num_players: number;
  pbvision_video_id: string;
  scoring_type: string | null;
  total_rallies: number | null;
}

interface GameWithPlayers extends GameRow {
  playerNames: string[];
}

export default function GameListPage() {
  const { orgId } = useParams();
  const [games, setGames] = useState<GameWithPlayers[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!orgId) return;

    (async () => {
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgId)
        .single();
      if (!org) { setLoading(false); return; }

      const { data: gameRows } = await supabase
        .from("games")
        .select("id, session_name, played_at, team0_score, team1_score, num_players, pbvision_video_id, scoring_type, total_rallies")
        .eq("org_id", org.id)
        .order("played_at", { ascending: false });

      if (!gameRows || gameRows.length === 0) {
        setGames([]);
        setLoading(false);
        return;
      }

      // Fetch player names for each game
      const gameIds = gameRows.map((g) => g.id);
      const { data: gpRows } = await supabase
        .from("game_players")
        .select("game_id, player_id, team, player_index")
        .in("game_id", gameIds);

      const playerIds = [...new Set((gpRows ?? []).map((r) => r.player_id))];
      const { data: playerRows } = await supabase
        .from("players")
        .select("id, display_name")
        .in("id", playerIds);

      const playerMap = new Map(
        (playerRows ?? []).map((p) => [p.id, p.display_name]),
      );

      const gamesWithPlayers = gameRows.map((g) => {
        const gps = (gpRows ?? [])
          .filter((gp) => gp.game_id === g.id)
          .sort((a, b) => a.player_index - b.player_index);
        return {
          ...g,
          playerNames: gps.map((gp) => playerMap.get(gp.player_id) ?? "?"),
        };
      });

      setGames(gamesWithPlayers);
      setLoading(false);
    })();
  }, [orgId]);

  const tdStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderBottom: "1px solid #f0f0f0",
    fontSize: 14,
  };

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Games</h2>

      {loading ? (
        <p>Loading…</p>
      ) : games.length === 0 ? (
        <p style={{ color: "#999" }}>No games found. Import some data first.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Date", "Session", "Score", "Players", "Rallies"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "10px 12px",
                    textAlign: h === "Date" || h === "Session" || h === "Players" ? "left" : "right",
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
                key={g.id}
                style={{ transition: "background 0.1s" }}
                onMouseOver={(e) => (e.currentTarget.style.background = "#f8f9fa")}
                onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <td style={{ ...tdStyle, fontSize: 13, color: "#666" }}>
                  {g.played_at ? new Date(g.played_at).toLocaleDateString() : "—"}
                </td>
                <td style={tdStyle}>
                  <Link
                    to={`/org/${orgId}/games/${g.id}`}
                    style={{ color: "#1a73e8", textDecoration: "none", fontWeight: 500 }}
                  >
                    {g.session_name || g.pbvision_video_id}
                  </Link>
                </td>
                <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>
                  {g.team0_score != null && g.team1_score != null
                    ? `${g.team0_score}–${g.team1_score}`
                    : "—"}
                </td>
                <td style={{ ...tdStyle, fontSize: 13, color: "#555" }}>
                  {g.playerNames.join(", ")}
                </td>
                <td style={{ ...tdStyle, textAlign: "right", color: "#666" }}>
                  {g.total_rallies ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
