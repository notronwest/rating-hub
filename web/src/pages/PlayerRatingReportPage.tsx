/**
 * PlayerRatingReportPage — pure-data per-player report that works with or
 * without a coach review.
 *
 * Two scoping modes, both rendered by this same component:
 *
 *   Rolling: `/org/:orgId/players/:slug/rating-report[?window=6]`
 *     — last N games across all sessions. Matches the PDF the club has
 *       been distributing manually.
 *
 *   Session: `/org/:orgId/sessions/:sessionId/rating-report?playerId=...`
 *     — just the games in one session (typically all 4 of a Pro+3 night).
 *       Useful when a whole session has been played and the coach wants
 *       a data-only recap without having to review individual games.
 *
 * The only difference is which set of games loads; the aggregation,
 * charts, bullets, and layout are identical. Works without any
 * `game_analyses` rows — it's PB Vision data all the way down.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../supabase";
import type {
  GamePlayer,
  GamePlayerCourtZone,
  GamePlayerShotType,
} from "../types/database";
import {
  buildPlayerRatingReport,
  classifyPct,
  fmtRating,
  fmtStat,
  PERF_TIERS,
  type GameRowForReport,
  type PerfTierSpec,
  type PlayerRatingReport,
} from "../lib/playerRatingReport";
import { BarChart, Sparkline, TrendChart } from "../components/report/MiniCharts";

const DEFAULT_WINDOW = 6;
const WINDOW_OPTIONS = [3, 6, 10, 20];

interface PlayerRow {
  id: string;
  display_name: string;
  slug: string;
  avatar_url: string | null;
}

interface GameLite {
  id: string;
  played_at: string;
  session_name: string | null;
  pbvision_video_id: string;
}

export default function PlayerRatingReportPage() {
  // Both routes land on this component; they differ only in which params
  // are present.
  const { orgId, slug, sessionId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const playerIdParam = searchParams.get("playerId");
  const windowSize = Math.max(
    1,
    Math.min(
      50,
      parseInt(searchParams.get("window") ?? "") || DEFAULT_WINDOW,
    ),
  );
  const isSessionScoped = !!sessionId;

  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [sessionLabel, setSessionLabel] = useState<string | null>(null);
  const [games, setGames] = useState<GameRowForReport[]>([]);
  const [sessionPlayers, setSessionPlayers] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    if (!isSessionScoped && !slug) return;
    if (isSessionScoped && !sessionId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        // 1. Find the player. Rolling mode uses the slug; session mode
        //    uses ?playerId, falling back to the first player in the
        //    session.
        let p: PlayerRow | null = null;
        if (isSessionScoped) {
          // Load session header + every player in it for the picker.
          const { data: s } = await supabase
            .from("sessions")
            .select("id, label, played_date")
            .eq("id", sessionId)
            .single();
          if (s && !cancelled) setSessionLabel(s.label ?? "Session");
          const { data: gameRows } = await supabase
            .from("games")
            .select("id")
            .eq("session_id", sessionId);
          const gameIds = (gameRows ?? []).map((g) => g.id);
          if (gameIds.length === 0) {
            if (!cancelled) {
              setErr("This session has no games yet.");
              setGames([]);
            }
            return;
          }
          const { data: gps } = await supabase
            .from("game_players")
            .select("player_id")
            .in("game_id", gameIds);
          const playerIds = Array.from(
            new Set((gps ?? []).map((gp) => gp.player_id as string)),
          );
          const { data: players } = await supabase
            .from("players")
            .select("id, display_name, slug, avatar_url")
            .in("id", playerIds);
          const allPlayers = (players ?? []) as PlayerRow[];
          if (!cancelled) setSessionPlayers(allPlayers);
          p =
            allPlayers.find((x) => x.id === playerIdParam) ??
            allPlayers[0] ??
            null;
          if (!p) {
            if (!cancelled) setErr("No players in this session.");
            return;
          }
          if (!cancelled) setPlayer(p);
          // Keep the URL in sync so the share/print link locks to the
          // chosen player.
          if (!playerIdParam && p && !cancelled) {
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.set("playerId", p!.id);
                return next;
              },
              { replace: true },
            );
          }
        } else {
          const { data: players } = await supabase
            .from("players")
            .select("id, display_name, slug, avatar_url")
            .eq("slug", slug!)
            .limit(1);
          p = (players?.[0] as PlayerRow | undefined) ?? null;
          if (!p) {
            if (!cancelled) setErr(`Player "${slug}" not found.`);
            return;
          }
          if (!cancelled) setPlayer(p);
        }

        // 2. Pull this player's game_players rows — session-scoped filter
        //    narrows before we hit the network.
        let gpQuery = supabase
          .from("game_players")
          .select("*, games!inner(id, session_id, played_at, session_name, pbvision_video_id)")
          .eq("player_id", p.id);
        if (isSessionScoped) {
          gpQuery = gpQuery.eq("games.session_id", sessionId);
        }
        const { data: joined } = await gpQuery;
        // Supabase returns the nested `games` object per row.
        const gpList = ((joined ?? []) as unknown as Array<
          GamePlayer & { games: GameLite & { session_id: string | null } }
        >);
        if (gpList.length === 0) {
          if (!cancelled) setGames([]);
          return;
        }

        // 3. Pick the games that belong in this report. Session-scoped
        //    takes all of them; rolling takes the most recent N by
        //    played_at.
        const gameRows: GameLite[] = gpList.map((row) => ({
          id: row.games.id,
          played_at: row.games.played_at,
          session_name: row.games.session_name,
          pbvision_video_id: row.games.pbvision_video_id,
        }));
        gameRows.sort(
          (a, b) =>
            new Date(b.played_at).getTime() - new Date(a.played_at).getTime(),
        );
        const recent: GameLite[] = isSessionScoped
          ? gameRows
          : gameRows.slice(0, windowSize);
        const recentIds = recent.map((g) => g.id);

        // 4. Shot types + court zones for those games
        const [stRes, czRes] = await Promise.all([
          recentIds.length > 0
            ? supabase
                .from("game_player_shot_types")
                .select("*")
                .in("game_id", recentIds)
                .eq("player_id", p.id)
            : Promise.resolve({ data: [] }),
          recentIds.length > 0
            ? supabase
                .from("game_player_court_zones")
                .select("*")
                .in("game_id", recentIds)
                .eq("player_id", p.id)
            : Promise.resolve({ data: [] }),
        ]);
        const shotTypes = (stRes.data ?? []) as GamePlayerShotType[];
        const courtZones = (czRes.data ?? []) as GamePlayerCourtZone[];

        const gpByGame = new Map<string, GamePlayer>(
          gpList.map((row) => {
            // Strip the joined `games` object back off — the rest of the
            // pipeline just wants the game_players shape.
            const { games: _unused, ...plain } = row;
            return [row.games.id, plain as GamePlayer];
          }),
        );
        const rows: GameRowForReport[] = recent
          .map((g) => {
            const gp = gpByGame.get(g.id);
            if (!gp) return null;
            return {
              id: g.id,
              played_at: g.played_at,
              session_name: g.session_name,
              pbvision_video_id: g.pbvision_video_id,
              gp,
              shotTypes: shotTypes.filter((s) => s.game_id === g.id),
              courtZones: courtZones.filter((z) => z.game_id === g.id),
            };
          })
          .filter((r): r is GameRowForReport => !!r);

        if (!cancelled) setGames(rows);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId, slug, sessionId, playerIdParam, windowSize, isSessionScoped]);

  const report: PlayerRatingReport | null = useMemo(
    () => (games.length > 0 ? buildPlayerRatingReport(games) : null),
    [games],
  );

  if (loading) return <div style={{ padding: 20 }}>Loading rating report…</div>;
  if (err) return <div style={{ padding: 20, color: "#c62828" }}>{err}</div>;
  if (!player) return <div style={{ padding: 20 }}>No player.</div>;

  function setWindow(n: number) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("window", String(n));
        return next;
      },
      { replace: true },
    );
  }

  return (
    <>
      <PrintStyles />
      <div className="prr-root" style={rootStyle}>
        <Toolbar
          orgId={orgId ?? ""}
          slug={player.slug}
          player={player}
          windowSize={windowSize}
          onWindow={setWindow}
          isSessionScoped={isSessionScoped}
          sessionId={sessionId ?? null}
          sessionLabel={sessionLabel}
          sessionPlayers={sessionPlayers}
          onPickPlayer={(id) =>
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

        {!report || report.perGame.length === 0 ? (
          <EmptyState player={player} />
        ) : (
          <ReportBody
            player={player}
            report={report}
            windowSize={windowSize}
            sessionLabel={isSessionScoped ? sessionLabel : null}
          />
        )}
      </div>
    </>
  );
}

// ─────────────────────────── Toolbar ───────────────────────────

function Toolbar({
  orgId,
  slug,
  player,
  windowSize,
  onWindow,
  isSessionScoped,
  sessionId,
  sessionLabel,
  sessionPlayers,
  onPickPlayer,
}: {
  orgId: string;
  slug: string;
  player: PlayerRow;
  windowSize: number;
  onWindow: (n: number) => void;
  isSessionScoped: boolean;
  sessionId: string | null;
  sessionLabel: string | null;
  sessionPlayers: PlayerRow[];
  onPickPlayer: (id: string) => void;
}) {
  return (
    <div className="prr-noprint" style={toolbarStyle}>
      {isSessionScoped && sessionId ? (
        <Link
          to={`/org/${orgId}/sessions/${sessionId}`}
          style={{ fontSize: 12, color: "#1a73e8", textDecoration: "none" }}
        >
          ← Back to {sessionLabel ?? "session"}
        </Link>
      ) : (
        <Link
          to={`/org/${orgId}/players/${slug}`}
          style={{ fontSize: 12, color: "#1a73e8", textDecoration: "none" }}
        >
          ← Back to {player.display_name}
        </Link>
      )}
      <span style={{ flex: 1 }} />
      {isSessionScoped && sessionPlayers.length > 1 ? (
        // Session mode: let the coach flip between players in this
        // session without leaving the report.
        <>
          <span style={{ fontSize: 12, color: "#666" }}>Player:</span>
          <div
            style={{
              display: "inline-flex",
              border: "1px solid #e2e2e2",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            {sessionPlayers.map((p) => {
              const active = p.id === player.id;
              return (
                <button
                  key={p.id}
                  onClick={() => onPickPlayer(p.id)}
                  style={{
                    padding: "5px 10px",
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
        </>
      ) : (
        <>
          <span style={{ fontSize: 12, color: "#666" }}>Window:</span>
          <div
            style={{
              display: "inline-flex",
              border: "1px solid #e2e2e2",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            {WINDOW_OPTIONS.map((n) => {
              const active = n === windowSize;
              return (
                <button
                  key={n}
                  onClick={() => onWindow(n)}
                  style={{
                    padding: "5px 10px",
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
                  {n}
                </button>
              );
            })}
          </div>
        </>
      )}
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

// ─────────────────────────── Empty state ───────────────────────────

function EmptyState({ player }: { player: PlayerRow }) {
  return (
    <div style={{ padding: 40, textAlign: "center", color: "#888" }}>
      <h2 style={{ margin: 0, color: "#333" }}>
        No games imported yet for {player.display_name}.
      </h2>
      <p style={{ marginTop: 8, fontSize: 13 }}>
        Once PB Vision video insights land for any of their games, this report
        will populate automatically.
      </p>
    </div>
  );
}

// ─────────────────────────── Report body ───────────────────────────

function ReportBody({
  player,
  report,
  windowSize,
  sessionLabel,
}: {
  player: PlayerRow;
  report: PlayerRatingReport;
  windowSize: number;
  sessionLabel: string | null;
}) {
  const n = report.perGame.length;

  // Per-skill trend arrays (oldest → newest) for sparklines.
  const chrono = [...report.perGame].sort(
    (a, b) =>
      new Date(a.game.played_at).getTime() -
      new Date(b.game.played_at).getTime(),
  );
  const trendBySkill = {
    overall: chrono.map((p) => p.ratings.overall),
    serve: chrono.map((p) => p.ratings.serve),
    return_: chrono.map((p) => p.ratings.return_),
    offense: chrono.map((p) => p.ratings.offense),
    defense: chrono.map((p) => p.ratings.defense),
    agility: chrono.map((p) => p.ratings.agility),
    consistency: chrono.map((p) => p.ratings.consistency),
  };

  return (
    <div style={pageStyle}>
      <header style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {player.avatar_url ? (
            <img
              src={player.avatar_url}
              alt=""
              style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                border: "2px solid #1a73e8",
              }}
            />
          ) : (
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: "50%",
                background: "#1a73e8",
                color: "#fff",
                display: "grid",
                placeItems: "center",
                fontSize: 28,
                fontWeight: 700,
              }}
            >
              {player.display_name[0]}
            </div>
          )}
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 11,
                color: "#888",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                fontWeight: 700,
              }}
            >
              WMPC rating report
            </div>
            <h1 style={{ margin: "2px 0 0", fontSize: 26, fontWeight: 700 }}>
              {player.display_name}
            </h1>
            <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
              Generated {new Date().toLocaleDateString()} ·{" "}
              {sessionLabel
                ? `${sessionLabel} (${n} ${n === 1 ? "game" : "games"})`
                : `sliding window of ${n} most recent ${
                    n === 1 ? "game" : "games"
                  }`}
            </div>
          </div>
          <div
            style={{
              textAlign: "right",
              borderLeft: "1px solid #e2e2e2",
              paddingLeft: 18,
            }}
          >
            <div
              style={{
                fontSize: 10,
                textTransform: "uppercase",
                color: "#888",
                letterSpacing: 0.5,
                fontWeight: 700,
              }}
            >
              Overall
            </div>
            <div style={{ fontSize: 40, fontWeight: 700, color: "#1a73e8", lineHeight: 1 }}>
              {fmtRating(report.ratings.overall)}
            </div>
          </div>
        </div>
      </header>

      <p style={explainerStyle}>
        {sessionLabel
          ? `All values below are averaged across the ${n} ${
              n === 1 ? "game" : "games"
            } played in this session.`
          : `All values below are averaged across this player's last ${n} games. As new games come in, older ones drop out of the window and the numbers refresh.`}
      </p>

      {/* Skill ratings with sparklines */}
      <Section title="Skill ratings">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 10 }}>
          <SkillStat
            label="Overall"
            value={report.ratings.overall}
            trend={trendBySkill.overall}
            emphasis
          />
          <SkillStat label="Serve" value={report.ratings.serve} trend={trendBySkill.serve} />
          <SkillStat label="Return" value={report.ratings.return_} trend={trendBySkill.return_} />
          <SkillStat
            label="Offense"
            value={report.ratings.offense}
            trend={trendBySkill.offense}
          />
          <SkillStat
            label="Defense"
            value={report.ratings.defense}
            trend={trendBySkill.defense}
          />
          <SkillStat
            label="Agility"
            value={report.ratings.agility}
            trend={trendBySkill.agility}
          />
          <SkillStat
            label="Consistency"
            value={report.ratings.consistency}
            trend={trendBySkill.consistency}
          />
        </div>
      </Section>

      {/* Key stats + charts */}
      <Section title="Key stats">
        <div style={{ marginBottom: 10 }}>
          <TierLegend />
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 8,
            marginBottom: 14,
          }}
        >
          <PctStat label="Shots in" value={report.stats.shotsInPct} />
          {/* Team shot % isn't tiered — 50% is ideal, not 100%. */}
          <PctStat
            label="Team shot%"
            value={report.stats.teamShotPct}
            tiered={false}
          />
          <PctStat label="Kitchen on serve" value={report.stats.kitchenOnServePct} />
          <PctStat label="Kitchen on return" value={report.stats.kitchenOnReturnPct} />
          <PctStat label="Serves in" value={report.stats.servesInPct} />
          <PctStat label="Serve deep" value={report.stats.serveDeepPct} />
          <PctStat label="Returns in" value={report.stats.returnsInPct} />
          <PctStat label="Return deep" value={report.stats.returnDeepPct} />
          <PctStat label="3rd shots in" value={report.stats.thirdShotsInPct} />
          <div
            style={{
              ...pctStatWrapStyle,
              background: "#fff",
            }}
          >
            <div style={pctStatLabelStyle}>Resets (avg/game)</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#222" }}>
              {fmtStat(report.stats.resetsAvg)}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 18,
            marginTop: 6,
          }}
        >
          <div style={chartCardStyle}>
            <BarChart
              title="Shots in % vs team shot %"
              data={[
                tieredBar("Shots in", report.stats.shotsInPct),
                // Team shot % isn't tiered — leave neutral.
                { label: "Team shot", value: report.stats.teamShotPct },
              ]}
            />
          </div>
          <div style={chartCardStyle}>
            <BarChart
              title="Kitchen arrival"
              data={[
                tieredBar("On serve", report.stats.kitchenOnServePct),
                tieredBar("On return", report.stats.kitchenOnReturnPct),
              ]}
            />
          </div>
          <div style={{ ...chartCardStyle, gridColumn: "1 / -1" }}>
            <BarChart
              title="Serve & return quality"
              data={[
                tieredBar("Serves in", report.stats.servesInPct),
                tieredBar("Serve deep", report.stats.serveDeepPct),
                tieredBar("Returns in", report.stats.returnsInPct),
                tieredBar("Return deep", report.stats.returnDeepPct),
              ]}
              width={640}
            />
          </div>
        </div>
      </Section>

      {/* Auto bullets */}
      {(report.wentWell.length > 0 || report.workOn.length > 0) && (
        <Section title="At a glance">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <BulletBlock
              title="What's working"
              accent="#1e7e34"
              bullets={report.wentWell}
            />
            <BulletBlock
              title="Work on"
              accent="#c62828"
              bullets={report.workOn}
              emptyLabel="Nothing flagged by the numbers right now."
            />
          </div>
        </Section>
      )}

      {/* Overall trend */}
      <Section title="Rating trend">
        <div style={chartCardStyle}>
          <TrendChart
            samples={report.trend}
            title={`Overall — last ${n} ${n === 1 ? "game" : "games"}`}
            width={900}
          />
        </div>
      </Section>

      {/* Per-game cards */}
      <Section title={`Last ${n} ${n === 1 ? "game" : "games"}`}>
        <div style={{ display: "grid", gap: 8, pageBreakBefore: "auto" }}>
          {report.perGame.map((p) => (
            <PerGameCard key={p.game.id} snap={p} />
          ))}
        </div>
      </Section>

      <footer style={footerStyle}>
        Rating report generated {new Date().toLocaleString()} ·{" "}
        {sessionLabel
          ? `session scope · ${n} ${n === 1 ? "game" : "games"}`
          : `rolling window = ${windowSize}`}{" "}
        · White Mountain Pickleball Club
      </footer>
    </div>
  );
}

