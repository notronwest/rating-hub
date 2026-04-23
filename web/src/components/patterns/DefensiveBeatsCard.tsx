/**
 * DefensiveBeatsCard — per-player scorecard showing how opponents beat them.
 * Each row (line/body/middle) is clickable to reveal the specific rally
 * events behind the count, with a play button that seeks the video.
 */

import { useState } from "react";
import type {
  BeatEvent,
  BeatRole,
  PlayerBeatSummary,
} from "../../lib/defensiveBeats";

const TEAM_COLORS = ["#1a73e8", "#4caf50"] as const;

interface Props {
  summary: PlayerBeatSummary;
  density?: "full" | "compact";
  /** Called with ms when coach hits a play button on a beat event. */
  onSeek?: (ms: number) => void;
}

export default function DefensiveBeatsCard({ summary, density = "full", onSeek }: Props) {
  const color = TEAM_COLORS[summary.player.team as 0 | 1];
  const [openRole, setOpenRole] = useState<BeatRole | null>(null);

  function eventsForRole(role: BeatRole): BeatEvent[] {
    return summary.events.filter((ev) => ev.role === role);
  }

  // Biggest leak for the headline banner
  const leaks: Array<{ label: string; count: number }> = [];
  if (summary.asDirectLine > 0) leaks.push({ label: "Down the line (direct duty)", count: summary.asDirectLine });
  if (summary.asDiagonalMiddle > 0) leaks.push({ label: "Through the middle (diagonal duty)", count: summary.asDiagonalMiddle });
  if (summary.asDirectBody > 0) leaks.push({ label: "At body (direct)", count: summary.asDirectBody });
  if (summary.asDiagonalBody > 0) leaks.push({ label: "At body (diagonal)", count: summary.asDiagonalBody });
  if (summary.asDiagonalLine > 0) leaks.push({ label: "Far line (diagonal)", count: summary.asDiagonalLine });
  leaks.sort((a, b) => b.count - a.count);
  const topLeak = leaks[0] ?? null;

  return (
    <div
      style={{
        border: "1px solid #e2e2e2",
        borderLeft: `4px solid ${color}`,
        borderRadius: 8,
        padding: density === "compact" ? 10 : 12,
        background: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: density === "compact" ? 6 : 10,
        }}
      >
        {summary.player.avatar_url ? (
          <img
            src={summary.player.avatar_url}
            alt=""
            style={{
              width: density === "compact" ? 28 : 34,
              height: density === "compact" ? 28 : 34,
              borderRadius: "50%",
              objectFit: "cover",
              border: `1.5px solid ${color}`,
            }}
          />
        ) : (
          <span
            style={{
              width: density === "compact" ? 28 : 34,
              height: density === "compact" ? 28 : 34,
              borderRadius: "50%",
              background: color,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: density === "compact" ? 11 : 13,
              fontWeight: 700,
            }}
          >
            {summary.player.display_name[0]}
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: density === "compact" ? 12 : 13,
              fontWeight: 700,
              color: "#222",
              lineHeight: 1.2,
            }}
          >
            {summary.player.display_name}
          </div>
          <div style={{ fontSize: 10, color: "#888" }}>
            Defensive beats · Team {summary.player.team}
          </div>
        </div>
        <div
          style={{
            padding: "4px 10px",
            fontSize: 12,
            fontWeight: 700,
            background: summary.totalBeats === 0 ? "#e6f4ea" : "#fce8e6",
            color: summary.totalBeats === 0 ? "#1e7e34" : "#c62828",
            borderRadius: 5,
            whiteSpace: "nowrap",
          }}
        >
          {summary.totalBeats} beat{summary.totalBeats === 1 ? "" : "s"}
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 10,
          marginBottom: density === "compact" ? 6 : 8,
        }}
      >
        <RoleBlock
          title="As DIRECT defender"
          subtitle="Line + your body"
          totalAsRole={summary.asDirectTotal}
          driftAvg={summary.avgDirectDrift}
          driftLabel="avg drift from shooter"
          rows={[
            {
              role: "direct_line",
              label: "Line",
              count: summary.asDirectLine,
              tone: summary.asDirectLine > 0 ? "bad" : "ok",
            },
            {
              role: "direct_body",
              label: "Body",
              count: summary.asDirectBody,
            },
          ]}
          openRole={openRole}
          onToggle={(r) => setOpenRole((p) => (p === r ? null : r))}
          eventsForRole={eventsForRole}
          onSeek={onSeek}
        />
        <RoleBlock
          title="As DIAGONAL defender"
          subtitle="Middle + your body"
          totalAsRole={summary.asDiagonalTotal}
          driftAvg={summary.avgDiagonalDrift}
          driftLabel="avg drift from center"
          rows={[
            {
              role: "diagonal_middle",
              label: "Middle",
              count: summary.asDiagonalMiddle,
              tone: summary.asDiagonalMiddle > 0 ? "bad" : "ok",
            },
            {
              role: "diagonal_body",
              label: "Body",
              count: summary.asDiagonalBody,
            },
            ...(summary.asDiagonalLine > 0
              ? ([{ role: "diagonal_line" as BeatRole, label: "Far line", count: summary.asDiagonalLine }])
              : []),
          ]}
          openRole={openRole}
          onToggle={(r) => setOpenRole((p) => (p === r ? null : r))}
          eventsForRole={eventsForRole}
          onSeek={onSeek}
        />
      </div>

      {topLeak && summary.totalBeats >= 2 && (
        <div
          style={{
            fontSize: 11,
            color: "#7a2020",
            padding: "6px 8px",
            background: "#fef2f2",
            borderRadius: 5,
          }}
        >
          <b>Biggest leak:</b> {topLeak.label} ({topLeak.count})
        </div>
      )}
    </div>
  );
}

