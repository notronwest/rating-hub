/**
 * SessionPresentationPage — read-only walkthrough of a player's whole
 * session, designed to be played to the player after the session.
 *
 * This is the session-scoped successor to PresentationPage (per-game).
 * The unit of coaching review is now the session — every game's flags,
 * sequences, and rally losses flow through a single linear queue,
 * preceded by the session-level priorities + strengths so the coach
 * opens with the big-picture framing.
 *
 * Queue order:
 *   1. PrioritiesSlide   — top 4 active priorities
 *   2. StrengthsSlide    — active strengths (skipped if none)
 *   3. For each game (in session order):
 *        a. SummarySlide  (only if the coach left an overall note)
 *        b. flags    — chronological by rally
 *        c. sequences
 *        d. losses
 *
 * Reuses ItemView + SummarySlide + style scaffolding from
 * PresentationPage so the look-and-feel stays identical.
 *
 * Reviewed-with-customer state persists in localStorage keyed by
 * sessionId:playerId so the coach can pause and resume.
 *
 * Route: /org/:orgId/sessions/:sessionId/present?playerId=...
 */

import {
  useCallback,
  useEffect,
  useMemo,
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
  CoachingTheme,
} from "../types/coach";
import type { FptmValue } from "../lib/fptm";
import { listPriorities, listStrengths } from "../lib/coachApi";
import {
  categorizeRallyLoss,
  buildLossSequence,
  REASON_LABELS,
} from "../lib/rallyAnalysis";
import {
  ItemView,
  SummarySlide,
  itemHeaderStyle,
  itemKindChipStyle,
  itemRootStyle,
  type PlayerRow,
  type QueueItem,
} from "./PresentationPage";

// Per-game data bundle. We load one of these per game in the session,
// then iterate them in order to build the unified queue.
interface GameBundle {
  game: Game;
  rallies: Rally[];
  shots: RallyShot[];
  analysis: GameAnalysis | null;
  sequences: AnalysisSequence[];
  flags: FlaggedShot[];
}

// Session-level slide types layered on top of the per-game QueueItem
// from PresentationPage. The leading slides aren't tied to any one
// game; the per-game items carry their gameId so we can resolve the
// right Mux playbackId for each clip.
type SessionSlide =
  | { kind: "priorities-slide"; itemKey: string; priorities: CoachingTheme[] }
  | { kind: "strengths-slide"; itemKey: string; strengths: CoachingTheme[] }
  | { kind: "game-marker"; itemKey: string; gameIdx: number; gameLabel: string }
  | (QueueItem & { gameId: string });

