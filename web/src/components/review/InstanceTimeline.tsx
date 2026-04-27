/**
 * InstanceTimeline — horizontal strip of pass/fail instances for a WMPC
 * Analysis topic. Lets the coach navigate between good and bad examples so
 * they can spot the behavioral delta, per the "what's different on the
 * passes?" coaching prompt.
 */
import { useState, type CSSProperties } from "react";
import type { TopicInstance, TopicMode } from "../../lib/reviewTopics";

interface Props {
  instances: TopicInstance[];
  currentId: string | null;
  onSelect: (instance: TopicInstance) => void;
  /** Rally ids the coach already flagged in Analyze — tiles in this set get
   *  a small flag badge so they aren't double-reviewed. */
  flaggedRallyIds?: Set<string>;
  /** "skill" (default) frames as Pass/Fail per attempt. "outcome" frames as
   *  Won/Lost — used by rally-outcome stats where the coach is reviewing
   *  team tactics rather than grading execution. */
  mode?: TopicMode;
}

type Filter = "all" | "pass" | "fail";

export default function InstanceTimeline({
  instances,
  currentId,
  onSelect,
  flaggedRallyIds,
  mode = "skill",
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const passCount = instances.filter((i) => i.passed).length;
  const failCount = instances.length - passCount;
  const isOutcome = mode === "outcome";
  // Outcome topics talk about wins/losses, not pass/fail.
  const labels = isOutcome
    ? { positive: "Won", negative: "Lost", positivePlural: "wins", negativePlural: "losses", filterPos: "Wins", filterNeg: "Losses" }
    : { positive: "Pass", negative: "Fail", positivePlural: "passes", negativePlural: "fails", filterPos: "Passes", filterNeg: "Fails" };
  // Sort chronologically by rally index — gives a natural playbook feel
  const ordered = [...instances].sort((a, b) => a.rallyIndex - b.rallyIndex);

  function passesFilter(it: TopicInstance) {
    if (filter === "all") return true;
    if (filter === "pass") return it.passed;
    return !it.passed;
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 4,
          fontSize: 11,
          color: "#666",
        }}
      >
        <b style={{ color: "#222" }}>{isOutcome ? "Rallies" : "Instances"}</b>
        <span>
          {instances.length} total ·{" "}
          <span style={{ color: "#c62828" }}>{failCount} {labels.negativePlural}</span> ·{" "}
          <span style={{ color: "#1e7e34" }}>{passCount} {labels.positivePlural}</span>
        </span>
        <span style={{ flex: 1 }} />
        <div
          role="group"
          style={{
            display: "inline-flex",
            border: "1px solid #e2e2e2",
            borderRadius: 5,
            overflow: "hidden",
          }}
        >
          {(["all", "pass", "fail"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: "3px 10px",
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: 0.3,
                background: filter === f ? "#1a73e8" : "#fff",
                color: filter === f ? "#fff" : "#666",
                border: "none",
                borderRight: "1px solid #e2e2e2",
                cursor: "pointer",
                fontFamily: "inherit",
                textTransform: "capitalize",
              }}
            >
              {f === "all" ? "All" : f === "pass" ? labels.filterPos : labels.filterNeg}
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 4,
          padding: 8,
          background: "#fff",
          border: "1px solid #e2e2e2",
          borderRadius: 6,
          overflowX: "auto",
        }}
      >
        {ordered.length === 0 && (
          <div style={{ color: "#999", fontSize: 11, fontStyle: "italic", padding: "4px 6px" }}>
            No instances yet.
          </div>
        )}
        {ordered.map((it) => {
          const matches = passesFilter(it);
          const isCurrent = currentId === it.id;
          const isFlagged = flaggedRallyIds?.has(it.rallyId) ?? false;
          return (
            <button
              key={it.id}
              onClick={() => onSelect(it)}
              disabled={!matches && !isCurrent}
              style={{
                ...tileStyle(it.passed, isCurrent, matches),
                position: "relative",
              }}
              title={`Rally ${it.rallyIndex + 1} · ${it.passed ? labels.positive.toLowerCase() : labels.negative.toLowerCase()}${isFlagged ? " · flagged in Analyze" : ""}${it.note ? " · " + it.note : ""}`}
            >
              {isFlagged && (
                <span
                  aria-label="Flagged in Analyze"
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    width: 14,
                    height: 14,
                    borderRadius: "50%",
                    background: "#d97706",
                    border: "1.5px solid #fff",
                    color: "#fff",
                    fontSize: 9,
                    fontWeight: 700,
                    display: "grid",
                    placeItems: "center",
                    lineHeight: 1,
                  }}
                >
                  🚩
                </span>
              )}
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: "50%",
                  background: it.passed ? "#1e7e34" : "#c62828",
                  color: "#fff",
                  fontSize: 11,
                  fontWeight: 700,
                  display: "grid",
                  placeItems: "center",
                }}
              >
                {it.passed ? "✓" : "✗"}
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  fontVariantNumeric: "tabular-nums",
                  color: isCurrent ? "#1a73e8" : "#444",
                }}
              >
                R{it.rallyIndex + 1}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function tileStyle(_passed: boolean, current: boolean, matches: boolean): CSSProperties {
  return {
    display: "inline-flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    padding: "5px 6px",
    minWidth: 42,
    borderRadius: 4,
    cursor: matches || current ? "pointer" : "not-allowed",
    background: current ? "#e8f0fe" : "transparent",
    border: current ? "1px solid #1a73e8" : "1px solid transparent",
    opacity: !matches && !current ? 0.2 : 1,
    fontFamily: "inherit",
  };
}
