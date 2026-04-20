/**
 * Coach Review — focused workflow for analyzing a player's rally losses.
 *
 * Flow:
 *   1. Pick a player from the game's roster.
 *   2. Page walks you through every rally they personally lost, one at a time.
 *   3. For each loss, an auto-sequence of the last ~5 shots (ending on the
 *      error) is pre-selected and looped on the video.
 *   4. Coach fills in "What went wrong" + "How to fix it" notes, saves, advances.
 *
 * UI is maximized for this task: no RallyStrip, no NotesPanel, no
 * ReasonsForLosingRally — just the video, the sequence, and the two note fields.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../supabase";
import { useAuth } from "../auth/AuthProvider";
import {
  getOrCreateAnalysis,
  listSequences,
  createSequence,
  updateSequence,
  setGameMuxPlaybackId,
} from "../lib/coachApi";
import { pbvPosterUrl, formatMs } from "../lib/pbvVideo";
import {
  categorizeRallyLoss,
  buildLossSequence,
  REASON_LABELS,
  type ReasonId,
} from "../lib/rallyAnalysis";
import type { GameAnalysis, AnalysisSequence } from "../types/coach";
import type { RallyShot } from "../types/database";
import VideoPlayer, { type VideoPlayerHandle } from "../components/analyze/VideoPlayer";
import VideoUrlInput from "../components/analyze/VideoUrlInput";
import ShotTooltip from "../components/analyze/ShotTooltip";

interface GameRow {
  id: string;
  org_id: string;
  session_name: string | null;
  pbvision_video_id: string;
  pbvision_bucket: string | null;
  mux_playback_id: string | null;
}

interface PlayerRow {
  id: string;
  player_index: number;
  display_name: string;
  team: number;
  avatar_url: string | null;
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

interface PlayerLoss {
  rallyId: string;
  rallyIndex: number;
  reason: ReasonId;
  sequenceShotIds: string[];
  sequenceStartMs: number;
  sequenceEndMs: number;
  attributedShotId: string;
  existingSequence: AnalysisSequence | null;
  scoreAfter: string | null;
}

export default function CoachReviewPage() {
  const { orgId, gameId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  const [game, setGame] = useState<GameRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [rallies, setRallies] = useState<RallyRow[]>([]);
  const [shots, setShots] = useState<RallyShot[]>([]);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [sequences, setSequences] = useState<AnalysisSequence[]>([]);
  const [loading, setLoading] = useState(true);

  const playerIdParam = searchParams.get("playerId") ?? "";
  const [currentIdx, setCurrentIdx] = useState(0);
  const [whatWentWrong, setWhatWentWrong] = useState("");
  const [howToFix, setHowToFix] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(0.5); // slow motion by default for coaching

  const videoRef = useRef<VideoPlayerHandle>(null);

  // Load all page data
  useEffect(() => {
    if (!gameId || !user) return;
    let cancelled = false;

    (async () => {
      const { data: g } = await supabase
        .from("games")
        .select(
          "id, org_id, session_name, pbvision_video_id, pbvision_bucket, mux_playback_id",
        )
        .eq("id", gameId)
        .single();

      if (!g || cancelled) {
        setLoading(false);
        return;
      }
      setGame(g as GameRow);

      const [gpsRes, ralRes] = await Promise.all([
        supabase
          .from("game_players")
          .select(
            "player_id, player_index, team, players!inner(id, display_name, avatar_url)",
          )
          .eq("game_id", gameId)
          .order("player_index"),
        supabase
          .from("rallies")
          .select(
            "id, rally_index, start_ms, end_ms, winning_team, score_team0, score_team1",
          )
          .eq("game_id", gameId)
          .order("rally_index"),
      ]);

      const ps: PlayerRow[] = (gpsRes.data ?? []).map((gp) => {
        const row = gp as unknown as {
          player_id: string;
          player_index: number;
          team: number;
          players: { id: string; display_name: string; avatar_url: string | null };
        };
        return {
          id: row.player_id,
          player_index: row.player_index,
          display_name: row.players.display_name,
          team: row.team,
          avatar_url: row.players.avatar_url,
        };
      });
      setPlayers(ps);
      setRallies(ralRes.data ?? []);

      const rallyIds = (ralRes.data ?? []).map((r) => r.id);
      if (rallyIds.length > 0) {
        const { data: shotData } = await supabase
          .from("rally_shots")
          .select("*")
          .in("rally_id", rallyIds);
        setShots((shotData ?? []) as RallyShot[]);
      }

      // Analysis + sequences
      try {
        const a = await getOrCreateAnalysis(g.id, g.org_id, user.id);
        if (cancelled) return;
        setAnalysis(a);
        const seqs = await listSequences(a.id);
        if (!cancelled) setSequences(seqs);
      } catch (e) {
        console.error("Failed to load analysis:", e);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [gameId, user]);

  // Resolve the selected player
  const selectedPlayer = useMemo(
    () => players.find((p) => p.id === playerIdParam) ?? null,
    [players, playerIdParam],
  );

  // Build the list of losses for the selected player
  const losses: PlayerLoss[] = useMemo(() => {
    if (!selectedPlayer) return [];
    const shotsByRally = new Map<string, RallyShot[]>();
    for (const s of shots) {
      if (!shotsByRally.has(s.rally_id)) shotsByRally.set(s.rally_id, []);
      shotsByRally.get(s.rally_id)!.push(s);
    }

    const out: PlayerLoss[] = [];
    for (const rally of rallies) {
      if (rally.winning_team == null) continue;
      const losingTeam = (1 - rally.winning_team) as 0 | 1;
      if (selectedPlayer.team !== losingTeam) continue;

      const rs = (shotsByRally.get(rally.id) ?? []).sort(
        (a, b) => a.shot_index - b.shot_index,
      );
      const res = categorizeRallyLoss(rs, losingTeam);
      if (!res) continue;
      if (res.attributedShot.player_index !== selectedPlayer.player_index)
        continue;

      const seqIds = buildLossSequence(rs, res.attributedShot, 4);
      const seqShots = seqIds
        .map((id) => rs.find((s) => s.id === id))
        .filter((s): s is RallyShot => !!s);
      if (seqShots.length === 0) continue;

      const start = Math.min(...seqShots.map((s) => s.start_ms));
      const end = Math.max(...seqShots.map((s) => s.end_ms));

      // Already saved as a sequence?
      const existingSequence = sequences.find(
        (seq) =>
          seq.rally_id === rally.id &&
          seq.player_id === selectedPlayer.id &&
          seq.shot_ids.length === seqIds.length &&
          seq.shot_ids.every((id) => seqIds.includes(id)),
      ) ?? null;

      out.push({
        rallyId: rally.id,
        rallyIndex: rally.rally_index,
        reason: res.reason,
        sequenceShotIds: seqIds,
        sequenceStartMs: start,
        sequenceEndMs: end,
        attributedShotId: res.attributedShot.id,
        existingSequence,
        scoreAfter:
          rally.score_team0 != null && rally.score_team1 != null
            ? `${rally.score_team0}–${rally.score_team1}`
            : null,
      });
    }
    return out;
  }, [selectedPlayer, rallies, shots, sequences]);

  const currentLoss = losses[currentIdx] ?? null;

  // Seek when loss changes, load existing notes
  useEffect(() => {
    if (!currentLoss) return;
    videoRef.current?.seek(currentLoss.sequenceStartMs);
    videoRef.current?.setPlaybackRate(playbackRate);
    void videoRef.current?.play();
    setWhatWentWrong(currentLoss.existingSequence?.what_went_wrong ?? "");
    setHowToFix(currentLoss.existingSequence?.how_to_fix ?? "");
    setSaveMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLoss?.rallyId]);

  // Reset index when player changes
  useEffect(() => {
    setCurrentIdx(0);
  }, [playerIdParam]);

  // Loop the current sequence
  useEffect(() => {
    if (!currentLoss) return;
    const endBuffer = 400;
    if (currentMs > currentLoss.sequenceEndMs + endBuffer) {
      videoRef.current?.seek(currentLoss.sequenceStartMs);
    }
  }, [currentMs, currentLoss]);

  async function handlePlaybackIdSave(playbackId: string) {
    if (!game) return;
    await setGameMuxPlaybackId(game.id, playbackId);
    setGame({ ...game, mux_playback_id: playbackId });
  }

  const reloadSequences = useCallback(async () => {
    if (!analysis) return;
    setSequences(await listSequences(analysis.id));
  }, [analysis]);

  async function handleSave(advance: boolean) {
    if (!analysis || !currentLoss || !selectedPlayer) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      if (currentLoss.existingSequence) {
        await updateSequence(currentLoss.existingSequence.id, {
          what_went_wrong: whatWentWrong.trim() || null,
          how_to_fix: howToFix.trim() || null,
        });
      } else {
        await createSequence({
          analysisId: analysis.id,
          rallyId: currentLoss.rallyId,
          shotIds: currentLoss.sequenceShotIds,
          label: `${REASON_LABELS[currentLoss.reason]} · Rally ${currentLoss.rallyIndex + 1}`,
          playerId: selectedPlayer.id,
          whatWentWrong: whatWentWrong.trim() || null,
          howToFix: howToFix.trim() || null,
        });
      }
      await reloadSequences();
      setSaveMsg("✓ Saved");
      if (advance && currentIdx < losses.length - 1) {
        setTimeout(() => {
          setCurrentIdx((i) => i + 1);
          setSaveMsg(null);
        }, 400);
      } else {
        setTimeout(() => setSaveMsg(null), 1500);
      }
    } catch (e) {
      setSaveMsg(e instanceof Error ? `Error: ${e.message}` : String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleSkip() {
    if (currentIdx < losses.length - 1) setCurrentIdx(currentIdx + 1);
  }

  function handlePrev() {
    if (currentIdx > 0) setCurrentIdx(currentIdx - 1);
  }

  function handlePickPlayer(playerId: string) {
    const next = new URLSearchParams(searchParams);
    if (playerId) next.set("playerId", playerId);
    else next.delete("playerId");
    setSearchParams(next, { replace: true });
  }

  function changeRate(r: number) {
    setPlaybackRate(r);
    videoRef.current?.setPlaybackRate(r);
  }

  if (loading) return <p>Loading…</p>;
  if (!game) return <p>Game not found.</p>;

  const posterUrl = pbvPosterUrl(game.pbvision_video_id, game.pbvision_bucket ?? "pbv-pro");

  // Currently-playing shot for the tooltip
  const playingShot = shots.find(
    (s) => currentMs >= s.start_ms && currentMs <= s.end_ms,
  ) ?? null;
  const playingShotPlayer = playingShot
    ? players.find((p) => p.player_index === playingShot.player_index) ?? null
    : null;

  // Sequence shots (for the side panel)
  const seqShots = currentLoss
    ? currentLoss.sequenceShotIds
        .map((id) => shots.find((s) => s.id === id))
        .filter((s): s is RallyShot => !!s)
    : [];

  const reviewedCount = losses.filter((l) => l.existingSequence != null).length;

  return (
    <div style={{ maxWidth: 1400 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <Link
          to={`/org/${orgId}/games/${gameId}/analyze`}
          style={{ fontSize: 13, color: "#888", textDecoration: "none" }}
        >
          &larr; Back to full analysis
        </Link>
        <span style={{ color: "#ddd" }}>|</span>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, flex: 1 }}>
          Coach Review
          {game.session_name && (
            <span style={{ fontSize: 14, color: "#666", fontWeight: 400, marginLeft: 8 }}>
              {game.session_name}
            </span>
          )}
        </h2>

        {/* Player picker */}
        <label style={{ fontSize: 12, color: "#666" }}>Player:</label>
        <select
          value={playerIdParam}
          onChange={(e) => handlePickPlayer(e.target.value)}
          style={{
            padding: "6px 10px",
            fontSize: 13,
            borderRadius: 6,
            border: "1px solid #ddd",
            outline: "none",
            fontFamily: "inherit",
          }}
        >
          <option value="">— Select player —</option>
          {[...players]
            .sort((a, b) => a.player_index - b.player_index)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name} (T{p.team})
              </option>
            ))}
        </select>
      </div>

      {!selectedPlayer ? (
        <PlayerPickerGrid players={players} onPick={handlePickPlayer} />
      ) : losses.length === 0 ? (
        <div
          style={{
            padding: 40,
            background: "#f8f9fa",
            border: "1px solid #e2e2e2",
            borderRadius: 10,
            textAlign: "center",
            color: "#666",
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
            No losses to review for {selectedPlayer.display_name}
          </div>
          <div style={{ fontSize: 13 }}>
            Either they didn't personally lose a rally or the AI couldn't
            attribute any fault shots to them.
          </div>
        </div>
      ) : (
        <>
          {/* Progress bar */}
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "center",
              marginBottom: 14,
              padding: "10px 14px",
              background: "#fff",
              border: "1px solid #e2e2e2",
              borderRadius: 10,
            }}
          >
            <span style={{ fontSize: 12, color: "#666" }}>
              Loss <b style={{ color: "#333" }}>{currentIdx + 1}</b> of{" "}
              <b style={{ color: "#333" }}>{losses.length}</b>
              <span style={{ marginLeft: 8, color: "#999" }}>
                · {reviewedCount} reviewed
              </span>
            </span>
            <div
              style={{
                flex: 1,
                height: 6,
                background: "#f0f0f0",
                borderRadius: 3,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  background: "#1a73e8",
                  width: `${(reviewedCount / losses.length) * 100}%`,
                  transition: "width 0.2s",
                }}
              />
            </div>
            <button onClick={handlePrev} disabled={currentIdx === 0} style={navBtn(currentIdx === 0)}>
              ← Prev
            </button>
            <button
              onClick={handleSkip}
              disabled={currentIdx >= losses.length - 1}
              style={navBtn(currentIdx >= losses.length - 1)}
            >
              Skip →
            </button>
          </div>

          {currentLoss && (
            <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16, alignItems: "start" }}>
              {/* Left: video */}
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
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        marginTop: 8,
                        fontSize: 12,
                      }}
                    >
                      <span style={{ color: "#666", marginRight: 4 }}>Speed:</span>
                      {[0.25, 0.5, 0.75, 1, 1.5].map((r) => (
                        <button
                          key={r}
                          onClick={() => changeRate(r)}
                          style={rateBtn(playbackRate === r)}
                        >
                          {r}×
                        </button>
                      ))}
                      <span style={{ flex: 1 }} />
                      <button
                        onClick={() => videoRef.current?.seek(currentLoss.sequenceStartMs)}
                        style={{ ...rateBtn(false), padding: "4px 10px" }}
                      >
                        ⟲ Restart sequence
                      </button>
                    </div>
                  </>
                ) : (
                  <VideoUrlInput
                    pbvisionVideoId={game.pbvision_video_id}
                    onSubmit={handlePlaybackIdSave}
                  />
                )}
              </div>

              {/* Right: sequence + notes */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Sequence header */}
                <div
                  style={{
                    padding: "12px 14px",
                    background: "#fff",
                    border: "1px solid #e2e2e2",
                    borderRadius: 10,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    <span
                      style={{
                        padding: "3px 10px",
                        background: "#fce8e6",
                        color: "#c62828",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: 0.3,
                      }}
                    >
                      {REASON_LABELS[currentLoss.reason]}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>
                      Rally {currentLoss.rallyIndex + 1}
                    </span>
                    {currentLoss.scoreAfter && (
                      <span style={{ fontSize: 12, color: "#888" }}>
                        → {currentLoss.scoreAfter}
                      </span>
                    )}
                    {currentLoss.existingSequence && (
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 10,
                          padding: "2px 6px",
                          background: "#e6f4ea",
                          color: "#1e7e34",
                          borderRadius: 3,
                          fontWeight: 600,
                        }}
                      >
                        ✓ REVIEWED
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "#666" }}>
                    {seqShots.length} shots leading to the error · {formatMs(currentLoss.sequenceStartMs)}–
                    {formatMs(currentLoss.sequenceEndMs)}
                  </div>
                  {/* Inline shot chain */}
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      marginTop: 10,
                    }}
                  >
                    {seqShots.map((s, i) => {
                      const p = players.find((pp) => pp.player_index === s.player_index);
                      const isError = s.id === currentLoss.attributedShotId;
                      return (
                        <div
                          key={s.id}
                          onClick={() => videoRef.current?.seek(s.start_ms)}
                          style={{
                            padding: "6px 10px",
                            background: isError ? "#fce8e6" : "#f0f0f0",
                            borderRadius: 6,
                            fontSize: 12,
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            cursor: "pointer",
                            borderLeft: isError ? "3px solid #c62828" : "3px solid transparent",
                          }}
                          title="Click to seek to this shot"
                        >
                          <span
                            style={{
                              width: 16,
                              height: 16,
                              borderRadius: "50%",
                              background: isError ? "#c62828" : "#aaa",
                              color: "#fff",
                              fontSize: 10,
                              fontWeight: 600,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            {i + 1}
                          </span>
                          <span style={{ fontWeight: 500, color: "#333" }}>
                            {s.shot_type ?? "shot"}
                          </span>
                          <span style={{ color: "#888" }}>
                            · {p?.display_name.split(" ")[0] ?? `p${s.player_index}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Notes */}
                <div
                  style={{
                    padding: "14px",
                    background: "#fff",
                    border: "1px solid #e2e2e2",
                    borderRadius: 10,
                  }}
                >
                  <label style={noteLabel("#c62828")}>What went wrong</label>
                  <textarea
                    value={whatWentWrong}
                    onChange={(e) => setWhatWentWrong(e.target.value)}
                    rows={4}
                    placeholder="Describe what led to this error — bad positioning, rushed shot, poor decision…"
                    style={textareaStyle}
                  />

                  <label style={{ ...noteLabel("#1e7e34"), marginTop: 12 }}>
                    How to fix it
                  </label>
                  <textarea
                    value={howToFix}
                    onChange={(e) => setHowToFix(e.target.value)}
                    rows={4}
                    placeholder="Coaching correction — technique cue, drill, mental reset…"
                    style={textareaStyle}
                  />

                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      marginTop: 12,
                      justifyContent: "flex-end",
                    }}
                  >
                    {saveMsg && (
                      <span
                        style={{
                          fontSize: 12,
                          color: saveMsg.startsWith("✓") ? "#1e7e34" : "crimson",
                          marginRight: "auto",
                        }}
                      >
                        {saveMsg}
                      </span>
                    )}
                    <button
                      onClick={() => handleSave(false)}
                      disabled={saving}
                      style={{ ...navBtn(false), background: "#fff", color: "#555" }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => handleSave(true)}
                      disabled={saving}
                      style={{
                        padding: "7px 16px",
                        fontSize: 13,
                        fontWeight: 600,
                        background: "#1a73e8",
                        color: "#fff",
                        borderRadius: 6,
                        borderTop: "1px solid #1a73e8",
                        borderBottom: "1px solid #1a73e8",
                        borderLeft: "1px solid #1a73e8",
                        borderRight: "1px solid #1a73e8",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      Save & Next →
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ───────────────────────────────── helpers ─────────────────────────────────

function PlayerPickerGrid({
  players,
  onPick,
}: {
  players: PlayerRow[];
  onPick: (id: string) => void;
}) {
  if (players.length === 0) {
    return <p style={{ color: "#999" }}>No players in this game.</p>;
  }
  return (
    <div
      style={{
        padding: 40,
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 12,
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>
        Pick a player to review
      </div>
      <div style={{ fontSize: 13, color: "#666", marginBottom: 28 }}>
        The workflow will step through each rally they lost, showing the last 5
        shots leading to the error. You leave notes, save, and move on.
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: 14,
          maxWidth: 800,
          margin: "0 auto",
        }}
      >
        {[...players]
          .sort((a, b) => a.player_index - b.player_index)
          .map((p) => (
            <button
              key={p.id}
              onClick={() => onPick(p.id)}
              style={{
                padding: 16,
                background: "#fff",
                borderTop: "1px solid #ddd",
                borderBottom: "1px solid #ddd",
                borderLeft: `4px solid ${p.team === 0 ? "#1a73e8" : "#4caf50"}`,
                borderRight: "1px solid #ddd",
                borderRadius: 10,
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                fontFamily: "inherit",
              }}
              onMouseOver={(e) => (e.currentTarget.style.background = "#f8f9fa")}
              onMouseOut={(e) => (e.currentTarget.style.background = "#fff")}
            >
              {p.avatar_url ? (
                <img
                  src={p.avatar_url}
                  alt=""
                  style={{ width: 56, height: 56, borderRadius: "50%", objectFit: "cover" }}
                />
              ) : (
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: "50%",
                    background: "#e0e0e0",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                    fontWeight: 600,
                    color: "#666",
                  }}
                >
                  {p.display_name[0]}
                </div>
              )}
              <div style={{ fontSize: 14, fontWeight: 600, color: "#333" }}>
                {p.display_name}
              </div>
              <div style={{ fontSize: 11, color: "#888" }}>Team {p.team}</div>
            </button>
          ))}
      </div>
    </div>
  );
}

// ── styles ──
function navBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 14px",
    fontSize: 13,
    fontWeight: 500,
    background: "#fff",
    color: disabled ? "#bbb" : "#555",
    borderTop: "1px solid #ddd",
    borderBottom: "1px solid #ddd",
    borderLeft: "1px solid #ddd",
    borderRight: "1px solid #ddd",
    borderRadius: 6,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
  };
}

function rateBtn(active: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    background: active ? "#1a73e8" : "#fff",
    color: active ? "#fff" : "#1a73e8",
    borderTop: `1px solid ${active ? "#1a73e8" : "#ddd"}`,
    borderBottom: `1px solid ${active ? "#1a73e8" : "#ddd"}`,
    borderLeft: `1px solid ${active ? "#1a73e8" : "#ddd"}`,
    borderRight: `1px solid ${active ? "#1a73e8" : "#ddd"}`,
    borderRadius: 5,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

function noteLabel(color: string): React.CSSProperties {
  return {
    display: "block",
    fontSize: 11,
    fontWeight: 700,
    color,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  };
}

const textareaStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  fontSize: 14,
  borderTop: "1px solid #ddd",
  borderBottom: "1px solid #ddd",
  borderLeft: "1px solid #ddd",
  borderRight: "1px solid #ddd",
  borderRadius: 6,
  outline: "none",
  resize: "vertical",
  fontFamily: "inherit",
  boxSizing: "border-box",
};
