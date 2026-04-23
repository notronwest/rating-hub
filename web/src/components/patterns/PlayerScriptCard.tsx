/**
 * PlayerScriptCard — one player's scorecard for the 4 scripted-start
 * criteria. Each metric row is clickable: expanding it reveals the rallies
 * that made up that count, with a play button that seeks the video to the
 * relevant shot so the coach can review what happened.
 */

import { useState } from "react";
import {
  ratePct,
  type PlayerScript,
  type ScriptCounter,
  type ScriptEvent,
} from "../../lib/firstFourShots";

const TEAM_COLORS = ["#1a73e8", "#4caf50"] as const;

type MetricKey = "deepServe" | "deepReturn" | "thirdDrop" | "fourthVolley";

interface Props {
  script: PlayerScript;
  density?: "full" | "compact";
  /** Called when the coach clicks the play button on an event; receives ms
   *  relative to the video timeline. If omitted the rows are still clickable
   *  to expand but individual events won't offer playback. */
  onSeek?: (ms: number) => void;
}

export default function PlayerScriptCard({ script, density = "full", onSeek }: Props) {
  const color = TEAM_COLORS[script.player.team as 0 | 1];
  const [openMetric, setOpenMetric] = useState<MetricKey | null>(null);

  function toggle(m: MetricKey) {
    setOpenMetric((prev) => (prev === m ? null : m));
  }

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
        {script.player.avatar_url ? (
          <img
            src={script.player.avatar_url}
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
            {script.player.display_name[0]}
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
            {script.player.display_name}
          </div>
          <div style={{ fontSize: 10, color: "#888" }}>
            First 4 Shots · Team {script.player.team}
          </div>
        </div>
        <CompositeBadge pct={script.compositePct} />
      </div>

      <MetricRow
        label="Deep serve"
        counter={script.deepServe}
        accent="#1a73e8"
        density={density}
        expanded={openMetric === "deepServe"}
        onToggle={() => toggle("deepServe")}
        onSeek={onSeek}
      />
      <MetricRow
        label="Deep return + kitchen"
        counter={script.deepReturnPlusKitchen}
        accent="#4caf50"
        density={density}
        expanded={openMetric === "deepReturn"}
        onToggle={() => toggle("deepReturn")}
        onSeek={onSeek}
      />
      <MetricRow
        label="3rd-shot drop"
        counter={script.thirdDrop}
        accent="#9334e6"
        density={density}
        expanded={openMetric === "thirdDrop"}
        onToggle={() => toggle("thirdDrop")}
        onSeek={onSeek}
        subline={
          script.thirdDriveThenFifthDrop.total > 0
            ? `Drive → own-drop-on-5th: ${script.thirdDriveThenFifthDrop.correct}/${script.thirdDriveThenFifthDrop.total}`
            : undefined
        }
      />
      <MetricRow
        label="4th out of the air"
        counter={script.fourthVolley}
        accent="#d97706"
        density={density}
        expanded={openMetric === "fourthVolley"}
        onToggle={() => toggle("fourthVolley")}
        onSeek={onSeek}
      />
    </div>
  );
}

function MetricRow({
  label,
  counter,
  accent,
  subline,
  density,
  expanded,
  onToggle,
  onSeek,
}: {
  label: string;
  counter: ScriptCounter;
  accent: string;
  subline?: string;
  density: "full" | "compact";
  expanded: boolean;
  onToggle: () => void;
  onSeek?: (ms: number) => void;
}) {
  const pct = ratePct(counter);
  const na = counter.total === 0;
  const canExpand = counter.events.length > 0;
  return (
    <div style={{ marginBottom: density === "compact" ? 5 : 8 }}>
      <button
        type="button"
        onClick={canExpand ? onToggle : undefined}
        disabled={!canExpand}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          width: "100%",
          padding: "3px 4px",
          margin: "-3px -4px",
          background: expanded ? "#f0f4ff" : "transparent",
          border: "none",
          borderRadius: 4,
          cursor: canExpand ? "pointer" : "default",
          textAlign: "left",
          fontFamily: "inherit",
        }}
      >
        <span style={{ width: 10, color: "#999", fontSize: 9 }}>
          {canExpand ? (expanded ? "▼" : "▶") : ""}
        </span>
        <span style={{ flex: 1, color: "#333", fontWeight: 500 }}>{label}</span>
        <span style={{ color: na ? "#999" : "#333", fontVariantNumeric: "tabular-nums" }}>
          {na ? "— n/a" : `${counter.correct}/${counter.total}`}
        </span>
        <span
          style={{
            width: 42,
            textAlign: "right",
            color: na ? "#999" : accent,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {na ? "—" : `${pct}%`}
        </span>
      </button>

      {density === "full" && (
        <div
          style={{
            marginTop: 3,
            height: 5,
            background: "#f0f0f0",
            borderRadius: 3,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: na ? "#e5e5e5" : accent,
              transition: "width 0.2s",
            }}
          />
        </div>
      )}
      {subline && (
        <div style={{ fontSize: 10, color: "#777", marginTop: 3 }}>{subline}</div>
      )}

      {expanded && (
        <EventList events={counter.events} accent={accent} onSeek={onSeek} />
      )}
    </div>
  );
}

function EventList({
  events,
  accent,
  onSeek,
}: {
  events: ScriptEvent[];
  accent: string;
  onSeek?: (ms: number) => void;
}) {
  // Show failures first (they're the ones worth reviewing); passes after
  const ordered = [...events].sort((a, b) => {
    if (a.passed !== b.passed) return a.passed ? 1 : -1;
    return a.rallyIndex - b.rallyIndex;
  });
  return (
    <div
      style={{
        marginTop: 6,
        padding: "6px 8px",
        background: "#fafafa",
        borderRadius: 5,
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
            fontSize: 11,
            padding: "2px 0",
          }}
        >
          <span
            style={{
              width: 14,
              textAlign: "center",
              color: ev.passed ? "#1e7e34" : "#c62828",
              fontWeight: 700,
            }}
          >
            {ev.passed ? "✓" : "✗"}
          </span>
          <span style={{ color: "#555", width: 56 }}>Rally {ev.rallyIndex + 1}</span>
          <span style={{ flex: 1, color: "#666", minWidth: 0 }}>
            {ev.note ?? (ev.passed ? "Executed" : "Missed")}
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
                padding: "1px 7px",
                fontSize: 10,
                fontWeight: 700,
                background: `${accent}18`,
                color: accent,
                border: `1px solid ${accent}40`,
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

function CompositeBadge({ pct }: { pct: number }) {
  const color = pct >= 75 ? "#1e7e34" : pct >= 50 ? "#d97706" : "#c62828";
  return (
    <div
      style={{
        padding: "4px 10px",
        fontSize: 12,
        fontWeight: 700,
        background: `${color}15`,
        color,
        borderRadius: 5,
        whiteSpace: "nowrap",
      }}
      title="Unweighted mean of the four rates above"
    >
      Script {pct}%
    </div>
  );
}