export default function SessionPresentationPage() {
  const { orgId, sessionId } = useParams();
  const [searchParams] = useSearchParams();
  const playerIdParam = searchParams.get("playerId");

  // ── Page data ──
  const [session, setSession] = useState<{
    id: string;
    label: string | null;
    played_date: string;
    org_id: string;
  } | null>(null);
  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [bundles, setBundles] = useState<GameBundle[]>([]);
  const [priorities, setPriorities] = useState<CoachingTheme[]>([]);
  const [strengths, setStrengths] = useState<CoachingTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // ── Walkthrough state ──
  const [currentIdx, setCurrentIdx] = useState(0);
  const [reviewedKeys, setReviewedKeys] = useState<Set<string>>(new Set());
  const reviewedStorageKey =
    sessionId && playerIdParam
      ? `present-reviewed-session:${sessionId}:${playerIdParam}`
      : null;

  // Load the persisted reviewed-set on mount.
  useEffect(() => {
    if (!reviewedStorageKey) return;
    try {
      const raw = localStorage.getItem(reviewedStorageKey);
      if (raw) setReviewedKeys(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
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

  // ── Load everything for the session ──
  useEffect(() => {
    if (!sessionId || !playerIdParam) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const { data: s } = await supabase
          .from("sessions")
          .select("id, label, played_date, org_id")
          .eq("id", sessionId)
          .single();
        if (!s) throw new Error("Session not found");
        if (cancelled) return;
        setSession(s as typeof session.prototype extends never ? never : any);

        const { data: p } = await supabase
          .from("players")
          .select("id, display_name, slug, avatar_url")
          .eq("id", playerIdParam)
          .single();
        if (!p) throw new Error("Player not found");

        // Load every game in the session. Order chronologically by
        // played_at so the walkthrough flows naturally.
        const { data: games } = await supabase
          .from("games")
          .select("*")
          .eq("session_id", sessionId)
          .order("played_at");
        const gameRows = (games ?? []) as Game[];
        if (gameRows.length === 0) throw new Error("Session has no games");
        const gameIds = gameRows.map((g) => g.id);

        // Player's index/team can vary across games (stacking, etc.) —
        // pull the first row we get and use it for the queue logic.
        const { data: gpRows } = await supabase
          .from("game_players")
          .select("*")
          .in("game_id", gameIds)
          .eq("player_id", playerIdParam);
        const myGps = (gpRows ?? []) as GamePlayer[];
        if (myGps.length === 0) throw new Error("Player did not play in this session");

        // Load every per-game artifact in parallel for all games.
        const [ralliesRes, shotsRes, analysesRes, sequencesRes, flagsRes] = await Promise.all([
          supabase.from("rallies").select("*").in("game_id", gameIds).order("rally_index"),
          supabase.from("rally_shots").select("*").in("rally_id",
            // Need rally ids first — chain the rally fetch.
            // To avoid the chain, we fetch shots by rally_id batched
            // after rallies arrive. For simplicity here we fetch all
            // shots for all rallies in one IN-list once we have the
            // rally rows; do it inline below.
            ["00000000-0000-0000-0000-000000000000"],
          ),
          supabase.from("game_analyses").select("*").in("game_id", gameIds),
          supabase.from("game_analysis_sequences").select("*").in("game_id", gameIds),
          supabase
            .from("analysis_flagged_shots")
            .select("*, rally_shots!inner(rally_id)")
            .in("rally_shots.rally_id",
              ["00000000-0000-0000-0000-000000000000"],
            ),
        ]);
        // Re-fetch shots + flags now that we have the actual rally ids.
        const allRallies = (ralliesRes.data ?? []) as Rally[];
        const allRallyIds = allRallies.map((r) => r.id);
        const [shotsBatchRes, flagsBatchRes] = await Promise.all([
          supabase.from("rally_shots").select("*").in("rally_id", allRallyIds),
          supabase.from("analysis_flagged_shots")
            .select("*")
            .in("analysis_id", ((analysesRes.data ?? []) as GameAnalysis[]).map((a) => a.id)),
        ]);
        const allShots = (shotsBatchRes.data ?? []) as RallyShot[];
        const allFlags = (flagsBatchRes.data ?? []) as FlaggedShot[];
        const allAnalyses = (analysesRes.data ?? []) as GameAnalysis[];
        const allSequences = (sequencesRes.data ?? []) as AnalysisSequence[];

        // Bundle per game.
        const bundlesOut: GameBundle[] = gameRows.map((g) => {
          const myGp = myGps.find((gp) => gp.game_id === g.id);
          return {
            game: g,
            rallies: allRallies.filter((r) => r.game_id === g.id),
            shots: allShots.filter((s) =>
              allRallies.some((r) => r.id === s.rally_id && r.game_id === g.id),
            ),
            analysis: allAnalyses.find((a) => a.game_id === g.id) ?? null,
            sequences: allSequences.filter((seq) => {
              const a = allAnalyses.find((aa) => aa.id === seq.analysis_id);
              return a?.game_id === g.id;
            }),
            flags: allFlags.filter((f) => {
              const a = allAnalyses.find((aa) => aa.id === f.analysis_id);
              return a?.game_id === g.id;
            }),
          };
        });
        if (cancelled) return;
        setBundles(bundlesOut);

        // We need PlayerRow for ItemView. Use the first game's seat.
        const firstGp = myGps[0];
        const playerRow: PlayerRow = {
          id: p.id,
          display_name: p.display_name,
          slug: p.slug,
          avatar_url: p.avatar_url,
          player_index: firstGp.player_index,
          team: firstGp.team,
        };
        setPlayer(playerRow);

        // Priorities + strengths — only show ones the coach has promoted
        // (status = 'active'); presentation is a player-facing surface.
        const [pri, str] = await Promise.all([
          listPriorities(sessionId, playerIdParam),
          listStrengths(sessionId, playerIdParam),
        ]);
        if (cancelled) return;
        setPriorities(pri.filter((x) => x.status === "active"));
        setStrengths(str.filter((x) => x.status === "active"));

        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setErr((e as Error).message);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, playerIdParam]);

  // ── Build the session-wide queue ──
  const queue: SessionSlide[] = useMemo(() => {
    if (!player) return [];
    const out: SessionSlide[] = [];

    // Lead with priorities (always — even if 0, the slide still renders
    // a "no priorities yet" message so the walkthrough has a known
    // starting point for the coach).
    out.push({
      kind: "priorities-slide",
      itemKey: "priorities-slide",
      priorities,
    });

    if (strengths.length > 0) {
      out.push({
        kind: "strengths-slide",
        itemKey: "strengths-slide",
        strengths,
      });
    }

    // Walk every game in chronological order, building per-game items
    // using the same logic as the per-game PresentationPage.
    for (let i = 0; i < bundles.length; i++) {
      const b = bundles[i];
      const gameLabel = parseGameLabel(b.game) ?? `Game ${i + 1}`;
      out.push({
        kind: "game-marker",
        itemKey: `game-marker:${b.game.id}`,
        gameIdx: i + 1,
        gameLabel,
      });

      for (const item of buildPerGameQueue(b, player)) {
        out.push({ ...item, gameId: b.game.id });
      }
    }
    return out;
  }, [player, priorities, strengths, bundles]);

  // ── Navigation ──
  const total = queue.length;
  const clampedIdx = Math.min(currentIdx, Math.max(0, total - 1));
  const current = queue[clampedIdx] ?? null;
  const reviewed = current ? reviewedKeys.has(current.itemKey) : false;

  const go = useCallback(
    (delta: number) => {
      setCurrentIdx((i) => Math.max(0, Math.min(total - 1, i + delta)));
    },
    [total],
  );

  // Keyboard shortcuts mirror PresentationPage.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if ((e.target as HTMLElement)?.tagName === "TEXTAREA") return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Enter" && current) {
        e.preventDefault();
        setReviewed(current.itemKey, !reviewed);
        if (!reviewed) go(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [go, current, reviewed]);

  // ── Render ──
  if (loading) {
    return (
      <div style={rootStyle}>
        <div style={{ color: "#aaa", padding: 40, fontSize: 14 }}>
          Loading session…
        </div>
      </div>
    );
  }
  if (err || !player || !session) {
    return (
      <div style={rootStyle}>
        <div style={{ color: "#ef4444", padding: 40, fontSize: 14 }}>
          {err ?? "Could not load session."}
        </div>
      </div>
    );
  }

  // Resolve the active game's playback id for ItemView.
  const activeGameId = current && "gameId" in current ? current.gameId : null;
  const activeBundle = activeGameId
    ? bundles.find((b) => b.game.id === activeGameId)
    : null;
  const playbackId = activeBundle?.game.mux_playback_id ?? null;

  return (
    <div style={rootStyle}>
      {/* Top bar — session label + back link + progress counter. */}
      <div style={topBarStyle}>
        <Link
          to={`/org/${orgId}/sessions/${session.id}/report?playerId=${player.id}`}
          style={backLinkStyle}
        >
          ← Session report
        </Link>
        <div style={{ flex: 1, color: "#aaa", fontSize: 13 }}>
          <b style={{ color: "#fff" }}>{player.display_name}</b> ·{" "}
          {session.label ?? "Session"} ·{" "}
          {new Date(session.played_date).toLocaleDateString()}
        </div>
        <div style={{ fontSize: 12, color: "#888" }}>
          {clampedIdx + 1} / {total}
        </div>
      </div>

      {/* Slide */}
      {current?.kind === "priorities-slide" ? (
        <PrioritiesSlide
          priorities={current.priorities}
          player={player}
          currentIdx={clampedIdx}
          total={total}
          reviewed={reviewed}
          onToggleReviewed={() => setReviewed(current.itemKey, !reviewed)}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
        />
      ) : current?.kind === "strengths-slide" ? (
        <StrengthsSlide
          strengths={current.strengths}
          player={player}
          currentIdx={clampedIdx}
          total={total}
          reviewed={reviewed}
          onToggleReviewed={() => setReviewed(current.itemKey, !reviewed)}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
        />
      ) : current?.kind === "game-marker" ? (
        <GameMarkerSlide
          gameIdx={current.gameIdx}
          gameLabel={current.gameLabel}
          currentIdx={clampedIdx}
          total={total}
          reviewed={reviewed}
          onToggleReviewed={() => setReviewed(current.itemKey, !reviewed)}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
        />
      ) : current?.kind === "summary" ? (
        <SummarySlide
          item={current}
          player={player}
          currentIdx={clampedIdx}
          total={total}
          reviewed={reviewed}
          onToggleReviewed={() => setReviewed(current.itemKey, !reviewed)}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
        />
      ) : current && (current.kind === "flag" || current.kind === "sequence" || current.kind === "loss") ? (
        <ItemView
          item={current}
          player={player}
          playbackId={playbackId}
          currentIdx={clampedIdx}
          total={total}
          reviewed={reviewed}
          onToggleReviewed={() => setReviewed(current.itemKey, !reviewed)}
          onPrev={() => go(-1)}
          onNext={() => go(1)}
          muted={false}
        />
      ) : (
        <div style={{ color: "#aaa", padding: 40 }}>No content to present.</div>
      )}
    </div>
  );
}

// ────────────────────────── Per-game queue builder ──────────────────────────

function buildPerGameQueue(b: GameBundle, player: PlayerRow): QueueItem[] {
  const shotsByRally = new Map<string, RallyShot[]>();
  for (const s of b.shots) {
    if (!shotsByRally.has(s.rally_id)) shotsByRally.set(s.rally_id, []);
    shotsByRally.get(s.rally_id)!.push(s);
  }
  for (const [, arr] of shotsByRally) arr.sort((a, b) => a.shot_index - b.shot_index);

  const myShotIds = new Set(
    b.shots.filter((s) => s.player_index === player.player_index).map((s) => s.id),
  );
  const flaggedShotIds = new Set(b.flags.map((f) => f.shot_id));
  const dismissedLossKeys = new Set(b.analysis?.dismissed_loss_keys ?? []);

  const out: QueueItem[] = [];

  // Per-game summary slide if coach left an overall note.
  const overall = b.analysis?.overall_notes?.trim();
  if (overall) {
    out.push({
      kind: "summary",
      itemKey: `summary:${b.analysis?.id ?? b.game.id}`,
      tone: b.analysis?.overall_tone ?? null,
      note: overall,
    });
  }

  // Flags
  for (const f of b.flags) {
    if (!myShotIds.has(f.shot_id)) continue;
    const shot = b.shots.find((s) => s.id === f.shot_id);
    if (!shot) continue;
    const rally = b.rallies.find((r) => r.id === shot.rally_id);
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

  // Sequences tagged to this player
  const sequenceIdsSurfaced = new Set<string>();
  for (const seq of b.sequences) {
    const tagged =
      seq.player_id === player.id || (seq.player_ids ?? []).includes(player.id);
    if (!tagged) continue;
    const rally = b.rallies.find((r) => r.id === seq.rally_id);
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

  // Auto-attributed rally losses
  for (const rally of b.rallies) {
    if (rally.winning_team == null) continue;
    const losingTeam = (1 - rally.winning_team) as 0 | 1;
    if (player.team !== losingTeam) continue;
    const rs = shotsByRally.get(rally.id) ?? [];
    const res = categorizeRallyLoss(rs, losingTeam);
    if (!res) continue;
    if (res.attributedShot.player_index !== player.player_index) continue;
    if (flaggedShotIds.has(res.attributedShot.id)) continue;
    const itemKey = `loss:${rally.id}:${res.attributedShot.id}`;
    if (dismissedLossKeys.has(itemKey)) continue;

    const seqIds = buildLossSequence(rs, res.attributedShot, 4);
    const existingSeq = b.sequences.find(
      (seq) =>
        seq.rally_id === rally.id &&
        seq.player_id === player.id &&
        seq.shot_ids.length === seqIds.length &&
        seq.shot_ids.every((id) => seqIds.includes(id)),
    );
    if (existingSeq && sequenceIdsSurfaced.has(existingSeq.id)) continue;

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

  // Same ordering rule as PresentationPage: summary → flags → sequences → losses.
  const kindOrder = { summary: 0, flag: 1, sequence: 2, loss: 3 } as const;
  out.sort((a, b) => {
    if (a.kind !== b.kind) return kindOrder[a.kind] - kindOrder[b.kind];
    if (a.kind === "summary" || b.kind === "summary") return 0;
    return a.rally.rally_index - b.rally.rally_index;
  });
  return out;
}

function parseGameLabel(g: Game): string | null {
  // session_name often looks like "ke0z…-gm-2" — extract gm-N if present.
  const m = g.session_name?.match(/gm-?(\d+)/i);
  if (m) return `Game ${m[1]}`;
  return g.session_name ?? null;
}

// ────────────────────────── Slide components ──────────────────────────

function PrioritiesSlide({
  priorities,
  player,
  currentIdx,
  total,
  reviewed,
  onToggleReviewed,
  onPrev,
  onNext,
}: {
  priorities: CoachingTheme[];
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
        <div style={itemKindChipStyle("priorities")}>Top priorities</div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#fff" }}>
          {player.display_name.split(" ")[0]} · what to work on
        </h2>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#888" }}>
          Slide {currentIdx + 1} / {total}
        </span>
      </div>

      <div style={slideBodyStyle}>
        {priorities.length === 0 ? (
          <div style={{ color: "#aaa", fontStyle: "italic" }}>
            No active priorities — coach can promote drafts on the session report.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14, maxWidth: 760 }}>
            {priorities.slice(0, 4).map((p, i) => (
              <div key={p.id} style={prioritySlideRowStyle}>
                <div style={prioritySlideRankStyle}>{i + 1}</div>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
                    {p.title}
                  </div>
                  <div style={{ fontSize: 14, color: "#ccc", lineHeight: 1.55, marginBottom: 8 }}>
                    {p.problem}
                  </div>
                  <div style={prioritySlideSolutionStyle}>
                    <b style={{ color: "#9ad9aa" }}>Drill: </b>
                    {p.solution}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <SlideFooter
        currentIdx={currentIdx}
        total={total}
        reviewed={reviewed}
        onToggleReviewed={onToggleReviewed}
        onPrev={onPrev}
        onNext={onNext}
      />
    </div>
  );
}

function StrengthsSlide({
  strengths,
  player,
  currentIdx,
  total,
  reviewed,
  onToggleReviewed,
  onPrev,
  onNext,
}: {
  strengths: CoachingTheme[];
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
        <div style={itemKindChipStyle("strengths")}>What's working</div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#fff" }}>
          {player.display_name.split(" ")[0]} · keep doing these
        </h2>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#888" }}>
          Slide {currentIdx + 1} / {total}
        </span>
      </div>

      <div style={slideBodyStyle}>
        <div style={{ display: "grid", gap: 14, maxWidth: 760 }}>
          {strengths.map((s) => (
            <div key={s.id} style={strengthSlideRowStyle}>
              <div style={strengthSlideCheckStyle}>✓</div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
                  {s.title}
                </div>
                <div style={{ fontSize: 14, color: "#ccc", lineHeight: 1.55, marginBottom: 8 }}>
                  {s.problem}
                </div>
                <div style={strengthSlideKeepStyle}>
                  <b style={{ color: "#9ad9aa" }}>Keep going: </b>
                  {s.solution}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <SlideFooter
        currentIdx={currentIdx}
        total={total}
        reviewed={reviewed}
        onToggleReviewed={onToggleReviewed}
        onPrev={onPrev}
        onNext={onNext}
      />
    </div>
  );
}

function GameMarkerSlide({
  gameIdx,
  gameLabel,
  currentIdx,
  total,
  reviewed,
  onToggleReviewed,
  onPrev,
  onNext,
}: {
  gameIdx: number;
  gameLabel: string;
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
        <div style={itemKindChipStyle("game-marker")}>Next game</div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#fff" }}>
          {gameLabel}
        </h2>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#888" }}>
          Slide {currentIdx + 1} / {total}
        </span>
      </div>

      <div style={{ ...slideBodyStyle, alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontSize: 64, color: "#1a73e8", marginBottom: 14 }}>
          {gameIdx}
        </div>
        <div style={{ color: "#aaa", fontSize: 14 }}>
          Walking through {gameLabel} — flags, sequences, and rally losses.
        </div>
      </div>

      <SlideFooter
        currentIdx={currentIdx}
        total={total}
        reviewed={reviewed}
        onToggleReviewed={onToggleReviewed}
        onPrev={onPrev}
        onNext={onNext}
      />
    </div>
  );
}

function SlideFooter({
  currentIdx,
  total,
  reviewed,
  onToggleReviewed,
  onPrev,
  onNext,
}: {
  currentIdx: number;
  total: number;
  reviewed: boolean;
  onToggleReviewed: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div style={slideFooterStyle}>
      <button
        onClick={onPrev}
        disabled={currentIdx === 0}
        style={navBtnStyle(currentIdx === 0)}
      >
        ← Prev
      </button>
      <span style={{ flex: 1 }} />
      <button
        onClick={() => {
          onToggleReviewed();
          if (!reviewed && currentIdx < total - 1) onNext();
        }}
        style={primaryBtnStyle(reviewed)}
      >
        {reviewed ? "✓ Reviewed" : "Mark reviewed · next →"}
      </button>
      <button
        onClick={onNext}
        disabled={currentIdx >= total - 1}
        style={navBtnStyle(currentIdx >= total - 1)}
      >
        Next →
      </button>
    </div>
  );
}

// ────────────────────────── Styles ──────────────────────────

const rootStyle: CSSProperties = {
  minHeight: "100vh",
  background: "#0e0e10",
  display: "flex",
  flexDirection: "column",
};

const topBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  padding: "10px 16px",
  background: "#16161a",
  borderBottom: "1px solid #27272a",
};

const backLinkStyle: CSSProperties = {
  color: "#9ca3af",
  textDecoration: "none",
  fontSize: 12,
  fontWeight: 600,
};

const slideBodyStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  padding: "32px 32px 16px",
  overflow: "auto",
};

const slideFooterStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 16px",
  borderTop: "1px solid #27272a",
};

function navBtnStyle(disabled: boolean): CSSProperties {
  return {
    padding: "8px 14px",
    background: "#27272a",
    color: disabled ? "#555" : "#ccc",
    border: "none",
    borderRadius: 6,
    cursor: disabled ? "default" : "pointer",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "inherit",
  };
}

function primaryBtnStyle(reviewed: boolean): CSSProperties {
  return {
    padding: "8px 16px",
    background: reviewed ? "#1e7e34" : "#1a73e8",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
    fontFamily: "inherit",
  };
}

const prioritySlideRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "44px 1fr",
  gap: 14,
  alignItems: "start",
  padding: "12px 14px",
  borderRadius: 10,
  background: "#16161a",
  border: "1px solid #27272a",
};

const prioritySlideRankStyle: CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: "50%",
  background: "#1a73e8",
  color: "#fff",
  display: "grid",
  placeItems: "center",
  fontSize: 16,
  fontWeight: 700,
};

const prioritySlideSolutionStyle: CSSProperties = {
  padding: "8px 10px",
  background: "rgba(30, 126, 52, 0.15)",
  borderLeft: "3px solid #1e7e34",
  borderRadius: 4,
  fontSize: 13,
  color: "#dbe9df",
  lineHeight: 1.5,
};

const strengthSlideRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "36px 1fr",
  gap: 12,
  alignItems: "start",
  padding: "12px 14px",
  borderRadius: 10,
  background: "#16161a",
  border: "1px solid #1e7e34",
};

const strengthSlideCheckStyle: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: "50%",
  background: "#1e7e34",
  color: "#fff",
  display: "grid",
  placeItems: "center",
  fontSize: 16,
  fontWeight: 700,
};

const strengthSlideKeepStyle: CSSProperties = {
  padding: "8px 10px",
  background: "rgba(30, 126, 52, 0.15)",
  borderLeft: "3px solid #1e7e34",
  borderRadius: 4,
  fontSize: 13,
  color: "#dbe9df",
  lineHeight: 1.5,
};
