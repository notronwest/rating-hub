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
import { useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../supabase";
import { useAuth } from "../auth/AuthProvider";
import {
  getOrCreateAnalysis,
  listSequences,
  createSequence,
  updateSequence,
  deleteSequence,
  listFlaggedShots,
  unflagShot,
  updateFlagFptm,
  updateFlagNote,
  updateAnalysis,
  setDismissedLossKeys,
  setGameMuxPlaybackId,
} from "../lib/coachApi";
import { pbvPosterUrl, formatMs } from "../lib/pbvVideo";
import {
  categorizeRallyLoss,
  buildLossSequence,
  REASON_LABELS,
  type ReasonId,
} from "../lib/rallyAnalysis";
import type { GameAnalysis, AnalysisSequence, FlaggedShot } from "../types/coach";
import type { RallyShot } from "../types/database";
import VideoPlayer, { type VideoPlayerHandle } from "../components/analyze/VideoPlayer";
import VideoUrlInput from "../components/analyze/VideoUrlInput";
import ShotTooltip from "../components/analyze/ShotTooltip";
import FptmEditor from "../components/analyze/FptmEditor";
import GameWorkspaceHeader from "../components/analyze/GameWorkspaceHeader";
import PatternsToolbar from "../components/patterns/PatternsToolbar";
import { summarizeFptm, type FptmValue } from "../lib/fptm";

interface GameRow {
  id: string;
  org_id: string;
  session_name: string | null;
  pbvision_video_id: string;
  pbvision_bucket: string | null;
  mux_playback_id: string | null;
  scoring_type: string | null;
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

type ReviewItemKind = "flag" | "sequence" | "loss";

interface PlayerLoss {
  /** Discriminator for the unified queue */
  kind: ReviewItemKind;
  /** Stable unique id across kinds, used for React keys and pending-jump targeting */
  itemKey: string;
  rallyId: string;
  rallyIndex: number;
  /** Only for "loss" items — the categorized reason */
  reason?: ReasonId;
  sequenceShotIds: string[];
  sequenceStartMs: number;
  sequenceEndMs: number;
  /** For flags: the flagged shot id. For losses: the attributed error shot id.
   *  For sequences: the last shot id. */
  attributedShotId: string;
  /** For losses: the auto-matched saved sequence, if any.
   *  For "sequence" kind items: the sequence itself (so hydrate/edit works uniformly).
   *  For flags: always null. */
  existingSequence: AnalysisSequence | null;
  scoreAfter: string | null;
  /** Populated only for "flag" items */
  flag?: FlaggedShot;
  /** Populated only for "sequence" items — the source sequence row */
  sequence?: AnalysisSequence;
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
  const [flags, setFlags] = useState<FlaggedShot[]>([]);
  const [loading, setLoading] = useState(true);

  // When a saved sequence is opened from the overview, its id lives here and
  // a dedicated inline playback view replaces the loss/flag flow.
  const [openSequenceId, setOpenSequenceId] = useState<string | null>(null);

  // Pending cross-player jump request from the Overview panels. After the
  // player/mode changes and `items` re-computes, the effect below lines up the
  // currentIdx and clears this.
  const [pendingJump, setPendingJump] = useState<
    | { kind: "flag"; targetShotId: string }
    | { kind: "sequence"; sequenceId: string }
    | null
  >(null);

  const playerIdParam = searchParams.get("playerId") ?? "";
  const [currentIdx, setCurrentIdx] = useState(0);
  const [fptm, setFptm] = useState<FptmValue>({});
  const [drills, setDrills] = useState<string | null>(null);
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
          "id, org_id, session_name, pbvision_video_id, pbvision_bucket, mux_playback_id, scoring_type",
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

      // Analysis + sequences + flags
      try {
        const a = await getOrCreateAnalysis(g.id, g.org_id, user.id);
        if (cancelled) return;
        setAnalysis(a);
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

  // Resolve the selected player
  const selectedPlayer = useMemo(
    () => players.find((p) => p.id === playerIdParam) ?? null,
    [players, playerIdParam],
  );

  // Build the list of losses for the selected player
  const dismissedLossKeys = useMemo(
    () => new Set(analysis?.dismissed_loss_keys ?? []),
    [analysis],
  );

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

      const itemKey = `loss:${rally.id}:${res.attributedShot.id}`;
      if (dismissedLossKeys.has(itemKey)) continue;

      out.push({
        kind: "loss",
        itemKey,
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
  }, [selectedPlayer, rallies, shots, sequences, dismissedLossKeys]);

  // Build a parallel "flag review" list for the selected player's flagged shots
  const flagReviews: PlayerLoss[] = useMemo(() => {
    if (!selectedPlayer) return [];
    const shotsByRally = new Map<string, RallyShot[]>();
    for (const s of shots) {
      if (!shotsByRally.has(s.rally_id)) shotsByRally.set(s.rally_id, []);
      shotsByRally.get(s.rally_id)!.push(s);
    }

    const out: PlayerLoss[] = [];
    for (const flag of flags) {
      const shot = shots.find((s) => s.id === flag.shot_id);
      if (!shot || shot.player_index !== selectedPlayer.player_index) continue;
      const rs = (shotsByRally.get(shot.rally_id) ?? []).sort(
        (a, b) => a.shot_index - b.shot_index,
      );
      const rally = rallies.find((r) => r.id === shot.rally_id);
      if (!rally) continue;

      // Auto-build a 4-shot context ending at the flagged shot
      const seqIds = buildLossSequence(rs, shot, 3);
      const seqShots = seqIds
        .map((id) => rs.find((s) => s.id === id))
        .filter((s): s is RallyShot => !!s);
      if (seqShots.length === 0) continue;
      const start = Math.min(...seqShots.map((s) => s.start_ms));
      const end = Math.max(...seqShots.map((s) => s.end_ms));

      const existingSequence = sequences.find(
        (seq) =>
          seq.rally_id === rally.id &&
          seq.player_id === selectedPlayer.id &&
          seq.shot_ids.length === seqIds.length &&
          seq.shot_ids.every((id) => seqIds.includes(id)),
      ) ?? null;

      out.push({
        kind: "flag",
        itemKey: `flag:${flag.id}`,
        rallyId: rally.id,
        rallyIndex: rally.rally_index,
        sequenceShotIds: seqIds,
        sequenceStartMs: start,
        sequenceEndMs: end,
        attributedShotId: shot.id,
        existingSequence,
        scoreAfter:
          rally.score_team0 != null && rally.score_team1 != null
            ? `${rally.score_team0}–${rally.score_team1}`
            : null,
        flag,
      });
    }
    return out;
  }, [selectedPlayer, flags, shots, rallies, sequences]);

  // Standalone saved sequences for the selected player — i.e. sequences built
  // from the Analyze "Build Sequence" flow that don't already surface as a
  // loss item (to avoid double-reviewing the same thing).
  const sequenceItems: PlayerLoss[] = useMemo(() => {
    if (!selectedPlayer) return [];
    const lossSeqIds = new Set(
      losses
        .map((l) => l.existingSequence?.id)
        .filter((id): id is string => !!id),
    );
    const out: PlayerLoss[] = [];
    for (const seq of sequences) {
      const tagged =
        seq.player_id === selectedPlayer.id ||
        (seq.player_ids ?? []).includes(selectedPlayer.id);
      if (!tagged) continue;
      if (lossSeqIds.has(seq.id)) continue;
      const rally = rallies.find((r) => r.id === seq.rally_id);
      if (!rally) continue;
      const seqShots = seq.shot_ids
        .map((id) => shots.find((s) => s.id === id))
        .filter((s): s is RallyShot => !!s)
        .sort((a, b) => a.start_ms - b.start_ms);
      if (seqShots.length === 0) continue;
      const start = seqShots[0].start_ms;
      const end = seqShots[seqShots.length - 1].end_ms;
      out.push({
        kind: "sequence",
        itemKey: `seq:${seq.id}`,
        rallyId: rally.id,
        rallyIndex: rally.rally_index,
        sequenceShotIds: seq.shot_ids,
        sequenceStartMs: start,
        sequenceEndMs: end,
        attributedShotId: seqShots[seqShots.length - 1].id,
        existingSequence: seq,
        sequence: seq,
        scoreAfter:
          rally.score_team0 != null && rally.score_team1 != null
            ? `${rally.score_team0}–${rally.score_team1}`
            : null,
      });
    }
    return out;
  }, [selectedPlayer, sequences, rallies, shots, losses]);

  // Unified review queue: flags → saved sequences → auto-detected losses.
  // A trailing "wrap-up" step is represented by currentIdx === items.length.
  const items: PlayerLoss[] = useMemo(
    () => [...flagReviews, ...sequenceItems, ...losses],
    [flagReviews, sequenceItems, losses],
  );
  const currentLoss = items[currentIdx] ?? null;
  const currentFlag = currentLoss?.flag ?? null;
  const atWrapUp = selectedPlayer != null && currentIdx >= items.length && items.length > 0;

  // Seek when the current review item changes, load its existing FPTM + drills
  // from whichever backing row this kind lives on.
  useEffect(() => {
    if (!currentLoss) return;
    videoRef.current?.seek(currentLoss.sequenceStartMs);
    videoRef.current?.setPlaybackRate(playbackRate);
    void videoRef.current?.play();
    let source: { fptm: FptmValue | null; drills: string | null } = {
      fptm: null,
      drills: null,
    };
    if (currentLoss.kind === "flag" && currentLoss.flag) {
      source = {
        fptm: (currentLoss.flag.fptm as FptmValue | null) ?? null,
        drills: currentLoss.flag.drills ?? null,
      };
    } else if (currentLoss.kind === "sequence" && currentLoss.sequence) {
      source = {
        fptm: (currentLoss.sequence.fptm as FptmValue | null) ?? null,
        drills: currentLoss.sequence.drills ?? null,
      };
    } else if (currentLoss.existingSequence) {
      source = {
        fptm: (currentLoss.existingSequence.fptm as FptmValue | null) ?? null,
        drills: currentLoss.existingSequence.drills ?? null,
      };
    }
    setFptm(source.fptm ?? {});
    setDrills(source.drills);
    setSaveMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLoss?.itemKey]);

  // Reset index when player changes, UNLESS a pendingJump is queued — in which
  // case the pendingJump effect below will set the correct index.
  useEffect(() => {
    if (pendingJump) return;
    setCurrentIdx(0);
  }, [playerIdParam, pendingJump]);

  // Consume pendingJump once the items list settles to match the target.
  useEffect(() => {
    if (!pendingJump || items.length === 0) return;
    let idx = -1;
    if (pendingJump.kind === "flag") {
      idx = items.findIndex((it) => it.attributedShotId === pendingJump.targetShotId);
    } else {
      idx = items.findIndex((it) => it.existingSequence?.id === pendingJump.sequenceId);
    }
    if (idx >= 0) {
      setCurrentIdx(idx);
      setPendingJump(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      // Target isn't in this list — abandon the jump
      setPendingJump(null);
    }
  }, [pendingJump, items]);

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
    const [seqs, flg] = await Promise.all([
      listSequences(analysis.id),
      listFlaggedShots(analysis.id),
    ]);
    setSequences(seqs);
    setFlags(flg);
  }, [analysis]);

  async function handleSave(advance: boolean) {
    if (!analysis || !currentLoss || !selectedPlayer) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      // Route the save based on what kind of item this is so we update the
      // right row rather than always creating a sequence.
      if (currentLoss.kind === "flag" && currentLoss.flag) {
        await updateFlagFptm(currentLoss.flag.id, {
          fptm,
          drills: drills ?? null,
        });
      } else if (currentLoss.kind === "sequence" && currentLoss.sequence) {
        await updateSequence(currentLoss.sequence.id, {
          fptm,
          drills: drills ?? null,
        });
      } else if (currentLoss.existingSequence) {
        await updateSequence(currentLoss.existingSequence.id, {
          fptm,
          drills: drills ?? null,
        });
      } else {
        await createSequence({
          analysisId: analysis.id,
          rallyId: currentLoss.rallyId,
          shotIds: currentLoss.sequenceShotIds,
          label: currentLoss.reason
            ? `${REASON_LABELS[currentLoss.reason]} · Rally ${currentLoss.rallyIndex + 1}`
            : `Rally ${currentLoss.rallyIndex + 1}`,
          playerId: selectedPlayer.id,
          fptm: Object.keys(fptm).length > 0 ? fptm : null,
          drills: drills ?? null,
        });
      }
      await reloadSequences();
      setSaveMsg("✓ Saved");
      if (advance) {
        // Advance to the next item, or into the wrap-up step past the last one.
        setTimeout(() => {
          setCurrentIdx((i) => Math.min(i + 1, items.length));
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

  async function handleDismissLoss(item: PlayerLoss) {
    if (!analysis || item.kind !== "loss") return;
    const next = [
      ...(analysis.dismissed_loss_keys ?? []),
      item.itemKey,
    ];
    try {
      await setDismissedLossKeys(analysis.id, next);
      setAnalysis((a) => (a ? { ...a, dismissed_loss_keys: next } : a));
      // Items array shrinks by one; currentIdx now points to the next item
      // (or to items.length, which is the wrap-up). Clamp just in case.
      setCurrentIdx((i) => Math.min(i, Math.max(0, items.length - 1)));
    } catch (e) {
      alert(
        `Failed to dismiss: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  async function handleRestoreDismissedLosses() {
    if (!analysis) return;
    try {
      await setDismissedLossKeys(analysis.id, []);
      setAnalysis((a) => (a ? { ...a, dismissed_loss_keys: [] } : a));
    } catch (e) {
      alert(
        `Failed to restore: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
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

  // An item counts as reviewed when its backing row has an FPTM diagnosis or
  // drills recorded (regardless of which row type that is).
  function isItemReviewed(it: PlayerLoss): boolean {
    const src =
      it.kind === "flag"
        ? it.flag
        : it.kind === "sequence"
        ? it.sequence
        : it.existingSequence;
    if (!src) return false;
    const hasFptm = !!src.fptm && Object.keys(src.fptm).length > 0;
    return hasFptm || !!src.drills;
  }
  const reviewedCount = items.filter(isItemReviewed).length;

  return (
    <div style={{ maxWidth: 1400 }}>
      <GameWorkspaceHeader
        orgId={orgId ?? ""}
        gameId={gameId ?? ""}
        mode="review"
        title={game.session_name || game.pbvision_video_id}
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
        }
      />

      {openSequenceId ? (
        <SequencePlayback
          sequence={sequences.find((s) => s.id === openSequenceId) ?? null}
          shots={shots}
          players={players}
          rallies={rallies}
          game={game}
          onClose={() => setOpenSequenceId(null)}
          onSaved={(updated) => {
            setSequences((prev) =>
              prev.map((s) => (s.id === updated.id ? updated : s)),
            );
          }}
          onDeleted={() => {
            setSequences((prev) => prev.filter((s) => s.id !== openSequenceId));
            setOpenSequenceId(null);
          }}
          onMuxSaved={(playbackId) => {
            setGame((g) => (g ? { ...g, mux_playback_id: playbackId } : g));
          }}
        />
      ) : !selectedPlayer ? (
        <>
          <PlayerPickerGrid players={players} onPick={handlePickPlayer} />
          {(flags.length > 0 || sequences.length > 0) && (
            <div style={{ marginTop: 20 }}>
              <OverviewPanels
                flags={flags}
                sequences={sequences}
                shots={shots}
                rallies={rallies}
                players={players}
                onJumpToFlag={(flag) => {
                  const shot = shots.find((s) => s.id === flag.shot_id);
                  if (!shot) return;
                  const p = players.find(
                    (pp) => pp.player_index === shot.player_index,
                  );
                  if (!p) return;
                  handlePickPlayer(p.id);
                  setPendingJump({ kind: "flag", targetShotId: flag.shot_id });
                }}
                onJumpToSequence={(seq) => {
                  setOpenSequenceId(seq.id);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              />
            </div>
          )}
        </>
      ) : (
        <>
        {/* Analytical panels — PB Vision Patterns / Moments toolbar. Opens
            full-screen modals; doesn't disturb the linear review flow below. */}
        <PatternsToolbar shots={shots} rallies={rallies} players={players} />

        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 20, alignItems: "start" }}>
          {/* Left rail: checklist of everything the coach needs to do */}
          <ReviewChecklist
            items={items}
            players={players}
            currentIdx={currentIdx}
            atWrapUp={atWrapUp}
            reviewedCount={reviewedCount}
            isItemReviewed={isItemReviewed}
            onJump={(idx) => setCurrentIdx(idx)}
            dismissedCount={analysis?.dismissed_loss_keys?.length ?? 0}
            onRestoreDismissed={handleRestoreDismissedLosses}
          />

          {/* Right: the active task */}
          <div>
          {items.length === 0 ? (
            <WrapUpPanel
              analysisId={analysis?.id ?? null}
              initial={analysis?.overall_notes ?? ""}
              onSaved={(notes) =>
                setAnalysis((a) => (a ? { ...a, overall_notes: notes } : a))
              }
              progress={{ reviewedCount: 0, total: 0 }}
            />
          ) : atWrapUp ? (
            <WrapUpPanel
              analysisId={analysis?.id ?? null}
              initial={analysis?.overall_notes ?? ""}
              onSaved={(notes) =>
                setAnalysis((a) => (a ? { ...a, overall_notes: notes } : a))
              }
              onBack={() => setCurrentIdx(items.length - 1)}
              progress={{ reviewedCount, total: items.length }}
            />
          ) : (
            <>
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
                        background:
                          currentLoss.kind === "flag"
                            ? "#fff3cd"
                            : currentLoss.kind === "sequence"
                            ? "#e8f0fe"
                            : "#fce8e6",
                        color:
                          currentLoss.kind === "flag"
                            ? "#856404"
                            : currentLoss.kind === "sequence"
                            ? "#1a73e8"
                            : "#c62828",
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: 0.3,
                      }}
                    >
                      {currentLoss.kind === "flag"
                        ? "🚩 Flagged"
                        : currentLoss.kind === "sequence"
                        ? "📋 Sequence"
                        : currentLoss.reason
                        ? REASON_LABELS[currentLoss.reason]
                        : "Rally loss"}
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
                    {currentLoss.kind === "loss" && (
                      <button
                        onClick={() => handleDismissLoss(currentLoss)}
                        title="Remove this rally loss from the checklist — it won't come back unless you restore it"
                        style={{
                          marginLeft: currentLoss.existingSequence ? 4 : "auto",
                          padding: "3px 10px",
                          fontSize: 11,
                          fontWeight: 600,
                          background: "#fff",
                          color: "#666",
                          border: "1px solid #ddd",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        ✕ Not significant
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "#666" }}>
                    {seqShots.length} shots{" "}
                    {currentLoss.kind === "flag"
                      ? "around the flag"
                      : currentLoss.kind === "sequence"
                      ? "in this sequence"
                      : "leading to the error"}{" "}
                    · {formatMs(currentLoss.sequenceStartMs)}–
                    {formatMs(currentLoss.sequenceEndMs)}
                  </div>

                  {/* Flag-specific: show the flag's own note + unflag button */}
                  {currentLoss.kind === "flag" && currentFlag && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: "8px 10px",
                        background: "#fff8e1",
                        border: "1px solid #f0d169",
                        borderRadius: 6,
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                      }}
                    >
                      <span style={{ fontSize: 14 }}>🚩</span>
                      <div style={{ flex: 1, fontSize: 12 }}>
                        <div style={{ color: "#7a5d00", fontWeight: 600, marginBottom: 2 }}>
                          Flag note
                        </div>
                        <FlagNoteInput
                          flag={currentFlag}
                          onSaved={reloadSequences}
                        />
                      </div>
                      <button
                        onClick={async () => {
                          if (!confirm("Remove this flag?")) return;
                          await unflagShot(currentFlag.analysis_id, currentFlag.shot_id);
                          await reloadSequences();
                        }}
                        style={{
                          padding: "4px 10px",
                          fontSize: 11,
                          background: "#fff",
                          color: "#7a5d00",
                          borderTop: "1px solid #f0d169",
                          borderBottom: "1px solid #f0d169",
                          borderLeft: "1px solid #f0d169",
                          borderRight: "1px solid #f0d169",
                          borderRadius: 4,
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        Unflag
                      </button>
                    </div>
                  )}
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
                  <FptmEditor
                    fptm={fptm}
                    drills={drills}
                    onChange={({ fptm: f, drills: d }) => {
                      setFptm(f);
                      setDrills(d);
                    }}
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
                      {currentIdx === items.length - 1
                        ? "Save & Finish →"
                        : "Save & Next →"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
            </>
          )}
          </div>
        </div>
        </>
      )}
    </div>
  );
}

// ─────────────────── Inline saved-sequence playback ───────────────────

function SequencePlayback({
  sequence,
  shots,
  players,
  rallies,
  game,
  onClose,
  onSaved,
  onDeleted,
  onMuxSaved,
}: {
  sequence: AnalysisSequence | null;
  shots: RallyShot[];
  players: PlayerRow[];
  rallies: RallyRow[];
  game: GameRow | null;
  onClose: () => void;
  onSaved: (updated: AnalysisSequence) => void;
  onDeleted: () => void;
  onMuxSaved: (playbackId: string) => void;
}) {
  const videoRef = useRef<VideoPlayerHandle>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(0.5);
  const [fptmDraft, setFptmDraft] = useState<FptmValue>({});
  const [drillsDraft, setDrillsDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // Resolve sequence shots + time range
  const seqShots = sequence
    ? sequence.shot_ids
        .map((id) => shots.find((s) => s.id === id))
        .filter((s): s is RallyShot => !!s)
        .sort((a, b) => a.start_ms - b.start_ms)
    : [];
  const startMs = seqShots[0]?.start_ms ?? 0;
  const endMs = seqShots.length > 0 ? seqShots[seqShots.length - 1].end_ms : 0;
  const rally = sequence ? rallies.find((r) => r.id === sequence.rally_id) ?? null : null;

  // Load diagnosis when the opened sequence changes + seek to start + play
  useEffect(() => {
    if (!sequence) return;
    setFptmDraft((sequence.fptm as FptmValue | null) ?? {});
    setDrillsDraft(sequence.drills ?? null);
    setSaveMsg(null);
    if (seqShots.length > 0) {
      videoRef.current?.seek(startMs);
      videoRef.current?.setPlaybackRate(playbackRate);
      void videoRef.current?.play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequence?.id]);

  // Loop the sequence
  useEffect(() => {
    if (!sequence || seqShots.length === 0) return;
    const endBuffer = 400;
    if (currentMs > endMs + endBuffer) {
      videoRef.current?.seek(startMs);
    }
  }, [currentMs, sequence, startMs, endMs, seqShots.length]);

  function changeRate(r: number) {
    setPlaybackRate(r);
    videoRef.current?.setPlaybackRate(r);
  }

  async function handleSave() {
    if (!sequence) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      await updateSequence(sequence.id, {
        fptm: fptmDraft,
        drills: drillsDraft ?? null,
      });
      onSaved({
        ...sequence,
        fptm: fptmDraft,
        drills: drillsDraft ?? null,
      });
      setSaveMsg("✓ Saved");
      setTimeout(() => setSaveMsg(null), 1500);
    } catch (e) {
      setSaveMsg(e instanceof Error ? `Error: ${e.message}` : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!sequence) return;
    if (!confirm("Delete this saved sequence?")) return;
    try {
      await deleteSequence(sequence.id);
      onDeleted();
    } catch (e) {
      setSaveMsg(e instanceof Error ? `Error: ${e.message}` : String(e));
    }
  }

  async function handlePlaybackIdSave(playbackId: string) {
    if (!game) return;
    await setGameMuxPlaybackId(game.id, playbackId);
    onMuxSaved(playbackId);
  }

  if (!sequence) {
    return (
      <div style={{ padding: 20, color: "#999" }}>
        Sequence not found.{" "}
        <button onClick={onClose} style={{ marginLeft: 8 }}>
          Back
        </button>
      </div>
    );
  }

  const posterUrl = game
    ? pbvPosterUrl(game.pbvision_video_id, game.pbvision_bucket ?? "pbv-pro")
    : "";

  // Player names tagged on the sequence (supports both player_ids and legacy player_id)
  const seqPlayerIds = sequence.player_ids?.length
    ? sequence.player_ids
    : sequence.player_id
    ? [sequence.player_id]
    : [];
  const seqPlayers = seqPlayerIds
    .map((id) => players.find((p) => p.id === id))
    .filter((p): p is PlayerRow => !!p);

  // Playing-shot tooltip
  const playingShot = shots.find(
    (s) => currentMs >= s.start_ms && currentMs <= s.end_ms,
  ) ?? null;
  const playingShotPlayer = playingShot
    ? players.find((p) => p.player_index === playingShot.player_index) ?? null
    : null;

  return (
    <div>
      {/* Back bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 14,
        }}
      >
        <button onClick={onClose} style={navBtn(false)}>
          ← Back to review
        </button>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#333", flex: 1 }}>
          📋 {sequence.label ?? `Saved sequence (${seqShots.length} shots)`}
          {rally && (
            <span style={{ fontSize: 12, color: "#888", fontWeight: 400, marginLeft: 8 }}>
              · Rally {rally.rally_index + 1}
            </span>
          )}
        </div>
        {seqPlayers.length > 0 && (
          <div style={{ display: "flex", gap: 4 }}>
            {seqPlayers.map((p) => (
              <span
                key={p.id}
                style={{
                  padding: "3px 8px",
                  fontSize: 11,
                  fontWeight: 600,
                  background: p.team === 0 ? "#e8f0fe" : "#fff3cd",
                  color: p.team === 0 ? "#1a73e8" : "#7a5d00",
                  borderRadius: 4,
                }}
              >
                {p.display_name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16, alignItems: "start" }}>
        {/* Left: video */}
        <div>
          {game && game.mux_playback_id ? (
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
                  <button key={r} onClick={() => changeRate(r)} style={rateBtn(playbackRate === r)}>
                    {r}×
                  </button>
                ))}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: "#7a5d00", fontStyle: "italic", marginRight: 6 }}>
                  Looping
                </span>
                <button
                  onClick={() => videoRef.current?.seek(startMs)}
                  style={{ ...rateBtn(false), padding: "4px 10px" }}
                >
                  ⟲ Restart
                </button>
              </div>
              <div style={{ marginTop: 6, fontSize: 11, color: "#888" }}>
                {formatMs(startMs)} – {formatMs(endMs)} · {seqShots.length} shot
                {seqShots.length !== 1 ? "s" : ""}
              </div>
            </>
          ) : game ? (
            <VideoUrlInput
              pbvisionVideoId={game.pbvision_video_id}
              onSubmit={handlePlaybackIdSave}
            />
          ) : null}
        </div>

        {/* Right: notes */}
        <div
          style={{
            padding: "14px",
            background: "#fff",
            border: "1px solid #e2e2e2",
            borderRadius: 10,
          }}
        >
          <FptmEditor
            fptm={fptmDraft}
            drills={drillsDraft}
            onChange={({ fptm, drills }) => {
              setFptmDraft(fptm);
              setDrillsDraft(drills);
            }}
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
              onClick={handleDelete}
              style={{ ...navBtn(false), background: "#fff", color: "#c62828", borderColor: "#f5c0bd" } as React.CSSProperties}
            >
              Delete
            </button>
            <button
              onClick={handleSave}
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
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving ? "Saving…" : "Save notes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────── Overview panels ─────────────────────────

function OverviewPanels({
  flags,
  sequences,
  shots,
  rallies,
  players,
  onJumpToFlag,
  onJumpToSequence,
}: {
  flags: FlaggedShot[];
  sequences: AnalysisSequence[];
  shots: RallyShot[];
  rallies: RallyRow[];
  players: PlayerRow[];
  onJumpToFlag: (flag: FlaggedShot) => void;
  onJumpToSequence: (seq: AnalysisSequence) => void;
}) {
  const [open, setOpen] = useState(true);
  const playerById = new Map(players.map((p) => [p.id, p]));
  const playerByIndex = new Map(players.map((p) => [p.player_index, p]));
  const rallyById = new Map(rallies.map((r) => [r.id, r]));
  const shotById = new Map(shots.map((s) => [s.id, s]));

  return (
    <div
      style={{
        marginBottom: 16,
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px",
          background: "#f8f9fa",
          border: "none",
          borderBottom: open ? "1px solid #eee" : "none",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 13,
          fontWeight: 600,
          color: "#333",
          textAlign: "left",
        }}
      >
        <span>
          Review overview ·{" "}
          <span style={{ color: "#d97706" }}>🚩 {flags.length}</span>{" "}
          <span style={{ color: "#999" }}>·</span>{" "}
          <span style={{ color: "#1a73e8" }}>📋 {sequences.length}</span>
        </span>
        <span style={{ fontSize: 11, color: "#999" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "#eee" }}>
          {/* Flagged shots */}
          <div style={{ background: "#fff", padding: 12 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#d97706",
                textTransform: "uppercase",
                letterSpacing: 0.4,
                marginBottom: 8,
              }}
            >
              🚩 Flagged shots ({flags.length})
            </div>
            {flags.length === 0 ? (
              <div style={{ fontSize: 12, color: "#999", fontStyle: "italic" }}>
                No flagged shots yet. Flag shots from the Analyze page.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 240, overflowY: "auto" }}>
                {flags.map((f) => {
                  const shot = shotById.get(f.shot_id);
                  const p = shot ? playerByIndex.get(shot.player_index ?? -1) ?? null : null;
                  const rally = shot ? rallyById.get(shot.rally_id) ?? null : null;
                  return (
                    <button
                      key={f.id}
                      onClick={() => onJumpToFlag(f)}
                      style={listItemBtn}
                      onMouseOver={(e) => (e.currentTarget.style.background = "#fff8e1")}
                      onMouseOut={(e) => (e.currentTarget.style.background = "#fff")}
                    >
                      <span style={{ fontSize: 14 }}>🚩</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#333", display: "flex", gap: 6 }}>
                          <span>{p?.display_name ?? `Player ${shot?.player_index ?? "?"}`}</span>
                          {rally && (
                            <span style={{ color: "#888", fontWeight: 400 }}>
                              · Rally {rally.rally_index + 1}
                            </span>
                          )}
                          {shot && (
                            <span style={{ color: "#888", fontWeight: 400 }}>
                              · {shot.shot_type ?? "shot"}
                            </span>
                          )}
                        </div>
                        {f.note && (
                          <div
                            style={{
                              fontSize: 11,
                              color: "#666",
                              marginTop: 2,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {f.note}
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: 10, color: "#1a73e8", fontWeight: 600, flexShrink: 0 }}>
                        Review →
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Saved sequences */}
          <div style={{ background: "#fff", padding: 12 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "#1a73e8",
                textTransform: "uppercase",
                letterSpacing: 0.4,
                marginBottom: 8,
              }}
            >
              📋 Saved sequences ({sequences.length})
            </div>
            {sequences.length === 0 ? (
              <div style={{ fontSize: 12, color: "#999", fontStyle: "italic" }}>
                No saved sequences yet. Build sequences from the Analyze page.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 240, overflowY: "auto" }}>
                {sequences.map((seq) => {
                  const rally = rallyById.get(seq.rally_id) ?? null;
                  // Show all player_ids if present, else fall back to player_id
                  const seqPlayerIds = seq.player_ids?.length
                    ? seq.player_ids
                    : seq.player_id
                    ? [seq.player_id]
                    : [];
                  const playerNames = seqPlayerIds
                    .map((id) => playerById.get(id)?.display_name)
                    .filter(Boolean);
                  return (
                    <button
                      key={seq.id}
                      onClick={() => onJumpToSequence(seq)}
                      style={listItemBtn}
                      onMouseOver={(e) => (e.currentTarget.style.background = "#eef3ff")}
                      onMouseOut={(e) => (e.currentTarget.style.background = "#fff")}
                      title="Open this sequence on the Analyze page"
                    >
                      <span style={{ fontSize: 14 }}>📋</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 600,
                            color: "#333",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {seq.label ?? `${seq.shot_ids.length} shots`}
                        </div>
                        <div style={{ fontSize: 11, color: "#666", marginTop: 2, display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {playerNames.length > 0 && (
                            <span>{playerNames.join(", ")}</span>
                          )}
                          {rally && (
                            <span style={{ color: "#888" }}>· Rally {rally.rally_index + 1}</span>
                          )}
                          {summarizeFptm(seq.fptm).map(({ pillar, itemCount }) => (
                            <span
                              key={pillar.id}
                              title={pillar.label}
                              style={{
                                padding: "1px 5px",
                                fontSize: 10,
                                fontWeight: 700,
                                background: `${pillar.color}18`,
                                color: pillar.color,
                                borderRadius: 3,
                              }}
                            >
                              {pillar.letter}
                              {itemCount > 0 ? ` ${itemCount}` : ""}
                            </span>
                          ))}
                        </div>
                      </div>
                      <span style={{ fontSize: 10, color: "#1a73e8", fontWeight: 600, flexShrink: 0 }}>
                        Open →
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const listItemBtn: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  background: "#fff",
  border: "1px solid #eee",
  borderRadius: 6,
  cursor: "pointer",
  textAlign: "left",
  fontFamily: "inherit",
  width: "100%",
};

function FlagNoteInput({
  flag,
  onSaved,
}: {
  flag: FlaggedShot;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(flag.note ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setValue(flag.note ?? "");
  }, [flag.id, flag.note]);

  async function save() {
    setSaving(true);
    try {
      await updateFlagNote(flag.id, value.trim() || null);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 6 }}>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        placeholder="Quick note on this flag (optional)…"
        style={{
          flex: 1,
          padding: "4px 8px",
          fontSize: 12,
          borderTop: "1px solid #ddd",
          borderBottom: "1px solid #ddd",
          borderLeft: "1px solid #ddd",
          borderRight: "1px solid #ddd",
          borderRadius: 4,
          outline: "none",
          fontFamily: "inherit",
        }}
      />
      {saving && <span style={{ fontSize: 11, color: "#888" }}>saving…</span>}
    </div>
  );
}

// ─────────────────────── Review checklist (left rail) ───────────────────────
//
// Streamlined todo-style list so the coach has a single clear path: walk
// down the list, check each item off, finish with the report card.

function ReviewChecklist({
  items,
  players,
  currentIdx,
  atWrapUp,
  reviewedCount,
  isItemReviewed,
  onJump,
  dismissedCount,
  onRestoreDismissed,
}: {
  items: PlayerLoss[];
  players: PlayerRow[];
  currentIdx: number;
  atWrapUp: boolean;
  reviewedCount: number;
  isItemReviewed: (it: PlayerLoss) => boolean;
  onJump: (idx: number) => void;
  dismissedCount: number;
  onRestoreDismissed: () => void;
}) {
  const total = items.length;
  const progressPct = total === 0 ? (atWrapUp ? 100 : 0) : (reviewedCount / total) * 100;

  // Build section groups (keeping queue order)
  const flagItems = items.map((it, idx) => ({ it, idx })).filter((x) => x.it.kind === "flag");
  const sequenceItems = items.map((it, idx) => ({ it, idx })).filter((x) => x.it.kind === "sequence");
  const lossItems = items.map((it, idx) => ({ it, idx })).filter((x) => x.it.kind === "loss");

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 10,
        overflow: "hidden",
        position: "sticky",
        top: 16,
      }}
    >
      {/* Header: progress summary */}
      <div style={{ padding: "12px 14px", borderBottom: "1px solid #eee" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>
          Review checklist
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#333", marginTop: 2 }}>
          {reviewedCount} of {total}
        </div>
        <div
          style={{
            height: 5,
            background: "#f0f0f0",
            borderRadius: 3,
            overflow: "hidden",
            marginTop: 6,
          }}
        >
          <div
            style={{
              height: "100%",
              background: progressPct === 100 ? "#1e7e34" : "#1a73e8",
              width: `${progressPct}%`,
              transition: "width 0.2s",
            }}
          />
        </div>
      </div>

      {/* Sections — always rendered so the coach sees the three categories
          of work whether or not there's anything in them today. */}
      <ChecklistSection
        icon="🚩"
        title="Flags"
        color="#d97706"
        entries={flagItems}
        players={players}
        currentIdx={currentIdx}
        atWrapUp={atWrapUp}
        isItemReviewed={isItemReviewed}
        onJump={onJump}
        emptyMessage="No flagged shots yet. Flag shots from the Analyze page."
      />
      <ChecklistSection
        icon="📋"
        title="Sequences"
        color="#1a73e8"
        entries={sequenceItems}
        players={players}
        currentIdx={currentIdx}
        atWrapUp={atWrapUp}
        isItemReviewed={isItemReviewed}
        onJump={onJump}
        emptyMessage="No saved sequences for this player yet."
      />
      <ChecklistSection
        icon="⚠"
        title="Rally losses"
        color="#c62828"
        entries={lossItems}
        players={players}
        currentIdx={currentIdx}
        atWrapUp={atWrapUp}
        isItemReviewed={isItemReviewed}
        onJump={onJump}
        emptyMessage="No attributed rally losses."
        trailing={
          dismissedCount > 0 ? (
            <div
              style={{
                padding: "6px 14px",
                fontSize: 11,
                color: "#999",
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "#fafafa",
              }}
            >
              <span>
                {dismissedCount} dismissed loss
                {dismissedCount !== 1 ? "es" : ""}
              </span>
              <button
                onClick={onRestoreDismissed}
                style={{
                  padding: "1px 6px",
                  fontSize: 10,
                  fontWeight: 600,
                  background: "#fff",
                  color: "#1a73e8",
                  border: "1px solid #c6dafc",
                  borderRadius: 3,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Restore all
              </button>
            </div>
          ) : null
        }
      />

      {/* Wrap-up row — always present */}
      <div
        style={{
          borderTop: "1px solid #eee",
          background: atWrapUp ? "#e6f4ea" : "#fff",
        }}
      >
        <button
          onClick={() => onJump(total)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "100%",
            padding: "12px 14px",
            background: "transparent",
            border: "none",
            borderLeft: atWrapUp ? "3px solid #1e7e34" : "3px solid transparent",
            cursor: "pointer",
            textAlign: "left",
            fontFamily: "inherit",
          }}
        >
          <span style={{ fontSize: 16 }}>🎓</span>
          <span
            style={{
              flex: 1,
              fontSize: 13,
              fontWeight: atWrapUp ? 700 : 600,
              color: atWrapUp ? "#1e7e34" : "#333",
            }}
          >
            Report card
          </span>
          {atWrapUp && <span style={{ fontSize: 10, color: "#1e7e34", fontWeight: 700 }}>NOW</span>}
        </button>
      </div>
    </div>
  );
}

function ChecklistSection({
  icon,
  title,
  color,
  entries,
  players,
  currentIdx,
  atWrapUp,
  isItemReviewed,
  onJump,
  emptyMessage,
  trailing,
}: {
  icon: string;
  title: string;
  color: string;
  entries: Array<{ it: PlayerLoss; idx: number }>;
  players: PlayerRow[];
  currentIdx: number;
  atWrapUp: boolean;
  isItemReviewed: (it: PlayerLoss) => boolean;
  onJump: (idx: number) => void;
  emptyMessage?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div style={{ borderTop: "1px solid #eee" }}>
      <div
        style={{
          padding: "8px 14px",
          background: "#fafafa",
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 10,
          fontWeight: 700,
          color,
          textTransform: "uppercase",
          letterSpacing: 0.5,
        }}
      >
        <span style={{ fontSize: 12 }}>{icon}</span>
        <span>{title}</span>
        <span style={{ color: "#999", fontWeight: 500 }}>· {entries.length}</span>
      </div>
      {entries.length === 0 && emptyMessage && (
        <div
          style={{
            padding: "8px 14px 10px",
            fontSize: 11,
            color: "#999",
            fontStyle: "italic",
          }}
        >
          {emptyMessage}
        </div>
      )}
      {entries.map(({ it, idx }) => {
        const active = !atWrapUp && idx === currentIdx;
        const reviewed = isItemReviewed(it);
        const label = checklistLabel(it, players);
        return (
          <button
            key={it.itemKey}
            onClick={() => onJump(idx)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "7px 14px 7px 10px",
              background: active ? `${color}14` : reviewed ? "#fafcff" : "#fff",
              border: "none",
              borderLeft: active
                ? `3px solid ${color}`
                : "3px solid transparent",
              cursor: "pointer",
              textAlign: "left",
              fontFamily: "inherit",
              lineHeight: 1.3,
            }}
          >
            <StatusDot reviewed={reviewed} active={active} color={color} />
            <span
              style={{
                flex: 1,
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                color: reviewed ? "#666" : "#333",
                textDecoration: reviewed && !active ? "line-through" : "none",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={label.full}
            >
              {label.primary}
              <span style={{ color: "#999", fontWeight: 400, marginLeft: 4 }}>
                {label.secondary}
              </span>
            </span>
          </button>
        );
      })}
      {trailing}
    </div>
  );
}

function StatusDot({
  reviewed,
  active,
  color,
}: {
  reviewed: boolean;
  active: boolean;
  color: string;
}) {
  if (reviewed) {
    return (
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "#1e7e34",
          color: "#fff",
          fontSize: 10,
          fontWeight: 700,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        ✓
      </span>
    );
  }
  return (
    <span
      style={{
        width: 16,
        height: 16,
        borderRadius: "50%",
        border: `2px solid ${active ? color : "#ccc"}`,
        flexShrink: 0,
        boxSizing: "border-box",
      }}
    />
  );
}

function checklistLabel(
  it: PlayerLoss,
  players: PlayerRow[],
): { primary: string; secondary: string; full: string } {
  const rallyLabel = `Rally ${it.rallyIndex + 1}`;
  if (it.kind === "flag") {
    const shotId = it.attributedShotId;
    // We don't have full shot details here; use rally + player as hint
    const shotPlayer = it.flag
      ? players.find((p) => {
          // best effort — flag has shot_id; we use rally + attributedShotId
          return p.id === shotId;
        })
      : null;
    return {
      primary: rallyLabel,
      secondary: shotPlayer ? `· ${shotPlayer.display_name.split(" ")[0]}` : "",
      full: `Flag · ${rallyLabel}`,
    };
  }
  if (it.kind === "sequence") {
    const lbl = it.sequence?.label?.trim();
    return {
      primary: lbl || `${it.sequenceShotIds.length} shots`,
      secondary: `· ${rallyLabel}`,
      full: `Sequence · ${rallyLabel}${lbl ? ` · ${lbl}` : ""}`,
    };
  }
  // Loss
  const reason = it.reason ? REASON_LABELS[it.reason] : "Rally loss";
  return {
    primary: reason,
    secondary: `· ${rallyLabel}`,
    full: `${reason} · ${rallyLabel}`,
  };
}


/**
 * Wrap-up panel — shown after the coach has walked through every flag,
 * sequence, and rally loss for the selected player. This is the beginnings
 * of a "digital report card": a single big notes field that's saved on the
 * game_analyses row (overall_notes). More structured fields can be added
 * later without disturbing the flow.
 */
// Static sample data — will eventually be driven by scheduling / library tables.
const SAMPLE_CLINICS = [
  { id: "c-drop", title: "3rd Shot Drop Clinic", when: "Sat · 9:00 AM", focus: "Paddle · contact point" },
  { id: "c-dink", title: "Advanced Dinking", when: "Mon · 6:00 PM", focus: "Tactics · pattern execution" },
  { id: "c-reset", title: "Reset & Defense Workshop", when: "Wed · 10:00 AM", focus: "Footwork · balance at contact" },
  { id: "c-mindset", title: "Match-Play Mental Game", when: "Thu · 7:00 PM", focus: "Mindset · tempo control" },
];

const SAMPLE_DRILLS = [
  { id: "d-triangle", title: "Dink Triangle", mins: 8, focus: "Paddle face control" },
  { id: "d-block", title: "Block-to-Dink Reset", mins: 6, focus: "Paddle · grip pressure" },
  { id: "d-split", title: "Split-Step Timing", mins: 5, focus: "Footwork · ready position" },
  { id: "d-shadow", title: "Shadow Recovery", mins: 5, focus: "Footwork · recovery" },
  { id: "d-target", title: "Target 3rd Shot Drops", mins: 10, focus: "Paddle · spin + margin" },
];

function SuggestionsRow() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
        marginBottom: 16,
      }}
    >
      <SuggestionCard
        title="Upcoming clinics"
        accent="#7e57c2"
        hint="Sample — will be tailored per player."
        items={SAMPLE_CLINICS.map((c) => ({
          id: c.id,
          primary: c.title,
          secondary: `${c.when}  ·  ${c.focus}`,
        }))}
      />
      <SuggestionCard
        title="Suggested drills"
        accent="#1e7e34"
        hint="Sample — will be tailored per player."
        items={SAMPLE_DRILLS.map((d) => ({
          id: d.id,
          primary: d.title,
          secondary: `${d.mins} min  ·  ${d.focus}`,
        }))}
      />
    </div>
  );
}

function SuggestionCard({
  title,
  accent,
  hint,
  items,
}: {
  title: string;
  accent: string;
  hint: string;
  items: Array<{ id: string; primary: string; secondary: string }>;
}) {
  return (
    <div
      style={{
        border: "1px solid #e2e2e2",
        borderLeft: `3px solid ${accent}`,
        borderRadius: 8,
        padding: "10px 12px",
        background: `${accent}06`,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: accent,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          marginBottom: 2,
        }}
      >
        {title}
      </div>
      <div style={{ fontSize: 10, color: "#999", marginBottom: 8 }}>{hint}</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {items.map((it) => (
          <li
            key={it.id}
            style={{
              padding: "6px 8px",
              background: "#fff",
              borderRadius: 5,
              border: "1px solid #eee",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: "#333" }}>
              {it.primary}
            </div>
            <div style={{ fontSize: 11, color: "#666", marginTop: 1 }}>
              {it.secondary}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function WrapUpPanel({
  analysisId,
  initial,
  onSaved,
  onBack,
  progress,
}: {
  analysisId: string | null;
  initial: string;
  onSaved: (notes: string | null) => void;
  onBack?: () => void;
  progress?: { reviewedCount: number; total: number };
}) {
  const [notes, setNotes] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  useEffect(() => {
    setNotes(initial);
  }, [initial]);

  async function handleSave() {
    if (!analysisId) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const trimmed = notes.trim() || null;
      await updateAnalysis(analysisId, { overall_notes: trimmed });
      onSaved(trimmed);
      setSaveMsg("✓ Saved");
      setTimeout(() => setSaveMsg(null), 1500);
    } catch (e) {
      setSaveMsg(e instanceof Error ? `Error: ${e.message}` : String(e));
    } finally {
      setSaving(false);
    }
  }

  const done = progress ? progress.reviewedCount >= progress.total : false;

  return (
    <div
      style={{
        padding: 20,
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 18, fontWeight: 700, color: "#333" }}>
          🎓 Report card
        </span>
        {progress && (
          <span
            style={{
              fontSize: 12,
              padding: "3px 8px",
              background: done ? "#e6f4ea" : "#fff3cd",
              color: done ? "#1e7e34" : "#7a5d00",
              borderRadius: 4,
              fontWeight: 600,
            }}
          >
            {done
              ? `✓ All ${progress.total} items reviewed`
              : `${progress.reviewedCount} of ${progress.total} items reviewed`}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {onBack && (
          <button
            onClick={onBack}
            style={{
              padding: "5px 12px",
              fontSize: 12,
              background: "#fff",
              color: "#555",
              border: "1px solid #ddd",
              borderRadius: 5,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            ← Back to last item
          </button>
        )}
      </div>

      {/* General notes — free-form observations. This field will likely grow
          into a structured report-card over time; the shape may change. */}
      <div style={{ marginBottom: 16 }}>
        <label
          style={{
            display: "block",
            fontSize: 11,
            fontWeight: 700,
            color: "#666",
            textTransform: "uppercase",
            letterSpacing: 0.5,
            marginBottom: 6,
          }}
        >
          General notes
        </label>
        <p style={{ fontSize: 12, color: "#888", marginTop: 0, marginBottom: 8 }}>
          Overall coaching takeaways from this game — strengths, patterns to
          keep, priorities to work on, partner dynamics, mindset observations.
        </p>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={8}
          placeholder="Write the player's takeaways from this game…"
          style={{
            width: "100%",
            padding: "10px 12px",
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
          }}
        />
      </div>

      {/* Sample recommendations — stubs for now; will get tailored per player
          once the report-card structure matures. */}
      <SuggestionsRow />


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
          onClick={handleSave}
          disabled={saving || !analysisId}
          style={{
            padding: "7px 16px",
            fontSize: 13,
            fontWeight: 600,
            background: "#1a73e8",
            color: "#fff",
            border: "1px solid #1a73e8",
            borderRadius: 6,
            cursor: "pointer",
            fontFamily: "inherit",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Saving…" : "Save report card"}
        </button>
      </div>
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

