/**
 * Compact player header shown above the video on the Analyze page.
 * Each player gets a chip with name + overall rating + a tiny sparkline of
 * their sub-ratings. Click a chip to expand and reveal the full rating grid
 * and shot quality / selection / accuracy breakdowns.
 */

import { useState } from "react";
import type { GamePlayer } from "../../types/database";

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
}

const TEAM_COLORS = ["#1a73e8", "#f59e0b"] as const;

export default function PlayerHeaderBar({ players, gamePlayers }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const gpByPlayerId = new Map(gamePlayers.map((gp) => [gp.player_id, gp]));
  const sorted = [...players].sort((a, b) => a.player_index - b.player_index);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${Math.min(sorted.length, 4)}, 1fr)`,
        gap: 8,
      }}
    >
      {sorted.map((p) => {
        const gp = gpByPlayerId.get(p.id);
        const isOpen = expanded === p.id;
        return (
          <PlayerChip
            key={p.id}
            player={p}
            gp={gp}
            expanded={isOpen}
            onToggle={() => setExpanded(isOpen ? null : p.id)}
          />
        );
      })}
    </div>
  );
}

function PlayerChip({
  player,
  gp,
  expanded,
  onToggle,
}: {
  player: PlayerLite;
  gp: GamePlayer | undefined;
  expanded: boolean;
  onToggle: () => void;
}) {
  const teamColor = TEAM_COLORS[player.team] ?? "#888";
  const overall = gp?.rating_overall ?? null;

  // Sub-ratings for mini bar chart
  const subs: Array<{ label: string; value: number | null; short: string }> = [
    { label: "Serve", short: "SV", value: gp?.rating_serve ?? null },
    { label: "Return", short: "RT", value: gp?.rating_return ?? null },
    { label: "Offense", short: "OF", value: gp?.rating_offense ?? null },
    { label: "Defense", short: "DF", value: gp?.rating_defense ?? null },
    { label: "Agility", short: "AG", value: gp?.rating_agility ?? null },
    { label: "Consistency", short: "CN", value: gp?.rating_consistency ?? null },
  ];

  return (
    <div
      style={{
        border: `1px solid ${expanded ? teamColor : "#e2e2e2"}`,
        borderLeft: `3px solid ${teamColor}`,
        borderRadius: 8,
        background: "#fff",
        overflow: "hidden",
      }}
    >
      <button
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 10px",
          background: expanded ? `${teamColor}10` : "#fff",
          border: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          textAlign: "left",
        }}
      >
        {player.avatar_url ? (
          <img
            src={player.avatar_url}
            alt=""
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              objectFit: "cover",
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: teamColor,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {player.display_name[0]}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#333",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {player.display_name}
          </div>
          <MiniBar subs={subs} color={teamColor} />
        </div>
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: teamColor, lineHeight: 1 }}>
            {overall != null ? overall.toFixed(2) : "—"}
          </div>
          <div style={{ fontSize: 9, color: "#888", marginTop: 2 }}>OVERALL</div>
        </div>
        <span style={{ fontSize: 10, color: "#bbb", marginLeft: 4 }}>
          {expanded ? "▲" : "▼"}
        </span>
      </button>

      {expanded && gp && (
        <div
          style={{
            padding: "10px 12px 12px",
            borderTop: "1px solid #eee",
            background: "#fafbff",
          }}
        >
          {/* Rating grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 6,
              marginBottom: 10,
            }}
          >
            {subs.map((s) => (
              <div
                key={s.label}
                style={{
                  padding: "5px 8px",
                  background: "#fff",
                  border: "1px solid #eee",
                  borderRadius: 5,
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 9, color: "#888", textTransform: "uppercase" }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#333" }}>
                  {s.value != null ? s.value.toFixed(2) : "—"}
                </div>
              </div>
            ))}
          </div>

          {/* Compact stats row */}
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              fontSize: 11,
              color: "#555",
            }}
          >
            {gp.won != null && (
              <span
                style={{
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  background: gp.won ? "#e6f4ea" : "#fce8e6",
                  color: gp.won ? "#1e7e34" : "#c62828",
                }}
              >
                {gp.won ? "WON" : "LOST"}
              </span>
            )}
            {gp.shot_count != null && <span>{gp.shot_count} shots</span>}
            {gp.num_rallies != null && (
              <span>
                {gp.num_rallies_won ?? 0}/{gp.num_rallies} rallies
              </span>
            )}
            {gp.distance_covered != null && (
              <span>{gp.distance_covered.toFixed(0)} ft</span>
            )}
          </div>

          {/* Shot accuracy mini */}
          {gp.shot_accuracy && (
            <AccuracyBar accuracy={gp.shot_accuracy as unknown as Record<string, number>} />
          )}
        </div>
      )}
    </div>
  );
}

function MiniBar({
  subs,
  color,
}: {
  subs: Array<{ label: string; value: number | null; short: string }>;
  color: string;
}) {
  const max = 6; // PB Vision rating scale roughly 0-6
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 2,
        height: 14,
        marginTop: 3,
      }}
      title={subs
        .map((s) => `${s.label}: ${s.value != null ? s.value.toFixed(2) : "—"}`)
        .join("  ·  ")}
    >
      {subs.map((s) => {
        const pct = s.value != null ? Math.max(8, Math.min(100, (s.value / max) * 100)) : 8;
        return (
          <div
            key={s.label}
            style={{
              flex: 1,
              height: `${pct}%`,
              background: s.value != null ? color : "#e0e0e0",
              borderRadius: 1,
              opacity: s.value != null ? 0.85 : 0.4,
            }}
          />
        );
      })}
    </div>
  );
}

function AccuracyBar({ accuracy }: { accuracy: Record<string, number> }) {
  const inPct = (accuracy.in ?? 0) * 100;
  const netPct = (accuracy.net ?? 0) * 100;
  const outPct = (accuracy.out ?? 0) * 100;
  const total = Math.max(1, inPct + netPct + outPct);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: "#888", textTransform: "uppercase", marginBottom: 3 }}>
        Shot Accuracy
      </div>
      <div style={{ display: "flex", height: 10, borderRadius: 3, overflow: "hidden" }}>
        <div
          title={`In: ${inPct.toFixed(0)}%`}
          style={{ flex: inPct / total, background: "#1e7e34" }}
        />
        <div
          title={`Net: ${netPct.toFixed(0)}%`}
          style={{ flex: netPct / total, background: "#f0ad4e" }}
        />
        <div
          title={`Out: ${outPct.toFixed(0)}%`}
          style={{ flex: outPct / total, background: "#c62828" }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#666", marginTop: 2 }}>
        <span>In {inPct.toFixed(0)}%</span>
        <span>Net {netPct.toFixed(0)}%</span>
        <span>Out {outPct.toFixed(0)}%</span>
      </div>
    </div>
  );
}
