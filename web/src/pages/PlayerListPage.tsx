import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../supabase";
import type { LeaderboardEntry } from "../types/database";

type SortKey = "display_name" | "latest_rating_overall" | "games_played" | "win_rate" | "last_played_at";

export default function PlayerListPage() {
  const { orgId } = useParams();
  const [players, setPlayers] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("display_name");
  const [sortAsc, setSortAsc] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!orgId) return;

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

  // Parse "Last, First" or "First Last" for sorting
  function sortableName(name: string): string {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      // Sort by last name, then first
      return `${parts[parts.length - 1]} ${parts.slice(0, -1).join(" ")}`.toLowerCase();
    }
    return name.toLowerCase();
  }

  // Filter by search
  const filtered = players.filter((p) =>
    p.display_name.toLowerCase().includes(search.toLowerCase()),
  );

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortKey === "display_name") {
      const cmp = sortableName(a.display_name).localeCompare(sortableName(b.display_name));
      return sortAsc ? cmp : -cmp;
    }
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

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortAsc ? " ↑" : " ↓") : "";

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, gap: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Players</h2>
        <input
          type="text"
          placeholder="Search players…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            padding: "7px 12px",
            fontSize: 14,
            borderRadius: 8,
            borderTop: "1px solid #ddd",
            borderBottom: "1px solid #ddd",
            borderLeft: "1px solid #ddd",
            borderRight: "1px solid #ddd",
            outline: "none",
            width: 220,
          }}
        />
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: "#999" }}>
          {search ? `No players matching "${search}".` : "No players found. Import some games first."}
        </p>
      ) : (
        <>
          <div style={{ fontSize: 12, color: "#999", marginBottom: 8 }}>
            {filtered.length} player{filtered.length !== 1 ? "s" : ""}
            {search && ` matching "${search}"`}
            {" · sorted by "}
            {sortKey === "display_name" ? "name (last, first)" :
             sortKey === "latest_rating_overall" ? "rating" :
             sortKey === "games_played" ? "games played" :
             sortKey === "win_rate" ? "win rate" : "last played"}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={thStyle("display_name")} onClick={() => handleSort("display_name")}>
                  Name{arrow("display_name")}
                </th>
                <th style={thStyle("latest_rating_overall")} onClick={() => handleSort("latest_rating_overall")}>
                  Rating{arrow("latest_rating_overall")}
                </th>
                <th style={thStyle("games_played")} onClick={() => handleSort("games_played")}>
                  Games{arrow("games_played")}
                </th>
                <th style={thStyle("win_rate")} onClick={() => handleSort("win_rate")}>
                  Win %{arrow("win_rate")}
                </th>
                <th style={thStyle("last_played_at")} onClick={() => handleSort("last_played_at")}>
                  Last Played{arrow("last_played_at")}
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
        </>
      )}
    </div>
  );
}