function RoleBlock({
  title,
  subtitle,
  totalAsRole,
  driftAvg,
  driftLabel,
  rows,
  openRole,
  onToggle,
  eventsForRole,
  onSeek,
}: {
  title: string;
  subtitle: string;
  totalAsRole: number;
  driftAvg: number;
  driftLabel: string;
  rows: Array<{ role: BeatRole; label: string; count: number; tone?: "ok" | "bad" }>;
  openRole: BeatRole | null;
  onToggle: (role: BeatRole) => void;
  eventsForRole: (role: BeatRole) => BeatEvent[];
  onSeek?: (ms: number) => void;
}) {
  return (
    <div
      style={{
        border: "1px solid #f0f0f0",
        borderRadius: 6,
        padding: "6px 8px",
        background: "#fafafa",
      }}
    >
      <div style={{ fontSize: 10, color: "#666", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>
        {title}
      </div>
      <div style={{ fontSize: 10, color: "#888", marginBottom: 6 }}>{subtitle}</div>
      {rows.map((r) => {
        const expanded = openRole === r.role;
        const canExpand = r.count > 0;
        return (
          <div key={r.role}>
            <button
              type="button"
              onClick={canExpand ? () => onToggle(r.role) : undefined}
              disabled={!canExpand}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                width: "100%",
                padding: "2px 4px",
                margin: "0 -4px",
                background: expanded ? "#fff" : "transparent",
                border: "none",
                borderRadius: 3,
                cursor: canExpand ? "pointer" : "default",
                fontSize: 12,
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              <span style={{ width: 8, color: "#999", fontSize: 9 }}>
                {canExpand ? (expanded ? "▼" : "▶") : ""}
              </span>
              <span style={{ flex: 1, color: "#333" }}>{r.label}</span>
              <span
                style={{
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 600,
                  color: r.count === 0 ? "#999" : r.tone === "bad" ? "#c62828" : "#333",
                }}
              >
                {r.count}
              </span>
            </button>
            {expanded && (
              <BeatEventList events={eventsForRole(r.role)} onSeek={onSeek} />
            )}
          </div>
        );
      })}
      <div
        style={{
          fontSize: 10,
          color: "#888",
          marginTop: 4,
          paddingTop: 4,
          borderTop: "1px dashed #e0e0e0",
        }}
      >
        {totalAsRole > 0 ? `${driftLabel}: ${driftAvg.toFixed(1)} ft` : "—"}
      </div>
    </div>
  );
}

function BeatEventList({
  events,
  onSeek,
}: {
  events: BeatEvent[];
  onSeek?: (ms: number) => void;
}) {
  if (events.length === 0) return null;
  const ordered = [...events].sort((a, b) => a.rallyIndex - b.rallyIndex);
  return (
    <div
      style={{
        margin: "4px 0 6px",
        padding: "5px 7px",
        background: "#fff",
        borderRadius: 4,
        border: "1px solid #eee",
        display: "flex",
        flexDirection: "column",
        gap: 3,
      }}
    >
      {ordered.map((ev, i) => (
        <div
          key={`${ev.rallyId}-${i}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10,
          }}
        >
          <span style={{ color: "#555", width: 52 }}>Rally {ev.rallyIndex + 1}</span>
          <span style={{ flex: 1, color: "#666", minWidth: 0 }}>
            land ({ev.landX.toFixed(1)}, {ev.landY.toFixed(1)}) · drift{" "}
            {ev.directDrift.toFixed(1)}/{ev.diagonalDrift.toFixed(1)} ft
          </span>
          {onSeek && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSeek(ev.seekMs);
              }}
              title="Play this moment"
              style={{
                padding: "1px 6px",
                fontSize: 9,
                fontWeight: 700,
                background: "#fce8e6",
                color: "#c62828",
                border: "1px solid #f5c0bd",
                borderRadius: 3,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              ▶ Play
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
