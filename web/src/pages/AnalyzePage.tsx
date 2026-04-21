import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../supabase";
import { useAuth } from "../auth/AuthProvider";
import {
  getOrCreateAnalysis,
  listSequences,
  listFlaggedShots,
  flagShot,
  unflagShot,
  setGameMuxPlaybackId,
} from "../lib/coachApi";
import { pbvPosterUrl } from "../lib/pbvVideo";
import type { GameAnalysis, AnalysisSequence, FlaggedShot } from "../types/coach";
import VideoPlayer, { type VideoPlayerHandle } from "../components/analyze/VideoPlayer";
import { useVideoPopout } from "../hooks/useVideoPopout";
import VideoUrlInput from "../components/analyze/VideoUrlInput";
import ShotSequence from "../components/analyze/ShotSequence";
import RallyStrip from "../components/analyze/RallyStrip";
import PlayerFocusBar from "../components/analyze/PlayerFocusBar";
import ShotTooltip from "../components/analyze/ShotTooltip";
import SequenceManager from "../components/analyze/SequenceManager";
import FlaggedShotsPanel from "../components/analyze/FlaggedShotsPanel";
import PlayerHeaderBar from "../components/analyze/PlayerHeaderBar";
import GameWorkspaceHeader from "../components/analyze/GameWorkspaceHeader";
import TeamStatsBlock from "../components/game/TeamStatsBlock";
import type { RallyShot, GamePlayer, GamePlayerShotType } from "../types/database";

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
  scoring_type: string | null;
  highlights: Array<{ rally_idx: number; s: number; e: number; kind: string; short_description: string }> | null;
  team0_kitchen_pct: number | null;
  team1_kitchen_pct: number | null;
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
  shot_count: number | null;
}