// ─────────────────────────── Per-game card ───────────────────────────

function PerGameCard({
  snap,
}: {
  snap: PlayerRatingReport["perGame"][number];
}) {
  const { game, ratings, stats, wentWell, workOn } = snap;
  const label = game.session_name ?? game.pbvision_video_id;
  return (
    <div style={perGameCardStyle}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 6,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: "#222" }}>{label}</div>
        <span style={{ color: "#888", fontSize: 12 }}>
          {new Date(game.played_at).toLocaleDateString()}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "2px 8px",
            borderRadius: 3,
            letterSpacing: 0.3,
            background: "#eef3ff",
            color: "#1a73e8",
          }}
        >
          Overall {fmtRating(ratings.overall)}
        </span>
      </div>
      {/* Ratings strip */}
      <div style={ratingsStripStyle}>
        <RatingPill label="Serve" v={ratings.serve} />
        <RatingPill label="Return" v={ratings.return_} />
        <RatingPill label="Off" v={ratings.offense} />
        <RatingPill label="Def" v={ratings.defense} />
        <RatingPill label="Agil" v={ratings.agility} />
        <RatingPill label="Cons" v={ratings.consistency} />
      </div>
      {/* Stats strip — tier colors on the "bigger is better" stats so the
          per-game card mirrors the summary block's legend. */}
      <div style={statsStripStyle}>
        <TinyStat label="Shots in" v={stats.shotsInPct} unit="%" tiered />
        <TinyStat label="Serve in" v={stats.servesInPct} unit="%" tiered />
        <TinyStat label="Serve deep" v={stats.serveDeepPct} unit="%" tiered />
        <TinyStat label="Ret in" v={stats.returnsInPct} unit="%" tiered />
        <TinyStat label="Ret deep" v={stats.returnDeepPct} unit="%" tiered />
        <TinyStat label="3rd in" v={stats.thirdShotsInPct} unit="%" tiered />
        <TinyStat label="Team shot" v={stats.teamShotPct} unit="%" />
        <TinyStat label="Kitch serve" v={stats.kitchenOnServePct} unit="%" tiered />
        <TinyStat label="Kitch ret" v={stats.kitchenOnReturnPct} unit="%" tiered />
      </div>
      {(wentWell.length > 0 || workOn.length > 0) && (
        <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {wentWell.length > 0 && (
            <div style={{ fontSize: 11, color: "#1e7e34" }}>
              <b>Went well: </b>
              {wentWell.join("; ")}
            </div>
          )}
          {workOn.length > 0 && (
            <div style={{ fontSize: 11, color: "#c62828" }}>
              <b>Work on: </b>
              {workOn.join("; ")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Small bits ───────────────────────────

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section style={sectionStyle}>
      <h2 style={sectionHeadStyle}>{title}</h2>
      {children}
    </section>
  );
}

function SkillStat({
  label,
  value,
  trend,
  emphasis = false,
}: {
  label: string;
  value: number | null;
  trend: Array<number | null>;
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
      <div
        style={{
          fontSize: 9,
          textTransform: "uppercase",
          color: "#888",
          letterSpacing: 0.4,
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: emphasis ? 22 : 18,
          fontWeight: 700,
          color: emphasis ? "#1a73e8" : "#222",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {fmtRating(value)}
      </div>
      <Sparkline values={trend} width={80} height={20} />
    </div>
  );
}

function PctStat({
  label,
  value,
  tiered = true,
}: {
  label: string;
  value: number | null;
  /** Set false for stats where "bigger is better" doesn't apply — e.g.
   *  team shot %, where 50 is ideal and 100 is actually bad. */
  tiered?: boolean;
}) {
  const spec = tiered ? classifyPct(value) : null;
  return (
    <div
      style={{
        ...pctStatWrapStyle,
        background: spec ? spec.tint : "#fff",
        borderColor: spec ? `${spec.color}55` : "#e2e2e2",
      }}
    >
      <div style={pctStatLabelStyle}>{label}</div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginTop: 2,
        }}
      >
        <div
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: spec ? spec.color : "#222",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {fmtStat(value, "%")}
        </div>
        {spec && <TierBadge spec={spec} />}
      </div>
    </div>
  );
}

/** BarChart input with tier coloring applied — shared across the chart
 *  calls so one helper keeps the 4 charts visually aligned. */
function tieredBar(label: string, value: number | null) {
  const spec = classifyPct(value);
  return { label, value, color: spec?.color };
}

function TierBadge({ spec }: { spec: PerfTierSpec }) {
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        padding: "1px 6px",
        borderRadius: 3,
        background: spec.color,
        color: "#fff",
        textTransform: "uppercase",
        letterSpacing: 0.4,
        whiteSpace: "nowrap",
      }}
    >
      {spec.label}
    </span>
  );
}

