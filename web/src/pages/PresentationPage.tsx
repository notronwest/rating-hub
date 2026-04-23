/**
 * PresentationPage — read-only walkthrough of a player's reviewed coaching
 * items, meant for sitting down with the player after the game.
 *
 * Mirrors the Coach Review queue's mental model but strips out all the
 * editors: you scrub through the items you actually reviewed, see the
 * rally play with the flagged / sequence shots highlighted, read the
 * coach's saved notes, and hit "Reviewed" to move on. No forms, no
 * recommendation editing, no FPTM tagging — that's all what the Review
 * Queue is for.
 *
 * Queue shape (in order, only included if the item has real coaching
 * content and isn't dismissed):
 *   1. Flags on this player's shots
 *   2. Sequences tagged to this player
 *
 * WMPC Analysis topics are intentionally NOT walked through here — they're
 * global patterns, not per-rally moments, and surfacing them inline would
 * dilute the "watch the rally → read the note → move on" rhythm. The
 * printable Game Report is the right place for that summary.
 *
 * Per-session "reviewed with customer" state is persisted in localStorage
 * keyed by gameId:playerId so the coach can pause and resume a
 * walkthrough without losing place.
 *
 * Route: /org/:orgId/games/:gameId/present?playerId=...&share=1
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../supabase";
import type {
  Game,
  GamePlayer,
  Rally,
  RallyShot,
} from "../types/database";
import type {
  AnalysisSequence,
  FlaggedShot,
  GameAnalysis,
} from "../types/coach";
import type { FptmValue } from "../lib/fptm";
import { summarizeFptm } from "../lib/fptm";
import { updateAnalysis } from "../lib/coachApi";
import {
  categorizeRallyLoss,
  buildLossSequence,
  REASON_LABELS,
} from "../lib/rallyAnalysis";
import VideoPlayer, { type VideoPlayerHandle } from "../components/analyze/VideoPlayer";

interface PlayerRow {
  id: string;
  display_name: string;
  slug: string;
  avatar_url: string | null;
  player_index: number;
  team: number;
}

// Unified queue item — every entry the Review Queue surfaces. We show
// flags, saved sequences, AND auto-attributed rally losses so the coach
// can walk through the entire list with the player. An item with no coach
// notes still plays the clip and prompts the coach to talk through it
// live. A lead-off "summary" slide carries the overall coach note so the
// walkthrough opens on the big-picture framing.
type QueueItem =
  | {
      kind: "summary";
      itemKey: string;
      tone: "good_job" | "needs_work" | null;
      note: string;
    }
  | {
      kind: "flag";
      itemKey: string;
      rally: Rally;
      rallyShots: RallyShot[];
      flag: FlaggedShot;
      /** The single shot the coach flagged — gets the bright highlight. */
      focusShotIds: Set<string>;
      title: string;
      note: string | null;
      fptm: FptmValue | null;
      drills: string | null;
    }
  | {
      kind: "sequence";
      itemKey: string;
      rally: Rally;
      rallyShots: RallyShot[];
      sequence: AnalysisSequence;
      /** The subset of the rally that belongs to the saved sequence. */
      focusShotIds: Set<string>;
      title: string;
      note: string | null;
      fptm: FptmValue | null;
      drills: string | null;
    }
  | {
      kind: "loss";
      itemKey: string;
      rally: Rally;
      rallyShots: RallyShot[];
      /** The shot the loss was attributed to (fault that ended the rally). */
      focusShotIds: Set<string>;
      title: string;
      reasonLabel: string;
      /** Rally losses without saved coach content have null for all three.
       *  The UI surfaces a "nothing written yet — talk it through live"
       *  nudge in that case. */
      note: null;
      fptm: null;
      drills: null;
    };

