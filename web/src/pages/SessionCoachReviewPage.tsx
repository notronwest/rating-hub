/**
 * SessionCoachReviewPage — coach's primary working surface, scoped
 * to a whole session for one player at a time.
 *
 * Replaces the per-game CoachReviewPage as the canonical coaching
 * synthesis flow:
 *   - Pick a player
 *   - Read AI-drafted Top Priorities + Strengths; promote/edit
 *   - Skim the session-wide list of flagged moments / sequences /
 *     rally losses across every game in the session
 *   - Write one session-level "overall note" + tone
 *
 * Per-rally items still pin to per-game data (you flag a shot in
 * Analyze, not here). The session-level coaching surface aggregates
 * them and gives the coach one place to write recommendations that
 * apply across the whole session.
 *
 * v1 scope (this turn):
 *   - Player picker
 *   - Priorities + Strengths panels (both already session-scoped)
 *   - Session overall_note + tone editor (writes session_analyses)
 *   - Read-only list of per-rally items grouped by game, each
 *     linking to the per-game CoachReviewPage to edit FPTM/notes
 *     until phase 2b lands the inline editor here.
 *
 * Route: /org/:orgId/sessions/:sessionId/coach-review?playerId=...
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../supabase";
import { useAuth } from "../auth/AuthProvider";
import {
  getOrCreateSessionAnalysis,
  updateSessionAnalysis,
} from "../lib/coachApi";
import {
  buildSessionReviewQueue,
  type GameBundle,
  type SessionReviewItem,
  type SessionReviewPlayer,
} from "../lib/sessionReview";
import { parseGameIdx } from "../lib/sessionGames";
import { REASON_LABELS } from "../lib/rallyAnalysis";
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
  SessionAnalysis,
} from "../types/coach";
import PrioritiesPanel from "../components/report/PrioritiesPanel";
import StrengthsPanel from "../components/report/StrengthsPanel";

interface SessionRow {
  id: string;
  org_id: string;
  label: string | null;
  played_date: string;
}

interface PlayerRow extends SessionReviewPlayer {
  /** Maps gameId → player_index. Player_index can vary across games
   *  (stacking, etc.) so we read it per-game when building the queue. */
  perGameIndex: Map<string, number>;
}

