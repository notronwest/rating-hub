import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "../supabase";
import type { Game, GamePlayer, GamePlayerShotType, GamePlayerCourtZone } from "../types/database";
import { computeHighlights, GameHighlightsFull, type GameHighlightData } from "../components/GameHighlights";
import { useIsCoach } from "../auth/useOrgRole";
import { getAnalysisByGameId } from "../lib/coachApi";
import type { GameAnalysis } from "../types/coach";

interface PlayerCard {
  gp: GamePlayer;
  name: string;
  slug: string;
  shotTypes: GamePlayerShotType[];
  courtZones: GamePlayerCourtZone[];
}

export default function GameDetailPage() {
  const { orgId, gameId } = useParams();
  const [searchParams] = useSearchParams();
  const fromPlayer = searchParams.get("from") === "player";
  const [game, setGame] = useState<Game | null>(null);
  const [playerCards, setPlayerCards] = useState<PlayerCard[]>([]);
  const [rallies, setRallies] = useState<{ shot_count: number | null }[]>([]);
  const [allShotTypes, setAllShotTypes] = useState<GamePlayerShotType[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const isCoach = useIsCoach(orgId);

  useEffect(() => {
    if (!gameId) return;
    getAnalysisByGameId(gameId).then(setAnalysis).catch(() => setAnalysis(null));
  }, [gameId]);

  useEffect(() => {
    if (!gameId) return;

    (async () => {
      // Fetch game
      const { data: g } = await supabase
        .from("games")
        .select("*")
        .eq("id", gameId)
        .single();
      if (!g) { setLoading(false); return; }
      setGame(g);

      // Fetch game_players
      const { data: gps } = await supabase
        .from("game_players")
        .select("*")
        .eq("game_id", gameId)
        .order("player_index");

      if (!gps) { setLoading(false); return; }

      // Fetch player names
      const playerIds = gps.map((gp) => gp.player_id);
      const { data: players } = await supabase
        .from("players")
        .select("id, display_name, slug")
        .in("id", playerIds);

      const playerMap = new Map(
        (players ?? []).map((p) => [p.id, { name: p.display_name, slug: p.slug }]),
      );

      // Fetch shot types, court zones, and rallies
      const [stRes, czRes, rallyRes] = await Promise.all([
        supabase.from("game_player_shot_types").select("*").eq("game_id", gameId),
        supabase.from("game_player_court_zones").select("*").eq("game_id", gameId),
        supabase.from("rallies").select("shot_count").eq("game_id", gameId),
      ]);

      const shotTypes = stRes.data;
      const courtZones = czRes.data;
      setRallies(rallyRes.data ?? []);
      setAllShotTypes(shotTypes ?? []);

      const cards: PlayerCard[] = gps.map((gp) => ({
        gp,
        name: playerMap.get(gp.player_id)?.name ?? "Unknown",
        slug: playerMap.get(gp.player_id)?.slug ?? "",
        shotTypes: (shotTypes ?? []).filter((st) => st.player_id === gp.player_id),
        courtZones: (courtZones ?? []).filter((cz) => cz.player_id === gp.player_id),
      }));

      setPlayerCards(cards);
      setLoading(false);
    })();
  }, [gameId]);

  // Compute highlights (hooks must be called before early returns)
  const highlightData: GameHighlightData = useMemo(() => {
    if (!game) return { gameId: "", gameName: "", rallies: [], players: [], shotTypes: [] };
    return {
      gameId: game.id,
      gameName: game.session_name || game.pbvision_video_id,
      rallies,
      players: playerCards.map((c) => ({
        playerName: c.name,
        shotCount: c.gp.shot_count,
        shotAccuracy: c.gp.shot_accuracy as { in?: number; net?: number; out?: number } | null,
      })),
      shotTypes: allShotTypes,
    };
  }, [game, rallies, playerCards, allShotTypes]);

  const highlights = useMemo(() => computeHighlights(highlightData), [highlightData]);

  if (loading) return <p>Loading…</p>;
  if (!game) return <p>Game not found.</p>;

  // Group players by team
  const team0 = playerCards.filter((c) => c.gp.team === 0);
  const team1 = playerCards.filter((c) => c.gp.team === 1);

  return (
    <div>
      {/* Back link (only when not in player context — breadcrumb handles that) */}
      {!fromPlayer && game.session_id && (
        <Link
          to={`/org/${orgId}/sessions/${game.session_id}`}
          style={{ fontSize: 13, color: "#888", textDecoration: "none" }}
        >
          &larr; Back to session
        </Link>
      )}

      {/* Game header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          marginTop: game.session_id ? 8 : 0,
          marginBottom: 4,
        }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0, flex: 1 }}>
          {game.session_name || game.pbvision_video_id}
          {analysis && (
            <span
              style={{
                marginLeft: 10,
                fontSize: 11,
                padding: "3px 8px",
                background: "#e8f0fe",
                color: "#1a73e8",
                borderRadius: 4,
                fontWeight: 600,
                letterSpacing: 0.3,
                verticalAlign: "middle",
              }}
              title="This game has been analyzed by a coach"
            >
              ✓ COACH ANALYZED
            </span>
          )}
        </h2>
        {isCoach && (
          <Link
            to={`/org/${orgId}/games/${gameId}/analyze`}
            style={{
              padding: "8px 14px",
              fontSize: 13,
              fontWeight: 600,
              background: "#1a73e8",
              color: "#fff",
              textDecoration: "none",
              borderRadius: 6,
            }}
          >
            {analysis ? "Continue analysis" : "Analyze"} →
          </Link>
        )}
      </div>
      <div style={{ display: "flex", gap: 20, fontSize: 14, color: "#666", marginBottom: 24 }}>
        {game.played_at && <span>{new Date(game.played_at).toLocaleDateString()}</span>}
        {game.team0_score != null && game.team1_score != null && (
          <span style={{ fontWeight: 600, color: "#333", fontSize: 18 }}>
            {game.team0_score} – {game.team1_score}
          </span>
        )}
        {game.scoring_type && <span>{game.scoring_type}</span>}
        {game.total_rallies && <span>{game.total_rallies} rallies</span>}
      </div>

      {/* Highlights */}
      {highlights.length > 0 && <GameHighlightsFull highlights={highlights} />}

      {/* Teams */}
      {[team0, team1].map((team, teamIdx) => (
        <div key={teamIdx} style={{ marginBottom: 32 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
            Team {teamIdx + 1}
            {game.winning_team === teamIdx && (
              <span style={{ marginLeft: 8, color: "#1e7e34", fontSize: 12, fontWeight: 600 }}>
                WINNER
              </span>
            )}
          </h3>

          {team.map((card) => (
            <PlayerGameCard
              key={card.gp.id}
              card={card}
              orgId={orgId ?? ""}
              isExpanded={expanded === card.gp.id}
              onToggle={() => setExpanded(expanded === card.gp.id ? null : card.gp.id)}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player card within a game
// ---------------------------------------------------------------------------

function PlayerGameCard({
  card,
  orgId,
  isExpanded,
  onToggle,
}: {
  card: PlayerCard;
  orgId: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const { gp } = card;

  const ratingPairs = [
    ["Overall", gp.rating_overall],
    ["Serve", gp.rating_serve],
    ["Return", gp.rating_return],
    ["Offense", gp.rating_offense],
    ["Defense", gp.rating_defense],
    ["Agility", gp.rating_agility],
    ["Consistency", gp.rating_consistency],
  ] as const;

  return (
    <div
      style={{
        border: "1px solid #e2e2e2",
        borderRadius: 10,
        marginBottom: 12,
        overflow: "hidden",
      }}
    >
      {/* Summary row */}
      <div
        onClick={onToggle}
        style={{
          padding: "14px 16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
          background: isExpanded ? "#f8f9fa" : "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            to={`/org/${orgId}/players/${card.slug}`}
            onClick={(e) => e.stopPropagation()}
            style={{ fontWeight: 600, fontSize: 15, color: "#1a73e8", textDecoration: "none" }}
          >
            {card.name}
          </Link>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
              background: gp.won ? "#e6f4ea" : "#fce8e6",
              color: gp.won ? "#1e7e34" : "#c62828",
            }}
          >
            {gp.won ? "W" : "L"}
          </span>
        </div>

        <div style={{ display: "flex", gap: 20, fontSize: 13, color: "#666", alignItems: "center" }}>
          <span>Rating: <b style={{ color: "#333" }}>{gp.rating_overall?.toFixed(2) ?? "—"}</b></span>
          <span>{gp.shot_count ?? 0} shots</span>
          <span style={{ fontSize: 16, color: "#ccc" }}>{isExpanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div style={{ padding: "0 16px 16px", borderTop: "1px solid #eee" }}>
          {/* Ratings grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 8, margin: "14px 0" }}>
            {ratingPairs.map(([label, val]) => (
              <div key={label} style={{ padding: "8px 10px", background: "#f8f9fa", borderRadius: 6, textAlign: "center" }}>
                <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase" }}>{label}</div>
                <div style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>{val?.toFixed(2) ?? "—"}</div>
              </div>
            ))}
          </div>

          {/* Shot quality / selection / accuracy */}
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 16 }}>
            {gp.shot_quality && <StatBlock title="Shot Quality" data={gp.shot_quality as unknown as Record<string, number>} pct />}
            {gp.shot_selection && <StatBlock title="Shot Selection" data={gp.shot_selection as unknown as Record<string, number>} pct />}
            {gp.shot_accuracy && <StatBlock title="Shot Accuracy" data={gp.shot_accuracy as unknown as Record<string, number>} pct />}
          </div>

          {/* Shot type breakdowns */}
          {card.shotTypes.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: "#666", marginBottom: 8 }}>Shot Type Breakdowns</h4>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {["Type", "Count", "Quality", "Success %", "Rally Won %", "Avg Speed"].map((h) => (
                      <th key={h} style={{ padding: "6px 8px", textAlign: h === "Type" ? "left" : "right", fontSize: 11, color: "#999", borderBottom: "1px solid #eee" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {card.shotTypes
                    .filter((st) => (st.count ?? 0) > 0)
                    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
                    .map((st) => {
                      const os = st.outcome_stats as Record<string, number> | null;
                      const ss = st.speed_stats as Record<string, number> | null;
                      return (
                        <tr key={st.shot_type}>
                          <td style={{ padding: "6px 8px", borderBottom: "1px solid #f5f5f5", textTransform: "capitalize" }}>
                            {st.shot_type.replace(/_/g, " ")}
                          </td>
                          <td style={{ padding: "6px 8px", borderBottom: "1px solid #f5f5f5", textAlign: "right" }}>{st.count}</td>
                          <td style={{ padding: "6px 8px", borderBottom: "1px solid #f5f5f5", textAlign: "right" }}>{st.average_quality?.toFixed(2) ?? "—"}</td>
                          <td style={{ padding: "6px 8px", borderBottom: "1px solid #f5f5f5", textAlign: "right" }}>
                            {os?.success_percentage != null ? `${os.success_percentage.toFixed(0)}%` : "—"}
                          </td>
                          <td style={{ padding: "6px 8px", borderBottom: "1px solid #f5f5f5", textAlign: "right" }}>
                            {os?.rally_won_percentage != null ? `${os.rally_won_percentage.toFixed(0)}%` : "—"}
                          </td>
                          <td style={{ padding: "6px 8px", borderBottom: "1px solid #f5f5f5", textAlign: "right" }}>
                            {ss?.average != null ? `${ss.average.toFixed(1)} mph` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          {/* Court zones */}
          {card.courtZones.length > 0 && (
            <div>
              <h4 style={{ fontSize: 13, fontWeight: 600, color: "#666", marginBottom: 8 }}>Court Zones</h4>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {["Zone", "Count", "Quality", "Success %"].map((h) => (
                      <th key={h} style={{ padding: "6px 8px", textAlign: h === "Zone" ? "left" : "right", fontSize: 11, color: "#999", borderBottom: "1px solid #eee" }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {card.courtZones
                    .filter((cz) => (cz.count ?? 0) > 0)
                    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
                    .map((cz) => {
                      const os = cz.outcome_stats as Record<string, number> | null;
                      return (
                        <tr key={cz.zone}>
                          <td style={{ padding: "6px 8px", borderBottom: "1px solid #f5f5f5", textTransform: "capitalize" }}>
                            {cz.zone.replace(/_/g, " ")}
                          </td>
                          <td style={{ padding: "6px 8px", borderBottom: "1px solid #f5f5f5", textAlign: "right" }}>{cz.count}</td>
                          <td style={{ padding: "6px 8px", borderBottom: "1px solid #f5f5f5", textAlign: "right" }}>{cz.average_quality?.toFixed(2) ?? "—"}</td>
                          <td style={{ padding: "6px 8px", borderBottom: "1px solid #f5f5f5", textAlign: "right" }}>
                            {os?.success_percentage != null ? `${os.success_percentage.toFixed(0)}%` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          {/* Extra stats */}
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 14, fontSize: 13, color: "#666" }}>
            {gp.distance_covered != null && <span>Distance: {gp.distance_covered.toFixed(0)} ft</span>}
            {gp.num_rallies != null && <span>Rallies: {gp.num_rallies_won ?? 0}/{gp.num_rallies} won</span>}
            {gp.volley_count != null && <span>Volleys: {gp.volley_count}</span>}
            {gp.ground_stroke_count != null && <span>Ground strokes: {gp.ground_stroke_count}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small stat block (shot quality, shot selection, etc.)
// ---------------------------------------------------------------------------

function StatBlock({ title, data, pct }: { title: string; data: Record<string, number>; pct?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#888", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>{title}</div>
      {Object.entries(data).map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 16, fontSize: 13, padding: "2px 0" }}>
          <span style={{ textTransform: "capitalize", color: "#555" }}>{k}</span>
          <span style={{ fontWeight: 500 }}>{pct ? `${(v * 100).toFixed(0)}%` : v.toFixed(2)}</span>
        </div>
      ))}
    </div>
  );
}