export default function PresentationPage() {
  const { orgId, gameId } = useParams();
  const [searchParams] = useSearchParams();
  const playerIdParam = searchParams.get("playerId");
  const isShared = searchParams.get("share") === "1";

  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [rallies, setRallies] = useState<Rally[]>([]);
  const [shots, setShots] = useState<RallyShot[]>([]);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [sequences, setSequences] = useState<AnalysisSequence[]>([]);
  const [flags, setFlags] = useState<FlaggedShot[]>([]);
  const [loading, setLoading] = useState(true);

  const [currentIdx, setCurrentIdx] = useState(0);
  // Reviewed-with-customer state, keyed by item itemKey. Persisted per
  // gameId + playerId so the coach can resume a walkthrough after a break.
  const [reviewedKeys, setReviewedKeys] = useState<Set<string>>(new Set());
  const reviewedStorageKey = gameId && playerIdParam ? `present-reviewed:${gameId}:${playerIdParam}` : null;
  useEffect(() => {
    if (!reviewedStorageKey) return;
    try {
      const raw = localStorage.getItem(reviewedStorageKey);
      if (raw) setReviewedKeys(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* localStorage may be blocked in private browsing; ignore */
    }
  }, [reviewedStorageKey]);
  function setReviewed(key: string, reviewed: boolean) {
    setReviewedKeys((prev) => {
      const next = new Set(prev);
      if (reviewed) next.add(key);
      else next.delete(key);
      if (reviewedStorageKey) {
        try {
          localStorage.setItem(reviewedStorageKey, JSON.stringify(Array.from(next)));
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  }

  useEffect(() => {
    if (!gameId) return;
    (async () => {
      setLoading(true);
      try {
        const { data: g } = await supabase
          .from("games")
          .select("*")
          .eq("id", gameId)
          .single();
        if (!g) return;
        setGame(g as Game);

        const { data: gps } = await supabase
          .from("game_players")
          .select("*")
          .eq("game_id", gameId)
          .order("player_index");
        if (!gps) return;
        const playerIds = gps.map((gp) => gp.player_id);
        const { data: playerRows } = await supabase
          .from("players")
          .select("id, display_name, slug, avatar_url")
          .in("id", playerIds);
        const pMap = new Map(
          (playerRows ?? []).map((p) => [p.id, p]),
        );
        setPlayers(
          (gps as GamePlayer[]).map((gp) => ({
            id: gp.player_id,
            display_name: pMap.get(gp.player_id)?.display_name ?? "Unknown",
            slug: pMap.get(gp.player_id)?.slug ?? "",
            avatar_url: pMap.get(gp.player_id)?.avatar_url ?? null,
            player_index: gp.player_index,
            team: gp.team,
          })),
        );

        const [ralRes, anaRes] = await Promise.all([
          supabase.from("rallies").select("*").eq("game_id", gameId).order("rally_index"),
          supabase.from("game_analyses").select("*").eq("game_id", gameId).maybeSingle(),
        ]);
        const rallyList = (ralRes.data ?? []) as Rally[];
        setRallies(rallyList);
        // rally_shots has no game_id column — fetch by the rally_ids we
        // just loaded instead.
        if (rallyList.length > 0) {
          const { data: shotRows } = await supabase
            .from("rally_shots")
            .select("*")
            .in(
              "rally_id",
              rallyList.map((r) => r.id),
            );
          setShots((shotRows ?? []) as RallyShot[]);
        } else {
          setShots([]);
        }
        const ana = anaRes.data as GameAnalysis | null;
        setAnalysis(ana);

        if (ana) {
          const [seqRes, flgRes] = await Promise.all([
            supabase.from("game_analysis_sequences").select("*").eq("analysis_id", ana.id),
            supabase.from("analysis_flagged_shots").select("*").eq("analysis_id", ana.id),
          ]);
          setSequences((seqRes.data ?? []) as AnalysisSequence[]);
          setFlags((flgRes.data ?? []) as FlaggedShot[]);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [gameId]);

  const selectedPlayer = useMemo(
    () =>
      players.find((p) => p.id === playerIdParam) ??
      (players.length > 0 ? players[0] : null),
    [players, playerIdParam],
  );

  // Build the presentation queue — mirrors the Review Queue exactly so the
  // coach walks through the same list they saw while reviewing. Three
  // sources:
  //   1. Flagged shots (every flag on this player's shots)
  //   2. Saved sequences (every sequence tagged to this player)
  //   3. Auto-attributed rally losses (rallies this player's team lost
  //      where the fault shot is theirs) — excluding ones already saved as
  //      a sequence and excluding ones the coach explicitly dismissed.
  //
  // Nothing is filtered by whether the coach wrote notes — presentation
  // mode is meant to walk every item, with empty ones falling back to
  // "talk it through live" prompts.
  const queue: QueueItem[] = useMemo(() => {
    if (!selectedPlayer) return [];

    const shotsByRally = new Map<string, RallyShot[]>();
    for (const s of shots) {
      if (!shotsByRally.has(s.rally_id)) shotsByRally.set(s.rally_id, []);
      shotsByRally.get(s.rally_id)!.push(s);
    }
    for (const [, arr] of shotsByRally) arr.sort((a, b) => a.shot_index - b.shot_index);

    const myShotIds = new Set(
      shots
        .filter((s) => s.player_index === selectedPlayer.player_index)
        .map((s) => s.id),
    );
    const flaggedShotIds = new Set(flags.map((f) => f.shot_id));
    const dismissedLossKeys = new Set(analysis?.dismissed_loss_keys ?? []);

    const out: QueueItem[] = [];

    // ── Summary (lead-off) ──
    // If the coach wrote an overall note, show it as the first slide so
    // the walkthrough opens with the big-picture takeaway before diving
    // into per-rally detail.
    const overall = analysis?.overall_notes?.trim();
    if (overall) {
      out.push({
        kind: "summary",
        itemKey: `summary:${analysis?.id ?? "default"}`,
        tone: analysis?.overall_tone ?? null,
        note: overall,
      });
    }

    // ── Flags ──
    for (const f of flags) {
      if (!myShotIds.has(f.shot_id)) continue;
      const shot = shots.find((s) => s.id === f.shot_id);
      if (!shot) continue;
      const rally = rallies.find((r) => r.id === shot.rally_id);
      if (!rally) continue;
      out.push({
        kind: "flag",
        itemKey: `flag:${f.id}`,
        rally,
        rallyShots: shotsByRally.get(rally.id) ?? [],
        flag: f,
        focusShotIds: new Set([f.shot_id]),
        title: `Rally ${rally.rally_index + 1}`,
        note: f.note,
        fptm: f.fptm as FptmValue | null,
        drills: f.drills,
      });
    }

    // ── Sequences tagged to this player ──
    // Track which sequences correspond to loss items so we don't duplicate
    // them below.
    const sequenceIdsSurfaced = new Set<string>();
    for (const seq of sequences) {
      const tagged =
        seq.player_id === selectedPlayer.id ||
        (seq.player_ids ?? []).includes(selectedPlayer.id);
      if (!tagged) continue;
      const rally = rallies.find((r) => r.id === seq.rally_id);
      if (!rally) continue;
      sequenceIdsSurfaced.add(seq.id);
      out.push({
        kind: "sequence",
        itemKey: `seq:${seq.id}`,
        rally,
        rallyShots: shotsByRally.get(rally.id) ?? [],
        sequence: seq,
        focusShotIds: new Set(seq.shot_ids),
        title: seq.label ?? `Rally ${rally.rally_index + 1}`,
        note: seq.what_went_wrong,
        fptm: seq.fptm as FptmValue | null,
        drills: seq.drills,
      });
    }

    // ── Auto-attributed rally losses ──
    // Mirror the Review Queue's loss-building rules: player's team lost,
    // the attributed fault is theirs, not already flagged, not dismissed,
    // and not already represented as a sequence.
    for (const rally of rallies) {
      if (rally.winning_team == null) continue;
      const losingTeam = (1 - rally.winning_team) as 0 | 1;
      if (selectedPlayer.team !== losingTeam) continue;
      const rs = shotsByRally.get(rally.id) ?? [];
      const res = categorizeRallyLoss(rs, losingTeam);
      if (!res) continue;
      if (res.attributedShot.player_index !== selectedPlayer.player_index) continue;
      if (flaggedShotIds.has(res.attributedShot.id)) continue;
      const itemKey = `loss:${rally.id}:${res.attributedShot.id}`;
      if (dismissedLossKeys.has(itemKey)) continue;

      const seqIds = buildLossSequence(rs, res.attributedShot, 4);
      // If an existing sequence covers exactly this set of shots, the
      // sequence branch already added it — skip here.
      const existingSequence = sequences.find(
        (seq) =>
          seq.rally_id === rally.id &&
          seq.player_id === selectedPlayer.id &&
          seq.shot_ids.length === seqIds.length &&
          seq.shot_ids.every((id) => seqIds.includes(id)),
      );
      if (existingSequence && sequenceIdsSurfaced.has(existingSequence.id)) continue;

      out.push({
        kind: "loss",
        itemKey,
        rally,
        rallyShots: rs,
        focusShotIds: new Set([res.attributedShot.id]),
        title: `Rally ${rally.rally_index + 1}`,
        reasonLabel: REASON_LABELS[res.reason] ?? "Rally loss",
        note: null,
        fptm: null,
        drills: null,
      });
    }

    // Sort: summary → flags → sequences → losses, each chronological.
    // Matches the Review Queue's ordering, with the lead-off summary slide
    // pinned to the front.
    const kindOrder = { summary: 0, flag: 1, sequence: 2, loss: 3 } as const;
    out.sort((a, b) => {
      if (a.kind !== b.kind) return kindOrder[a.kind] - kindOrder[b.kind];
      if (a.kind === "summary" || b.kind === "summary") return 0;
      return a.rally.rally_index - b.rally.rally_index;
    });
    return out;
  }, [selectedPlayer, flags, sequences, rallies, shots, analysis]);

  // Clamp cursor when the queue changes length (e.g., on player switch).
  useEffect(() => {
    if (currentIdx >= queue.length) setCurrentIdx(Math.max(0, queue.length - 1));
  }, [queue.length, currentIdx]);

  const go = useCallback(
    (delta: number) => {
      setCurrentIdx((i) => Math.max(0, Math.min(queue.length - 1, i + delta)));
    },
    [queue.length],
  );

  // Keyboard shortcuts — ← → advance, Enter toggles reviewed + advances, Esc
  // exits.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't hijack typing in form fields (there aren't any right now but
      // this guards against future additions like a live annotation).
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (window.history.length > 1) window.history.back();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (loading || !game) {
    return <div style={loadingStyle}>Loading presentation…</div>;
  }
  if (!selectedPlayer) {
    return <div style={loadingStyle}>No player selected.</div>;
  }

  const reviewedCount = queue.filter((q) => reviewedKeys.has(q.itemKey)).length;

  return (
    <div style={rootStyle}>
      <PresentationToolbar
        orgId={orgId ?? ""}
        gameId={gameId ?? ""}
        player={selectedPlayer}
        analysis={analysis}
        onAnalysisUpdate={(patch) =>
          setAnalysis((a) => (a ? { ...a, ...patch } : a))
        }
        progress={{ reviewed: reviewedCount, total: queue.length }}
        isShared={isShared}
      />

      {queue.length === 0 ? (
        <EmptyState player={selectedPlayer} />
      ) : queue[currentIdx].kind === "summary" ? (
        <SummarySlide
          key={queue[currentIdx].itemKey}
          item={queue[currentIdx] as Extract<QueueItem, { kind: "summary" }>}
          player={selectedPlayer}
          currentIdx={currentIdx}
          total={queue.length}
          reviewed={reviewedKeys.has(queue[currentIdx]?.itemKey ?? "")}
          onToggleReviewed={() => {
            const item = queue[currentIdx];
            if (!item) return;
            const nowReviewed = !reviewedKeys.has(item.itemKey);
            setReviewed(item.itemKey, nowReviewed);
            if (nowReviewed && currentIdx < queue.length - 1) {
              setCurrentIdx(currentIdx + 1);
            }
          }}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
        />
      ) : (
        <ItemView
          key={queue[currentIdx]?.itemKey ?? "none"}
          item={queue[currentIdx] as Exclude<QueueItem, { kind: "summary" }>}
          player={selectedPlayer}
          playbackId={game.mux_playback_id}
          currentIdx={currentIdx}
          total={queue.length}
          reviewed={reviewedKeys.has(queue[currentIdx]?.itemKey ?? "")}
          onToggleReviewed={() => {
            const item = queue[currentIdx];
            if (!item) return;
            const nowReviewed = !reviewedKeys.has(item.itemKey);
            setReviewed(item.itemKey, nowReviewed);
            if (nowReviewed) {
              // Move to the next un-reviewed item, or the next one if all
              // downstream items are already reviewed.
              const nextUnreviewed = queue.findIndex(
                (q, i) => i > currentIdx && !reviewedKeys.has(q.itemKey),
              );
              if (nextUnreviewed >= 0) setCurrentIdx(nextUnreviewed);
              else if (currentIdx < queue.length - 1) setCurrentIdx(currentIdx + 1);
            }
          }}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
          muted={isShared}
        />
      )}
    </div>
  );
}

// ─────────────────────────── Toolbar ───────────────────────────

function PresentationToolbar({
  orgId,
  gameId,
  player,
  analysis,
  onAnalysisUpdate,
  progress,
  isShared,
}: {
  orgId: string;
  gameId: string;
  player: PlayerRow;
  analysis: GameAnalysis | null;
  onAnalysisUpdate: (patch: Partial<GameAnalysis>) => void;
  progress: { reviewed: number; total: number };
  isShared: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const isPublic = !!analysis?.is_public;

  async function togglePublic() {
    if (!analysis) return;
    const next = !isPublic;
    try {
      await updateAnalysis(analysis.id, { is_public: next });
      onAnalysisUpdate({ is_public: next });
    } catch (e) {
      alert(`Couldn't toggle sharing: ${e instanceof Error ? e.message : e}`);
    }
  }
  const shareUrl = () => {
    const base = typeof window !== "undefined" ? window.location.origin : "";
    return `${base}/org/${orgId}/games/${gameId}/present?playerId=${player.id}&share=1`;
  };
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      window.prompt("Copy this link:", shareUrl());
    }
  }

  return (
    <div style={toolbarStyle}>
      {!isShared && (
        <Link
          to={`/org/${orgId}/games/${gameId}/coach-review?playerId=${player.id}`}
          style={backLinkStyle}
        >
          ← Back to review
        </Link>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {player.avatar_url ? (
          <img
            src={player.avatar_url}
            alt=""
            style={{ width: 34, height: 34, borderRadius: "50%", border: "2px solid #1a73e8" }}
          />
        ) : (
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: "#1a73e8",
              color: "#fff",
              display: "grid",
              placeItems: "center",
              fontSize: 14,
              fontWeight: 700,
            }}
          >
            {player.display_name[0]}
          </div>
        )}
        <div>
          <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
            Presenting
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>
            {player.display_name}
          </div>
        </div>
      </div>

      <span style={{ flex: 1 }} />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 12px",
          background: "#1c1c1c",
          borderRadius: 16,
          fontSize: 12,
          color: "#ddd",
        }}
        title="How many items you've walked through with the player"
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background:
              progress.total === 0
                ? "#555"
                : progress.reviewed === progress.total
                ? "#2ecc71"
                : "#1a73e8",
          }}
        />
        {progress.reviewed} / {progress.total} reviewed
      </div>

      {!isShared && (
        <>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: "#ddd",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={isPublic}
              onChange={togglePublic}
              disabled={!analysis}
            />
            Public link
          </label>
          <button
            onClick={copyLink}
            disabled={!isPublic}
            title={isPublic ? "Copy a read-only link to share" : "Enable public link first"}
            style={{
              padding: "5px 12px",
              fontSize: 12,
              fontWeight: 600,
              color: "#fff",
              background: isPublic ? "#1a73e8" : "#333",
              border: "1px solid " + (isPublic ? "#1a73e8" : "#444"),
              borderRadius: 5,
              cursor: isPublic ? "pointer" : "not-allowed",
              fontFamily: "inherit",
            }}
          >
            {copied ? "✓ Copied" : "🔗 Copy share link"}
          </button>
        </>
      )}
    </div>
  );
}

// ─────────────────────────── Empty state ───────────────────────────

function EmptyState({ player }: { player: PlayerRow }) {
  return (
    <div style={emptyStateStyle}>
      <div style={{ fontSize: 46, marginBottom: 14 }}>🎉</div>
      <h2 style={{ color: "#fff", fontSize: 22, margin: 0 }}>
        Nothing reviewed for {player.display_name.split(" ")[0]} yet.
      </h2>
      <div style={{ color: "#999", marginTop: 8, maxWidth: 480, textAlign: "center", fontSize: 14 }}>
        Open the Review Queue and leave a recommendation, drill, or FPTM
        diagnosis on at least one flag or sequence — those will show up here
        ready to walk through with the player.
      </div>
    </div>
  );
}

// ─────────────────────────── Summary slide ───────────────────────────

function SummarySlide({
  item,
  player,
  currentIdx,
  total,
  reviewed,
  onToggleReviewed,
  onPrev,
  onNext,
}: {
  item: Extract<QueueItem, { kind: "summary" }>;
  player: PlayerRow;
  currentIdx: number;
  total: number;
  reviewed: boolean;
  onToggleReviewed: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div style={itemRootStyle}>
      <div style={itemHeaderStyle}>
        <div style={itemKindChipStyle("summary")}>Coach's note</div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#fff" }}>
          {player.display_name.split(" ")[0]} · game takeaways
        </h2>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#888", fontVariantNumeric: "tabular-nums" }}>
          Item {currentIdx + 1} / {total}
        </span>
      </div>

      <div
        style={{
          background: "#141414",
          border: "1px solid #222",
          borderRadius: 12,
          padding: 32,
          display: "flex",
          flexDirection: "column",
          gap: 22,
          flex: 1,
          minHeight: 320,
        }}
      >
        {item.tone && (
          <span
            style={{
              alignSelf: "flex-start",
              padding: "5px 14px",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.5,
              textTransform: "uppercase",
              borderRadius: 4,
              background: item.tone === "good_job" ? "#1e7e34" : "#c62828",
              color: "#fff",
            }}
          >
            {item.tone === "good_job" ? "Good job" : "Needs work"}
          </span>
        )}

        <blockquote
          style={{
            margin: 0,
            padding: "6px 0 6px 22px",
            borderLeft: "3px solid #1a73e8",
            fontSize: 19,
            lineHeight: 1.6,
            color: "#eee",
            whiteSpace: "pre-wrap",
            fontStyle: "italic",
          }}
        >
          {item.note}
        </blockquote>

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={onToggleReviewed}
            style={{
              padding: "12px 20px",
              fontSize: 14,
              fontWeight: 700,
              background: reviewed ? "#1e7e34" : "#1a73e8",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {reviewed ? "✓ Reviewed" : "Start walkthrough →"}
          </button>
          <span style={{ flex: 1 }} />
          <button onClick={onPrev} disabled={currentIdx === 0} style={navBtn(currentIdx === 0)}>
            ← Prev
          </button>
          <button
            onClick={onNext}
            disabled={currentIdx === total - 1}
            style={navBtn(currentIdx === total - 1)}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── Item view ───────────────────────────

interface ItemViewProps {
  item: Exclude<QueueItem, { kind: "summary" }>;
  player: PlayerRow;
  playbackId: string | null;
  currentIdx: number;
  total: number;
  reviewed: boolean;
  onToggleReviewed: () => void;
  onPrev: () => void;
  onNext: () => void;
  muted: boolean;
}

function ItemView({
  item,
  player: _player,
  playbackId,
  currentIdx,
  total,
  reviewed,
  onToggleReviewed,
  onPrev,
  onNext,
  muted,
}: ItemViewProps) {
  const videoRef = useRef<VideoPlayerHandle>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(0.75);
  const [activeShotId, setActiveShotId] = useState<string | null>(null);

  // Seek to rally start + play whenever the item changes.
  useEffect(() => {
    setActiveShotId(null);
    videoRef.current?.seek(item.rally.start_ms);
    videoRef.current?.setPlaybackRate(playbackRate);
    if (!muted) void videoRef.current?.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.itemKey]);

  // Loop the full rally. If an individual shot was pinned (clicked on the
  // strip), loop that shot instead for closer examination.
  useEffect(() => {
    const activeShot = activeShotId
      ? item.rallyShots.find((s) => s.id === activeShotId) ?? null
      : null;
    if (activeShot) {
      if (currentMs < activeShot.start_ms - 100 || currentMs > activeShot.end_ms + 500) {
        videoRef.current?.seek(activeShot.start_ms);
      }
    } else if (currentMs >= item.rally.end_ms) {
      videoRef.current?.seek(item.rally.start_ms);
    }
  }, [currentMs, item, activeShotId]);

  const itemKindLabel =
    item.kind === "flag"
      ? "Flagged shot"
      : item.kind === "sequence"
      ? "Sequence"
      : "Rally loss";
  const itemTitle = item.title;
  const itemSubtitle = item.kind === "loss" ? item.reasonLabel : null;

  return (
    <div style={itemRootStyle}>
      {/* Header strip with item position + title */}
      <div style={itemHeaderStyle}>
        <div style={itemKindChipStyle(item.kind)}>{itemKindLabel}</div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#fff" }}>
          {itemTitle}
        </h2>
        {itemSubtitle && (
          <span style={{ fontSize: 13, color: "#aaa" }}>· {itemSubtitle}</span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#888", fontVariantNumeric: "tabular-nums" }}>
          Item {currentIdx + 1} / {total}
        </span>
      </div>

      <div style={itemBodyStyle}>
        {/* LEFT: video + shot strip + speed controls */}
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {playbackId ? (
            <VideoPlayer
              ref={videoRef}
              playbackId={playbackId}
              onTimeUpdate={setCurrentMs}
            />
          ) : (
            <div style={noVideoStyle}>
              No Mux playback ID on this game — paste one from Analyze first.
            </div>
          )}

          {/* Playback controls + rally info */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#bbb", fontSize: 12 }}>
            <span style={{ textTransform: "uppercase", letterSpacing: 1, color: "#888", fontWeight: 700, fontSize: 10 }}>
              Speed
            </span>
            {([0.25, 0.5, 0.75, 1] as const).map((r) => (
              <button
                key={r}
                onClick={() => {
                  setPlaybackRate(r);
                  videoRef.current?.setPlaybackRate(r);
                }}
                style={speedBtn(playbackRate === r)}
              >
                {r}×
              </button>
            ))}
            <span style={{ flex: 1 }} />
            {activeShotId && (
              <button
                onClick={() => {
                  setActiveShotId(null);
                  videoRef.current?.seek(item.rally.start_ms);
                }}
                style={{
                  padding: "4px 10px",
                  fontSize: 11,
                  background: "#1c1c1c",
                  color: "#ddd",
                  border: "1px solid #333",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                ↩ Play full rally
              </button>
            )}
          </div>

          {/* Shot strip — highlights the focus shots. Click any shot to
              pin it for slow-motion review. */}
          <ShotStrip
            rallyShots={item.rallyShots}
            focusShotIds={item.focusShotIds}
            activeShotId={activeShotId}
            currentMs={currentMs}
            onActivate={(shot) => {
              setActiveShotId(shot.id);
              videoRef.current?.seek(shot.start_ms);
              videoRef.current?.setPlaybackRate(playbackRate);
              void videoRef.current?.play();
            }}
          />
        </div>

        {/* RIGHT: notes + FPTM + drills + reviewed CTA */}
        <aside style={notesPanelStyle}>
          {item.note && item.note.trim() ? (
            <NoteBlock title="Coach's note">{item.note}</NoteBlock>
          ) : (
            <div style={{ fontSize: 13, color: "#777", fontStyle: "italic" }}>
              No written note on this one — talk it through live.
            </div>
          )}
          <FptmDisplay fptm={item.fptm} />
          {item.drills && item.drills.trim() && (
            <NoteBlock title="Drills">{item.drills}</NoteBlock>
          )}

          <div style={{ flex: 1 }} />

          {/* Reviewed toggle — the main CTA. Pressing marks this item done
              and jumps to the next un-reviewed one. */}
          <button
            onClick={onToggleReviewed}
            style={{
              padding: "14px 18px",
              fontSize: 15,
              fontWeight: 700,
              background: reviewed ? "#1e7e34" : "#1a73e8",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              cursor: "pointer",
              fontFamily: "inherit",
              letterSpacing: 0.3,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
            title={
              reviewed
                ? "Undo the reviewed mark"
                : "Mark this item reviewed with the player and jump to the next one"
            }
          >
            {reviewed ? "✓ Reviewed" : "Mark reviewed · next →"}
          </button>

          {/* Secondary nav — keyboard-shortcut hints + prev/next. */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 10,
              fontSize: 11,
              color: "#888",
            }}
          >
            <button onClick={onPrev} disabled={currentIdx === 0} style={navBtn(currentIdx === 0)}>
              ← Prev
            </button>
            <span>← → to jump</span>
            <button
              onClick={onNext}
              disabled={currentIdx === total - 1}
              style={navBtn(currentIdx === total - 1)}
            >
              Next →
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─────────────────────────── Shot strip ───────────────────────────

interface ShotStripProps {
  rallyShots: RallyShot[];
  focusShotIds: Set<string>;
  activeShotId: string | null;
  currentMs: number;
  onActivate: (shot: RallyShot) => void;
}

function ShotStrip({
  rallyShots,
  focusShotIds,
  activeShotId,
  currentMs,
  onActivate,
}: ShotStripProps) {
  if (rallyShots.length === 0) {
    return (
      <div style={{ color: "#666", fontSize: 12, fontStyle: "italic" }}>
        No per-shot data on this rally.
      </div>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        overflowX: "auto",
        padding: "8px 2px",
        background: "#111",
        border: "1px solid #222",
        borderRadius: 6,
      }}
    >
      {rallyShots.map((s, i) => {
        const isFocus = focusShotIds.has(s.id);
        const isActive = activeShotId === s.id;
        const isPlaying = currentMs >= s.start_ms && currentMs <= s.end_ms;
        // Focus = this is one of the shots that made the item matter. Gets
        // the bright accent regardless of play state. Active = user clicked
        // to pin it. Playing = video is inside this shot's window.
        const borderColor = isFocus ? "#f5a623" : "transparent";
        const bg = isActive
          ? "#1a73e8"
          : isPlaying
          ? "#2a2a2a"
          : "#1a1a1a";
        const color = isActive ? "#fff" : isFocus ? "#f5a623" : "#aaa";
        return (
          <button
            key={s.id}
            onClick={() => onActivate(s)}
            title={`Shot ${i + 1}${s.shot_type ? ` · ${s.shot_type}` : ""}${isFocus ? " · focus" : ""}`}
            style={{
              minWidth: 52,
              padding: "6px 8px",
              background: bg,
              color,
              border: `2px solid ${borderColor}`,
              borderRadius: 5,
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 11,
              fontWeight: isFocus ? 700 : 500,
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              gap: 2,
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 10, color: isActive ? "#d7e6fc" : "#666", fontWeight: 600 }}>
              {i + 1}
            </span>
            <span style={{ textTransform: "capitalize" }}>{s.shot_type ?? "—"}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────── FPTM display ───────────────────────────

function FptmDisplay({ fptm }: { fptm: FptmValue | null }) {
  if (!fptm) return null;
  const summary = summarizeFptm(fptm);
  if (summary.length === 0) return null;
  return (
    <div>
      <div style={sideHeadStyle}>Coaching diagnosis</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {summary.map(({ pillar }) => {
          const state = fptm[pillar.id];
          const tone = state?.tone ?? "weakness";
          const color = tone === "strength" ? "#7bd489" : "#ef6b6b";
          const items = state?.items ?? [];
          const labels = items
            .map((id) => pillar.items.find((it) => it.id === id)?.label)
            .filter(Boolean)
            .slice(0, 3)
            .join(" · ");
          return (
            <div
              key={pillar.id}
              style={{
                fontSize: 12,
                padding: "5px 10px",
                borderRadius: 14,
                background: "#1c1c1c",
                border: `1px solid ${color}66`,
                color: "#fff",
              }}
            >
              <b style={{ color }}>{pillar.letter}</b>
              <span style={{ color: "#ccc", marginLeft: 6 }}>{pillar.label}</span>
              {labels && <span style={{ color: "#888", marginLeft: 6 }}>· {labels}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NoteBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={sideHeadStyle}>{title}</div>
      <div style={noteBodyStyle}>{children}</div>
    </div>
  );
}

// ─────────────────────────── Styles ───────────────────────────

const rootStyle: CSSProperties = {
  background: "#0a0a0a",
  color: "#fff",
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  fontFamily: "system-ui, -apple-system, sans-serif",
};

const loadingStyle: CSSProperties = {
  padding: 40,
  textAlign: "center",
  color: "#ccc",
  background: "#111",
  minHeight: "100vh",
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "10px 18px",
  borderBottom: "1px solid #1f1f1f",
  background: "#0a0a0a",
  flexWrap: "wrap",
};

const backLinkStyle: CSSProperties = {
  color: "#aaa",
  textDecoration: "none",
  fontSize: 12,
};

const emptyStateStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: 40,
};

const itemRootStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  padding: "16px 22px 24px",
  maxWidth: 1400,
  width: "100%",
  margin: "0 auto",
  boxSizing: "border-box",
};

const itemHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  marginBottom: 14,
  flexWrap: "wrap",
};

const itemBodyStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.65fr) minmax(320px, 1fr)",
  gap: 20,
  alignItems: "start",
  flex: 1,
  minHeight: 0,
};

const notesPanelStyle: CSSProperties = {
  background: "#141414",
  border: "1px solid #222",
  borderRadius: 10,
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 14,
  minHeight: 360,
};

const noVideoStyle: CSSProperties = {
  background: "#141414",
  color: "#888",
  aspectRatio: "16/9",
  display: "grid",
  placeItems: "center",
  borderRadius: 10,
  padding: 20,
  textAlign: "center",
};

const sideHeadStyle: CSSProperties = {
  fontSize: 10,
  color: "#888",
  textTransform: "uppercase",
  letterSpacing: 1,
  fontWeight: 700,
  marginBottom: 6,
};

const noteBodyStyle: CSSProperties = {
  fontSize: 14,
  lineHeight: 1.55,
  color: "#eee",
  whiteSpace: "pre-wrap",
};

function itemKindChipStyle(kind: "flag" | "sequence" | "loss" | "summary"): CSSProperties {
  const color =
    kind === "flag"
      ? "#f5a623"
      : kind === "sequence"
      ? "#9b6df0"
      : kind === "loss"
      ? "#ef6b6b"
      : "#1a73e8";
  return {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    padding: "3px 8px",
    borderRadius: 3,
    background: `${color}22`,
    color,
  };
}

function speedBtn(active: boolean): CSSProperties {
  return {
    padding: "3px 8px",
    fontSize: 11,
    fontFamily: "inherit",
    background: active ? "#1a73e8" : "transparent",
    color: active ? "#fff" : "#aaa",
    border: `1px solid ${active ? "#1a73e8" : "#333"}`,
    borderRadius: 4,
    cursor: "pointer",
  };
}

function navBtn(disabled: boolean): CSSProperties {
  return {
    padding: "4px 12px",
    fontSize: 11,
    fontFamily: "inherit",
    background: "transparent",
    color: disabled ? "#555" : "#aaa",
    border: `1px solid ${disabled ? "#222" : "#333"}`,
    borderRadius: 4,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
