import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../supabase";

interface GameRow {
  id: string;
  session_name: string | null;
  played_at: string | null;
  team0_score: number | null;
  team1_score: number | null;
  pbvision_video_id: string;
  total_rallies: number | null;
  analysis_id: string | null;
  note_count: number;
  assessment_count: number;
}

type Filter = "all" | "unanalyzed" | "analyzed";

export default function CoachDashboardPage() {
  const { orgId } = useParams();
  const [games, setGames] = useState<GameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("unanalyzed");

  useEffect(() => {
    if (!orgId) return;

    (async () => {
      const { data: org } = await supabase
        .from("organizations")
        .select("id")
        .eq("slug", orgId)
        .single();
      if (!org) {
        setLoading(false);
        return;
      }

      // Fetch all games
      const { data: gameRows } = await supabase
        .from("games")
        .select("id, session_name, played_at, team0_score, team1_score, pbvision_video_id, total_rallies")
        .eq("org_id", org.id)
        .order("played_at", { ascending: false });

      if (!gameRows || gameRows.length === 0) {
        setGames([]);
        setLoading(false);
        return;
      }

      // Fetch analyses + counts
      const gameIds = gameRows.map((g) => g.id);
      const { data: analyses } = await supabase
        .from("game_analyses")
        .select("id, game_id")
        .in("game_id", gameIds);

      const analysisByGame = new Map<string, string>();
      for (const a of analyses ?? []) {
        analysisByGame.set(a.game_id, a.id);
      }

      const analysisIds = (analyses ?? []).map((a) => a.id);

      // Count notes + assessments per analysis
      const [{ data: allNotes }, { data: allAssessments }] = await Promise.all([
        analysisIds.length > 0
          ? supabase.from("game_analysis_notes").select("analysis_id").in("analysis_id", analysisIds)
          : Promise.resolve({ data: [] as Array<{ analysis_id: string }> }),
        analysisIds.length > 0
          ? supabase.from("player_game_assessments").select("analysis_id").in("analysis_id", analysisIds)
          : Promise.resolve({ data: [] as Array<{ analysis_id: string }> }),
      ]);

      const noteCount = new Map<string, number>();
      for (const n of allNotes ?? []) {
        noteCount.set(n.analysis_id, (noteCount.get(n.analysis_id) ?? 0) + 1);
      }
      const assessCount = new Map<string, number>();
      for (const a of allAssessments ?? []) {
        assessCount.set(a.analysis_id, (assessCount.get(a.analysis_id) ?? 0) + 1);
      }

      const rows: GameRow[] = gameRows.map((g) => {
        const aid = analysisByGame.get(g.id) ?? null;
        return {
          ...g,
          analysis_id: aid,
          note_count: aid ? noteCount.get(aid) ?? 0 : 0,
          assessment_count: aid ? assessCount.get(aid) ?? 0 : 0,
        };
      });

      setGames(rows);
      setLoading(false);
    })();
  }, [orgId]);

  const filtered = games.filter((g) => {
    if (filter === "all") return true;
    if (filter === "unanalyzed") return g.analysis_id == null;
    return g.analysis_id != null;
  });

  const unanalyzedCount = games.filter((g) => g.analysis_id == null).length;
  const analyzedCount = games.filter((g) => g.analysis_id != null).length;

  return (
    <div>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Coach Dashboard</h2>
      <div style={{ fontSize: 13, color: "#666", marginBottom: 20 }}>
        Review games and leave feedback. {unanalyzedCount} unanalyzed · {analyzedCount} analyzed
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 0, marginBottom: 20 }}>
        {(["unanalyzed", "analyzed", "all"] as Filter[]).map((f, i) => {
          const active = filter === f;
          const count = f === "unanalyzed" ? unanalyzedCount : f === "analyzed" ? analyzedCount : games.length;
          return (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "6px 14px",
                fontSize: 13,
                fontWeight: active ? 600 : 400,
                borderTop: `1px solid ${active ? "#1a73e8" : "#ddd"}`,
                borderBottom: `1px solid ${active ? "#1a73e8" : "#ddd"}`,
                borderLeft: i === 0 ? `1px solid ${active ? "#1a73e8" : "#ddd"}` : "none",
                borderRight: `1px solid ${active ? "#1a73e8" : "#ddd"}`,
                borderRadius: i === 0 ? "6px 0 0 6px" : i === 2 ? "0 6px 6px 0" : "0",
                background: active ? "#e8f0fe" : "#fff",
                color: active ? "#1a73e8" : "#555",
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {f} ({count})
            </button>
          );
        })}
      </div>

      {loading ? (
        <p>Loading…</p>
      ) : filtered.length === 0 ? (
        <p style={{ color: "#999" }}>No games match this filter.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["Date", "Game", "Score", "Analysis", ""].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: "10px 12px",
                    textAlign: h === "Score" || h === "Analysis" ? "center" : "left",
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
            {filtered.map((g) => (
              <tr
                key={g.id}
                style={{ transition: "background 0.1s" }}
                onMouseOver={(e) => (e.currentTarget.style.background = "#f8f9fa")}
                onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", fontSize: 13, color: "#666", whiteSpace: "nowrap" }}>
                  {g.played_at ? new Date(g.played_at).toLocaleDateString() : "—"}
                </td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", fontSize: 14 }}>
                  <Link
                    to={`/org/${orgId}/games/${g.id}`}
                    style={{ color: "#1a73e8", textDecoration: "none", fontWeight: 500 }}
                  >
                    {g.session_name || g.pbvision_video_id}
                  </Link>
                </td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", textAlign: "center", fontWeight: 600 }}>
                  {g.team0_score != null && g.team1_score != null ? `${g.team0_score}–${g.team1_score}` : "—"}
                </td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", textAlign: "center", fontSize: 12, color: "#666" }}>
                  {g.analysis_id ? (
                    <span>
                      <span style={{ color: "#1e7e34", fontWeight: 600 }}>✓</span>{" "}
                      {g.note_count} notes · {g.assessment_count} tags
                    </span>
                  ) : (
                    <span style={{ color: "#999" }}>—</span>
                  )}
                </td>
                <td style={{ padding: "10px 12px", borderBottom: "1px solid #f0f0f0", textAlign: "right" }}>
                  <Link
                    to={`/org/${orgId}/games/${g.id}/analyze`}
                    style={{
                      padding: "5px 10px",
                      fontSize: 12,
                      fontWeight: 600,
                      background: g.analysis_id ? "#e8f0fe" : "#1a73e8",
                      color: g.analysis_id ? "#1a73e8" : "#fff",
                      textDecoration: "none",
                      borderRadius: 5,
                    }}
                  >
                    {g.analysis_id ? "Continue" : "Analyze"} →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
