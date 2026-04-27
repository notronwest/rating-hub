/**
 * Generic "Shot Contact Locations" panel. Renders a court map + per-team /
 * per-player breakdown sidebars. Matches PB Vision's own Patterns view for
 * the 3rd Shot, 4th Shot, Serve, Return, and similar single-shot-type views.
 *
 * The panel is intentionally generic — it takes a predicate that picks which
 * shots to include (e.g. "3rd shot of the rally") so the same component
 * drives every card on the toolbar.
 */

import { useMemo, useState } from "react";
import Court3DMap, { shotToDot3D, type CourtDot3D, type ShotArc } from "./Court3DMap";
import type { RallyShot } from "../../types/database";

interface PlayerLite {
  id: string;
  player_index: number;
  display_name: string;
  team: number;
  avatar_url: string | null;
}

interface RallyLite {
  id: string;
  rally_index: number;
  winning_team: number | null;
}

export interface ShotLocationsPanelProps {
  /** Human-readable title, e.g. "3rd Shot Contact Locations". */
  title: string;
  shots: RallyShot[];
  rallies: RallyLite[];
  players: PlayerLite[];
  /** Predicate to select which shots to display. */
  shotFilter: (shot: RallyShot, rally: RallyLite) => boolean;
  /** Optional shot-type sub-filter (e.g. "Drive" / "Drop"). Rendered as chips. */
  subTypes?: Array<{ label: string; match: (shot: RallyShot) => boolean }>;
  /** If set, the panel opens pre-filtered to this player. The coach can still
   *  toggle back to team/all by clicking the selection. */
  defaultPlayerIdx?: number | null;
  /** Render Deep / Mid / Short depth bands on the court. Coaches use this
   *  to read serve and return placement at a glance — only meaningful for
   *  shots that target the opposing service court. */
  showDepthBands?: boolean;
  onClose: () => void;
}

const TEAM_COLORS = ["#1a73e8", "#4caf50"] as const;

