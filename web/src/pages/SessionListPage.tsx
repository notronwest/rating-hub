import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../supabase";

interface SessionRow {
  id: string;
  played_date: string;
  label: string | null;
  gameCount: number;
  playerNames: string[];
}

export default function SessionListPage() {
  const { orgId } = useParams();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
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

      // Get all sessions for this org
      const { data: sessionRows } = await supabase
        .from("sessions")
        .select("id, played_date, label, player_group_key")
        .eq("org_id", org.id)
        .order("played_date", { ascending: false });

      if (!sessionRows || sessionRows.length === 0) {
        setSessions([]);
        setLoading(false);
        return;
      }

      // Get game counts per session
      const sessionIds = sessionRows.map((s) => s.id);
      const { data: games } = await supabase
        .from("games")
        .select("id, session_id")
        .in("session_id", sessionIds);

      const gameCountMap = new Map<string, number>();
      for (const g of games ?? []) {
        if (g.session_id) {
          gameCountMap.set(g.session_id, (gameCountMap.get(g.session_id) ?? 0) + 1);
        }
      }

      // Resolve player names from player_group_key (comma-separated UUIDs)
      const allPlayerIds = new Set<string>();
      for (const s of sessionRows) {
        for (const pid of s.player_group_key.split(",")) {
          allPlayerIds.add(pid.trim());
        }
      }

      const { data: players } = await supabase
        .from("players")
        .select("id, display_name")
        .in("id", [...allPlayerIds]);

      const playerMap = new Map(
        (players ?? []).map((p) => [p.id, p.display_name]),
      );

      const rows: SessionRow[] = sessionRows.map((s) => ({
        id: s.id,
        played_date: s.played_date,
        label: s.label,
        gameCount: gameCountMap.get(s.id) ?? 0,
        playerNames: s.player_group_key
          .split(",")
          .map((pid: string) => playerMap.get(pid.trim()) ?? "?"),
      }));

      setSessions(rows);
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
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Sessions</h2>

      {loading ? (
        <p>Loading…</p>
      ) : sessions.length === 0 ? (
        <p style={{ color: "#999" }}>No sessions found. Import some games first.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Date", "Label", "Games", "Players"].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "10px 12px",
                    textAlign: h === "Games" ? "center" : "left",
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
            {sessions.map((s) => (
              <tr
                key={s.id}
                style={{ transition: "background 0.1s" }}
                onMouseOver={(e) => (e.currentTarget.style.background = "#f8f9fa")}
                onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <td style={{ ...tdStyle, fontSize: 13, color: "#666", whiteSpace: "nowrap" }}>
                  {new Date(s.played_date + "T12:00:00").toLocaleDateString(undefined, {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </td>
                <td style={tdStyle}>
                  <Link
                    to={`/org/${orgId}/sessions/${s.id}`}
                    style={{ color: "#1a73e8", textDecoration: "none", fontWeight: 500 }}
                  >
                    {s.label || "Session"}
                  </Link>
                </td>
                <td style={{ ...tdStyle, textAlign: "center", fontWeight: 600 }}>
                  {s.gameCount}
                </td>
                <td style={{ ...tdStyle, fontSize: 13, color: "#555" }}>
                  {s.playerNames.join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
