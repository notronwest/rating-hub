import type { RallyShot } from "../../types/database";
import type { AnalysisSequence, FlaggedShot } from "../../types/coach";

interface Rally {
  id: string;
  rally_index: number;
  start_ms: number;
  end_ms: number;
  winning_team: number | null;
  score_team0: number | null;
  score_team1: number | null;
}

interface HighlightEvent {
  rally_idx: number;
  s: number;
  e: number;
  kind: string;
  short_description: string;
}

interface Props {
  rallies: Rally[];
  shots: RallyShot[];
  highlights?: HighlightEvent[];
  sequences?: AnalysisSequence[];
  flags?: FlaggedShot[];
  /** "loss:<rally_id>:<shot_id>" keys that the coach has marked as not
   *  significant. Rallies whose fault-ending shot is dismissed get a muted
   *  bottom border instead of the red "ended on fault" stripe. */
  dismissedLossKeys?: Set<string>;
  /** Rally ids the coach has already played through. Rallies NOT in this set
   *  get a small blue "unseen" dot in the corner of the card. Auto-populated
   *  by AnalyzePage as the playhead enters each rally. */
  viewedRallyIds?: Set<string>;
  /** Clear the viewed set — exposed on the legend row as a reset button so
   *  the coach can re-walk the game fresh. */
  onResetViewed?: () => void;
  activeRallyId: string | null;
  currentMs: number;
  onRallyClick: (rally: Rally) => void;
}

/**
 * Horizontal strip: one equal-width card per rally, ignoring dead time between rallies.
 * Each card shows:
 *   - Rally number (top)
 *   - 🔥 firefight marker (if highlight kind="firefight" or shot_count >= threshold)
 *   - Running score below
 *   - Two bars: team 0 (blue, left) + team 1 (green, right); height ∝ team's shot count
 *   - ⚠️ red dot (bottom) if rally ended in a fault
 *
 * Click a card to seek video to that rally's start + activate it in the analysis panel.
 */
