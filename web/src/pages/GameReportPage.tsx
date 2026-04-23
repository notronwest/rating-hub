/**
 * GameReportPage — per-game coaching report for a single player.
 *
 * This is the static, presentable version of everything the coach captured on
 * the Coach Review / WMPC Analysis flow: stats, overall framing + note,
 * addressed review topics, flagged moments, and saved sequences.
 *
 * Print-friendly CSS lets `window.print()` (or Cmd+P) produce a clean PDF
 * without a dedicated PDF library. Navigation chrome and the print button
 * hide under `@media print`.
 *
 * URL: /org/:orgId/games/:gameId/report?playerId=...
 * - When `playerId` is present, renders that player's report.
 * - When omitted, shows a picker and defaults to the first player.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { supabase } from "../supabase";
import type {
  Game,
  GamePlayer,
  RallyShot,
  Rally,
  GamePlayerShotType,
  GamePlayerCourtZone,
} from "../types/database";
import type {
  GameAnalysis,
  AnalysisSequence,
  FlaggedShot,
} from "../types/coach";
import type { FptmValue } from "../lib/fptm";
import { FPTM_PILLARS, summarizeFptm } from "../lib/fptm";
import {
  listTopicRecommendations,
  type TopicRecommendationRow,
} from "../lib/coachApi";
import {
  buildReviewTopics,
  isTopicAddressed,
  type ReviewTopic,
  type TopicId,
  type TopicRecommendation,
} from "../lib/reviewTopics";
import type { PlayerInfo } from "../lib/firstFourShots";

interface PlayerRow {
  id: string;
  display_name: string;
  slug: string;
  avatar_url: string | null;
}

interface PlayerWithStats extends PlayerInfo {
  gp: GamePlayer;
  slug: string;
}

export default function GameReportPage() {
  const { orgId, gameId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const playerIdParam = searchParams.get("playerId");

  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<PlayerWithStats[]>([]);
  const [rallies, setRallies] = useState<Rally[]>([]);
  const [shots, setShots] = useState<RallyShot[]>([]);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [sequences, setSequences] = useState<AnalysisSequence[]>([]);
  const [flags, setFlags] = useState<FlaggedShot[]>([]);
  const [topicRecs, setTopicRecs] = useState<TopicRecommendationRow[]>([]);
  const [shotTypes, setShotTypes] = useState<GamePlayerShotType[]>([]);
  const [courtZones, setCourtZones] = useState<GamePlayerCourtZone[]>([]);
  const [loading, setLoading] = useState(true);

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
        const pMap = new Map<string, PlayerRow>(
          (playerRows ?? []).map((p) => [p.id, p as PlayerRow]),
        );

        setPlayers(
          (gps as GamePlayer[]).map((gp) => {
            const p = pMap.get(gp.player_id);
            return {
              gp,
              id: gp.player_id,
              display_name: p?.display_name ?? "Unknown",
              slug: p?.slug ?? "",
              avatar_url: p?.avatar_url ?? null,
              player_index: gp.player_index,
              team: gp.team,
            };
          }),
        );

        const [ralRes, anaRes, stRes, czRes] = await Promise.all([
          supabase.from("rallies").select("*").eq("game_id", gameId).order("rally_index"),
          supabase.from("game_analyses").select("*").eq("game_id", gameId).maybeSingle(),
          supabase.from("game_player_shot_types").select("*").eq("game_id", gameId),
          supabase.from("game_player_court_zones").select("*").eq("game_id", gameId),
        ]);
        const rallyList = (ralRes.data ?? []) as Rally[];
        setRallies(rallyList);
        // rally_shots is filtered by rally_id, not game_id — the column
        // doesn't exist on that table.
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
        setShotTypes((stRes.data ?? []) as GamePlayerShotType[]);
        setCourtZones((czRes.data ?? []) as GamePlayerCourtZone[]);

        const ana = anaRes.data as GameAnalysis | null;
        setAnalysis(ana);

        if (ana) {
          const [seqRes, flgRes, topicRes] = await Promise.all([
            supabase.from("game_analysis_sequences").select("*").eq("analysis_id", ana.id),
            supabase.from("analysis_flagged_shots").select("*").eq("analysis_id", ana.id),
            listTopicRecommendations(ana.id),
          ]);
          setSequences((seqRes.data ?? []) as AnalysisSequence[]);
          setFlags((flgRes.data ?? []) as FlaggedShot[]);
          setTopicRecs(topicRes);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [gameId]);

  // Default the player picker to the first player once loaded.
  useEffect(() => {
    if (!playerIdParam && players.length > 0) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("playerId", players[0].id);
          return next;
        },
        { replace: true },
      );
    }
  }, [playerIdParam, players, setSearchParams]);

  const selectedPlayer = useMemo(
    () => players.find((p) => p.id === playerIdParam) ?? null,
    [players, playerIdParam],
  );

  if (loading || !game) {
    return <div style={{ padding: 20 }}>Loading report…</div>;
  }
  if (players.length === 0) {
    return <div style={{ padding: 20 }}>No players on this game yet.</div>;
  }

  return (
    <>
      <PrintStyles />

      <div className="gr-root" style={rootStyle}>
        <ReportToolbar
          orgId={orgId ?? ""}
          gameId={gameId ?? ""}
          players={players}
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
          <PlayerReport
            game={game}
            player={selectedPlayer}
            allPlayers={players}
            rallies={rallies}
            shots={shots}
            analysis={analysis}
            sequences={sequences}
            flags={flags}
            topicRecs={topicRecs}
            shotTypes={shotTypes.filter((st) => st.player_id === selectedPlayer.id)}
            courtZones={courtZones.filter((cz) => cz.player_id === selectedPlayer.id)}
          />
        )}
      </div>
    </>
  );
}

// ─────────────────────────── Toolbar ───────────────────────────

function ReportToolbar({
  orgId,
  gameId,
  players,
  selectedId,
  onPick,
}: {
  orgId: string;
  gameId: string;
  players: PlayerWithStats[];
  selectedId: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <div className="gr-noprint" style={toolbarStyle}>
      <Link
        to={`/org/${orgId}/games/${gameId}`}
        style={{ fontSize: 12, color: "#1a73e8", textDecoration: "none" }}
      >
        ← Back to game
      </Link>
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
      <Link
        to={`/org/${orgId}/games/${gameId}/present?playerId=${selectedId ?? ""}`}
        style={{
          padding: "6px 12px",
          fontSize: 12,
          fontWeight: 600,
          background: "#7c3aed",
          color: "#fff",
          border: "1px solid #7c3aed",
          borderRadius: 6,
          cursor: "pointer",
          fontFamily: "inherit",
          textDecoration: "none",
        }}
      >
        ▶ Present
      </Link>
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

// ─────────────────────────── Player report ───────────────────────────

interface PlayerReportProps {
  game: Game;
  player: PlayerWithStats;
  allPlayers: PlayerWithStats[];
  rallies: Rally[];
  shots: RallyShot[];
  analysis: GameAnalysis | null;
  sequences: AnalysisSequence[];
  flags: FlaggedShot[];
  topicRecs: TopicRecommendationRow[];
  shotTypes: GamePlayerShotType[];
  courtZones: GamePlayerCourtZone[];
}

function PlayerReport(props: PlayerReportProps) {
  const { game, player, allPlayers, rallies, shots, sequences, flags, analysis, topicRecs } = props;

  // Topics (only rendered if the coach addressed / dismissed them)
  const topics = useMemo<ReviewTopic[]>(() => {
    const recsByTopic = new Map<TopicId, TopicRecommendation>();
    for (const r of topicRecs.filter((x) => x.player_id === player.id)) {
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
    return buildReviewTopics({
      player,
      shots,
      rallies,
      players: allPlayers,
      recommendationsByTopic: recsByTopic,
    }).filter((t) => isTopicAddressed(t));
  }, [player, shots, rallies, allPlayers, topicRecs]);

  // Flags on shots hit by this player
  const myFlags = useMemo(() => {
    const myShotIds = new Set(shots.filter((s) => s.player_index === player.player_index).map((s) => s.id));
    return flags.filter((f) => myShotIds.has(f.shot_id));
  }, [flags, shots, player]);

  // Sequences tagged to this player
  const mySequences = useMemo(() => {
    return sequences.filter(
      (s) => s.player_id === player.id || (s.player_ids ?? []).includes(player.id),
    );
  }, [sequences, player]);

  const tone = analysis?.overall_tone ?? null;
  const gameLabel = game.session_name || `Game`;

  return (
    <div className="gr-page" style={pageStyle}>
      {/* Cover / header */}
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
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
              {player.display_name}
            </h1>
            <div style={{ fontSize: 13, color: "#555", marginTop: 2 }}>
              {gameLabel} · {new Date(game.played_at).toLocaleDateString()}
              {tone && (
                <span
                  style={{
                    marginLeft: 10,
                    fontSize: 11,
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
            </div>
          </div>
        </div>
      </header>

      {/* Overall note */}
      {analysis?.overall_notes && analysis.overall_notes.trim() && (
        <Section title="Coach's summary">
          <div style={noteStyle}>{analysis.overall_notes}</div>
        </Section>
      )}

      {/* Stats block */}
      <Section title="Game statistics">
        <StatsBlock player={player} shotTypes={props.shotTypes} courtZones={props.courtZones} />
      </Section>

      {/* Addressed review topics */}
      {topics.length > 0 && (
        <Section title="WMPC Analysis">
          <div style={{ display: "grid", gap: 10 }}>
            {topics.map((t) => (
              <TopicCard key={t.id} topic={t} />
            ))}
          </div>
        </Section>
      )}

      {/* Flagged moments */}
      {myFlags.length > 0 && (
        <Section title="Flagged moments">
          <div style={{ display: "grid", gap: 10 }}>
            {myFlags.map((f) => {
              const shot = shots.find((s) => s.id === f.shot_id);
              const rally = shot ? rallies.find((r) => r.id === shot.rally_id) : null;
              return (
                <ItemCard
                  key={f.id}
                  title={`🚩 Rally ${rally ? rally.rally_index + 1 : "?"}`}
                  note={f.note}
                  fptm={f.fptm as FptmValue | null}
                  drills={f.drills}
                />
              );
            })}
          </div>
        </Section>
      )}

      {/* Sequences */}
      {mySequences.length > 0 && (
        <Section title="Saved sequences">
          <div style={{ display: "grid", gap: 10 }}>
            {mySequences.map((s) => {
              const rally = rallies.find((r) => r.id === s.rally_id);
              return (
                <ItemCard
                  key={s.id}
                  title={`📋 ${s.label ?? `Rally ${rally ? rally.rally_index + 1 : "?"}`}`}
                  subtitle={`${s.shot_ids.length} shot${s.shot_ids.length !== 1 ? "s" : ""}`}
                  note={s.what_went_wrong}
                  fptm={s.fptm as FptmValue | null}
                  drills={s.drills}
                />
              );
            })}
          </div>
        </Section>
      )}

      <footer style={footerStyle}>
        Report generated {new Date().toLocaleString()} · White Mountain Pickleball Club
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

function StatsBlock({
  player,
  shotTypes,
  courtZones,
}: {
  player: PlayerWithStats;
  shotTypes: GamePlayerShotType[];
  courtZones: GamePlayerCourtZone[];
}) {
  const gp = player.gp;
  const winRate =
    gp.num_rallies && gp.num_rallies > 0
      ? Math.round(((gp.num_rallies_won ?? 0) / gp.num_rallies) * 100)
      : null;

  // Top 3 shot types by count
  const topShotTypes = [...shotTypes]
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
    .slice(0, 3);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* Ratings row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 8 }}>
        <Stat label="Overall" value={fmtRating(gp.rating_overall)} emphasis />
        <Stat label="Serve" value={fmtRating(gp.rating_serve)} />
        <Stat label="Return" value={fmtRating(gp.rating_return)} />
        <Stat label="Offense" value={fmtRating(gp.rating_offense)} />
        <Stat label="Defense" value={fmtRating(gp.rating_defense)} />
        <Stat label="Agility" value={fmtRating(gp.rating_agility)} />
        <Stat label="Consist." value={fmtRating(gp.rating_consistency)} />
      </div>

      {/* Game outcomes */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        <Stat
          label="Rallies won"
          value={
            gp.num_rallies != null && gp.num_rallies_won != null
              ? `${gp.num_rallies_won}/${gp.num_rallies}`
              : "—"
          }
        />
        <Stat label="Win rate" value={winRate != null ? `${winRate}%` : "—"} />
        <Stat label="Shots" value={gp.shot_count != null ? `${gp.shot_count}` : "—"} />
        <Stat
          label="Court coverage"
          value={gp.x_coverage_pct != null ? `${Math.round(gp.x_coverage_pct * 100)}%` : "—"}
        />
      </div>

      {/* Shot selection + quality */}
      {(gp.shot_quality || gp.shot_accuracy) && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {gp.shot_quality && (
            <MiniBreakdown title="Shot quality" data={gp.shot_quality as Record<string, number>} />
          )}
          {gp.shot_accuracy && (
            <MiniBreakdown
              title="Shot accuracy"
              data={gp.shot_accuracy as Record<string, number>}
            />
          )}
        </div>
      )}

      {/* Top shot types */}
      {topShotTypes.length > 0 && (
        <div>
          <div style={miniHeadStyle}>Most-hit shot types</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {topShotTypes.map((st) => (
              <span key={st.shot_type} style={shotTypeChipStyle}>
                {st.shot_type}
                <b style={{ marginLeft: 4 }}>{st.count ?? 0}</b>
              </span>
            ))}
          </div>
        </div>
      )}

      {courtZones.length > 0 && (
        <div>
          <div style={miniHeadStyle}>Where they played from</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[...courtZones]
              .sort((a, b) => (b.shot_count ?? 0) - (a.shot_count ?? 0))
              .slice(0, 4)
              .map((cz) => (
                <span key={cz.zone} style={shotTypeChipStyle}>
                  {cz.zone}
                  <b style={{ marginLeft: 4 }}>{cz.shot_count ?? 0}</b>
                </span>
              ))}
          </div>
        </div>
      )}
    </div>
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

function MiniBreakdown({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data).filter(([, v]) => typeof v === "number");
  const total = entries.reduce((a, [, v]) => a + v, 0);
  return (
    <div>
      <div style={miniHeadStyle}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {entries.map(([k, v]) => {
          const pct = total > 0 ? Math.round((v / total) * 100) : 0;
          return (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
              <span style={{ width: 70, color: "#555" }}>{k}</span>
              <div style={{ flex: 1, background: "#f0f0f0", height: 6, borderRadius: 3 }}>
                <div style={{ width: `${pct}%`, background: "#1a73e8", height: 6, borderRadius: 3 }} />
              </div>
              <span style={{ width: 30, textAlign: "right", color: "#888" }}>{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopicCard({ topic }: { topic: ReviewTopic }) {
  const rec = topic.recommendation;
  const pctColor = topic.pct >= 80 ? "#1e7e34" : topic.pct >= 60 ? "#d97706" : "#c62828";
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>
          {topic.icon} {topic.title}
        </div>
        <span style={{ fontSize: 11, color: "#888" }}>{topic.subtitle}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: pctColor }}>
          {topic.correct}/{topic.total} ({topic.pct}%)
        </span>
        {rec?.dismissed && <DismissedBadge />}
      </div>
      {rec?.recommendation && <div style={{ ...noteStyle, marginTop: 6 }}>{rec.recommendation}</div>}
      <FptmChips fptm={rec?.fptm as FptmValue | null} />
      {rec?.drills && (
        <div style={{ marginTop: 6 }}>
          <div style={miniHeadStyle}>Drills</div>
          <div style={noteStyle}>{rec.drills}</div>
        </div>
      )}
    </div>
  );
}

function ItemCard({
  title,
  subtitle,
  note,
  fptm,
  drills,
}: {
  title: string;
  subtitle?: string;
  note: string | null;
  fptm: FptmValue | null;
  drills: string | null;
}) {
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
        {subtitle && <span style={{ fontSize: 11, color: "#888" }}>· {subtitle}</span>}
      </div>
      {note && <div style={{ ...noteStyle, marginTop: 6 }}>{note}</div>}
      <FptmChips fptm={fptm} />
      {drills && (
        <div style={{ marginTop: 6 }}>
          <div style={miniHeadStyle}>Drills</div>
          <div style={noteStyle}>{drills}</div>
        </div>
      )}
    </div>
  );
}

function FptmChips({ fptm }: { fptm: FptmValue | null }) {
  if (!fptm) return null;
  const summary = summarizeFptm(fptm);
  if (summary.length === 0) return null;
  return (
    <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
      {summary.map(({ pillar, itemCount }) => {
        const state = fptm[pillar.id];
        const tone = state?.tone ?? "weakness";
        const color = tone === "strength" ? "#1e7e34" : "#c62828";
        const selectedItems = state?.items ?? [];
        const labels = selectedItems
          .map((id) => pillar.items.find((it) => it.id === id)?.label)
          .filter(Boolean)
          .join(", ");
        return (
          <span
            key={pillar.id}
            title={labels || pillar.label}
            style={{
              fontSize: 10,
              padding: "3px 8px",
              borderRadius: 10,
              background: `${color}11`,
              border: `1px solid ${color}66`,
              color,
              fontWeight: 600,
            }}
          >
            <span style={{ fontWeight: 700 }}>{pillar.letter}</span>
            {" · "}
            {pillar.label.toLowerCase()}
            {itemCount > 0 && ` (${itemCount})`}
          </span>
        );
      })}
    </div>
  );
}

function DismissedBadge() {
  return (
    <span
      style={{
        fontSize: 10,
        padding: "2px 6px",
        background: "#f1f3f5",
        color: "#6b7280",
        borderRadius: 3,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.3,
      }}
    >
      Dismissed
    </span>
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

const pageStyle: React.CSSProperties = {
  background: "#fff",
};

const headerBlockStyle: React.CSSProperties = {
  padding: "10px 0 14px",
  borderBottom: "2px solid #1a73e8",
  marginBottom: 18,
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 20,
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

const cardStyle: React.CSSProperties = {
  border: "1px solid #e2e2e2",
  borderRadius: 6,
  padding: 10,
  background: "#fff",
  pageBreakInside: "avoid",
};

const noteStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#333",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
};

const miniHeadStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: 0.4,
  color: "#888",
  fontWeight: 700,
  marginBottom: 4,
};

const shotTypeChipStyle: React.CSSProperties = {
  fontSize: 11,
  padding: "3px 8px",
  borderRadius: 10,
  background: "#f5f5f5",
  border: "1px solid #e2e2e2",
  color: "#333",
};

const footerStyle: React.CSSProperties = {
  marginTop: 30,
  paddingTop: 10,
  borderTop: "1px solid #eee",
  fontSize: 10,
  color: "#888",
  textAlign: "center",
};

// ─────────────────────────── Print CSS ───────────────────────────

function PrintStyles() {
  return (
    <style>{`
      @media print {
        @page { size: letter; margin: 0.5in; }
        body { background: #fff !important; }
        .gr-noprint { display: none !important; }
        .gr-root { max-width: none !important; padding: 0 !important; }
        section, .gr-card { page-break-inside: avoid; }
        a { color: inherit !important; text-decoration: none !important; }
      }
    `}</style>
  );
}

function fmtRating(v: number | null): string {
  if (v == null) return "—";
  return v.toFixed(1);
}
