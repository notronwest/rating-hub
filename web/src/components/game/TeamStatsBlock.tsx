/**
 * Team-level stats panel for the Game Detail page. Three sections:
 *
 *   1. Kitchen Arrival — serving-side % + returning-side % per player, visualized
 *      as mini court diagrams with colored bars.
 *   2. Shot Distribution / Left Side % / Speedups — horizontal team-split bars.
 *   3. Rallies Won by length — Short (1-5) / Medium (6-10) / Long (11+) bars
 *      showing what % of each bucket each team won, with player avatars.
 */

import type { GamePlayer, GamePlayerShotType, Rally } from "../../types/database";

interface PlayerLite {
  id: string;
  player_index: number;
  display_name: string;
  team: number;
  avatar_url: string | null;
}

interface Props {
  players: PlayerLite[];
  gamePlayers: GamePlayer[];
  shotTypes: GamePlayerShotType[];
  rallies: Pick<Rally, "shot_count" | "winning_team">[];
  team0KitchenPct: number | null;
  team1KitchenPct: number | null;
}

const TEAM0_DARK = "#1a73e8"; // Team 0 serving
const TEAM0_LIGHT = "#60a5fa"; // Team 0 returning
const TEAM1_DARK = "#f59e0b"; // Team 1 serving
const TEAM1_LIGHT = "#ef5350"; // Team 1 returning

