import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../supabase";
import { useAuth } from "../auth/AuthProvider";
import { computeHighlights, GameHighlightsCompact, type GameHighlightData } from "../components/GameHighlights";
import type { GamePlayerShotType } from "../types/database";

interface SessionInfo {
  id: string;
  played_date: string;
  label: string | null;
}

interface GameRow {
  id: string;
  session_name: string | null;
  played_at: string | null;
  team0_score: number | null;
  team1_score: number | null;
  winning_team: number | null;
  total_rallies: number | null;
  pbvision_video_id: string;
}

interface GamePlayerInfo {
  game_id: string;
  player_id: string;
  team: number;
  won: boolean | null;
  rating_overall: number | null;
  shot_count: number | null;
  shot_accuracy: unknown;
}

export default function SessionDetailPage() {
  const { orgId, sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const fromPlayer = searchParams.get("from") === "player";
  const playerSlug = searchParams.get("slug");
  const playerQuery = fromPlayer && playerSlug ? `?from=player&slug=${playerSlug}` : "";
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [games, setGames] = useState<GameRow[]>([]);
  const [gamePlayers, setGamePlayers] = useState<GamePlayerInfo[]>([]);
  const [playerNames, setPlayerNames] = useState<Map<string, string>>(new Map());
  const [ralliesByGame, setRalliesByGame] = useState<Map<string, { shot_count: number | null }[]>>(new Map());
  const [shotTypesByGame, setShotTypesByGame] = useState<Map<string, GamePlayerShotType[]>>(new Map());
  // game_id -> true if a coach review has content (sequence, flag, or note)
  const [gamesWithReview, setGamesWithReview] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;

    (async () => {
      // Get session
      const { data: s } = await supabase
        .from("sessions")
        .select("id, played_date, label")
        .eq("id", sessionId)
        .single();
      if (!s) { setLoading(false); return; }
      setSession(s);

      // Get games in this session
      const { data: gameRows } = await supabase
        .from("games")
        .select("id, session_name, played_at, team0_score, team1_score, winning_team, total_rallies, pbvision_video_id")
        .eq("session_id", sessionId)
        .order("played_at", { ascending: true });

      setGames(gameRows ?? []);

      // Get game_players, rallies, shot types for these games
      const gameIds = (gameRows ?? []).map((g) => g.id);
      if (gameIds.length > 0) {
        const [gpRes, rallyRes, stRes] = await Promise.all([
          supabase
            .from("game_players")
            .select("game_id, player_id, team, won, rating_overall, shot_count, shot_accuracy")
            .in("game_id", gameIds)
            .order("player_index"),
          supabase
            .from("rallies")
            .select("game_id, shot_count")
            .in("game_id", gameIds),
          supabase
            .from("game_player_shot_types")
            .select("*")
            .in("game_id", gameIds),
        ]);

        const gps = gpRes.data ?? [];
        setGamePlayers(gps);

        // Group rallies by game
        const rMap = new Map<string, { shot_count: number | null }[]>();
        for (const r of rallyRes.data ?? []) {
          const arr = rMap.get(r.game_id) ?? [];
          arr.push({ shot_count: r.shot_count });
          rMap.set(r.game_id, arr);
        }
        setRalliesByGame(rMap);

        // Group shot types by game
        const stMap = new Map<string, GamePlayerShotType[]>();
        for (const st of stRes.data ?? []) {
          const arr = stMap.get(st.game_id) ?? [];
          arr.push(st);
          stMap.set(st.game_id, arr);
        }
        setShotTypesByGame(stMap);

        // Resolve player names
        const pids = [...new Set(gps.map((gp) => gp.player_id))];
        const { data: players } = await supabase
          .from("players")
          .select("id, display_name")
          .in("id", pids);

        setPlayerNames(new Map((players ?? []).map((p) => [p.id, p.display_name])));
      }

      setLoading(false);
    })();
  }, [sessionId]);

  // Fetch review status separately: game_analyses + its content tables are
  // RLS-gated (private analyses require org access), so we must wait for
  // auth to be ready before querying. Doing it alongside the non-auth data
  // above would fire the query as anon and silently return empty, which
  // made every game render as "Review Not Started".
  useEffect(() => {
    if (authLoading) {
      console.log("[review-status] waiting for auth");
      return;
    }
    if (!user) {
      console.log("[review-status] not signed in — all reviews will show Not Started");
      return;
    }
    if (games.length === 0) return;
    let cancelled = false;

    (async () => {
      const gameIds = games.map((g) => g.id);
      const { data: analyses, error: aErr } = await supabase
        .from("game_analyses")
        .select("id, game_id")
        .in("game_id", gameIds);
      console.log("[review-status] analyses query", {
        gameIds,
        count: analyses?.length ?? 0,
        error: aErr?.message,
      });
      if (cancelled || !analyses || analyses.length === 0) return;

      const analysisIds = analyses.map((a) => a.id);
      const analysisToGame = new Map(analyses.map((a) => [a.id, a.game_id]));

      const [seqRes, flagRes, noteRes] = await Promise.all([
        supabase
          .from("game_analysis_sequences")
          .select("analysis_id")
          .in("analysis_id", analysisIds),
        supabase
          .from("analysis_flagged_shots")
          .select("analysis_id")
          .in("analysis_id", analysisIds),
        supabase
          .from("game_analysis_notes")
          .select("analysis_id")
          .in("analysis_id", analysisIds),
      ]);
      if (cancelled) return;
      console.log("[review-status] content counts", {
        sequences: seqRes.data?.length ?? 0,
        sequencesError: seqRes.error?.message,
        flags: flagRes.data?.length ?? 0,
        flagsError: flagRes.error?.message,
        notes: noteRes.data?.length ?? 0,
        notesError: noteRes.error?.message,
      });

      const withContent = new Set<string>();
      for (const row of [
        ...(seqRes.data ?? []),
        ...(flagRes.data ?? []),
        ...(noteRes.data ?? []),
      ]) {
        const gameId = analysisToGame.get(row.analysis_id);
        if (gameId) withContent.add(gameId);
      }
      console.log("[review-status] games with review:", Array.from(withContent));
      setGamesWithReview(withContent);
    })();

    return () => {
      cancelled = true;
    };
  }, [games, user, authLoading]);

  if (loading) return <p>Loading…</p>;
  if (!session) return <p>Session not found.</p>;

  // Compute session-level stats
  const allPlayers = [...new Set(gamePlayers.map((gp) => gp.player_id))];
  const totalGames = games.length;

  // Per-player W-L across the session
  const playerStats = allPlayers.map((pid) => {
    const gps = gamePlayers.filter((gp) => gp.player_id === pid);
    const wins = gps.filter((gp) => gp.won === true).length;
    const losses = gps.filter((gp) => gp.won === false).length;
    const avgRating = gps.reduce((sum, gp) => sum + (gp.rating_overall ?? 0), 0) / (gps.length || 1);
    return {
      id: pid,
      name: playerNames.get(pid) ?? "?",
      wins,
      losses,
      avgRating,
      team: gps[0]?.team ?? 0,
    };
  });

  const tdStyle: React.CSSProperties = {
    padding: "10px 12px",
    borderBottom: "1px solid #f0f0f0",
    fontSize: 14,
  };

  return (
    <div>
      {/* Header */}
      {!fromPlayer && (
        <Link
          to={`/org/${orgId}/sessions`}
          style={{ fontSize: 13, color: "#888", textDecoration: "none" }}
        >
          &larr; All sessions
        </Link>
      )}

      <h2 style={{ fontSize: 20, fontWeight: 700, marginTop: 8, marginBottom: 4 }}>
        {session.label || "Session"}
      </h2>
      <div style={{ fontSize: 14, color: "#666", marginBottom: 24 }}>
        {new Date(session.played_date + "T12:00:00").toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
        {" · "}
        {totalGames} games
      </div>

      {/* Player summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginBottom: 28 }}>
        {playerStats.map((p) => (
          <Link
            key={p.id}
            to={`/org/${orgId}/players/${encodeURIComponent(p.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""))}`}
            style={{
              padding: "12px 14px",
              border: "1px solid #e2e2e2",
              borderRadius: 10,
              textDecoration: "none",
              color: "#333",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14, color: "#1a73e8" }}>{p.name}</div>
            <div style={{ fontSize: 13, color: "#666", marginTop: 4 }}>
              {p.wins}W – {p.losses}L
              <span style={{ marginLeft: 12 }}>Avg: {p.avgRating.toFixed(2)}</span>
            </div>
          </Link>
        ))}
      </div>

      {/* Games table */}
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>Games</h3>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["#", "Name", "Score", "Rallies", ""].map((h) => (
              <th
                key={h}
                style={{
                  padding: "8px 12px",
                  textAlign: h === "#" || h === "Rallies" ? "center" : "left",
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
          {games.map((g, idx) => {
            // Compute highlights for this game
            const gameGps = gamePlayers.filter((gp) => gp.game_id === g.id);
            const hlData: GameHighlightData = {
              gameId: g.id,
              gameName: g.session_name || `Game ${idx + 1}`,
              rallies: ralliesByGame.get(g.id) ?? [],
              players: gameGps.map((gp) => ({
                playerName: playerNames.get(gp.player_id) ?? "?",
                shotCount: gp.shot_count,
                shotAccuracy: gp.shot_accuracy as { in?: number; net?: number; out?: number } | null,
              })),
              shotTypes: shotTypesByGame.get(g.id) ?? [],
            };
            const hl = computeHighlights(hlData);

            return (
              <tr
                key={g.id}
                style={{ transition: "background 0.1s" }}
                onMouseOver={(e) => (e.currentTarget.style.background = "#f8f9fa")}
                onMouseOut={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <td style={{ ...tdStyle, textAlign: "center", color: "#999", fontSize: 13, verticalAlign: "top", paddingTop: 14 }}>
                  {idx + 1}
                </td>
                <td style={tdStyle}>
                  <Link
                    to={`/org/${orgId}/games/${g.id}${playerQuery}`}
                    style={{ color: "#1a73e8", textDecoration: "none", fontWeight: 500 }}
                  >
                    {g.session_name || `Game ${idx + 1}`}
                  </Link>
                  {hl.length > 0 && (
                    <div style={{ marginTop: 6 }}>
                      <GameHighlightsCompact highlights={hl} />
                    </div>
                  )}
                </td>
                <td style={{ ...tdStyle, fontWeight: 600, verticalAlign: "top", paddingTop: 14 }}>
                  {g.team0_score != null && g.team1_score != null
                    ? `${g.team0_score}–${g.team1_score}`
                    : "—"}
                </td>
                <td style={{ ...tdStyle, textAlign: "center", color: "#666", verticalAlign: "top", paddingTop: 14 }}>
                  {g.total_rallies ?? "—"}
                </td>
                <td style={{ ...tdStyle, textAlign: "right", verticalAlign: "top", paddingTop: 10 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "stretch", gap: 6, minWidth: 170 }}>
                    <Link
                      to={`/org/${orgId}/games/${g.id}${playerQuery}`}
                      style={dashboardBtnStyle({
                        variant: "neutral",
                      })}
                    >
                      <span>📊 Details</span>
                      <span style={{ opacity: 0.6, fontSize: 11 }}>→</span>
                    </Link>
                    <Link
                      to={`/org/${orgId}/games/${g.id}/coach-review${playerQuery}`}
                      title={
                        gamesWithReview.has(g.id)
                          ? "Continue coach review"
                          : "Start a coach review"
                      }
                      style={dashboardBtnStyle({
                        variant: gamesWithReview.has(g.id) ? "filled" : "outline",
                      })}
                    >
                      <span>
                        ⭐ {gamesWithReview.has(g.id) ? "Review Started" : "Review Not Started"}
                      </span>
                      <span style={{ opacity: 0.7, fontSize: 11 }}>→</span>
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function dashboardBtnStyle({
  variant,
}: {
  variant: "filled" | "outline" | "neutral";
}): React.CSSProperties {
  const base: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    padding: "8px 12px",
    fontSize: 12,
    fontWeight: 600,
    textDecoration: "none",
    borderRadius: 6,
    whiteSpace: "nowrap",
    lineHeight: 1.2,
  };
  if (variant === "filled") {
    return {
      ...base,
      background: "#7c3aed",
      color: "#fff",
      border: "1px solid #7c3aed",
      boxShadow: "0 1px 2px rgba(124, 58, 237, 0.25)",
    };
  }
  if (variant === "outline") {
    return {
      ...base,
      background: "#fff",
      color: "#7c3aed",
      border: "1px dashed #c4b5fd",
    };
  }
  // neutral
  return {
    ...base,
    background: "#fff",
    color: "#444",
    border: "1px solid #ddd",
  };
}
