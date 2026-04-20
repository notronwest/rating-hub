import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../supabase";
import { useAuth } from "../auth/AuthProvider";
import {
  getOrCreateAnalysis,
  listAssessments,
  listNotes,
  setGameMuxPlaybackId,
} from "../lib/coachApi";
import { pbvPosterUrl } from "../lib/pbvVideo";
import type { GameAnalysis, AnalysisNote, PlayerAssessment } from "../types/coach";
import VideoPlayer, { type VideoPlayerHandle } from "../components/analyze/VideoPlayer";
import Timeline from "../components/analyze/Timeline";
import NotesPanel from "../components/analyze/NotesPanel";
import VideoUrlInput from "../components/analyze/VideoUrlInput";
import ShotSequence from "../components/analyze/ShotSequence";
import RallyStrip from "../components/analyze/RallyStrip";
import PlayerFocusBar from "../components/analyze/PlayerFocusBar";
import ShotTooltip from "../components/analyze/ShotTooltip";
import type { RallyShot } from "../types/database";

interface GameRow {
  id: string;
  org_id: string;
  session_name: string | null;
  pbvision_video_id: string;
  pbvision_bucket: string | null;
  played_at: string | null;
  team0_score: number | null;
  team1_score: number | null;
  session_id: string | null;
  mux_playback_id: string | null;
  highlights: Array<{ rally_idx: number; s: number; e: number; kind: string; short_description: string }> | null;
}

interface GamePlayerRow {
  player_id: string;
  player_index: number;
  team: number;
  players: { id: string; display_name: string; slug: string; avatar_url: string | null };
}

interface RallyRow {
  id: string;
  rally_index: number;
  start_ms: number;
  end_ms: number;
  winning_team: number | null;
  score_team0: number | null;
  score_team1: number | null;
}

