import type { RallyShot } from "../../types/database";

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

  // Firefight set from highlights
  const firefightIdxs = new Set(
    highlights.filter((h) => h.kind === "firefight").map((h) => h.rally_idx),
  );

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
        background: "#1a1a1a",
        borderRadius: 10,
        padding: "10px 12px",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", gap: 14, fontSize: 11, color: "#aaa" }}>
          <Legend color="#60a5fa" label="Team 0 (far)" />
          <Legend color="#4ade80" label="Team 1 (near)" />
          <span style={{ color: "#888" }}>🔥 firefight</span>
        </div>
        <div style={{ fontSize: 11, color: "#888" }}>
          {rallies.length} {rallies.length === 1 ? "rally" : "rallies"}
          <span style={{ marginLeft: 10 }}>Click a rally to jump video</span>
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

          // Fault = last shot has an "err" field in raw_data
          const lastShot = rallyShots[rallyShots.length - 1];
          const lastRaw = (lastShot?.raw_data ?? {}) as Record<string, unknown>;
          const hasFault = !!lastRaw.err;

          const score = r.score_team0 != null && r.score_team1 != null
            ? `${r.score_team0}-${r.score_team1}`
            : null;

          return (
            <button
              key={r.id}
              onClick={() => onRallyClick(r)}
              title={`Rally ${r.rally_index + 1}${score ? ` · ${score}` : ""} · ${rallyShots.length} shots`}
              style={{
                flex: "0 0 52px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 3,
                padding: "6px 0",
                minHeight: 120,
                borderTop: isActive ? "1px solid #3b82f6" : "1px solid #2a2a2a",
                borderBottom: isActive ? "1px solid #3b82f6" : "1px solid #2a2a2a",
                borderLeft: isActive ? "1px solid #3b82f6" : isPlaying ? "1px solid #4ade80" : "1px solid transparent",
                borderRight: isActive ? "1px solid #3b82f6" : isPlaying ? "1px solid #4ade80" : "1px solid transparent",
                borderRadius: 6,
                background: isActive ? "#1e3a8a33" : isPlaying ? "#14532d33" : "#222",
                color: "#ddd",
                cursor: "pointer",
                fontSize: 10,
                fontFamily: "inherit",
                transition: "background 0.1s",
              }}
              onMouseOver={(e) => {
                if (!isActive && !isPlaying) e.currentTarget.style.background = "#2c2c2c";
              }}
              onMouseOut={(e) => {
                if (!isActive && !isPlaying) e.currentTarget.style.background = "#222";
              }}
            >
              {/* Rally # */}
              <span style={{ fontSize: 11, fontWeight: 600, color: isActive ? "#93c5fd" : "#ccc" }}>
                {r.rally_index + 1}
              </span>

              {/* Firefight marker */}
              <span style={{ fontSize: 11, height: 14, lineHeight: 1 }}>
                {isFirefight ? "🔥" : ""}
              </span>

              {/* Score */}
              {score ? (
                <span
                  style={{
                    fontSize: 10,
                    padding: "1px 4px",
                    background: "#333",
                    borderRadius: 3,
                    color: "#ccc",
                    minWidth: 28,
                    textAlign: "center",
                  }}
                >
                  {score}
                </span>
              ) : (
                <span style={{ height: 14 }} />
              )}

              {/* Team bars */}
              <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 40, width: 28 }}>
                <TeamBar count={team0Count} max={maxShots} color="#60a5fa" />
                <TeamBar count={team1Count} max={maxShots} color="#4ade80" />
              </div>

              {/* Fault indicator */}
              <span style={{ fontSize: 10, height: 12, color: "#ef4444" }}>
                {hasFault ? "●" : ""}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TeamBar({ count, max, color }: { count: number; max: number; color: string }) {
  const pct = Math.max(4, (count / max) * 100);
  return (
    <div
      style={{
        width: 10,
        height: `${pct}%`,
        background: color,
        borderRadius: 2,
        position: "relative",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      {count > 0 && (
        <span
          style={{
            position: "absolute",
            bottom: -14,
            fontSize: 9,
            color: "#888",
          }}
        >
          {count}
        </span>
      )}
    </div>
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