export default function AnalyzePage() {
  const { orgId, gameId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
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
  const [gamePlayers, setGamePlayers] = useState<GamePlayer[]>([]);
  const [shotTypes, setShotTypes] = useState<GamePlayerShotType[]>([]);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  // Shot playback controls
  const [activeShotId, setActiveShotId] = useState<string | null>(null);
  const [isLooping, setIsLooping] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  // Filters
  const [focusedPlayerIndex, setFocusedPlayerIndex] = useState<number | null>(null);
  // Rally explicitly selected by clicking the rally strip (overrides "current time" rally)
  const [selectedRallyId, setSelectedRallyId] = useState<string | null>(null);
  const [rallyLoop, setRallyLoop] = useState(true);

  // Sequences
  const [sequences, setSequences] = useState<AnalysisSequence[]>([]);
  const [buildMode, setBuildMode] = useState(false);
  const [draftShotIds, setDraftShotIds] = useState<Set<string>>(new Set());
  const [activeSequenceId, setActiveSequenceId] = useState<string | null>(null);

  // Flagged shots
  const [flags, setFlags] = useState<FlaggedShot[]>([]);

  const localVideoRef = useRef<VideoPlayerHandle>(null);
  const {
    popoutActive,
    openPopout,
    closePopout,
    controller: videoRef,
    currentMs,
    setCurrentMs,
    isPaused,
    setIsPaused,
  } = useVideoPopout(gameId ?? "", localVideoRef);

  // Load all page data
  useEffect(() => {
    if (!gameId || !user) return;
    let cancelled = false;

    (async () => {
      // Fetch game
      const { data: g } = await supabase
        .from("games")
        .select("id, org_id, session_name, pbvision_video_id, pbvision_bucket, played_at, team0_score, team1_score, session_id, mux_playback_id, scoring_type, highlights, team0_kitchen_pct, team1_kitchen_pct")
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

      // Fetch full game_player rows (ratings, stats) for header + team stats
      const { data: gpFull } = await supabase
        .from("game_players")
        .select("*")
        .eq("game_id", gameId)
        .order("player_index");
      if (!cancelled) setGamePlayers((gpFull as GamePlayer[] | null) ?? []);

      // Fetch per-player shot-type breakdowns for team stats
      const { data: st } = await supabase
        .from("game_player_shot_types")
        .select("*")
        .eq("game_id", gameId);
      if (!cancelled) setShotTypes((st as GamePlayerShotType[] | null) ?? []);

      // Fetch rallies
      const { data: ral } = await supabase
        .from("rallies")
        .select("id, rally_index, start_ms, end_ms, winning_team, score_team0, score_team1, shot_count")
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

        // Load sequences + flagged shots
        const [seqs, flg] = await Promise.all([
          listSequences(a.id),
          listFlaggedShots(a.id),
        ]);
        if (!cancelled) {
          setSequences(seqs);
          setFlags(flg);
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
    const [seqs, flg] = await Promise.all([
      listSequences(analysis.id),
      listFlaggedShots(analysis.id),
    ]);
    setSequences(seqs);
    setFlags(flg);
  }, [analysis]);

  async function handlePlaybackIdSave(playbackId: string) {
    if (!game) return;
    await setGameMuxPlaybackId(game.id, playbackId);
    setGame({ ...game, mux_playback_id: playbackId });
  }

  // Sequence handlers
  function handleToggleBuildMode() {
    setBuildMode((v) => {
      if (v) {
        setDraftShotIds(new Set()); // clearing on exit
      } else {
        // Entering build mode — pause the video right where it is so the
        // coach can pick shots without the clock running past them.
        videoRef.pause();
        setIsPaused(true);
      }
      return !v;
    });
    setActiveSequenceId(null);
    setActiveShotId(null);
  }

  function handleToggleDraftShot(shotId: string) {
    setDraftShotIds((prev) => {
      const next = new Set(prev);
      if (next.has(shotId)) next.delete(shotId);
      else next.add(shotId);
      return next;
    });
  }

  function handleClearDraft() {
    setDraftShotIds(new Set());
  }

  function handlePlayDraft() {
    if (draftShotIds.size === 0) return;
    const seqShots = shots
      .filter((s) => draftShotIds.has(s.id))
      .sort((a, b) => a.start_ms - b.start_ms);
    if (seqShots.length === 0) return;
    setActiveSequenceId(null);
    setActiveShotId(null);
    videoRef.seek(seqShots[0].start_ms);
    videoRef.setPlaybackRate(playbackRate);
    void videoRef.play();
    setIsPaused(false);
  }

  // Flagged shot handlers
  async function handleToggleFlag(shotId: string) {
    console.log("[flag] toggle", shotId, "analysis?", !!analysis);
    if (!analysis) {
      alert("Analysis not loaded yet — try again in a moment.");
      return;
    }
    const alreadyFlagged = flags.some((f) => f.shot_id === shotId);
    try {
      if (alreadyFlagged) {
        await unflagShot(analysis.id, shotId);
        setFlags((prev) => prev.filter((f) => f.shot_id !== shotId));
      } else {
        const created = await flagShot({
          analysisId: analysis.id,
          shotId,
        });
        setFlags((prev) => [...prev, created]);
      }
    } catch (e) {
      console.error("[flag] toggle FAILED:", e);
      alert(
        `Failed to toggle flag: ${
          e instanceof Error ? e.message : String(e)
        }\n\nMost likely cause: migration 011_flagged_shots.sql hasn't been run yet in Supabase.`,
      );
    }
  }

  function handleJumpToFlaggedShot(shot: RallyShot) {
    setSelectedRallyId(shot.rally_id);
    setActiveShotId(shot.id);
    setBuildMode(false);
    setDraftShotIds(new Set());
    setActiveSequenceId(null);
    videoRef.seek(shot.start_ms);
    videoRef.setPlaybackRate(playbackRate);
    void videoRef.play();
    setIsPaused(false);
  }

  // Consume `?sequence=<id>` — fired when the coach clicks "Open →" on a saved
  // sequence from the Coach Review overview. Waits until sequences + shots are
  // loaded, then activates the requested sequence and clears the param.
  useEffect(() => {
    const seqId = searchParams.get("sequence");
    if (!seqId) return;
    if (sequences.length === 0 || shots.length === 0) return;
    const seq = sequences.find((s) => s.id === seqId);
    if (seq) handleActivateSequence(seq);
    const next = new URLSearchParams(searchParams);
    next.delete("sequence");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequences, shots]);

  function handleActivateSequence(seq: AnalysisSequence) {
    // Clear other selections
    setBuildMode(false);
    setDraftShotIds(new Set());
    setActiveShotId(null);
    setActiveSequenceId(seq.id);

    // Select the rally containing this sequence so the panel switches context
    setSelectedRallyId(seq.rally_id);

    const seqShots = seq.shot_ids
      .map((id) => shots.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .sort((a, b) => a.start_ms - b.start_ms);
    if (seqShots.length === 0) return;

    videoRef.seek(seqShots[0].start_ms);
    videoRef.setPlaybackRate(playbackRate);
    void videoRef.play();
    setIsPaused(false);
  }

  // Shot playback control handlers
  function handleActivateShot(shot: RallyShot) {
    setActiveShotId(shot.id);
    videoRef.seek(shot.start_ms);
    videoRef.setPlaybackRate(playbackRate);
    void videoRef.play();
    setIsPaused(false);
  }

  function handleReplayShot() {
    const active = shots.find((s) => s.id === activeShotId);
    if (!active) return;
    videoRef.seek(active.start_ms);
    void videoRef.play();
    setIsPaused(false);
  }

  function handleToggleLoop() {
    setIsLooping((v) => !v);
  }

  function handleSetPlaybackRate(rate: number) {
    setPlaybackRate(rate);
    videoRef.setPlaybackRate(rate);
  }

  function handleTogglePlay() {
    videoRef.togglePlay();
    setIsPaused((p) => !p);
  }

  // Loop effect: when looping a specific shot, seek back to its start when the
  // playhead goes past its end. Shot loop takes precedence over rally loop.
  useEffect(() => {
    if (!isLooping || !activeShotId) return;
    const active = shots.find((s) => s.id === activeShotId);
    if (!active) return;
    const endBuffer = 100;
    if (currentMs > active.end_ms + endBuffer) {
      videoRef.seek(active.start_ms);
    }
  }, [currentMs, isLooping, activeShotId, shots]);

  // Rally loop: when a rally is explicitly selected AND rallyLoop is on AND
  // no shot is actively looping, keep the selected rally playing on repeat.
  useEffect(() => {
    if (!rallyLoop || !selectedRallyId) return;
    if (activeShotId && isLooping) return; // shot loop wins
    if (activeSequenceId || draftShotIds.size > 0) return; // sequence loop wins
    const rally = rallies.find((r) => r.id === selectedRallyId);
    if (!rally) return;
    const endBuffer = 500;
    if (currentMs > rally.end_ms + endBuffer) {
      videoRef.seek(rally.start_ms);
    }
  }, [currentMs, rallyLoop, selectedRallyId, activeShotId, isLooping, activeSequenceId, draftShotIds, rallies]);

  // Auto-play the draft whenever shots are added/removed while building.
  // Jumps to the earliest shot's start and plays, so the sequence-loop effect
  // below will keep it on repeat. Runs only when the draft changes, not on
  // every currentMs tick.
  useEffect(() => {
    if (!buildMode) return;
    if (draftShotIds.size === 0) return;
    const seqShots = shots
      .filter((s) => draftShotIds.has(s.id))
      .sort((a, b) => a.start_ms - b.start_ms);
    if (seqShots.length === 0) return;
    const start = seqShots[0].start_ms;
    videoRef.seek(start);
    videoRef.setPlaybackRate(playbackRate);
    void videoRef.play();
    setIsPaused(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftShotIds, buildMode]);

  // Sequence loop: when a saved sequence is active OR a draft is being previewed,
  // loop from the earliest selected shot's start to the latest's end.
  useEffect(() => {
    // Saved sequence takes precedence over draft
    let shotIds: string[] = [];
    if (activeSequenceId) {
      const seq = sequences.find((s) => s.id === activeSequenceId);
      shotIds = seq?.shot_ids ?? [];
    } else if (draftShotIds.size > 0) {
      shotIds = Array.from(draftShotIds);
    } else {
      return;
    }

    const seqShots = shotIds
      .map((id) => shots.find((s) => s.id === id))
      .filter((s): s is NonNullable<typeof s> => !!s);
    if (seqShots.length === 0) return;

    const start = Math.min(...seqShots.map((s) => s.start_ms));
    const end = Math.max(...seqShots.map((s) => s.end_ms));
    const endBuffer = 400;
    if (currentMs > end + endBuffer) {
      videoRef.seek(start);
    }
  }, [currentMs, activeSequenceId, draftShotIds, sequences, shots]);

  // Keep isPaused in sync with player state
  useEffect(() => {
    const interval = setInterval(() => {
      const paused = videoRef.isPaused();
      setIsPaused((prev) => (prev !== paused ? paused : prev));
    }, 500);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;

      if (e.code === "Space") {
        e.preventDefault();
        videoRef.togglePlay();
      } else if (e.key === "[") {
        e.preventDefault();
        const prev = [...rallies].reverse().find((r) => r.start_ms < currentMs - 500);
        if (prev) videoRef.seek(prev.start_ms);
      } else if (e.key === "]") {
        e.preventDefault();
        const next = rallies.find((r) => r.start_ms > currentMs + 500);
        if (next) videoRef.seek(next.start_ms);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rallies, currentMs]);

  if (loading) return <p>Loading…</p>;
  if (!game) return <p>Game not found.</p>;

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

  // Set of flagged shot IDs for fast lookup
  const flaggedShotIds = new Set(flags.map((f) => f.shot_id));

  // Shots belonging to any saved sequence on the *current* rally — used to
  // highlight them in the shot list so the coach can see prior work at a glance.
  const savedSequenceShotIds = currentRally
    ? new Set(
        sequences
          .filter((s) => s.rally_id === currentRally.id)
          .flatMap((s) => s.shot_ids),
      )
    : new Set<string>();

  // Fault-ending shots across the whole game — any shot whose PB Vision raw
  // data carries an `err` field. Used to highlight the point-ending mistake
  // in the shot list, matching the fault dot on the rally strip.
  const faultShotIds = new Set(
    shots
      .filter((s) => {
        const raw = (s.raw_data ?? {}) as Record<string, unknown>;
        return !!raw.err;
      })
      .map((s) => s.id),
  );

  // The currently "playing" shot (for the video tooltip overlay) — based on currentMs
  const playingShot = shots.find(
    (s) => currentMs >= s.start_ms && currentMs <= s.end_ms,
  ) ?? null;
  const playingShotPlayer = playingShot
    ? players.find((p) => p.player_index === playingShot.player_index) ?? null
    : null;

  return (
    <div style={{ maxWidth: 1400 }}>
      <GameWorkspaceHeader
        orgId={orgId ?? ""}
        gameId={gameId ?? ""}
        mode="analyze"
        title={game.session_name || game.pbvision_video_id}
        score={{ team0: game.team0_score, team1: game.team1_score }}
      />

      {/* Player header — expandable chips with name + stats bar */}
      {players.length > 0 && gamePlayers.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <PlayerHeaderBar players={players} gamePlayers={gamePlayers} />
        </div>
      )}

      {/* Coach Review entry point */}
      {rallies.length > 0 && shots.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            background: "linear-gradient(90deg, #fff7e6 0%, #f0f4ff 100%)",
            border: "1px solid #f0d169",
            borderRadius: 10,
            marginBottom: 20,
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#7a5d00", marginBottom: 2 }}>
              ⭐ Coach Review
            </div>
            <div style={{ fontSize: 12, color: "#555" }}>
              Pick a player and walk through their rally losses + flagged shots,
              with per-player loss breakdowns.
            </div>
          </div>
          <Link
            to={`/org/${orgId}/games/${gameId}/coach-review`}
            style={{
              padding: "10px 18px",
              fontSize: 13,
              fontWeight: 700,
              background: "#1a73e8",
              color: "#fff",
              borderRadius: 6,
              textDecoration: "none",
              whiteSpace: "nowrap",
              flexShrink: 0,
              marginLeft: 16,
            }}
          >
            Start Coach Review →
          </Link>
        </div>
      )}

      {/* Rally strip — horizontal navigator for all rallies in this game */}
      {rallies.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <RallyStrip
            rallies={rallies}
            shots={shots}
            highlights={game.highlights ?? []}
            sequences={sequences}
            flags={flags}
            activeRallyId={currentRally?.id ?? null}
            currentMs={currentMs}
            rallyLoop={rallyLoop}
            onToggleRallyLoop={() => setRallyLoop((v) => !v)}
            onRallyClick={(r) => {
              setSelectedRallyId(r.id);
              setActiveShotId(null); // clear shot selection so rally loop takes effect
              videoRef.seek(r.start_ms);
              setCurrentMs(r.start_ms);
              videoRef.setPlaybackRate(playbackRate);
              void videoRef.play();
              setIsPaused(false);
            }}
          />
        </div>
      )}

      {/* Main content area */}
      {popoutActive && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 14px",
            background: "#1a1a1a",
            color: "#ddd",
            borderRadius: 8,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          <span>
            <span style={{ color: "#4ade80", fontWeight: 600 }}>● Video in separate tab</span>
            <span style={{ marginLeft: 12, color: "#888", fontSize: 11 }}>
              {isPaused ? "⏸" : "▶"} {formatMsStatic(currentMs)} · controls on this tab still drive it
            </span>
          </span>
          <button
            onClick={closePopout}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              background: "transparent",
              color: "#fff",
              borderTop: "1px solid #444",
              borderBottom: "1px solid #444",
              borderLeft: "1px solid #444",
              borderRight: "1px solid #444",
              borderRadius: 6,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Close popout
          </button>
        </div>
      )}
      {game.mux_playback_id ? (
        <>
          {/* Top row: video on the left, shot-in-rally list alongside on the right */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: popoutActive ? "1fr" : "2fr 1fr",
              gap: 20,
              alignItems: "start",
            }}
          >
            {/* Left: video + controls */}
            {!popoutActive && (
              <div>
                <div style={{ position: "relative" }}>
                  <VideoPlayer
                    ref={localVideoRef}
                    playbackId={game.mux_playback_id}
                    posterUrl={posterUrl}
                    onTimeUpdate={setCurrentMs}
                  />
                  <ShotTooltip shot={playingShot} player={playingShotPlayer} />
                </div>

                <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
                  <button
                    onClick={openPopout}
                    style={{
                      padding: "5px 12px",
                      fontSize: 12,
                      fontWeight: 500,
                      background: "#fff",
                      color: "#1a73e8",
                      borderTop: "1px solid #c6dafc",
                      borderBottom: "1px solid #c6dafc",
                      borderLeft: "1px solid #c6dafc",
                      borderRight: "1px solid #c6dafc",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                    title="Open the video in a new tab — drag it to a second monitor"
                  >
                    ⧉ Pop out to new tab
                  </button>
                  <span style={{ fontSize: 11, color: "#999", marginLeft: "auto" }}>
                    <kbd style={kbdStyle}>Space</kbd> play/pause ·{" "}
                    <kbd style={kbdStyle}>[</kbd> prev ·{" "}
                    <kbd style={kbdStyle}>]</kbd> next
                  </span>
                </div>
              </div>
            )}

            {/* Right: shot list for the current rally, with focus filter on top */}
            <div>
              <div style={{ marginBottom: 8 }}>
                <PlayerFocusBar
                  players={players}
                  focusedPlayerIndex={focusedPlayerIndex}
                  onFocus={setFocusedPlayerIndex}
                />
              </div>
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
                buildMode={buildMode}
                draftShotIds={draftShotIds}
                onToggleBuildMode={handleToggleBuildMode}
                onToggleDraftShot={handleToggleDraftShot}
                flaggedShotIds={flaggedShotIds}
                onToggleFlag={handleToggleFlag}
                savedSequenceShotIds={savedSequenceShotIds}
                faultShotIds={faultShotIds}
              />
            </div>
          </div>

          {/* Below: sequence manager (full width) */}
          {analysis && (
            <div style={{ marginTop: 16 }}>
              <SequenceManager
                analysisId={analysis.id}
                rally={currentRally}
                shots={shots}
                players={players}
                sequences={sequences}
                activeSequenceId={activeSequenceId}
                buildMode={buildMode}
                draftShotIds={draftShotIds}
                focusedPlayerIndex={focusedPlayerIndex}
                onCancelBuild={() => setBuildMode(false)}
                onClearDraft={handleClearDraft}
                onPlayDraft={handlePlayDraft}
                onActivateSequence={handleActivateSequence}
                onReload={reloadNotes}
              />
            </div>
          )}

          {/* Flagged shots — coach bookmarks */}
          {flags.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <FlaggedShotsPanel
                flags={flags}
                shots={shots}
                rallies={rallies}
                players={players}
                onJumpToShot={handleJumpToFlaggedShot}
                onUnflag={handleToggleFlag}
                onReload={reloadNotes}
              />
            </div>
          )}

          {/* Team stats — below the game */}
          {gamePlayers.length > 0 && (
            <div style={{ marginTop: 24 }}>
              <TeamStatsBlock
                players={players}
                gamePlayers={gamePlayers}
                shotTypes={shotTypes}
                rallies={rallies}
                team0KitchenPct={game.team0_kitchen_pct}
                team1KitchenPct={game.team1_kitchen_pct}
              />
            </div>
          )}
        </>
      ) : (
        <VideoUrlInput
          pbvisionVideoId={game.pbvision_video_id}
          onSubmit={handlePlaybackIdSave}
        />
      )}

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

function formatMsStatic(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

