/**
 * SessionReportPage — rolls up every game in a session into one per-player
 * coaching report, with a "recurring themes" panel that surfaces patterns
 * appearing across two or more games.
 *
 * The recurring-themes threshold is intentionally low (2 games) because two
 * repeats is enough signal that something is a habit rather than a one-off.
 *
 * URL: /org/:orgId/sessions/:sessionId/report?playerId=...
 *
 * Sections:
 *   1. Cover — session label, date, player picker
 *   2. Stats rollup — average ratings + per-game strip + aggregate totals
 *   3. Recurring themes — FPTM sub-items, failing topics, repeated drills
 *   4. Per-game cards — link into each game's full report
 *
 * Print-friendly (`window.print()` → PDF), matching the game report.
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

// Thresholds: something is a "recurring theme" when it appears in this many
// games. Two games is enough of a pattern to call out — anything lower is
// noise, anything higher is too conservative for a typical 3-4-game session.
const RECURRING_THRESHOLD = 2;

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

/** Pull `gm-N` out of PB Vision's session_name suffix. Matches SessionDetail. */
function extractGameIdx(sessionName: string | null | undefined): number | null {
  if (!sessionName) return null;
  const m = sessionName.match(/gm-(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
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
            to={`/org/${orgId}/sessions/${sessionId}/rating-report?playerId=${selectedId}`}
            title="Switch to the data-only rating report for this session — stats, charts, auto bullets"
            style={{
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 700,
              background: "#fff",
              color: "#1a73e8",
              border: "1px solid #1a73e8",
              borderRadius: 12,
              textDecoration: "none",
              fontFamily: "inherit",
              letterSpacing: 0.3,
              textTransform: "uppercase",
            }}
          >
            📊 Rating report
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

  const themes = useMemo(
    () => computeRecurringThemes(perGame, playersById, player.id),
    [perGame, playersById, player.id],
  );

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

      {/* Recurring themes — the novel part */}
      <Section title={`Recurring themes · appearing in ${RECURRING_THRESHOLD}+ games`}>
        {themes.fptm.length === 0 && themes.topics.length === 0 && themes.drills.length === 0 ? (
          <div style={{ color: "#888", fontSize: 13, fontStyle: "italic" }}>
            Not enough repeated coaching signal yet. Keep reviewing — themes will surface once a
            pattern shows up in {RECURRING_THRESHOLD} or more games.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {themes.fptm.length > 0 && (
              <ThemeBlock
                heading="FPTM patterns"
                subtitle="Specific coaching items the coach flagged on this player across multiple games"
              >
                {themes.fptm.map((theme) => (
                  <ThemeRow
                    key={`${theme.pillarId}:${theme.itemId ?? "_pillar"}`}
                    label={theme.label}
                    accent={theme.accent}
                    count={theme.gameCount}
                    gameLabels={theme.gameLabels}
                    detail={theme.detail}
                  />
                ))}
              </ThemeBlock>
            )}

            {themes.topics.length > 0 && (
              <ThemeBlock
                heading="Scripted-start topics that keep showing up"
                subtitle="Review topics with coach content in multiple games — habits, not flukes"
              >
                {themes.topics.map((t) => (
                  <ThemeRow
                    key={t.topicId}
                    label={t.title}
                    accent="#d97706"
                    count={t.gameCount}
                    gameLabels={t.gameLabels}
                    detail={t.detail}
                  />
                ))}
              </ThemeBlock>
            )}

            {themes.drills.length > 0 && (
              <ThemeBlock
                heading="Drills prescribed multiple times"
                subtitle="Practice cues the coach has written into ≥2 games — worth bringing into every practice"
              >
                {themes.drills.map((d, i) => (
                  <ThemeRow
                    key={i}
                    label={d.text}
                    accent="#1e7e34"
                    count={d.gameCount}
                    gameLabels={d.gameLabels}
                  />
                ))}
              </ThemeBlock>
            )}
          </div>
        )}
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

// ─────────────────────── Recurring-themes aggregation ───────────────────────

interface FptmTheme {
  pillarId: string;
  itemId: string | null; // null = pillar-level theme (no sub-item repeated)
  label: string;
  accent: string;
  gameCount: number;
  gameLabels: string[];
  detail?: string;
}

interface TopicTheme {
  topicId: TopicId;
  title: string;
  gameCount: number;
  gameLabels: string[];
  detail?: string;
}

interface DrillTheme {
  text: string;
  gameCount: number;
  gameLabels: string[];
}

function computeRecurringThemes(
  perGame: Array<{ bundle: GameBundle; gp: GamePlayer }>,
  playersById: Map<string, PlayerRow>,
  playerId: string,
) {
  // Walk every piece of coach content for this player across games, bucketing
  // by theme key. Each bucket records the distinct set of games it touches.

  const fptmBucket = new Map<
    string,
    {
      pillarId: string;
      itemId: string | null;
      tone: string | null;
      games: Set<number>;
      gameLabels: string[];
    }
  >();
  const topicBucket = new Map<
    string,
    {
      topicId: TopicId;
      title: string;
      games: Set<number>;
      gameLabels: string[];
      pctSamples: Array<{ gameIdx: number; pct: number }>;
    }
  >();
  const drillBucket = new Map<
    string,
    {
      text: string;
      games: Set<number>;
      gameLabels: string[];
    }
  >();

  function recordFptm(
    fptm: FptmValue | null | undefined,
    gameIdx: number,
    gameLabel: string,
  ) {
    if (!fptm) return;
    const summary = summarizeFptm(fptm);
    for (const { pillar } of summary) {
      const state = fptm[pillar.id];
      if (!state) continue;
      const tone = state.tone ?? null;
      const items = state.items ?? [];
      // Record each sub-item — those are the substantive repeats.
      if (items.length > 0) {
        for (const itemId of items) {
          const key = `${pillar.id}:${itemId}`;
          let b = fptmBucket.get(key);
          if (!b) {
            b = {
              pillarId: pillar.id,
              itemId,
              tone,
              games: new Set(),
              gameLabels: [],
            };
            fptmBucket.set(key, b);
          }
          if (!b.games.has(gameIdx)) {
            b.games.add(gameIdx);
            b.gameLabels.push(gameLabel);
          }
        }
      } else {
        // Pillar toggled on without specifics — still worth surfacing.
        const key = `${pillar.id}:_pillar`;
        let b = fptmBucket.get(key);
        if (!b) {
          b = {
            pillarId: pillar.id,
            itemId: null,
            tone,
            games: new Set(),
            gameLabels: [],
          };
          fptmBucket.set(key, b);
        }
        if (!b.games.has(gameIdx)) {
          b.games.add(gameIdx);
          b.gameLabels.push(gameLabel);
        }
      }
    }
  }

  function recordDrill(
    raw: string | null | undefined,
    gameIdx: number,
    gameLabel: string,
  ) {
    if (!raw) return;
    // Break into "sentences" — short enough that a verbatim match across
    // games catches repetition, long enough that common words don't group.
    const lines = raw
      .split(/[.\n;]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 8);
    const seenThisGame = new Set<string>();
    for (const line of lines) {
      const key = line.toLowerCase();
      if (seenThisGame.has(key)) continue;
      seenThisGame.add(key);
      let b = drillBucket.get(key);
      if (!b) {
        b = { text: line, games: new Set(), gameLabels: [] };
        drillBucket.set(key, b);
      }
      if (!b.games.has(gameIdx)) {
        b.games.add(gameIdx);
        b.gameLabels.push(gameLabel);
      }
    }
  }

  for (const { bundle, gp: _gp } of perGame) {
    const gameLabel = `G${bundle.gameIdx}`;
    const gameIdx = bundle.gameIdx;

    // Build the review topics for THIS game so we can read each topic's
    // title + pass rate alongside the coach's recommendation.
    const players = bundle.gamePlayers
      .map((g) => {
        const p = playersById.get(g.player_id);
        if (!p) return null;
        return {
          id: g.player_id,
          display_name: p.display_name,
          player_index: g.player_index,
          team: g.team,
          avatar_url: p.avatar_url,
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    const selfPlayer = players.find((p) => p.id === playerId);

    if (selfPlayer) {
      const recsForPlayer = bundle.topicRecs.filter((r) => r.player_id === playerId);
      const recsByTopic = new Map<TopicId, TopicRecommendation>();
      for (const r of recsForPlayer) {
        recsByTopic.set(r.topic_id as TopicId, {
          id: r.id,
          recommendation: r.recommendation,
          tags: r.tags,
          dismissed: r.dismissed,
          fptm: r.fptm,
          drills: r.drills,
          updated_at: r.updated_at,
        });
      }
      const topics: ReviewTopic[] = buildReviewTopics({
        player: selfPlayer,
        shots: bundle.shots,
        rallies: bundle.rallies,
        players,
        recommendationsByTopic: recsByTopic,
      });

      for (const t of topics) {
        if (!t.recommendation) continue;
        // Only addressed topics that aren't dismissed count as "covered"
        // for the theme detector.
        if (t.recommendation.dismissed) continue;
        const hasContent =
          !!t.recommendation.recommendation ||
          !!t.recommendation.drills ||
          (t.recommendation.fptm &&
            Object.keys(t.recommendation.fptm as FptmValue).length > 0);
        if (!hasContent) continue;
        let b = topicBucket.get(t.id);
        if (!b) {
          b = {
            topicId: t.id,
            title: t.title,
            games: new Set(),
            gameLabels: [],
            pctSamples: [],
          };
          topicBucket.set(t.id, b);
        }
        if (!b.games.has(gameIdx)) {
          b.games.add(gameIdx);
          b.gameLabels.push(gameLabel);
          b.pctSamples.push({ gameIdx, pct: t.pct });
        }
        recordFptm(t.recommendation.fptm as FptmValue | null, gameIdx, gameLabel);
        recordDrill(t.recommendation.drills, gameIdx, gameLabel);
      }
    }

    // Flags + sequences owned by this player
    const myShotIds = new Set(
      bundle.shots
        .filter((s) => selfPlayer && s.player_index === selfPlayer.player_index)
        .map((s) => s.id),
    );
    for (const f of bundle.flags) {
      if (!myShotIds.has(f.shot_id)) continue;
      recordFptm(f.fptm as FptmValue | null, gameIdx, gameLabel);
      recordDrill(f.drills, gameIdx, gameLabel);
    }
    for (const seq of bundle.sequences) {
      const taggedMe =
        seq.player_id === playerId || (seq.player_ids ?? []).includes(playerId);
      if (!taggedMe) continue;
      recordFptm(seq.fptm as FptmValue | null, gameIdx, gameLabel);
      recordDrill(seq.drills, gameIdx, gameLabel);
    }
  }

  const fptm: FptmTheme[] = Array.from(fptmBucket.values())
    .filter((b) => b.games.size >= RECURRING_THRESHOLD)
    .map((b) => {
      const pillar = FPTM_PILLAR_BY_ID[b.pillarId as keyof typeof FPTM_PILLAR_BY_ID];
      const item = b.itemId
        ? pillar?.items.find((it) => it.id === b.itemId)
        : null;
      const tone = b.tone === "strength" ? "Strength" : "Needs work";
      const label = item
        ? `${pillar.letter} · ${pillar.label} — ${item.label}`
        : `${pillar.letter} · ${pillar.label} (no specifics)`;
      const accent = b.tone === "strength" ? "#1e7e34" : "#c62828";
      return {
        pillarId: b.pillarId,
        itemId: b.itemId,
        label,
        accent,
        gameCount: b.games.size,
        gameLabels: b.gameLabels,
        detail: tone,
      };
    })
    .sort((a, b) => b.gameCount - a.gameCount);

  const topics: TopicTheme[] = Array.from(topicBucket.values())
    .filter((b) => b.games.size >= RECURRING_THRESHOLD)
    .map((b) => {
      const pctDetail = b.pctSamples
        .sort((a, c) => a.gameIdx - c.gameIdx)
        .map((s) => `G${s.gameIdx}: ${s.pct}%`)
        .join(" · ");
      return {
        topicId: b.topicId,
        title: b.title,
        gameCount: b.games.size,
        gameLabels: b.gameLabels,
        detail: pctDetail,
      };
    })
    .sort((a, b) => b.gameCount - a.gameCount);

  const drills: DrillTheme[] = Array.from(drillBucket.values())
    .filter((b) => b.games.size >= RECURRING_THRESHOLD)
    .map((b) => ({
      text: b.text,
      gameCount: b.games.size,
      gameLabels: b.gameLabels,
    }))
    .sort((a, b) => b.gameCount - a.gameCount)
    .slice(0, 8);

  return { fptm, topics, drills };
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

function ThemeBlock({
  heading,
  subtitle,
  children,
}: {
  heading: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "#333" }}>{heading}</div>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>{subtitle}</div>
      <div style={{ display: "grid", gap: 6 }}>{children}</div>
    </div>
  );
}

function ThemeRow({
  label,
  accent,
  count,
  gameLabels,
  detail,
}: {
  label: string;
  accent: string;
  count: number;
  gameLabels: string[];
  detail?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        border: "1px solid #e2e2e2",
        borderLeft: `3px solid ${accent}`,
        borderRadius: 4,
        background: "#fff",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, color: "#222", fontWeight: 500 }}>{label}</div>
        {detail && (
          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{detail}</div>
        )}
      </div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: accent,
          background: `${accent}11`,
          padding: "3px 8px",
          borderRadius: 10,
          whiteSpace: "nowrap",
        }}
      >
        {count}× · {gameLabels.join(" · ")}
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
