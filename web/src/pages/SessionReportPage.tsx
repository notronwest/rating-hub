/**
 * SessionReportPage — rolls up every game in a session into one per-player
 * coaching report.
 *
 * URL: /org/:orgId/sessions/:sessionId/report?playerId=...
 *
 * Sections:
 *   1. Cover — session label, date, player picker
 *   2. Top priorities (hero) + Strengths
 *   3. Coach's notes per game
 *   4. Stats rollup — average ratings + per-game strip + aggregate totals
 *   5. Per-game cards — link into each game's full data view
 *
 * Print-friendly (`window.print()` → PDF).
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../supabase";
import type {
  Game,
  GamePlayer,
  RallyShot,
  Rally,
} from "../types/database";
import type {
  AnalysisSequence,
  FlaggedShot,
  GameAnalysis,
} from "../types/coach";
import type { FptmValue } from "../lib/fptm";
import { FPTM_PILLARS, FPTM_PILLAR_BY_ID, summarizeFptm } from "../lib/fptm";
import {
  listTopicRecommendations,
  type TopicRecommendationRow,
} from "../lib/coachApi";
import {
  buildReviewTopics,
  type ReviewTopic,
  type TopicId,
  type TopicRecommendation,
} from "../lib/reviewTopics";
import PrioritiesPanel from "../components/report/PrioritiesPanel";
import StrengthsPanel from "../components/report/StrengthsPanel";
import { parseGameIdx as extractGameIdx } from "../lib/sessionGames";

interface SessionRow {
  id: string;
  label: string | null;
  played_date: string;
  org_id: string;
}

interface PlayerRow {
  id: string;
  display_name: string;
  slug: string;
  avatar_url: string | null;
}

interface GameBundle {
  game: Game;
  gameIdx: number; // 1-based display index; derived from gm-N suffix on session_name
  gamePlayers: GamePlayer[];
  rallies: Rally[];
  shots: RallyShot[];
  analysis: GameAnalysis | null;
  sequences: AnalysisSequence[];
  flags: FlaggedShot[];
  topicRecs: TopicRecommendationRow[];
}


export default function SessionReportPage() {
  const { orgId, sessionId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const playerIdParam = searchParams.get("playerId");

  const [session, setSession] = useState<SessionRow | null>(null);
  const [playersById, setPlayersById] = useState<Map<string, PlayerRow>>(new Map());
  const [bundles, setBundles] = useState<GameBundle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      setLoading(true);
      try {
        // Session
        const { data: s } = await supabase
          .from("sessions")
          .select("*")
          .eq("id", sessionId)
          .single();
        if (!s) return;
        setSession(s as SessionRow);

        // Games in this session, ordered via gm-N suffix fallback to played_at.
        const { data: games } = await supabase
          .from("games")
          .select("*")
          .eq("session_id", sessionId);
        if (!games || games.length === 0) return;
        const ordered = [...(games as Game[])].sort((a, b) => {
          const ai = extractGameIdx(a.session_name);
          const bi = extractGameIdx(b.session_name);
          if (ai != null && bi != null) return ai - bi;
          return new Date(a.played_at).getTime() - new Date(b.played_at).getTime();
        });

        const gameIds = ordered.map((g) => g.id);

        // Fan out the heavy reads — everything is filtered by game_id /
        // analysis_id, so one query each beats N per-game queries.
        const [gpRes, ralRes, anaRes] = await Promise.all([
          supabase.from("game_players").select("*").in("game_id", gameIds),
          supabase.from("rallies").select("*").in("game_id", gameIds),
          supabase.from("game_analyses").select("*").in("game_id", gameIds),
        ]);
        // rally_shots has no game_id column — fetch by the rally_ids we
        // just loaded.
        const rallyIds = (ralRes.data ?? []).map((r: Rally) => r.id);
        const shotRes = rallyIds.length > 0
          ? await supabase.from("rally_shots").select("*").in("rally_id", rallyIds)
          : { data: [] as RallyShot[] };

        // Player names
        const playerIdSet = new Set(
          (gpRes.data ?? []).map((gp: GamePlayer) => gp.player_id),
        );
        const { data: playerRows } = await supabase
          .from("players")
          .select("id, display_name, slug, avatar_url")
          .in("id", Array.from(playerIdSet));
        const pMap = new Map<string, PlayerRow>(
          (playerRows ?? []).map((p) => [p.id, p as PlayerRow]),
        );
        setPlayersById(pMap);

        // Analysis-scoped fetches
        const analyses = (anaRes.data ?? []) as GameAnalysis[];
        const analysisIds = analyses.map((a) => a.id);
        const [seqRes, flgRes, topicsAll] = await Promise.all([
          analysisIds.length > 0
            ? supabase.from("game_analysis_sequences").select("*").in("analysis_id", analysisIds)
            : Promise.resolve({ data: [] as AnalysisSequence[] }),
          analysisIds.length > 0
            ? supabase.from("analysis_flagged_shots").select("*").in("analysis_id", analysisIds)
            : Promise.resolve({ data: [] as FlaggedShot[] }),
          analysisIds.length > 0
            ? Promise.all(analysisIds.map((id) => listTopicRecommendations(id)))
            : Promise.resolve([] as TopicRecommendationRow[][]),
        ]);

        const seqAll = (seqRes.data ?? []) as AnalysisSequence[];
        const flgAll = (flgRes.data ?? []) as FlaggedShot[];
        const topicRecByAnalysis = new Map<string, TopicRecommendationRow[]>();
        if (Array.isArray(topicsAll) && topicsAll.length > 0) {
          for (let i = 0; i < analysisIds.length; i++) {
            topicRecByAnalysis.set(analysisIds[i], topicsAll[i] as TopicRecommendationRow[]);
          }
        }

        // Assemble bundles
        const assembled: GameBundle[] = ordered.map((game, i) => {
          const ana = analyses.find((a) => a.game_id === game.id) ?? null;
          return {
            game,
            gameIdx: i + 1,
            gamePlayers: (gpRes.data ?? []).filter((gp: GamePlayer) => gp.game_id === game.id),
            rallies: (ralRes.data ?? []).filter((r: Rally) => r.game_id === game.id),
            shots: (shotRes.data ?? []).filter((s: RallyShot) => s.game_id === game.id),
            analysis: ana,
            sequences: ana ? seqAll.filter((s) => s.analysis_id === ana.id) : [],
            flags: ana ? flgAll.filter((f) => f.analysis_id === ana.id) : [],
            topicRecs: ana ? topicRecByAnalysis.get(ana.id) ?? [] : [],
          };
        });
        setBundles(assembled);
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  // Pick the player — all players who appear in ≥1 game of the session.
  const sessionPlayers = useMemo(() => {
    const ids = new Set<string>();
    for (const b of bundles) for (const gp of b.gamePlayers) ids.add(gp.player_id);
    return Array.from(ids)
      .map((id) => playersById.get(id))
      .filter((p): p is PlayerRow => !!p);
  }, [bundles, playersById]);

  useEffect(() => {
    if (!playerIdParam && sessionPlayers.length > 0) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("playerId", sessionPlayers[0].id);
          return next;
        },
        { replace: true },
      );
    }
  }, [playerIdParam, sessionPlayers, setSearchParams]);

  const selectedPlayer = useMemo(
    () => sessionPlayers.find((p) => p.id === playerIdParam) ?? null,
    [sessionPlayers, playerIdParam],
  );

  if (loading || !session) {
    return <div style={{ padding: 20 }}>Loading session report…</div>;
  }
  if (bundles.length === 0) {
    return <div style={{ padding: 20 }}>No games in this session yet.</div>;
  }

  return (
    <>
      <PrintStyles />
      <div className="sr-root" style={rootStyle}>
        <Toolbar
          orgId={orgId ?? ""}
          sessionId={sessionId ?? ""}
          players={sessionPlayers}
          selectedId={selectedPlayer?.id ?? null}
          onPick={(id) =>
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.set("playerId", id);
                return next;
              },
              { replace: true },
            )
          }
        />

        {selectedPlayer && (
          <PlayerSessionReport
            orgId={orgId ?? ""}
            session={session}
            player={selectedPlayer}
            bundles={bundles}
            playersById={playersById}
          />
        )}
      </div>
    </>
  );
}

// ─────────────────────────── Toolbar ───────────────────────────

function Toolbar({
  orgId,
  sessionId,
  players,
  selectedId,
  onPick,
}: {
  orgId: string;
  sessionId: string;
  players: PlayerRow[];
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div className="sr-noprint" style={toolbarStyle}>
      <Link
        to={`/org/${orgId}/sessions/${sessionId}`}
        style={{ fontSize: 12, color: "#1a73e8", textDecoration: "none" }}
      >
        ← Back to session
      </Link>
      {selectedId && (
        <>
          <Link
            to={`/org/${orgId}/sessions/${sessionId}/coach-review?playerId=${selectedId}`}
            title="Coach review: priorities, strengths, session-wide review queue"
            style={{
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 700,
              background: "#0d904f",
              color: "#fff",
              border: "1px solid #0d904f",
              borderRadius: 12,
              textDecoration: "none",
              fontFamily: "inherit",
              letterSpacing: 0.3,
              textTransform: "uppercase",
            }}
          >
            🎯 Review
          </Link>
          <Link
            to={`/org/${orgId}/sessions/${sessionId}/present?playerId=${selectedId}`}
            title="Walk this player through the whole session: priorities, strengths, then per-game flagged moments"
            style={{
              padding: "4px 10px",
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
        </>
      )}
      <span style={{ flex: 1 }} />
      <span style={{ fontSize: 12, color: "#666" }}>Player:</span>
      <div style={{ display: "inline-flex", border: "1px solid #e2e2e2", borderRadius: 6, overflow: "hidden" }}>
        {players.map((p) => {
          const active = p.id === selectedId;
          return (
            <button
              key={p.id}
              onClick={() => onPick(p.id)}
              style={{
                padding: "6px 10px",
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                background: active ? "#1a73e8" : "#fff",
                color: active ? "#fff" : "#333",
                border: "none",
                borderRight: "1px solid #e2e2e2",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {p.display_name.split(" ")[0]}
            </button>
          );
        })}
      </div>
      <button
        onClick={() => window.print()}
        style={{
          padding: "6px 14px",
          fontSize: 12,
          fontWeight: 600,
          background: "#1a73e8",
          color: "#fff",
          border: "1px solid #1a73e8",
          borderRadius: 6,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        🖨 Print / Save as PDF
      </button>
    </div>
  );
}

// ─────────────────────────── Player session report ───────────────────────────

function PlayerSessionReport({
  orgId,
  session,
  player,
  bundles,
  playersById,
}: {
  orgId: string;
  session: SessionRow;
  player: PlayerRow;
  bundles: GameBundle[];
  playersById: Map<string, PlayerRow>;
}) {
  // Reduce each game down to this player's row
  const perGame = useMemo(() => {
    return bundles
      .map((b) => {
        const gp = b.gamePlayers.find((g) => g.player_id === player.id);
        if (!gp) return null;
        return { bundle: b, gp };
      })
      .filter((x): x is { bundle: GameBundle; gp: GamePlayer } => !!x);
  }, [bundles, player.id]);

  // Averages across the session (only games the player appeared in).
  const stats = useMemo(() => {
    const avg = (pick: (gp: GamePlayer) => number | null): number | null => {
      const vals = perGame.map(({ gp }) => pick(gp)).filter((v): v is number => v != null);
      if (vals.length === 0) return null;
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };
    const totalRallies = perGame.reduce((a, { gp }) => a + (gp.num_rallies ?? 0), 0);
    const totalRalliesWon = perGame.reduce((a, { gp }) => a + (gp.num_rallies_won ?? 0), 0);
    const totalShots = perGame.reduce((a, { gp }) => a + (gp.shot_count ?? 0), 0);
    const gamesWon = perGame.filter(({ gp }) => gp.won === true).length;
    return {
      avgOverall: avg((gp) => gp.rating_overall),
      avgServe: avg((gp) => gp.rating_serve),
      avgReturn: avg((gp) => gp.rating_return),
      avgOffense: avg((gp) => gp.rating_offense),
      avgDefense: avg((gp) => gp.rating_defense),
      avgAgility: avg((gp) => gp.rating_agility),
      avgConsistency: avg((gp) => gp.rating_consistency),
      totalRallies,
      totalRalliesWon,
      totalShots,
      gamesWon,
      gamesPlayed: perGame.length,
    };
  }, [perGame]);

  return (
    <div className="sr-page" style={pageStyle}>
      <header style={headerBlockStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          {player.avatar_url ? (
            <img
              src={player.avatar_url}
              alt=""
              style={{ width: 64, height: 64, borderRadius: "50%", border: "2px solid #1a73e8" }}
            />
          ) : (
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "#1a73e8",
                color: "#fff",
                display: "grid",
                placeItems: "center",
                fontSize: 26,
                fontWeight: 700,
              }}
            >
              {player.display_name[0]}
            </div>
          )}
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", color: "#888", letterSpacing: 0.5, fontWeight: 700 }}>
              Session report
            </div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{player.display_name}</h1>
            <div style={{ fontSize: 13, color: "#555", marginTop: 2 }}>
              {session.label ?? "Session"} · {new Date(session.played_date).toLocaleDateString()} ·{" "}
              {perGame.length} {perGame.length === 1 ? "game" : "games"}
            </div>
          </div>
        </div>
      </header>

      {/* Top priorities — the hero block above everything else.
          Drives the "what to work on next" conversation; demotes the
          older Common Themes panel further down the page. */}
      <PrioritiesPanel sessionId={session.id} playerId={player.id} />

      {/* What you're doing well — 1–3 strengths surfaced alongside
          priorities so the report isn't all "things to fix". */}
      <StrengthsPanel sessionId={session.id} playerId={player.id} />

      {/* Coach notes across all games — quoted in order so the player
          reads the session's takeaways before the numbers. */}
      {(() => {
        const notes = perGame
          .map(({ bundle }) => ({
            idx: bundle.gameIdx,
            text: bundle.analysis?.overall_notes ?? null,
          }))
          .filter((n): n is { idx: number; text: string } =>
            !!(n.text && n.text.trim()),
          );
        if (notes.length === 0) return null;
        return (
          <Section title="Coach's notes">
            <div style={{ display: "grid", gap: 8 }}>
              {notes.map(({ idx, text }) => (
                <div
                  key={idx}
                  style={{
                    padding: "10px 12px",
                    borderLeft: "3px solid #1a73e8",
                    background: "#f7f9ff",
                    borderRadius: 4,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      color: "#1a73e8",
                      fontWeight: 700,
                      letterSpacing: 0.4,
                      textTransform: "uppercase",
                      marginBottom: 4,
                    }}
                  >
                    Game {idx}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      color: "#222",
                      lineHeight: 1.55,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {text}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        );
      })()}

      {/* Aggregate stats */}
      <Section title={`Session rollup · average across ${perGame.length} games`}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8, marginBottom: 10 }}>
          <Stat label="Overall" value={fmtRating(stats.avgOverall)} emphasis />
          <Stat label="Serve" value={fmtRating(stats.avgServe)} />
          <Stat label="Return" value={fmtRating(stats.avgReturn)} />
          <Stat label="Offense" value={fmtRating(stats.avgOffense)} />
          <Stat label="Defense" value={fmtRating(stats.avgDefense)} />
          <Stat label="Agility" value={fmtRating(stats.avgAgility)} />
          <Stat label="Consist." value={fmtRating(stats.avgConsistency)} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          <Stat
            label="Games won"
            value={`${stats.gamesWon}/${stats.gamesPlayed}`}
          />
          <Stat
            label="Rallies won"
            value={`${stats.totalRalliesWon}/${stats.totalRallies}`}
          />
          <Stat
            label="Rally win rate"
            value={
              stats.totalRallies > 0
                ? `${Math.round((stats.totalRalliesWon / stats.totalRallies) * 100)}%`
                : "—"
            }
          />
          <Stat label="Total shots" value={`${stats.totalShots}`} />
        </div>

        {/* Per-game rating strip — lets the coach eyeball ups and downs
            without needing a full trend chart yet. */}
        <div style={{ marginTop: 14 }}>
          <div style={miniHeadStyle}>Per-game overall rating</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {perGame.map(({ bundle, gp }) => (
              <Link
                key={bundle.game.id}
                to={`/org/${orgId}/games/${bundle.game.id}`}
                style={perGameChipStyle}
              >
                <span style={{ color: "#888", fontSize: 10, marginRight: 6 }}>
                  G{bundle.gameIdx}
                </span>
                <b>{fmtRating(gp.rating_overall)}</b>
                <span
                  style={{
                    marginLeft: 6,
                    fontSize: 10,
                    color: gp.won === true ? "#1e7e34" : gp.won === false ? "#c62828" : "#888",
                  }}
                >
                  {gp.won === true ? "W" : gp.won === false ? "L" : "—"}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </Section>

      {/* Per-game cards */}
      <Section title="Games in this session">
        <div style={{ display: "grid", gap: 10 }}>
          {perGame.map(({ bundle, gp }) => {
            const ana = bundle.analysis;
            const tone = ana?.overall_tone ?? null;
            const flagCount = bundle.flags.filter((f) => {
              const shot = bundle.shots.find((s) => s.id === f.shot_id);
              return shot?.player_index === gp.player_index;
            }).length;
            const seqCount = bundle.sequences.filter(
              (s) => s.player_id === player.id || (s.player_ids ?? []).includes(player.id),
            ).length;
            return (
              <Link
                key={bundle.game.id}
                to={`/org/${orgId}/games/${bundle.game.id}`}
                style={perGameCardStyle}
              >
                <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#222" }}>
                    Game {bundle.gameIdx}
                  </div>
                  <span style={{ color: "#888", fontSize: 12 }}>
                    {new Date(bundle.game.played_at).toLocaleDateString()}
                  </span>
                  {tone && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 3,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                        background: tone === "good_job" ? "#e6f4ea" : "#fdecea",
                        color: tone === "good_job" ? "#1e7e34" : "#c62828",
                      }}
                    >
                      {tone === "good_job" ? "Good job" : "Needs work"}
                    </span>
                  )}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, color: "#1a73e8", fontWeight: 600 }}>
                    Open report →
                  </span>
                </div>
                <div style={{ display: "flex", gap: 12, marginTop: 6, color: "#555", fontSize: 12, flexWrap: "wrap" }}>
                  <span>Rating: <b>{fmtRating(gp.rating_overall)}</b></span>
                  <span>Rallies: {gp.num_rallies_won ?? 0}/{gp.num_rallies ?? 0}</span>
                  <span>{flagCount} flag{flagCount === 1 ? "" : "s"}</span>
                  <span>{seqCount} sequence{seqCount === 1 ? "" : "s"}</span>
                </div>
                {ana?.overall_notes && ana.overall_notes.trim() && (
                  <div
                    style={{
                      marginTop: 8,
                      padding: "8px 10px",
                      borderLeft: "3px solid #1a73e8",
                      background: "#f7f9ff",
                      fontSize: 13,
                      color: "#333",
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {ana.overall_notes}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </Section>

      <footer style={footerStyle}>
        Session report generated {new Date().toLocaleString()} · White Mountain Pickleball Club
      </footer>
    </div>
  );
}


// ─────────────────────────── Subcomponents ───────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={sectionStyle}>
      <h2 style={sectionHeadStyle}>{title}</h2>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      style={{
        border: "1px solid #e2e2e2",
        borderRadius: 6,
        padding: "8px 10px",
        background: emphasis ? "#eef3ff" : "#fff",
      }}
    >
      <div style={{ fontSize: 9, textTransform: "uppercase", color: "#888", letterSpacing: 0.5, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: emphasis ? 18 : 15, fontWeight: 700, color: emphasis ? "#1a73e8" : "#222" }}>
        {value}
      </div>
    </div>
  );
}


// ─────────────────────────── Styles ───────────────────────────

const rootStyle: React.CSSProperties = {
  maxWidth: 960,
  margin: "0 auto",
  padding: "12px 16px 40px",
  fontFamily: "system-ui, -apple-system, sans-serif",
  color: "#222",
};

const toolbarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 0 14px",
  borderBottom: "1px solid #eee",
  marginBottom: 18,
  position: "sticky",
  top: 0,
  background: "#fff",
  zIndex: 10,
};

const pageStyle: React.CSSProperties = { background: "#fff" };

const headerBlockStyle: React.CSSProperties = {
  padding: "10px 0 14px",
  borderBottom: "2px solid #1a73e8",
  marginBottom: 18,
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 22,
  pageBreakInside: "avoid",
};

const sectionHeadStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "#1a73e8",
  margin: "0 0 8px 0",
  paddingBottom: 4,
  borderBottom: "1px solid #eee",
};

const miniHeadStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: "#888",
  fontWeight: 700,
  marginBottom: 4,
};

const perGameChipStyle: React.CSSProperties = {
  padding: "5px 10px",
  border: "1px solid #e2e2e2",
  borderRadius: 6,
  background: "#fff",
  fontSize: 13,
  color: "#222",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};

const perGameCardStyle: React.CSSProperties = {
  display: "block",
  padding: "10px 12px",
  border: "1px solid #e2e2e2",
  borderRadius: 6,
  background: "#fff",
  textDecoration: "none",
  color: "inherit",
};

const footerStyle: React.CSSProperties = {
  marginTop: 30,
  paddingTop: 10,
  borderTop: "1px solid #eee",
  fontSize: 10,
  color: "#888",
  textAlign: "center",
};

function PrintStyles() {
  return (
    <style>{`
      @media print {
        @page { size: letter; margin: 0.5in; }
        body { background: #fff !important; }
        .sr-noprint { display: none !important; }
        .sr-root { max-width: none !important; padding: 0 !important; }
        section { page-break-inside: avoid; }
        a { color: inherit !important; text-decoration: none !important; }
      }
    `}</style>
  );
}

function fmtRating(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(1);
}