export default function AnalyzePage() {
  const { orgId, gameId } = useParams();
  const { user } = useAuth();

  const [game, setGame] = useState<GameRow | null>(null);
  const [players, setPlayers] = useState<Array<{
    id: string;
    display_name: string;
    team: number;
    player_index: number;
    avatar_url: string | null;
  }>>([]);
  const [rallies, setRallies] = useState<RallyRow[]>([]);
  const [shots, setShots] = useState<RallyShot[]>([]);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [notes, setNotes] = useState<AnalysisNote[]>([]);
  const [assessments, setAssessments] = useState<PlayerAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMs, setCurrentMs] = useState(0);

  // Shot playback controls
  const [activeShotId, setActiveShotId] = useState<string | null>(null);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isPaused, setIsPaused] = useState(true);

  // Filters
  const [focusedPlayerIndex, setFocusedPlayerIndex] = useState<number | null>(null);
  // Rally explicitly selected by clicking the rally strip (overrides "current time" rally)
  const [selectedRallyId, setSelectedRallyId] = useState<string | null>(null);

  const videoRef = useRef<VideoPlayerHandle>(null);

  // Load all page data
  useEffect(() => {
    if (!gameId || !user) return;
    let cancelled = false;

    (async () => {
      // Fetch game
      const { data: g } = await supabase
        .from("games")
        .select("id, org_id, session_name, pbvision_video_id, pbvision_bucket, played_at, team0_score, team1_score, session_id, mux_playback_id, highlights")
        .eq("id", gameId)
        .single();

      if (!g || cancelled) {
        setLoading(false);
        return;
      }
      setGame(g as GameRow);

      // Fetch game_players with player names + avatars
      const { data: gps } = await supabase
        .from("game_players")
        .select("player_id, player_index, team, players!inner(id, display_name, slug, avatar_url)")
        .eq("game_id", gameId)
        .order("player_index");

      if (gps) {
        setPlayers(
          (gps as unknown as GamePlayerRow[]).map((gp) => ({
            id: gp.player_id,
            display_name: gp.players.display_name,
            team: gp.team,
            player_index: gp.player_index,
            avatar_url: gp.players.avatar_url,
          })),
        );
      }

      // Fetch rallies
      const { data: ral } = await supabase
        .from("rallies")
        .select("id, rally_index, start_ms, end_ms, winning_team, score_team0, score_team1")
        .eq("game_id", gameId)
        .order("rally_index");
      const ralList = (ral as RallyRow[] | null) ?? [];
      if (!cancelled) setRallies(ralList);

      // Fetch all shots for all rallies in this game
      if (ralList.length > 0) {
        const rallyIds = ralList.map((r) => r.id);
        const { data: shotData } = await supabase
          .from("rally_shots")
          .select("*")
          .in("rally_id", rallyIds)
          .order("rally_id")
          .order("shot_index");
        if (!cancelled) setShots((shotData as RallyShot[] | null) ?? []);
      }

      // Get or create analysis
      try {
        const a = await getOrCreateAnalysis(g.id, g.org_id, user.id);
        if (cancelled) return;
        setAnalysis(a);

        // Load notes + assessments
        const [n, asss] = await Promise.all([
          listNotes(a.id),
          listAssessments(a.id),
        ]);
        if (!cancelled) {
          setNotes(n);
          setAssessments(asss);
        }
      } catch (e) {
        console.error("Failed to load analysis:", e);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [gameId, user]);

  const reloadNotes = useCallback(async () => {
    if (!analysis) return;
    const [n, asss] = await Promise.all([
      listNotes(analysis.id),
      listAssessments(analysis.id),
    ]);
    setNotes(n);
    setAssessments(asss);
  }, [analysis]);

  async function handlePlaybackIdSave(playbackId: string) {
    if (!game) return;
    await setGameMuxPlaybackId(game.id, playbackId);
    setGame({ ...game, mux_playback_id: playbackId });
  }

  // Shot playback control handlers
  function handleActivateShot(shot: RallyShot) {
    setActiveShotId(shot.id);
    videoRef.current?.seek(shot.start_ms);
    videoRef.current?.setPlaybackRate(playbackRate);
    void videoRef.current?.play();
    setIsPaused(false);
  }

  function handleReplayShot() {
    const active = shots.find((s) => s.id === activeShotId);
    if (!active) return;
    videoRef.current?.seek(active.start_ms);
    void videoRef.current?.play();
    setIsPaused(false);
  }

  function handleToggleLoop() {
    setIsLooping((v) => !v);
  }

  function handleSetPlaybackRate(rate: number) {
    setPlaybackRate(rate);
    videoRef.current?.setPlaybackRate(rate);
  }

  function handleTogglePlay() {
    videoRef.current?.togglePlay();
    setIsPaused((p) => !p);
  }

  // Loop effect: when looping a specific shot, seek back to its start when the
  // playhead goes past its end.
  useEffect(() => {
    if (!isLooping || !activeShotId) return;
    const active = shots.find((s) => s.id === activeShotId);
    if (!active) return;
    // Add a small buffer (100ms) so the shot plays fully before looping
    const endBuffer = 100;
    if (currentMs > active.end_ms + endBuffer) {
      videoRef.current?.seek(active.start_ms);
    }
  }, [currentMs, isLooping, activeShotId, shots]);

  // Keep isPaused in sync with player state
  useEffect(() => {
    const interval = setInterval(() => {
      if (videoRef.current) {
        const paused = videoRef.current.isPaused();
        setIsPaused((prev) => (prev !== paused ? paused : prev));
      }
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;

      if (e.code === "Space") {
        e.preventDefault();
        videoRef.current?.togglePlay();
      } else if (e.key === "[") {
        e.preventDefault();
        const prev = [...rallies].reverse().find((r) => r.start_ms < currentMs - 500);
        if (prev) videoRef.current?.seek(prev.start_ms);
      } else if (e.key === "]") {
        e.preventDefault();
        const next = rallies.find((r) => r.start_ms > currentMs + 500);
        if (next) videoRef.current?.seek(next.start_ms);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rallies, currentMs]);

  if (loading) return <p>Loading…</p>;
  if (!game) return <p>Game not found.</p>;

  const duration = rallies.length > 0
    ? rallies[rallies.length - 1].end_ms + 30000
    : 600000;

  const posterUrl = pbvPosterUrl(game.pbvision_video_id, game.pbvision_bucket ?? "pbv-pro");

  // Explicit selection overrides time-based detection
  const currentRally: RallyRow | null =
    (selectedRallyId ? rallies.find((r) => r.id === selectedRallyId) : null) ??
    rallies.find((r) => currentMs >= r.start_ms && currentMs <= r.end_ms) ??
    rallies.reduce<RallyRow | null>((best, r) => {
      if (best == null) return r;
      return Math.abs(r.start_ms - currentMs) < Math.abs(best.start_ms - currentMs)
        ? r
        : best;
    }, null) ??
    null;

  // Apply player focus filter to shots shown in the sequence
  const currentRallyShots = currentRally
    ? shots
        .filter((s) => s.rally_id === currentRally.id)
        .filter((s) =>
          focusedPlayerIndex == null
            ? true
            : s.player_index === focusedPlayerIndex,
        )
    : [];

  // The currently "playing" shot (for the video tooltip overlay) — based on currentMs
  const playingShot = shots.find(
    (s) => currentMs >= s.start_ms && currentMs <= s.end_ms,
  ) ?? null;
  const playingShotPlayer = playingShot
    ? players.find((p) => p.player_index === playingShot.player_index) ?? null
    : null;

  return (
    <div style={{ maxWidth: 1400 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <Link
          to={`/org/${orgId}/games/${gameId}`}
          style={{ fontSize: 13, color: "#888", textDecoration: "none" }}
        >
          &larr; Back to game
        </Link>
        <span style={{ color: "#ddd" }}>|</span>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, flex: 1 }}>
          Analyze: {game.session_name || game.pbvision_video_id}
        </h2>
        {game.team0_score != null && game.team1_score != null && (
          <span style={{ fontSize: 18, fontWeight: 600, color: "#333" }}>
            {game.team0_score}–{game.team1_score}
          </span>
        )}
      </div>

      {/* Rally strip — horizontal navigator for all rallies in this game */}
      {rallies.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <RallyStrip
            rallies={rallies}
            shots={shots}
            highlights={game.highlights ?? []}
            activeRallyId={currentRally?.id ?? null}
            currentMs={currentMs}
            onRallyClick={(r) => {
              setSelectedRallyId(r.id);
              videoRef.current?.seek(r.start_ms);
              setCurrentMs(r.start_ms);
            }}
          />
        </div>
      )}

      {/* Two-column layout */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, alignItems: "start" }}>
        {/* Left: video + timeline */}
        <div>
          {game.mux_playback_id ? (
            <>
              <div style={{ position: "relative" }}>
                <VideoPlayer
                  ref={videoRef}
                  playbackId={game.mux_playback_id}
                  posterUrl={posterUrl}
                  onTimeUpdate={setCurrentMs}
                />
                <ShotTooltip shot={playingShot} player={playingShotPlayer} />
              </div>
              <Timeline
                durationMs={duration}
                currentMs={currentMs}
                rallies={rallies}
                highlights={game.highlights ?? []}
                notes={notes}
                onSeek={(ms) => {
                  videoRef.current?.seek(ms);
                  setCurrentMs(ms);
                }}
              />
              <div style={{ fontSize: 11, color: "#999", marginTop: 8 }}>
                Shortcuts: <kbd style={kbdStyle}>Space</kbd> play/pause ·{" "}
                <kbd style={kbdStyle}>[</kbd> prev rally ·{" "}
                <kbd style={kbdStyle}>]</kbd> next rally
              </div>

              {/* Player focus filter */}
              <div style={{ marginTop: 16, paddingBottom: 10, borderBottom: "1px solid #eee" }}>
                <PlayerFocusBar
                  players={players}
                  focusedPlayerIndex={focusedPlayerIndex}
                  onFocus={setFocusedPlayerIndex}
                />
              </div>

              {/* Shot sequence for the current rally */}
              <div style={{ marginTop: 16 }}>
                <ShotSequence
                  rally={currentRally}
                  shots={currentRallyShots}
                  players={players}
                  currentMs={currentMs}
                  activeShotId={activeShotId}
                  isLooping={isLooping}
                  playbackRate={playbackRate}
                  isPaused={isPaused}
                  onActivateShot={handleActivateShot}
                  onReplayShot={handleReplayShot}
                  onToggleLoop={handleToggleLoop}
                  onSetPlaybackRate={handleSetPlaybackRate}
                  onTogglePlay={handleTogglePlay}
                />
              </div>
            </>
          ) : (
            <VideoUrlInput
              pbvisionVideoId={game.pbvision_video_id}
              onSubmit={handlePlaybackIdSave}
            />
          )}
        </div>

        {/* Right: notes panel */}
        <div>
          {analysis && (
            <NotesPanel
              analysisId={analysis.id}
              overallNotes={analysis.overall_notes}
              players={players}
              rallies={rallies}
              notes={notes}
              assessments={assessments}
              currentMs={currentMs}
              onSeek={(ms) => {
                videoRef.current?.seek(ms);
                setCurrentMs(ms);
              }}
              onReload={reloadNotes}
            />
          )}
        </div>
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  padding: "1px 5px",
  fontSize: 10,
  background: "#f0f0f0",
  borderRadius: 3,
  fontFamily: "monospace",
};
