import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../supabase";
import type { LeaderboardEntry } from "../types/database";

type SortKey = "display_name" | "latest_rating_overall" | "games_played" | "win_rate" | "last_played_at";

export default function PlayerListPage() {
  const { orgId } = useParams();
  const [players, setPlayers] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("latest_rating_overall");
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    if (!orgId) return;
    supabase
      .from("v_leaderboard")
      .select("*")
      .eq("org_id", orgId)
      .then(({ data, error }) => {
        // v_leaderboard filters by org_id UUID, but we have the slug.
        // Query organizations first to get the UUID.
      });

    // Since v_leaderboard has org_id as UUID, we need to resolve it.
    (async () => {
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgId)
        .single();
      if (!org) { setLoading(false); return; }

      const { data } = await supabase
        .from("v_leaderboard")
        .select("*")
        .eq("org_id", org.id);

      setPlayers(data ?? []);
      setLoading(false);
    })();
  }, [orgId]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === "display_name");
    }
  }

  const sorted = [...players].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortAsc ? cmp : -cmp;
  });

  const thStyle = (key: SortKey): React.CSSProperties => ({
    padding: "10px 12px",
    textAlign: key === "display_name" ? "left" : "right",
    cursor: "pointer",
    userSelect: "none",
    fontSize: 12,
    fontWeight: 600,
    color: sortKey === key ? "#1a73e8" : "#666",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    borderBottom: "2px solid #eee",
  });

  const tdStyle = (align: "left" | "right" = "right"): React.CSSProperties => ({
    padding: "10px 12px",
    textAlign: align,
    borderBottom: "1px solid #f0f0f0",
    fontSize: 14,
  });

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Players</h2>

      {loading ? (
        <p>Loading…</p>
      ) : players.length === 0 ? (
        <p style={{ color: "#999" }}>No players found. Import some games first.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle("display_name")} onClick={() => handleSort("display_name")}>
                Name {sortKey === "display_name" ? (sortAsc ? "↑" : "↓") : ""}
              </th>
              <th style={thStyle("latest_rating_overall")} onClick={() => handleSort("latest_rating_overall")}>
                Rating {sortKey === "latest_rating_overall" ? (sortAsc ? "↑" : "↓") : ""}
              </th>
              <th style={thStyle("games_played")} onClick={() => handleSort("games_played")}>
                Games {sortKey === "games_played" ? (sortAsc ? "↑" : "↓") : ""}
              </th>
              <th style={thStyle("win_rate")} onClick={() => handleSort("win_rate")}>
                Win % {sortKey === "win_rate" ? (sortAsc ? "↑" : "↓") : ""}
              </th>
              <th style={thStyle("last_played_at")} onClick={() => handleSort("last_played_at")}>
                Last Played {sortKey === "last_played_at" ? (sortAsc ? "↑" : "↓") : ""}
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr
                key={p.player_id}
                style={{ transition: "background 0.1s" }}
                onMouseOver={(e) => (e.currentTarget.style.background = "#f8f9fa")}
                onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <td style={tdStyle("left")}>
                  <Link
                    to={`/org/${orgId}/players/${p.player_slug}`}
                    style={{ color: "#1a73e8", textDecoration: "none", fontWeight: 500 }}
                  >
                    {p.display_name}
                  </Link>
                </td>
                <td style={tdStyle()}>
                  <span style={{ fontWeight: 600 }}>
                    {p.latest_rating_overall?.toFixed(2) ?? "—"}
                  </span>
                </td>
                <td style={tdStyle()}>{p.games_played}</td>
                <td style={tdStyle()}>
                  {p.win_rate != null ? `${(p.win_rate * 100).toFixed(0)}%` : "—"}
                </td>
                <td style={{ ...tdStyle(), fontSize: 13, color: "#666" }}>
                  {p.last_played_at
                    ? new Date(p.last_played_at).toLocaleDateString()
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
