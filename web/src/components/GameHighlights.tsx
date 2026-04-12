import type { GamePlayerShotType } from "../types/database";

// Data needed to compute highlights for a single game
export interface GameHighlightData {
  gameId: string;
  gameName: string;
  rallies: { shot_count: number | null }[];
  players: {
    playerName: string;
    shotCount: number | null;
    shotAccuracy: { in?: number; net?: number; out?: number } | null;
  }[];
  shotTypes: GamePlayerShotType[];
}

export interface HighlightItem {
  label: string;
  value: string;
  detail?: string;
}

export function computeHighlights(data: GameHighlightData): HighlightItem[] {
  const highlights: HighlightItem[] = [];

  // 1. Longest Rally
  const longestRally = data.rallies.reduce(
    (max, r) => Math.max(max, r.shot_count ?? 0),
    0,
  );
  if (longestRally > 0) {
    highlights.push({
      label: "Longest Rally",
      value: `${longestRally} shots`,
    });
  }

  // 2. Most Shots Taken (by a player)
  const mostShots = data.players.reduce(
    (best, p) =>
      (p.shotCount ?? 0) > (best.shotCount ?? 0) ? p : best,
    data.players[0],
  );
  if (mostShots && (mostShots.shotCount ?? 0) > 0) {
    highlights.push({
      label: "Most Shots",
      value: `${mostShots.shotCount}`,
      detail: mostShots.playerName,
    });
  }

  // 3. Best Shot Percentage (highest "in" accuracy)
  const bestAccuracy = data.players
    .filter((p) => p.shotAccuracy?.in != null && (p.shotCount ?? 0) > 0)
    .reduce(
      (best, p) =>
        (p.shotAccuracy?.in ?? 0) > (best?.shotAccuracy?.in ?? 0) ? p : best,
      null as (typeof data.players)[number] | null,
    );
  if (bestAccuracy?.shotAccuracy?.in != null) {
    highlights.push({
      label: "Best Shot %",
      value: `${(bestAccuracy.shotAccuracy.in * 100).toFixed(0)}%`,
      detail: bestAccuracy.playerName,
    });
  }

  // 4. Total 3rd Shot Drops (sum across all players)
  const thirdDrops = data.shotTypes
    .filter((st) => st.shot_type === "third_drops")
    .reduce((sum, st) => sum + (st.count ?? 0), 0);
  highlights.push({
    label: "3rd Shot Drops",
    value: `${thirdDrops}`,
  });

  // 5. Best 3rd Shot Percentage (highest success % among players with third_drops)
  const thirdDropEntries = data.shotTypes.filter(
    (st) => st.shot_type === "third_drops" && (st.count ?? 0) > 0,
  );
  if (thirdDropEntries.length > 0) {
    const best3rd = thirdDropEntries.reduce((best, st) => {
      const bestPct =
        (best.outcome_stats as Record<string, number> | null)
          ?.success_percentage ?? 0;
      const thisPct =
        (st.outcome_stats as Record<string, number> | null)
          ?.success_percentage ?? 0;
      return thisPct > bestPct ? st : best;
    });
    const pct =
      (best3rd.outcome_stats as Record<string, number> | null)
        ?.success_percentage;
    const playerName =
      data.players.find((_, idx) =>
        data.shotTypes.some(
          (st) =>
            st.player_id === best3rd.player_id &&
            st.shot_type === "third_drops",
        ),
      )?.playerName ?? "";
    // Find the actual player name by player_id
    const matchedPlayer = data.players.find((p) => {
      // We need to match by checking shotTypes for this player_id
      return data.shotTypes.some(
        (st) =>
          st.player_id === best3rd.player_id && st.shot_type === "third_drops",
      );
    });
    if (pct != null) {
      highlights.push({
        label: "Best 3rd Shot %",
        value: `${pct.toFixed(0)}%`,
        detail: matchedPlayer?.playerName ?? playerName,
      });
    }
  }

  // 6. Total Resets
  const totalResets = data.shotTypes
    .filter((st) => st.shot_type === "resets")
    .reduce((sum, st) => sum + (st.count ?? 0), 0);
  highlights.push({
    label: "Resets",
    value: `${totalResets}`,
  });

  return highlights;
}

// Compact display for session detail page
export function GameHighlightsCompact({
  highlights,
}: {
  highlights: HighlightItem[];
}) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      {highlights.map((h) => (
        <div
          key={h.label}
          style={{
            padding: "6px 10px",
            background: "#f8f9fa",
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          <span style={{ color: "#888" }}>{h.label}: </span>
          <span style={{ fontWeight: 600 }}>{h.value}</span>
          {h.detail && (
            <span style={{ color: "#999", marginLeft: 4 }}>({h.detail})</span>
          )}
        </div>
      ))}
    </div>
  );
}

// Full display for game detail page
export function GameHighlightsFull({
  highlights,
}: {
  highlights: HighlightItem[];
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: 12,
        marginBottom: 24,
      }}
    >
      {highlights.map((h) => (
        <div
          key={h.label}
          style={{
            padding: "12px 14px",
            border: "1px solid #e2e2e2",
            borderRadius: 10,
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: 11,
              color: "#888",
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            {h.label}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>
            {h.value}
          </div>
          {h.detail && (
            <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>
              {h.detail}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