export default function RallyStrip({
  rallies,
  shots,
  highlights = [],
  sequences = [],
  flags = [],
  dismissedLossKeys,
  viewedRallyIds,
  onResetViewed,
  activeRallyId,
  currentMs,
  onRallyClick,
}: Props) {
  if (rallies.length === 0) return null;

  // Players 0+1 are team 0, players 2+3 are team 1 (standard pb.vision convention)
  const teamOf = (playerIndex: number | null) =>
    playerIndex == null ? null : playerIndex < 2 ? 0 : 1;

  // Precompute team shot counts and fault flag per rally
  const shotsByRally = new Map<string, RallyShot[]>();
  for (const s of shots) {
    if (!shotsByRally.has(s.rally_id)) shotsByRally.set(s.rally_id, []);
    shotsByRally.get(s.rally_id)!.push(s);
  }
  // Ensure per-rally shot arrays are ordered by shot_index so lastShot is
  // reliably the rally-ending shot (which is what the fault-stripe color and
  // flag-detection logic below depend on).
  for (const [, arr] of shotsByRally) {
    arr.sort((a, b) => a.shot_index - b.shot_index);
  }

  // Firefight set from highlights
  const firefightIdxs = new Set(
    highlights.filter((h) => h.kind === "firefight").map((h) => h.rally_idx),
  );

  // Coach-work counts per rally — saved sequences are direct; flagged shots
  // require a shot→rally hop.
  const sequenceCountByRally = new Map<string, number>();
  for (const seq of sequences) {
    sequenceCountByRally.set(
      seq.rally_id,
      (sequenceCountByRally.get(seq.rally_id) ?? 0) + 1,
    );
  }
  const rallyIdByShotId = new Map(shots.map((s) => [s.id, s.rally_id]));
  const flagCountByRally = new Map<string, number>();
  for (const f of flags) {
    const rallyId = rallyIdByShotId.get(f.shot_id);
    if (!rallyId) continue;
    flagCountByRally.set(rallyId, (flagCountByRally.get(rallyId) ?? 0) + 1);
  }

  // Max shot count across rallies for bar normalization
  const maxShots = Math.max(
    1,
    ...rallies.map((r) => {
      const rs = shotsByRally.get(r.id) ?? [];
      const t0 = rs.filter((s) => teamOf(s.player_index) === 0).length;
      const t1 = rs.filter((s) => teamOf(s.player_index) === 1).length;
      return Math.max(t0, t1);
    }),
  );

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 12,
        padding: "12px 14px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 14, fontSize: 11, color: "#666", flexWrap: "wrap" }}>
          <Legend color="#1a73e8" label="Team 0 (far)" />
          <Legend color="#f59e0b" label="Team 1 (near)" />
          <span style={{ color: "#888" }}>🔥 firefight</span>
          <span style={{ color: "#888" }}>
            <span style={{ color: "#7c3aed", fontWeight: 700 }}>▤</span> sequence ·{" "}
            <span style={{ color: "#475569", fontWeight: 700 }}>⚑</span> flag ·{" "}
            <span
              style={{
                display: "inline-block",
                width: 14,
                height: 3,
                background: "#ef4444",
                borderRadius: 1,
                verticalAlign: "middle",
              }}
            />{" "}
            ended on fault ·{" "}
            <span
              style={{
                display: "inline-block",
                width: 14,
                height: 3,
                background: "#9ca3af",
                borderRadius: 1,
                verticalAlign: "middle",
              }}
            />{" "}
            flagged / dismissed
          </span>
          <span style={{ color: "#888", display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span
              style={{
                display: "inline-block",
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#1a73e8",
              }}
            />
            unseen
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "#666" }}>
          <span>
            {rallies.length} {rallies.length === 1 ? "rally" : "rallies"}
          </span>
          {onResetViewed && (viewedRallyIds?.size ?? 0) > 0 && (
            <button
              onClick={onResetViewed}
              title="Clear the unseen-rally markers and start over"
              style={{
                padding: "3px 8px",
                fontSize: 10,
                fontWeight: 600,
                background: "#fff",
                color: "#555",
                border: "1px solid #ddd",
                borderRadius: 4,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Reset seen ({viewedRallyIds?.size ?? 0})
            </button>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 3,
          overflowX: "auto",
          paddingBottom: 4,
          // Thin scrollbar styling
          scrollbarWidth: "thin",
        }}
      >
        {rallies.map((r) => {
          const rallyShots = shotsByRally.get(r.id) ?? [];
          const team0Count = rallyShots.filter((s) => teamOf(s.player_index) === 0).length;
          const team1Count = rallyShots.filter((s) => teamOf(s.player_index) === 1).length;

          const isFirefight = firefightIdxs.has(r.rally_index);
          const isActive = r.id === activeRallyId;
          const isPlaying = currentMs >= r.start_ms && currentMs <= r.end_ms;

          // Fault = the `is_final` shot has an `err` field in raw_data.
          // NOTE: we can't just use rallyShots[last] — PB Vision sometimes
          // tracks phantom shots after the point-ending one (see the Rally 6
          // putaway case), so the array's last element isn't always the shot
          // the coach flags. Pick the is_final shot explicitly so fault
          // detection and flag-match below line up with ShotSequence.
          const lastShot =
            rallyShots.find((s) => {
              const raw = (s.raw_data ?? {}) as Record<string, unknown>;
              return s.is_final && !!raw.err;
            }) ?? rallyShots[rallyShots.length - 1];
          const lastRaw = (lastShot?.raw_data ?? {}) as Record<string, unknown>;
          const hasFault = !!lastShot?.is_final && !!lastRaw.err;
          // Dismissed fault: the coach has explicitly marked this rally's
          // fault-ending shot as "not significant". Show the stripe in a
          // muted neutral color instead of alarm red so the rally card still
          // communicates "ended on fault" without demanding attention.
          const faultDismissed =
            hasFault &&
            lastShot != null &&
            (dismissedLossKeys?.has(`loss:${r.id}:${lastShot.id}`) ?? false);
          // Per docs/DESIGN_PREFERENCES.md §"States for review decisions":
          // a flagged fault is "will review" and gets its own amber stripe —
          // distinguishable from pending (red) and dismissed (gray).
          const faultFlagged =
            hasFault &&
            lastShot != null &&
            flags.some((f) => f.shot_id === lastShot.id);
          // Flagged faults collapse into the same muted gray as dismissed —
          // once the coach has committed to reviewing (or skipping) it, the
          // rally shouldn't keep shouting for attention in the strip. Only
          // pending faults stay red.
          const faultStripeColor =
            faultFlagged || faultDismissed ? "#9ca3af" : "#ef4444";
          const isUnviewed = !(viewedRallyIds?.has(r.id) ?? true);

          const seqCount = sequenceCountByRally.get(r.id) ?? 0;
          const flagCount = flagCountByRally.get(r.id) ?? 0;

          const hasScore = r.score_team0 != null && r.score_team1 != null;
          const score = hasScore ? `${r.score_team0}-${r.score_team1}` : null;

          return (
            <button
              key={r.id}
              onClick={() => onRallyClick(r)}
              title={[
                `Rally ${r.rally_index + 1}`,
                score,
                `${rallyShots.length} shots`,
                seqCount > 0 ? `${seqCount} sequence${seqCount !== 1 ? "s" : ""}` : null,
                flagCount > 0 ? `${flagCount} flag${flagCount !== 1 ? "s" : ""}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
              style={{
                flex: "0 0 60px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                padding: "6px 0",
                minHeight: 144,
                position: "relative",
                borderTop: `1px solid ${isActive ? "#1a73e8" : "#eee"}`,
                borderBottom: `1px solid ${isActive ? "#1a73e8" : "#eee"}`,
                borderLeft: `1px solid ${isActive ? "#1a73e8" : isPlaying ? "#4caf50" : "transparent"}`,
                borderRight: `1px solid ${isActive ? "#1a73e8" : isPlaying ? "#4caf50" : "transparent"}`,
                borderRadius: 6,
                // Fault is communicated as a thin stripe inset along the bottom
                // edge — red when unaddressed, muted gray when the coach has
                // marked it "not significant". Overlays existing borders
                // without conflicting with active/playing highlight colors.
                boxShadow: hasFault ? `inset 0 -3px 0 ${faultStripeColor}` : undefined,
                background: isActive ? "#e8f0fe" : isPlaying ? "#e6f4ea" : "#fafafa",
                color: "#333",
                cursor: "pointer",
                fontSize: 10,
                fontFamily: "inherit",
                transition: "background 0.1s",
              }}
              onMouseOver={(e) => {
                if (!isActive && !isPlaying) e.currentTarget.style.background = "#f0f0f0";
              }}
              onMouseOut={(e) => {
                if (!isActive && !isPlaying) e.currentTarget.style.background = "#fafafa";
              }}
            >
              {/* "Unseen" dot — auto-removed once the playhead has entered
                  this rally's range once. Corner-dot style keeps the card's
                  primary content centered. */}
              {isUnviewed && (
                <span
                  aria-label="Not yet viewed"
                  title="Not yet viewed"
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: "#1a73e8",
                  }}
                />
              )}

              {/* Rally # */}
              <span style={{ fontSize: 11, fontWeight: 600, color: isActive ? "#1a73e8" : "#555" }}>
                {r.rally_index + 1}
              </span>

              {/* Firefight marker */}
              <span style={{ fontSize: 11, height: 14, lineHeight: 1 }}>
                {isFirefight ? "🔥" : ""}
              </span>

              {/* Score — each team's digit colored with its team color */}
              {hasScore ? (
                <span
                  style={{
                    fontSize: 10,
                    padding: "1px 4px",
                    background: "#f0f0f0",
                    borderRadius: 3,
                    minWidth: 28,
                    textAlign: "center",
                    fontWeight: 700,
                  }}
                >
                  <span style={{ color: "#1a73e8" }}>{r.score_team0}</span>
                  <span style={{ color: "#888" }}>-</span>
                  <span style={{ color: "#f59e0b" }}>{r.score_team1}</span>
                </span>
              ) : (
                <span style={{ height: 14 }} />
              )}

              {/* Team bars */}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 40, width: 28 }}>
                <TeamBar count={team0Count} max={maxShots} color="#1a73e8" />
                <TeamBar count={team1Count} max={maxShots} color="#f59e0b" />
              </div>

              {/* Coach-work row: sequence + flag icons under a divider.
                  Faded when zero so every card has the same footprint. */}
              <div
                style={{
                  marginTop: 2,
                  paddingTop: 3,
                  width: "90%",
                  borderTop: "1px solid #eee",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 4,
                  height: 16,
                  fontSize: 10,
                  lineHeight: 1,
                }}
              >
                <CoachWorkIcon
                  icon="▤"
                  count={seqCount}
                  activeColor="#7c3aed"
                  label="sequence"
                />
                <CoachWorkIcon
                  icon="⚑"
                  count={flagCount}
                  activeColor="#475569"
                  label="flag"
                />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TeamBar({ count, max, color }: { count: number; max: number; color: string }) {
  const pct = Math.max(4, (count / max) * 100);
  // Bar height alone communicates relative magnitude; count labels were
  // overflowing into the rows below and cluttering the card.
  return (
    <div
      title={`${count} shot${count === 1 ? "" : "s"}`}
      style={{
        width: 10,
        height: `${pct}%`,
        background: color,
        borderRadius: 2,
      }}
    />
  );
}

/**
 * Displays a glyph for a category of coach work on a rally. Filled state is a
 * solid colored badge with count; empty state is a tiny dashed outline
 * placeholder so the row keeps its footprint without visually competing.
 */
function CoachWorkIcon({
  icon,
  count,
  activeColor,
  label,
}: {
  icon: string;
  count: number;
  activeColor: string;
  label: string;
}) {
  if (count === 0) {
    return (
      <span
        aria-label={`no ${label}s`}
        title={`No ${label}s on this rally`}
        style={{
          display: "inline-block",
          width: 14,
          height: 10,
          border: "1px dashed #ccc",
          borderRadius: 2,
          opacity: 0.6,
        }}
      />
    );
  }
  return (
    <span
      title={`${count} ${label}${count !== 1 ? "s" : ""} on this rally`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: "1px 4px",
        fontSize: 11,
        fontWeight: 800,
        color: "#fff",
        background: activeColor,
        borderRadius: 3,
        lineHeight: 1,
      }}
    >
      <span style={{ fontSize: 12 }}>{icon}</span>
      {count > 1 && <span style={{ fontSize: 9 }}>{count}</span>}
    </span>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span style={{ width: 8, height: 8, background: color, borderRadius: 2 }} />
      {label}
    </span>
  );
}
