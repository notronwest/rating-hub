import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../supabase";
import { useAuth } from "../auth/AuthProvider";
import { computeHighlights, GameHighlightsCompact, type GameHighlightData } from "../components/GameHighlights";
import type { GamePlayerShotType } from "../types/database";
import EmailRatingReportsPanel from "../components/report/EmailRatingReportsPanel";

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

/**
 * Extract the `gm-N` numeric suffix from a game's session_name.
 * e.g. `kr-do-pk-2026-04-19-gm-3` → 3. Returns null if no suffix.
 */
function extractGameIdx(sessionName: string | null): number | null {
  if (!sessionName) return null;
  const m = sessionName.match(/gm-(\d+)$/i);
  return m ? parseInt(m[1], 10) : null;
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

      // Display order: prefer the "gm-N" suffix from session_name (how the
      // session-manager numbers uploads) — that's what the coach thinks of
      // as Game 1..N. Fall back to played_at for any row without a suffix
      // so the list stays stable.
      const ordered = [...(gameRows ?? [])].sort((a, b) => {
        const ai = extractGameIdx(a.session_name);
        const bi = extractGameIdx(b.session_name);
        if (ai != null && bi != null) return ai - bi;
        if (ai != null) return -1;
        if (bi != null) return 1;
        // both fall through to played_at asc
        return 0;
      });
      setGames(ordered);

      // Get game_players, rallies, shot types for these games.
      // We also pull rally_shots filtered to 3rd-shot drops so we can derive
      // the count ourselves when the Stats-format import never ran (which
      // is the case for games imported only via the compact webhook).
      const gameIds = (gameRows ?? []).map((g) => g.id);
      if (gameIds.length > 0) {
        const [gpRes, rallyRes, stRes, rallyIdsRes] = await Promise.all([
          supabase
            .from("game_players")
            .select("game_id, player_id, team, won, rating_overall, shot_count, shot_accuracy, player_index")
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
          supabase
            .from("rallies")
            .select("id, game_id")
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

        // Synthesize missing `third_drops` entries from rally_shots so the
        // highlight count is accurate even without a Stats-format import.
        const rallyIds = (rallyIdsRes.data ?? []).map((r) => r.id);
        const rallyToGame = new Map<string, string>();
        for (const r of rallyIdsRes.data ?? []) rallyToGame.set(r.id, r.game_id);

        if (rallyIds.length > 0) {
          const { data: dropShots } = await supabase
            .from("rally_shots")
            .select("rally_id, player_index")
            .in("rally_id", rallyIds)
            .eq("shot_index", 2)
            .eq("shot_type", "drop");

          // (game, player_idx) → count
          const counts = new Map<string, number>();
          for (const s of dropShots ?? []) {
            if (s.player_index == null) continue;
            const gameId = rallyToGame.get(s.rally_id);
            if (!gameId) continue;
            const key = `${gameId}::${s.player_index}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }

          // Inject synthetic third_drops rows where the stats table lacks them.
          for (const [key, count] of counts) {
            const [gameId, playerIdxStr] = key.split("::");
            const playerIdx = parseInt(playerIdxStr, 10);
            const gp = gps.find(
              (x) => x.game_id === gameId && x.player_index === playerIdx,
            );
            if (!gp) continue;
            const existing = stMap.get(gameId) ?? [];
            const already = existing.some(
              (st) => st.player_id === gp.player_id && st.shot_type === "third_drops",
            );
            if (already) continue;
            existing.push({
              game_id: gameId,
              player_id: gp.player_id,
              shot_type: "third_drops",
              count,
              average_quality: null,
              outcome_stats: null,
              speed_stats: null,
            } as GamePlayerShotType);
            stMap.set(gameId, existing);
          }
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

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, marginBottom: 4 }}>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
          {session.label || "Session"}
        </h2>
        <span style={{ flex: 1 }} />
        <Link
          to={`/org/${orgId}/sessions/${session.id}/rating-report`}
          title="Data-only stats report for each player in this session — works without any coach review"
          style={{
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 600,
            background: "#fff",
            color: "#1a73e8",
            border: "1px solid #1a73e8",
            borderRadius: 6,
            textDecoration: "none",
            fontFamily: "inherit",
          }}
        >
          📊 Rating report
        </Link>
        <Link
          to={`/org/${orgId}/sessions/${session.id}/report`}
          title="Coach's session report — rollup + recurring themes + per-game coach notes"
          style={{
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
          📄 Session report
        </Link>
      </div>
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

      {/* Email rating reports — button + delivery log. Sits above the
          player grid so it reads as a session-level action, not a
          per-player one. */}
      <div style={{ marginBottom: 22 }}>
        <EmailRatingReportsPanel sessionId={session.id} />
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
              gameName: `Game ${idx + 1}`,
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
                    {`Game ${idx + 1}`}
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