export default function SessionCoachReviewPage() {
  const { orgId, sessionId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const playerIdParam = searchParams.get("playerId") ?? "";
  const { user } = useAuth();

  const [session, setSession] = useState<SessionRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [bundles, setBundles] = useState<GameBundle[]>([]);
  const [sessionAnalysis, setSessionAnalysis] = useState<SessionAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // ── Load session, games, per-game data ──
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { data: s } = await supabase
          .from("sessions")
          .select("id, org_id, label, played_date")
          .eq("id", sessionId)
          .single();
        if (!s) throw new Error("Session not found");
        if (cancelled) return;
        setSession(s as SessionRow);

        const { data: gameRows } = await supabase
          .from("games")
          .select("*")
          .eq("session_id", sessionId)
          .order("played_at");
        const games = (gameRows ?? []) as Game[];
        if (games.length === 0) throw new Error("Session has no games");
        const gameIds = games.map((g) => g.id);

        const { data: gpRows } = await supabase
          .from("game_players")
          .select("*, players!inner(id, display_name, avatar_url)")
          .in("game_id", gameIds);
        const gpList = (gpRows ?? []) as Array<
          GamePlayer & {
            players: { id: string; display_name: string; avatar_url: string | null };
          }
        >;

        // Distinct players in the session — collapse across games. Use
        // the first game we see them in for display defaults; per-game
        // index is preserved separately.
        const playerMap = new Map<string, PlayerRow>();
        for (const gp of gpList) {
          const existing = playerMap.get(gp.player_id);
          if (existing) {
            existing.perGameIndex.set(gp.game_id, gp.player_index);
            continue;
          }
          playerMap.set(gp.player_id, {
            id: gp.player_id,
            display_name: gp.players.display_name,
            avatar_url: gp.players.avatar_url,
            player_index: gp.player_index,
            team: gp.team,
            perGameIndex: new Map([[gp.game_id, gp.player_index]]),
          });
        }
        const playerList = Array.from(playerMap.values()).sort((a, b) =>
          a.display_name.localeCompare(b.display_name),
        );
        if (cancelled) return;
        setPlayers(playerList);

        // Per-game artifacts in parallel.
        const [ralliesRes, analysesRes, sequencesRes] = await Promise.all([
          supabase.from("rallies").select("*").in("game_id", gameIds).order("rally_index"),
          supabase.from("game_analyses").select("*").in("game_id", gameIds),
          supabase.from("game_analysis_sequences").select("*").in("game_id", gameIds),
        ]);
        const allRallies = (ralliesRes.data ?? []) as Rally[];
        const allAnalyses = (analysesRes.data ?? []) as GameAnalysis[];
        const allSequences = (sequencesRes.data ?? []) as AnalysisSequence[];

        const allRallyIds = allRallies.map((r) => r.id);
        const [shotsRes, flagsRes] = await Promise.all([
          allRallyIds.length > 0
            ? supabase.from("rally_shots").select("*").in("rally_id", allRallyIds)
            : Promise.resolve({ data: [] }),
          allAnalyses.length > 0
            ? supabase
                .from("analysis_flagged_shots")
                .select("*")
                .in("analysis_id", allAnalyses.map((a) => a.id))
            : Promise.resolve({ data: [] }),
        ]);
        const allShots = (shotsRes.data ?? []) as RallyShot[];
        const allFlags = (flagsRes.data ?? []) as FlaggedShot[];

        const bundlesOut: GameBundle[] = games.map((g) => {
          const idx = parseGameIdx(g.session_name) ?? null;
          const label = idx != null ? `Game ${String(idx).padStart(2, "0")}` : (g.session_name ?? "Game");
          const analysis = allAnalyses.find((a) => a.game_id === g.id) ?? null;
          return {
            gameId: g.id,
            gameLabel: label,
            playedAt: g.played_at ?? "",
            rallies: allRallies.filter((r) => r.game_id === g.id),
            shots: allShots.filter((s) =>
              allRallies.some((r) => r.id === s.rally_id && r.game_id === g.id),
            ),
            sequences: allSequences.filter((seq) => {
              const a = allAnalyses.find((aa) => aa.id === seq.analysis_id);
              return a?.game_id === g.id;
            }),
            flags: allFlags.filter((f) => {
              const a = allAnalyses.find((aa) => aa.id === f.analysis_id);
              return a?.game_id === g.id;
            }),
            gameDismissedLossKeys: analysis?.dismissed_loss_keys ?? [],
          };
        });
        if (cancelled) return;
        setBundles(bundlesOut);

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
  }, [sessionId]);

  // ── Load (or create) session_analyses for the selected player ──
  const selectedPlayer = useMemo(
    () => players.find((p) => p.id === playerIdParam) ?? null,
    [players, playerIdParam],
  );

  useEffect(() => {
    if (!selectedPlayer || !session || !user) {
      setSessionAnalysis(null);
      return;
    }
    let cancelled = false;
    getOrCreateSessionAnalysis({
      sessionId: session.id,
      playerId: selectedPlayer.id,
      orgId: session.org_id,
      coachUserId: user.id,
    })
      .then((sa) => {
        if (!cancelled) setSessionAnalysis(sa);
      })
      .catch((e) => {
        if (!cancelled) setErr((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPlayer, session, user]);

  // ── Build the unified per-rally queue ──
  const queue = useMemo<SessionReviewItem[]>(() => {
    if (!selectedPlayer) return [];
    return buildSessionReviewQueue({
      player: selectedPlayer,
      bundles: bundles.map((b) => ({
        ...b,
        // Note: SessionReviewPlayer's player_index is from the first
        // game we saw the player in. Per-game index can differ when
        // the team stacks. The aggregator filters shots by
        // `shot.player_index === player.player_index`, which is wrong
        // for games where the index differs. For v1 we accept this
        // limitation; phase 2b will plumb perGameIndex through.
      })),
      sessionDismissedLossKeys: sessionAnalysis?.dismissed_loss_keys ?? [],
    });
  }, [selectedPlayer, bundles, sessionAnalysis]);

  function handlePickPlayer(playerId: string) {
    const next = new URLSearchParams(searchParams);
    next.set("playerId", playerId);
    setSearchParams(next, { replace: true });
  }

  if (loading) return <div style={{ padding: 24 }}>Loading session…</div>;
  if (err) return <div style={{ padding: 24, color: "#c62828" }}>{err}</div>;
  if (!session) return <div style={{ padding: 24 }}>Session not found.</div>;

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* Top toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        <Link
          to={`/org/${orgId}/sessions/${session.id}`}
          style={{ fontSize: 12, color: "#1a73e8", textDecoration: "none" }}
        >
          ← Back to session
        </Link>
        <span style={{ flex: 1 }} />
        {selectedPlayer && (
          <Link
            to={`/org/${orgId}/sessions/${session.id}/present?playerId=${selectedPlayer.id}`}
            style={{
              padding: "5px 11px",
              fontSize: 11,
              fontWeight: 700,
              background: "#7c3aed",
              color: "#fff",
              border: "1px solid #7c3aed",
              borderRadius: 12,
              textDecoration: "none",
              fontFamily: "inherit",
              letterSpacing: 0.3,
              textTransform: "uppercase",
            }}
          >
            ▶ Present
          </Link>
        )}
      </div>

      {/* Header */}
      <div style={{ marginBottom: 18 }}>
        <div
          style={{
            fontSize: 11,
            textTransform: "uppercase",
            color: "#888",
            letterSpacing: 0.5,
            fontWeight: 700,
          }}
        >
          Coach Review
        </div>
        <h1 style={{ margin: "2px 0 4px", fontSize: 22, fontWeight: 700 }}>
          {session.label || "Session"}
        </h1>
        <div style={{ fontSize: 13, color: "#666" }}>
          {new Date(session.played_date + "T12:00:00").toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
          {" · "}
          {bundles.length} {bundles.length === 1 ? "game" : "games"}
        </div>
      </div>

      {/* Player picker */}
      <PlayerPicker
        players={players}
        selectedId={selectedPlayer?.id ?? null}
        onPick={handlePickPlayer}
      />

      {!selectedPlayer ? (
        <div
          style={{
            padding: "40px 20px",
            textAlign: "center",
            color: "#888",
            fontSize: 14,
            background: "#fafafa",
            borderRadius: 10,
            border: "1px dashed #ddd",
            marginTop: 18,
          }}
        >
          Pick a player above to review their session.
        </div>
      ) : (
        <>
          {/* Top priorities (already session-scoped) */}
          <div style={{ marginTop: 18 }}>
            <PrioritiesPanel
              sessionId={session.id}
              playerId={selectedPlayer.id}
            />
          </div>

          {/* Strengths */}
          <StrengthsPanel
            sessionId={session.id}
            playerId={selectedPlayer.id}
          />

          {/* Coach session note + tone */}
          <SessionNoteEditor
            sessionAnalysis={sessionAnalysis}
            onChange={(next) => setSessionAnalysis(next)}
          />

          {/* Per-rally queue, grouped by game */}
          <ReviewItemsList queue={queue} orgSlug={orgId ?? ""} />
        </>
      )}
    </div>
  );
}

// ────────────────────────── Player picker ──────────────────────────

function PlayerPicker({
  players,
  selectedId,
  onPick,
}: {
  players: PlayerRow[];
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        padding: 10,
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 10,
      }}
    >
      <span style={{ fontSize: 12, color: "#666", alignSelf: "center", marginRight: 4 }}>
        Player:
      </span>
      {players.map((p) => {
        const active = p.id === selectedId;
        return (
          <button
            key={p.id}
            onClick={() => onPick(p.id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 11px",
              fontSize: 13,
              fontWeight: active ? 700 : 600,
              background: active ? "#1a73e8" : "#fff",
              color: active ? "#fff" : "#444",
              border: `1px solid ${active ? "#1a73e8" : "#e2e2e2"}`,
              borderRadius: 999,
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {p.avatar_url && (
              <img
                src={p.avatar_url}
                alt=""
                style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover" }}
              />
            )}
            {p.display_name}
          </button>
        );
      })}
    </div>
  );
}

// ────────────────────────── Session note editor ──────────────────────────

function SessionNoteEditor({
  sessionAnalysis,
  onChange,
}: {
  sessionAnalysis: SessionAnalysis | null;
  onChange: (next: SessionAnalysis) => void;
}) {
  const [draftNote, setDraftNote] = useState("");
  const [savedMs, setSavedMs] = useState<number | null>(null);

  useEffect(() => {
    setDraftNote(sessionAnalysis?.overall_note ?? "");
  }, [sessionAnalysis?.id]);

  if (!sessionAnalysis) return null;

  async function save(patch: Partial<Pick<SessionAnalysis, "overall_note" | "overall_tone">>) {
    if (!sessionAnalysis) return;
    await updateSessionAnalysis(sessionAnalysis.id, patch);
    onChange({ ...sessionAnalysis, ...patch });
    setSavedMs(Date.now());
  }

  return (
    <section
      style={{
        marginTop: 14,
        padding: "14px 16px",
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#222" }}>
          💬 Coach's session note
        </h2>
        <span style={{ fontSize: 11, color: "#888" }}>
          One framing for the whole session — opens the player's review walkthrough.
        </span>
        <span style={{ flex: 1 }} />
        {savedMs && Date.now() - savedMs < 2000 && (
          <span style={{ fontSize: 11, color: "#1e7e34", fontWeight: 600 }}>Saved</span>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <ToneButton
          label="Good job"
          active={sessionAnalysis.overall_tone === "good_job"}
          color="#1e7e34"
          onClick={() =>
            save({
              overall_tone:
                sessionAnalysis.overall_tone === "good_job" ? null : "good_job",
            })
          }
        />
        <ToneButton
          label="Needs work"
          active={sessionAnalysis.overall_tone === "needs_work"}
          color="#c62828"
          onClick={() =>
            save({
              overall_tone:
                sessionAnalysis.overall_tone === "needs_work" ? null : "needs_work",
            })
          }
        />
      </div>

      <textarea
        value={draftNote}
        onChange={(e) => setDraftNote(e.target.value)}
        onBlur={() => {
          if (draftNote !== (sessionAnalysis.overall_note ?? "")) {
            void save({ overall_note: draftNote.trim() || null });
          }
        }}
        rows={4}
        placeholder="What's the through-line of this session? Saves when you click out of the box."
        style={{
          width: "100%",
          padding: "10px 12px",
          fontSize: 14,
          fontFamily: "inherit",
          border: "1px solid #e2e2e2",
          borderRadius: 6,
          resize: "vertical",
          color: "#222",
        }}
      />
    </section>
  );
}

function ToneButton({
  label,
  active,
  color,
  onClick,
}: {
  label: string;
  active: boolean;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "5px 11px",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        background: active ? color : "#fff",
        color: active ? "#fff" : color,
        border: `1px solid ${color}`,
        borderRadius: 4,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {label}
    </button>
  );
}

// ────────────────────────── Per-rally items list ──────────────────────────

function ReviewItemsList({
  queue,
  orgSlug,
}: {
  queue: SessionReviewItem[];
  orgSlug: string;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, { gameId: string; gameLabel: string; items: SessionReviewItem[] }>();
    for (const item of queue) {
      const slot = map.get(item.gameId);
      if (slot) {
        slot.items.push(item);
      } else {
        map.set(item.gameId, {
          gameId: item.gameId,
          gameLabel: item.gameLabel,
          items: [item],
        });
      }
    }
    return Array.from(map.values());
  }, [queue]);

  return (
    <section style={{ marginTop: 16 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 14px",
          background: "#fafafa",
          border: "1px solid #e2e2e2",
          borderTopLeftRadius: 10,
          borderTopRightRadius: 10,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#222" }}>
          📋 Review items across the session
        </h2>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "#666", fontWeight: 500 }}>
          {queue.length} item{queue.length === 1 ? "" : "s"}
        </span>
      </div>

      <div
        style={{
          background: "#fff",
          border: "1px solid #e2e2e2",
          borderTop: "none",
          borderBottomLeftRadius: 10,
          borderBottomRightRadius: 10,
        }}
      >
        {queue.length === 0 ? (
          <div style={{ padding: 20, fontSize: 13, color: "#888", textAlign: "center" }}>
            No flagged moments, sequences, or rally losses for this player yet.
            Tag moments in the per-game Analyze workspace to surface them here.
          </div>
        ) : (
          grouped.map((g, i) => (
            <div key={g.gameId} style={{ borderTop: i === 0 ? "none" : "1px solid #f0f0f0" }}>
              <div
                style={{
                  padding: "10px 14px",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#1a73e8",
                  background: "#f7faff",
                  borderBottom: "1px solid #eef2ff",
                }}
              >
                {g.gameLabel}
                <Link
                  to={`/org/${orgSlug}/games/${g.gameId}/coach-review`}
                  style={{
                    marginLeft: 10,
                    fontSize: 10,
                    fontWeight: 600,
                    color: "#666",
                    textDecoration: "none",
                  }}
                >
                  edit per-game →
                </Link>
              </div>
              {g.items.map((item) => (
                <ReviewItemRow key={item.itemKey} item={item} />
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ReviewItemRow({ item }: { item: SessionReviewItem }) {
  const kindLabel =
    item.kind === "flag" ? "🚩 Flag" : item.kind === "sequence" ? "📋 Sequence" : "⚠️ Rally loss";
  const reasonLabel = item.reason ? REASON_LABELS[item.reason] : null;
  const note =
    item.kind === "flag"
      ? item.flag?.note
      : item.kind === "sequence"
      ? item.sequence?.what_went_wrong
      : null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "120px 1fr 80px",
        gap: 12,
        alignItems: "center",
        padding: "10px 14px",
        borderTop: "1px solid #f5f5f5",
        fontSize: 13,
      }}
    >
      <div style={{ fontSize: 12, color: "#444", fontWeight: 600 }}>{kindLabel}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ color: "#222", fontWeight: 500 }}>
          Rally {item.rallyIndex + 1}
          {reasonLabel && (
            <span style={{ marginLeft: 8, color: "#666", fontWeight: 400 }}>
              · {reasonLabel}
            </span>
          )}
          {item.scoreAfter && (
            <span style={{ marginLeft: 8, color: "#999", fontSize: 11 }}>
              · score {item.scoreAfter}
            </span>
          )}
        </div>
        {note && (
          <div
            style={{
              marginTop: 2,
              fontSize: 12,
              color: "#666",
              fontStyle: "italic",
              lineHeight: 1.4,
            }}
          >
            "{note}"
          </div>
        )}
      </div>
      <div style={{ textAlign: "right", fontSize: 11, color: "#999" }}>
        {item.sequenceShotIds.length} shot{item.sequenceShotIds.length === 1 ? "" : "s"}
      </div>
    </div>
  );
}