export default function ShotLocationsPanel({
  title,
  shots,
  rallies,
  players,
  shotFilter,
  subTypes,
  defaultPlayerIdx = null,
  showDepthBands = false,
  onClose,
}: ShotLocationsPanelProps) {
  const rallyById = useMemo(
    () => new Map(rallies.map((r) => [r.id, r])),
    [rallies],
  );
  const playerByIndex = useMemo(
    () => new Map(players.map((p) => [p.player_index, p])),
    [players],
  );

  // UI state
  const [subType, setSubType] = useState<string>("All");
  // Default team selection follows the default player (if provided) so the
  // matching TeamStatCard renders in its selected/highlighted state.
  const defaultTeam: 0 | 1 | null = useMemo(() => {
    if (defaultPlayerIdx == null) return null;
    const p = players.find((pp) => pp.player_index === defaultPlayerIdx);
    return p ? (p.team as 0 | 1) : null;
  }, [defaultPlayerIdx, players]);
  const [selectedTeam, setSelectedTeam] = useState<0 | 1 | null>(defaultTeam);
  const [selectedPlayerIdx, setSelectedPlayerIdx] = useState<number | null>(
    defaultPlayerIdx,
  );
  const [hover, setHover] = useState<CourtDot | null>(null);

  // 1) Apply the primary predicate (e.g. 3rd-shot-of-rally)
  const baseShots = useMemo(
    () =>
      shots.filter((s) => {
        const rally = rallyById.get(s.rally_id);
        if (!rally) return false;
        return shotFilter(s, rally);
      }),
    [shots, rallyById, shotFilter],
  );

  // 2) Apply subType chip
  const typedShots = useMemo(() => {
    if (subType === "All" || !subTypes) return baseShots;
    const st = subTypes.find((x) => x.label === subType);
    if (!st) return baseShots;
    return baseShots.filter((s) => st.match(s));
  }, [baseShots, subType, subTypes]);

  // 3) Apply team/player selection
  const filteredShots = useMemo(() => {
    return typedShots.filter((s) => {
      const player = s.player_index != null
        ? playerByIndex.get(s.player_index)
        : null;
      if (!player) return false;
      if (selectedTeam != null && player.team !== selectedTeam) return false;
      if (selectedPlayerIdx != null && player.player_index !== selectedPlayerIdx) {
        return false;
      }
      return true;
    });
  }, [typedShots, playerByIndex, selectedTeam, selectedPlayerIdx]);

  // Bezier arcs — contact → peak → landing for each visible shot. The 3D
  // court map traces the actual flight path rather than a straight line.
  const arcs = useMemo(() => {
    const m = new Map<string, ShotArc>();
    for (const s of filteredShots) {
      if (s.contact_x == null || s.contact_y == null) continue;
      m.set(s.id, {
        contact: {
          x: s.contact_x,
          y: s.contact_y,
          z: s.contact_z ?? 0,
        },
        peak: s.trajectory?.peak
          ? {
              x: s.trajectory.peak.x,
              y: s.trajectory.peak.y,
              z: s.trajectory.peak.z,
            }
          : undefined,
      });
    }
    return m;
  }, [filteredShots]);

  // Build dots — positioned at the landing point, colored by whether the
  // shot itself was "in" (not a fault) vs a fault. Winning/losing the rally
  // is not used for color here — coaches want placement signal, not
  // outcome signal.
  const dots: CourtDot3D[] = useMemo(() => {
    const out: CourtDot3D[] = [];
    for (const s of filteredShots) {
      const player = s.player_index != null ? playerByIndex.get(s.player_index) : null;
      if (!player) continue;
      const d = shotToDot3D({
        id: s.id,
        land_x: s.land_x,
        land_y: s.land_y,
        land_z: s.land_z,
        contact_x: s.contact_x,
        contact_y: s.contact_y,
        team: player.team as 0 | 1,
        // Coach-facing coloring: a shot with PBV-detected errors (fault /
        // out) reads as "miss" (won=false → red); otherwise "in" (won=true
        // → green). This ignores who won the rally.
        won:
          s.shot_errors && Object.keys(s.shot_errors).length > 0
            ? false
            : true,
        is_final: s.is_final,
        shot_errors: s.shot_errors,
      });
      if (d) out.push(d);
    }
    return out;
  }, [filteredShots, playerByIndex]);

  // Per-team summary stats
  const stats = useMemo(() => {
    const byTeam: Record<0 | 1, { total: number; won: number; lost: number; perPlayer: Map<number, { total: number; won: number; lost: number }> }> = {
      0: { total: 0, won: 0, lost: 0, perPlayer: new Map() },
      1: { total: 0, won: 0, lost: 0, perPlayer: new Map() },
    };
    for (const s of typedShots) {
      const player = s.player_index != null ? playerByIndex.get(s.player_index) : null;
      if (!player) continue;
      const team = player.team as 0 | 1;
      const rally = rallyById.get(s.rally_id);
      const won = rally?.winning_team === team;
      const t = byTeam[team];
      t.total++;
      if (won) t.won++;
      else t.lost++;
      let pp = t.perPlayer.get(player.player_index);
      if (!pp) {
        pp = { total: 0, won: 0, lost: 0 };
        t.perPlayer.set(player.player_index, pp);
      }
      pp.total++;
      if (won) pp.won++;
      else pp.lost++;
    }
    return byTeam;
  }, [typedShots, playerByIndex, rallyById]);

  const hoverShot = hover ? shots.find((s) => s.id === hover.id) ?? null : null;
  const hoverPlayer = hoverShot?.player_index != null
    ? playerByIndex.get(hoverShot.player_index) ?? null
    : null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.55)",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 12,
          padding: 20,
          width: "100%",
          maxWidth: 1200,
          maxHeight: "100%",
          overflow: "auto",
          display: "grid",
          gridTemplateColumns: "220px 1fr 240px",
          gap: 18,
          position: "relative",
        }}
      >
        {/* Title bar spans full width */}
        <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "baseline", gap: 14 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{title}</h2>
          <span style={{ fontSize: 12, color: "#666" }}>
            <span style={{ color: TEAM_COLORS[0], fontWeight: 600 }}>
              Team 0 (far)
            </span>
            : {stats[0].total} ·{" "}
            <span style={{ color: TEAM_COLORS[1], fontWeight: 600 }}>
              Team 1 (near)
            </span>
            : {stats[1].total}
          </span>
          <span style={{ flex: 1 }} />
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              fontSize: 20,
              color: "#888",
              cursor: "pointer",
              padding: "0 4px",
            }}
          >
            ×
          </button>
        </div>

        {/* Left column — team stats + player filter */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <TeamStatCard
            team={0}
            stats={stats[0]}
            players={players.filter((p) => p.team === 0)}
            selectedPlayerIdx={selectedPlayerIdx}
            onSelectTeam={(teamNull) => {
              setSelectedTeam(teamNull);
              setSelectedPlayerIdx(null);
            }}
            onSelectPlayer={setSelectedPlayerIdx}
            selectedTeam={selectedTeam}
          />
          <TeamStatCard
            team={1}
            stats={stats[1]}
            players={players.filter((p) => p.team === 1)}
            selectedPlayerIdx={selectedPlayerIdx}
            onSelectTeam={(teamNull) => {
              setSelectedTeam(teamNull);
              setSelectedPlayerIdx(null);
            }}
            onSelectPlayer={setSelectedPlayerIdx}
            selectedTeam={selectedTeam}
          />
        </div>

        {/* Middle column — subtype chips + court */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          {subTypes && subTypes.length > 0 && (
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#666", marginRight: 4 }}>
                Shot type
              </span>
              {(["All" as const, ...subTypes.map((x) => x.label)]).map((lbl) => (
                <button
                  key={lbl}
                  onClick={() => setSubType(lbl)}
                  style={{
                    padding: "4px 12px",
                    fontSize: 12,
                    fontWeight: subType === lbl ? 700 : 500,
                    background: subType === lbl ? "#1a73e8" : "#fff",
                    color: subType === lbl ? "#fff" : "#555",
                    border: "1px solid #ddd",
                    borderRadius: 16,
                    cursor: "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {lbl}
                </button>
              ))}
            </div>
          )}

          <Court3DMap
            dots={dots}
            arcs={arcs}
            onDotHover={setHover}
            activeDotId={hover?.id ?? null}
            width={540}
            showDepthBands={showDepthBands}
          />
          <div style={{ fontSize: 11, color: "#888" }}>
            Showing {dots.length} of {baseShots.length} shots
            {selectedPlayerIdx != null || selectedTeam != null
              ? " (filtered)"
              : ""}
          </div>
        </div>

        {/* Right column — legend + hover preview */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Legend</div>
            <LegendRow color="#4caf50" label="In (shot was good)" hollow={false} />
            <LegendRow color="#ef4444" label="Out / fault" hollow={false} />
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: "#444",
                marginTop: 4,
              }}
            >
              <span style={{ color: "#111", fontWeight: 700, fontSize: 14, lineHeight: 1 }}>×</span>
              <span>Rally-ending fault</span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                color: "#444",
                marginTop: 4,
                fontStyle: "italic",
              }}
            >
              <span>Arcs trace contact → peak → landing</span>
            </div>
          </div>

          <div
            style={{
              border: "1px solid #eee",
              borderRadius: 8,
              padding: 10,
              minHeight: 120,
              fontSize: 12,
              color: "#555",
            }}
          >
            {hover && hoverShot ? (
              <div>
                <div style={{ fontWeight: 700, color: "#333", marginBottom: 4 }}>
                  {hoverPlayer?.display_name ?? `Player ${hoverShot.player_index}`}
                </div>
                <div style={{ color: TEAM_COLORS[(hoverPlayer?.team ?? 0) as 0 | 1] }}>
                  Team {hoverPlayer?.team ?? "?"}
                </div>
                <div style={{ marginTop: 4 }}>
                  Type: <b>{hoverShot.shot_type ?? "shot"}</b>
                </div>
                {hoverShot.speed_mph != null && (
                  <div>Speed: {hoverShot.speed_mph.toFixed(1)} mph</div>
                )}
                {hoverShot.height_over_net != null && (
                  <div>Net clearance: {hoverShot.height_over_net.toFixed(1)} ft</div>
                )}
                {hoverShot.ball_direction && (
                  <div>Direction: {hoverShot.ball_direction}</div>
                )}
                {hoverShot.quality != null && (
                  <div>Quality: {(hoverShot.quality * 100).toFixed(0)}%</div>
                )}
              </div>
            ) : (
              <span style={{ fontStyle: "italic", color: "#999" }}>
                Hover a dot for details.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamStatCard({
  team,
  stats,
  players,
  selectedTeam,
  selectedPlayerIdx,
  onSelectTeam,
  onSelectPlayer,
}: {
  team: 0 | 1;
  stats: {
    total: number;
    won: number;
    lost: number;
    perPlayer: Map<number, { total: number; won: number; lost: number }>;
  };
  players: PlayerLite[];
  selectedTeam: 0 | 1 | null;
  selectedPlayerIdx: number | null;
  onSelectTeam: (t: 0 | 1 | null) => void;
  onSelectPlayer: (idx: number | null) => void;
}) {
  const color = TEAM_COLORS[team];
  const isTeamSelected = selectedTeam === team;
  return (
    <div
      style={{
        border: `1px solid ${isTeamSelected ? color : "#e2e2e2"}`,
        borderRadius: 8,
        padding: 10,
        background: isTeamSelected ? `${color}08` : "#fff",
      }}
    >
      <button
        onClick={() => onSelectTeam(isTeamSelected ? null : team)}
        style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          padding: 0,
        }}
      >
        <div style={{ color, fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
          Team {team}
        </div>
        <div style={{ fontSize: 11, color: "#555" }}>
          Total: {stats.total} · Won: {stats.won} · Lost: {stats.lost}
        </div>
      </button>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
        {players.map((p) => {
          const pp = stats.perPlayer.get(p.player_index) ?? { total: 0, won: 0, lost: 0 };
          const active = selectedPlayerIdx === p.player_index;
          return (
            <button
              key={p.id}
              onClick={() =>
                onSelectPlayer(active ? null : p.player_index)
              }
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "4px 6px",
                fontSize: 11,
                background: active ? `${color}18` : "transparent",
                border: `1px solid ${active ? color : "transparent"}`,
                borderRadius: 5,
                cursor: "pointer",
                textAlign: "left",
                fontFamily: "inherit",
              }}
            >
              {p.avatar_url ? (
                <img
                  src={p.avatar_url}
                  alt=""
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    objectFit: "cover",
                    border: `1.5px solid ${color}`,
                  }}
                />
              ) : (
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: color,
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  {p.display_name[0]}
                </span>
              )}
              <span style={{ fontWeight: 600, color: "#333", flex: 1 }}>
                {p.display_name.split(" ")[0]}
              </span>
              <span style={{ color: "#888" }}>
                {pp.won}W / {pp.lost}L
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LegendRow({
  color,
  label,
  hollow,
}: {
  color: string;
  label: string;
  hollow: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#444", marginBottom: 3 }}>
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: hollow ? "#fff" : color,
          border: `2px solid ${color}`,
        }}
      />
      {label}
    </div>
  );
}