function TierLegend() {
  const order: Array<keyof typeof PERF_TIERS> = ["needs_work", "ok", "good", "great"];
  const ranges: Record<string, string> = {
    needs_work: "< 60%",
    ok: "60–70%",
    good: "71–89%",
    great: "90–100%",
  };
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        flexWrap: "wrap",
        fontSize: 10,
        color: "#666",
      }}
    >
      {order.map((key) => {
        const spec = PERF_TIERS[key];
        return (
          <span
            key={key}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 6px",
              borderRadius: 3,
              background: spec.tint,
              border: `1px solid ${spec.color}33`,
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: spec.color,
              }}
            />
            <b style={{ color: spec.color }}>{spec.label}</b>
            <span>{ranges[key]}</span>
          </span>
        );
      })}
    </div>
  );
}

function RatingPill({ label, v }: { label: string; v: number | null }) {
  return (
    <div style={ratingPillStyle}>
      <span style={{ color: "#888", fontSize: 10, letterSpacing: 0.3 }}>{label}</span>
      <span style={{ color: "#222", fontSize: 12, fontWeight: 700 }}>{fmtRating(v)}</span>
    </div>
  );
}

function TinyStat({
  label,
  v,
  unit = "",
  tiered = false,
}: {
  label: string;
  v: number | null;
  unit?: string;
  tiered?: boolean;
}) {
  const spec = tiered && unit === "%" ? classifyPct(v) : null;
  return (
    <div
      style={{
        ...tinyStatStyle,
        background: spec ? spec.tint : "#f7f7f7",
      }}
    >
      <span style={{ color: "#888", fontSize: 9, letterSpacing: 0.3 }}>{label}</span>
      <span
        style={{
          color: spec ? spec.color : "#222",
          fontSize: 11,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {fmtStat(v, unit)}
      </span>
    </div>
  );
}

function BulletBlock({
  title,
  accent,
  bullets,
  emptyLabel,
}: {
  title: string;
  accent: string;
  bullets: string[];
  emptyLabel?: string;
}) {
  return (
    <div
      style={{
        border: `1px solid ${accent}33`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 6,
        padding: "10px 12px",
        background: "#fff",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: accent,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      {bullets.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 18, color: "#333", fontSize: 13, lineHeight: 1.5 }}>
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      ) : (
        <div style={{ fontSize: 12, color: "#888", fontStyle: "italic" }}>
          {emptyLabel ?? "Nothing to call out."}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── Styles ───────────────────────────

const rootStyle: React.CSSProperties = {
  maxWidth: 1000,
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

const headerStyle: React.CSSProperties = {
  padding: "10px 0 14px",
  borderBottom: "2px solid #1a73e8",
  marginBottom: 12,
};

const explainerStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#666",
  marginBottom: 18,
  lineHeight: 1.5,
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

const pctStatWrapStyle: React.CSSProperties = {
  border: "1px solid #e2e2e2",
  borderRadius: 6,
  padding: "8px 10px",
  background: "#fff",
};

const pctStatLabelStyle: React.CSSProperties = {
  fontSize: 9,
  textTransform: "uppercase",
  color: "#888",
  letterSpacing: 0.4,
  fontWeight: 700,
};

const chartCardStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e2e2",
  borderRadius: 6,
  padding: 10,
  pageBreakInside: "avoid",
};

const perGameCardStyle: React.CSSProperties = {
  border: "1px solid #e2e2e2",
  borderRadius: 6,
  padding: "10px 12px",
  background: "#fff",
  pageBreakInside: "avoid",
};

const ratingsStripStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(6, 1fr)",
  gap: 4,
  marginBottom: 4,
};

const ratingPillStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "3px 8px",
  border: "1px solid #eee",
  borderRadius: 3,
  background: "#fafafa",
};

const statsStripStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(9, 1fr)",
  gap: 3,
};

const tinyStatStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "3px 6px",
  borderRadius: 3,
  background: "#f7f7f7",
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
        @page { size: letter; margin: 0.4in; }
        body { background: #fff !important; }
        .prr-noprint { display: none !important; }
        .prr-root { max-width: none !important; padding: 0 !important; }
        section { page-break-inside: avoid; }
        a { color: inherit !important; text-decoration: none !important; }
      }
    `}</style>
  );
}