export default function TeamStatsBlock({
  players,
  gamePlayers,
  shotTypes,
  rallies,
  team0KitchenPct,
  team1KitchenPct,
}: Props) {
  // Sort players by index for consistent ordering
  const sortedPlayers = [...players].sort(
    (a, b) => a.player_index - b.player_index,
  );
  const team0Players = sortedPlayers.filter((p) => p.team === 0);
  const team1Players = sortedPlayers.filter((p) => p.team === 1);

  const getGP = (playerId: string) =>
    gamePlayers.find((gp) => gp.player_id === playerId);

  // ── Kitchen arrival: serving-side and returning-side % per player ──
  function kitchenFor(playerId: string, side: "serving" | "returning"): number {
    const gp = getGP(playerId);
    const summary = gp?.kitchen_arrivals_summary as
      | { serving_side?: number; receiving_side?: number }
      | null;
    if (!summary) return 0;
    const raw =
      side === "serving" ? summary.serving_side : summary.receiving_side;
    return raw != null ? Math.round(raw * 100) : 0;
  }

  // ── Shot distribution: % of team's total shots each team hit ──
  function shotPctForTeam(team: 0 | 1): number {
    const teamPlayers = team === 0 ? team0Players : team1Players;
    const counts = teamPlayers.map((p) => getGP(p.id)?.shot_count ?? 0);
    return counts.reduce((a, b) => a + b, 0);
  }
  const team0Shots = shotPctForTeam(0);
  const team1Shots = shotPctForTeam(1);
  const totalShots = Math.max(1, team0Shots + team1Shots);

  // Within-team split: player 0 vs player 1 on team 0, and the two on team 1
  function teamPlayerSplit(team: 0 | 1, field: "shot_count" | "left_side_percentage") {
    const ps = team === 0 ? team0Players : team1Players;
    const vals = ps.map((p) => {
      const gp = getGP(p.id);
      if (!gp) return 0;
      if (field === "shot_count") return gp.shot_count ?? 0;
      return gp.left_side_percentage ?? 0;
    });
    const sum = Math.max(1, vals.reduce((a, b) => a + b, 0));
    return vals.map((v) => Math.round((v / sum) * 100));
  }

  // ── Speedups: count per player → per-team contribution to all speedups ──
  const speedupCount = (playerId: string) =>
    shotTypes.find(
      (st) => st.player_id === playerId && st.shot_type === "speedups",
    )?.count ?? 0;
  const team0Speedups = team0Players.reduce(
    (s, p) => s + speedupCount(p.id),
    0,
  );
  const team1Speedups = team1Players.reduce(
    (s, p) => s + speedupCount(p.id),
    0,
  );
  const totalSpeedups = Math.max(1, team0Speedups + team1Speedups);

  // ── Rallies Won by length ──
  const ralliesByBucket = { short: 0, medium: 0, long: 0 };
  const ralliesWonByBucket = { short: [0, 0], medium: [0, 0], long: [0, 0] };
  for (const r of rallies) {
    const n = r.shot_count ?? 0;
    const bucket: "short" | "medium" | "long" =
      n <= 5 ? "short" : n <= 10 ? "medium" : "long";
    ralliesByBucket[bucket] += 1;
    if (r.winning_team === 0 || r.winning_team === 1) {
      ralliesWonByBucket[bucket][r.winning_team] += 1;
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* ── Kitchen Arrival ── */}
      <div style={sectionStyle}>
        <SectionHeader title="Kitchen Arrival" />
        <KitchenArrivalRow
          label="When on Serving Team"
          team0Players={team0Players}
          team1Players={team1Players}
          team0Values={team0Players.map((p) => kitchenFor(p.id, "serving"))}
          team1Values={team1Players.map((p) => kitchenFor(p.id, "serving"))}
        />
        <KitchenArrivalRow
          label="When on Returning Team"
          team0Players={team0Players}
          team1Players={team1Players}
          team0Values={team0Players.map((p) => kitchenFor(p.id, "returning"))}
          team1Values={team1Players.map((p) => kitchenFor(p.id, "returning"))}
        />
        {(team0KitchenPct != null || team1KitchenPct != null) && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #eee" }}>
            <div style={subHeaderStyle}>Team percentage to the kitchen</div>
            <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
              <TeamBarCell
                pct={team0KitchenPct != null ? Math.round(team0KitchenPct * 100) : 0}
                color={TEAM0_DARK}
                align="right"
              />
              <TeamBarCell
                pct={team1KitchenPct != null ? Math.round(team1KitchenPct * 100) : 0}
                color={TEAM1_DARK}
                align="left"
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Shot Distribution + Left Side + Speedups ── */}
      <div style={sectionStyle}>
        <SectionHeader title="Shot Distribution & Positioning" />
        <SplitBarRow
          label="Shots"
          leftLabel={`${Math.round((team0Shots / totalShots) * 100)}%`}
          rightLabel={`${Math.round((team1Shots / totalShots) * 100)}%`}
          team0Split={teamPlayerSplit(0, "shot_count")}
          team1Split={teamPlayerSplit(1, "shot_count")}
          team0Players={team0Players}
          team1Players={team1Players}
        />
        <SplitBarRow
          label="Left side"
          leftLabel=""
          rightLabel=""
          team0Split={teamPlayerSplit(0, "left_side_percentage")}
          team1Split={teamPlayerSplit(1, "left_side_percentage")}
          team0Players={team0Players}
          team1Players={team1Players}
        />
        {totalSpeedups > 1 && (
          <SplitBarRow
            label="Speedups"
            leftLabel={`${Math.round((team0Speedups / totalSpeedups) * 100)}%`}
            rightLabel={`${Math.round((team1Speedups / totalSpeedups) * 100)}%`}
            team0Split={team0Players.map((p) => speedupCount(p.id))}
            team1Split={team1Players.map((p) => speedupCount(p.id))}
            team0Players={team0Players}
            team1Players={team1Players}
          />
        )}
      </div>

      {/* ── Rallies Won by length ── */}
      {rallies.length > 0 && (
        <div style={sectionStyle}>
          <SectionHeader title="Rallies Won" />
          {(["short", "medium", "long"] as const).map((bucket) => {
            const total = ralliesByBucket[bucket];
            if (total === 0) return null;
            const t0 = ralliesWonByBucket[bucket][0];
            const t1 = ralliesWonByBucket[bucket][1];
            const range = bucket === "short" ? "1–5" : bucket === "medium" ? "6–10" : "11+";
            const labelName = bucket.charAt(0).toUpperCase() + bucket.slice(1);
            return (
              <RalliesWonRow
                key={bucket}
                countLabel={`${total} ${labelName} Rallies`}
                rangeLabel={`${range} Shots`}
                team0Pct={Math.round((t0 / total) * 100)}
                team1Pct={Math.round((t1 / total) * 100)}
                team0Players={team0Players}
                team1Players={team1Players}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 13,
        fontWeight: 700,
        color: "#333",
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: "1px solid #eee",
      }}
    >
      {title}
    </div>
  );
}

function KitchenArrivalRow({
  label,
  team0Players,
  team1Players,
  team0Values,
  team1Values,
}: {
  label: string;
  team0Players: PlayerLite[];
  team1Players: PlayerLite[];
  team0Values: number[];
  team1Values: number[];
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={subHeaderStyle}>{label}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 6 }}>
        {/* Team 0 side */}
        <div>
          {team0Players.map((p, i) => (
            <KitchenPlayerBar
              key={p.id}
              player={p}
              pct={team0Values[i] ?? 0}
              color={i === 0 ? TEAM0_DARK : TEAM0_LIGHT}
              align="right"
            />
          ))}
        </div>
        {/* Team 1 side */}
        <div>
          {team1Players.map((p, i) => (
            <KitchenPlayerBar
              key={p.id}
              player={p}
              pct={team1Values[i] ?? 0}
              color={i === 0 ? TEAM1_DARK : TEAM1_LIGHT}
              align="left"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function KitchenPlayerBar({
  player,
  pct,
  color,
  align,
}: {
  player: PlayerLite;
  pct: number;
  color: string;
  align: "left" | "right";
}) {
  const bar = (
    <div
      style={{
        height: 24,
        background: color,
        width: `${Math.max(2, pct)}%`,
        borderRadius: 3,
        display: "flex",
        alignItems: "center",
        padding: align === "right" ? "0 6px 0 0" : "0 0 0 6px",
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        color: "#fff",
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      {pct}%
    </div>
  );
  const name = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        color: "#555",
        whiteSpace: "nowrap",
      }}
    >
      {player.avatar_url && (
        <img
          src={player.avatar_url}
          alt=""
          style={{ width: 18, height: 18, borderRadius: "50%", objectFit: "cover" }}
        />
      )}
      <span style={{ fontWeight: 500 }}>{player.display_name.split(" ")[0]}</span>
    </div>
  );
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 4,
        flexDirection: align === "right" ? "row-reverse" : "row",
      }}
    >
      {name}
      <div
        style={{
          flex: 1,
          display: "flex",
          justifyContent: align === "right" ? "flex-end" : "flex-start",
        }}
      >
        {bar}
      </div>
    </div>
  );
}

function SplitBarRow({
  label,
  leftLabel,
  rightLabel,
  team0Split,
  team1Split,
  team0Players,
  team1Players,
}: {
  label: string;
  leftLabel: string;
  rightLabel: string;
  team0Split: number[];
  team1Split: number[];
  team0Players: PlayerLite[];
  team1Players: PlayerLite[];
}) {
  const team0Total = Math.max(0, team0Split.reduce((a, b) => a + b, 0));
  const team1Total = Math.max(0, team1Split.reduce((a, b) => a + b, 0));
  const grandTotal = Math.max(1, team0Total + team1Total);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#666", marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ display: "flex", gap: 4, height: 24 }}>
        {/* Team 0 side (split internally) */}
        <div
          style={{
            flex: team0Total / grandTotal || 0.01,
            display: "flex",
            gap: 1,
            overflow: "hidden",
            borderRadius: "4px 0 0 4px",
          }}
        >
          {team0Split.map((v, i) => (
            <SegmentBar
              key={i}
              weight={v}
              color={i === 0 ? TEAM0_DARK : TEAM0_LIGHT}
              label={i === 0 && leftLabel ? leftLabel : ""}
              align="left"
              player={team0Players[i]}
            />
          ))}
        </div>
        {/* Team 1 side */}
        <div
          style={{
            flex: team1Total / grandTotal || 0.01,
            display: "flex",
            gap: 1,
            overflow: "hidden",
            borderRadius: "0 4px 4px 0",
          }}
        >
          {team1Split.map((v, i) => (
            <SegmentBar
              key={i}
              weight={v}
              color={i === 0 ? TEAM1_DARK : TEAM1_LIGHT}
              label={i === team1Split.length - 1 && rightLabel ? rightLabel : ""}
              align="right"
              player={team1Players[i]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SegmentBar({
  weight,
  color,
  label,
  align,
  player,
}: {
  weight: number;
  color: string;
  label: string;
  align: "left" | "right";
  player?: PlayerLite;
}) {
  return (
    <div
      title={player ? `${player.display_name}: ${weight}` : undefined}
      style={{
        flex: Math.max(weight, 0.01),
        background: color,
        color: "#fff",
        fontSize: 11,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        padding: "0 8px",
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        overflow: "hidden",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </div>
  );
}

function TeamBarCell({
  pct,
  color,
  align,
}: {
  pct: number;
  color: string;
  align: "left" | "right";
}) {
  return (
    <div
      style={{
        flex: 1,
        height: 28,
        background: "#f0f0f0",
        borderRadius: align === "right" ? "4px 0 0 4px" : "0 4px 4px 0",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: `${pct}%`,
          background: color,
          [align === "right" ? "right" : "left"]: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: align === "right" ? "flex-start" : "flex-end",
          padding: "0 10px",
          color: "#fff",
          fontSize: 12,
          fontWeight: 700,
        }}
      >
        {pct}%
      </div>
    </div>
  );
}

function RalliesWonRow({
  countLabel,
  rangeLabel,
  team0Pct,
  team1Pct,
  team0Players,
  team1Players,
}: {
  countLabel: string;
  rangeLabel: string;
  team0Pct: number;
  team1Pct: number;
  team0Players: PlayerLite[];
  team1Players: PlayerLite[];
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div style={{ width: 150, flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#333" }}>{countLabel}</div>
          <div style={{ fontSize: 11, color: "#888" }}>{rangeLabel}</div>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <BucketBar
            pct={team0Pct}
            color={TEAM0_DARK}
            players={team0Players}
          />
          <BucketBar
            pct={team1Pct}
            color={TEAM1_DARK}
            players={team1Players}
          />
        </div>
      </div>
    </div>
  );
}

function BucketBar({
  pct,
  color,
  players,
}: {
  pct: number;
  color: string;
  players: PlayerLite[];
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div
        style={{
          flex: 1,
          height: 22,
          background: "#f0f0f0",
          borderRadius: 3,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.max(2, pct)}%`,
            background: color,
            display: "flex",
            alignItems: "center",
            paddingLeft: 10,
            color: "#fff",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {pct}%
        </div>
      </div>
      <div style={{ display: "flex", gap: 2 }}>
        {players.map((p) => (
          <Avatar key={p.id} player={p} />
        ))}
      </div>
    </div>
  );
}

function Avatar({ player }: { player: PlayerLite }) {
  if (player.avatar_url) {
    return (
      <img
        src={player.avatar_url}
        alt={player.display_name}
        title={player.display_name}
        style={{ width: 20, height: 20, borderRadius: "50%", objectFit: "cover" }}
      />
    );
  }
  return (
    <span
      title={player.display_name}
      style={{
        width: 20,
        height: 20,
        borderRadius: "50%",
        background: "#bbb",
        color: "#fff",
        fontSize: 10,
        fontWeight: 700,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {player.display_name[0]}
    </span>
  );
}

const sectionStyle: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e2e2",
  borderRadius: 10,
  padding: 16,
};

const subHeaderStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#666",
  textTransform: "uppercase",
  letterSpacing: 0.4,
};
