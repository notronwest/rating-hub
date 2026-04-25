/**
 * PlayerRatingReportEmbed — self-contained "last N games" rating report
 * rendered inline on the player profile page.
 *
 * Reuses the same `PlayerRatingReportBody` component the standalone
 * /rating-report page uses, with its own slim data loader so the player
 * profile page can mount it without duplicating fetch logic.
 *
 * No toolbar here — just the report body. Callers that want print / PDF
 * affordances should link out to the full /rating-report route.
 */

import { useEffect, useState } from "react";
import { supabase } from "../../supabase";
import type {
  GamePlayer,
  GamePlayerCourtZone,
  GamePlayerShotType,
} from "../../types/database";
import {
  buildPlayerRatingReport,
  type GameRowForReport,
  type PlayerRatingReport,
} from "../../lib/playerRatingReport";
import {
  PlayerRatingReportBody,
  type PlayerRow,
} from "../../pages/PlayerRatingReportPage";

interface GameLite {
  id: string;
  played_at: string;
  session_name: string | null;
  pbvision_video_id: string;
}

interface Props {
  playerId: string;
  /** Number of most-recent games to include. Defaults to 6 to match the
   *  PDF the club has historically distributed. */
  windowSize?: number;
  /** Replace the default "Skill ratings" sparkline row. Profile page
   *  uses this to show color-coded cards tied to the RatingsOverTime
   *  palette. */
  skillRatingsSlot?: React.ReactNode;
  /** Extra content between Skill Ratings and Key Stats. Profile page
   *  uses this slot for Ratings Over Time / donuts / Serve Speed. */
  afterSkillRatingsSlot?: React.ReactNode;
}

export default function PlayerRatingReportEmbed({
  playerId,
  windowSize = 6,
  skillRatingsSlot,
  afterSkillRatingsSlot,
}: Props) {
  const [player, setPlayer] = useState<PlayerRow | null>(null);
  const [report, setReport] = useState<PlayerRatingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        // Player
        const { data: p } = await supabase
          .from("players")
          .select("id, display_name, slug, avatar_url, email")
          .eq("id", playerId)
          .single();
        if (!p) {
          if (!cancelled) setErr("Player not found.");
          return;
        }
        if (!cancelled) setPlayer(p as PlayerRow);

        // Last-N game_players rows via inner-join on games, most recent first.
        const { data: joined } = await supabase
          .from("game_players")
          .select(
            "*, games!inner(id, played_at, session_name, pbvision_video_id)",
          )
          .eq("player_id", playerId);
        const gpList = ((joined ?? []) as unknown as Array<
          GamePlayer & { games: GameLite }
        >);
        const gameRows: GameLite[] = gpList.map((r) => ({
          id: r.games.id,
          played_at: r.games.played_at,
          session_name: r.games.session_name,
          pbvision_video_id: r.games.pbvision_video_id,
        }));
        // Composite sort: date (DESC) primary, `gm-N` index (DESC)
        // secondary. PB Vision's per-game timestamps can drift within
        // a session — we've seen sequences like "Game 6, 7, 2, 5"
        // when sorting by timestamp alone. Using the YYYY-MM-DD date
        // for cross-session ordering and the gm-index within a day
        // keeps the sequence honest. CLAUDE.md documents this rule
        // for the whole codebase.
        gameRows.sort((a, b) => gameSortKey(b).localeCompare(gameSortKey(a)));
        const recent = gameRows.slice(0, windowSize);
        if (recent.length === 0) {
          if (!cancelled) {
            setReport(null);
            setLoading(false);
          }
          return;
        }
        const recentIds = recent.map((g) => g.id);

        // Shot types + court zones + everyone who played in those games.
        // The last one lets us label each per-game card with "your
        // partner" and "your opponents".
        const [stRes, czRes, rosterRes] = await Promise.all([
          supabase
            .from("game_player_shot_types")
            .select("*")
            .in("game_id", recentIds)
            .eq("player_id", playerId),
          supabase
            .from("game_player_court_zones")
            .select("*")
            .in("game_id", recentIds)
            .eq("player_id", playerId),
          supabase
            .from("game_players")
            .select("game_id, player_id, team, players!inner(display_name)")
            .in("game_id", recentIds),
        ]);
        const stRows = (stRes.data ?? []) as GamePlayerShotType[];
        const czRows = (czRes.data ?? []) as GamePlayerCourtZone[];
        // Shape: { game_id, player_id, team, players: { display_name } }
        const rosterRows = (rosterRes.data ?? []) as Array<{
          game_id: string;
          player_id: string;
          team: number;
          players: { display_name: string };
        }>;

        const rows: GameRowForReport[] = recent.map((g) => {
          // The joined row carries both the GamePlayer columns and a
          // nested `games` object — GameRowForReport wants them flat.
          const gpRow = gpList.find((x) => x.games.id === g.id)!;

          // Partner = same team, different player. Opponents = other team.
          const myTeam = gpRow.team;
          const teammates = rosterRows.filter((r) => r.game_id === g.id);
          const partnerName =
            teammates.find(
              (r) => r.player_id !== playerId && r.team === myTeam,
            )?.players.display_name ?? null;
          const opponentNames = teammates
            .filter((r) => r.team !== myTeam)
            .map((r) => r.players.display_name);

          return {
            id: g.id,
            played_at: g.played_at,
            session_name: g.session_name,
            pbvision_video_id: g.pbvision_video_id,
            gp: gpRow,
            shotTypes: stRows.filter((s) => s.game_id === g.id),
            courtZones: czRows.filter((c) => c.game_id === g.id),
            partnerName,
            opponentNames,
          };
        });

        const built = buildPlayerRatingReport(rows);
        if (!cancelled) {
          setReport(built);
        }
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerId, windowSize]);

  if (loading) {
    return (
      <div style={{ padding: "20px 24px", color: "#888", fontSize: 13 }}>
        Loading rating report…
      </div>
    );
  }
  if (err) {
    return (
      <div style={{ padding: "20px 24px", color: "#c62828", fontSize: 13 }}>
        {err}
      </div>
    );
  }
  if (!player || !report || report.perGame.length === 0) {
    return (
      <div
        style={{
          padding: "20px 24px",
          color: "#888",
          fontSize: 13,
          fontStyle: "italic",
        }}
      >
        No games to summarize yet — play a session to generate a rating report.
      </div>
    );
  }

  return (
    <PlayerRatingReportBody
      player={player}
      report={report}
      windowSize={windowSize}
      sessionLabel={null}
      skillRatingsSlot={skillRatingsSlot}
      afterSkillRatingsSlot={afterSkillRatingsSlot}
    />
  );
}

function parseGameIdx(name: string | null | undefined): number | null {
  if (!name) return null;
  // Two formats coexist: raw PBV "gm-N" and pre-prettied "Game 06".
  const gm = name.match(/gm-(\d+)/i);
  if (gm) return parseInt(gm[1], 10);
  const game = name.match(/\bGame\s+0*(\d+)/i);
  if (game) return parseInt(game[1], 10);
  return null;
}

/** Composite sort key used for ordering games across + within sessions.
 *  Lexically sortable (date is YYYY-MM-DD, idx is zero-padded). */
function gameSortKey(g: { played_at: string; session_name: string | null }): string {
  const date = (g.played_at ?? "").slice(0, 10); // YYYY-MM-DD
  const idx = parseGameIdx(g.session_name) ?? 0;
  return `${date}|${String(idx).padStart(4, "0")}`;
}
