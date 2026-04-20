import type { RallyShot } from "../../types/database";

interface Rally {
  id: string;
  rally_index: number;
  winning_team: number | null;
}

interface PlayerInfo {
  player_index: number;
  display_name: string;
  team: number;
  avatar_url?: string | null;
}

interface Props {
  rallies: Rally[];
  shots: RallyShot[];
  players: PlayerInfo[];
  scoringType: string | null; // "side_out" or "rally" — affects Game Pts Lost
  focusedPlayerIndex: number | null;
}

/**
 * Per-team breakdown of rally losses by category, mirroring pickleball game
 * explorer's "Reasons for Losing Rally" table.
 *
 * Derives categories from each rally's final shot + err field:
 *   - err.f.n         → Net / tape
 *   - err.f.out       → Hit out
 *   - err.f.sh        → Short
 *   - err.uf = 1      → Unforced error
 *   - err (other)     → Forced fault
 *   - err.pop = 1     → Popup exploited (winning team's putaway off a popup)
 * Shot-type-specific buckets (checked first):
 *   - Missed serve / Missed return / Missed 3rd drop
 *
 * "Opportunities Lost" = every rally a team lost in that category.
 * "Game Pts Lost" = rallies where the serving team was the winner (they scored
 *   under side-out scoring). In rally scoring, equals Opportunities Lost.
 */

type ReasonId =
  | "missed_serve"
  | "missed_return"
  | "missed_3rd_drop"
  | "net"
  | "out"
  | "short"
  | "unforced"
  | "forced"
  | "popup";

const REASONS: { id: ReasonId; label: string; icon: string; color: string }[] = [
  { id: "missed_serve", label: "Missed serves", icon: "🎾", color: "#e8710a" },
  { id: "missed_return", label: "Missed returns", icon: "↩", color: "#0d904f" },
  { id: "missed_3rd_drop", label: "Missed 3rd drops", icon: "3", color: "#9334e6" },
  { id: "net", label: "Net / tape", icon: "〰", color: "#607d8b" },
  { id: "out", label: "Hit out", icon: "↗", color: "#c62828" },
  { id: "short", label: "Short", icon: "↘", color: "#6a1b9a" },
  { id: "unforced", label: "Unforced errors", icon: "ⓘ", color: "#ef5350" },
  { id: "forced", label: "Forced faults", icon: "⚡", color: "#fbc02d" },
  { id: "popup", label: "Popups exploited", icon: "📈", color: "#29b6f6" },
];

function teamOf(playerIndex: number | null | undefined): 0 | 1 | null {
  if (playerIndex == null) return null;
  return playerIndex < 2 ? 0 : 1;
}

function categorizeRallyLoss(
  rallyShots: RallyShot[],
  losingTeam: 0 | 1,
  /** When set, only include rallies where THIS player can be held responsible. */
  focusedPlayerIndex: number | null,
): ReasonId | null {
  const finalShot = rallyShots[rallyShots.length - 1];
  if (!finalShot) return null;
  const raw = (finalShot.raw_data ?? {}) as {
    err?: {
      f?: { n?: number; out?: unknown; sh?: number };
      uf?: number;
      pop?: number;
    };
  };
  const err = raw.err;
  if (!err) return null;

  const finalShotTeam = teamOf(finalShot.player_index);
  const lostByFinalShot = finalShotTeam === losingTeam;

  // Popup exploited: winning-team putaway off a losing-team popup. The blame
  // goes to whoever on the losing team hit the SECOND-to-last shot (the popup).
  if (err.pop && !lostByFinalShot) {
    const popupShot = rallyShots[rallyShots.length - 2];
    if (!popupShot) return null;
    if (teamOf(popupShot.player_index) !== losingTeam) return null;
    if (
      focusedPlayerIndex != null &&
      popupShot.player_index !== focusedPlayerIndex
    ) {
      return null;
    }
    return "popup";
  }

  // For non-popup losses, the losing team hit the final (faulty) shot
  if (!lostByFinalShot) return null;

  // Player focus: attribute only to the player who hit the fault
  if (
    focusedPlayerIndex != null &&
    finalShot.player_index !== focusedPlayerIndex
  ) {
    return null;
  }

  // Shot-type-specific buckets take priority
  if (finalShot.shot_type === "serve") return "missed_serve";
  if (finalShot.shot_type === "return") return "missed_return";
  if (
    finalShot.shot_index === 2 &&
    (finalShot.shot_type === "drop" ||
      finalShot.shot_type === "third" ||
      finalShot.shot_type === "third_drops")
  ) {
    return "missed_3rd_drop";
  }

  // Otherwise categorize by error detail
  if (err.f?.n) return "net";
  if (err.f?.out) return "out";
  if (err.f?.sh) return "short";
  if (err.uf === 1) return "unforced";
  return "forced";
}

type Counts = Record<string, { opps: number; pts: number }>;

function makeEmptyCounts(): Counts {
  const c: Counts = {};
  for (const r of REASONS) c[r.id] = { opps: 0, pts: 0 };
  return c;
}

export default function ReasonsForLosingRally({
  rallies,
  shots,
  players,
  scoringType,
  focusedPlayerIndex,
}: Props) {
  // Group shots by rally for fast lookup
  const shotsByRally = new Map<string, RallyShot[]>();
  for (const s of shots) {
    if (!shotsByRally.has(s.rally_id)) shotsByRally.set(s.rally_id, []);
    shotsByRally.get(s.rally_id)!.push(s);
  }

  const focusedPlayer =
    focusedPlayerIndex != null
      ? players.find((p) => p.player_index === focusedPlayerIndex) ?? null
      : null;

  // Either one bucket per team (unfocused) or one bucket for the focused player
  const team0Counts: Counts = makeEmptyCounts();
  const team1Counts: Counts = makeEmptyCounts();
  const playerCounts: Counts = makeEmptyCounts();

  const isSideOut = scoringType !== "rally";

  for (const rally of rallies) {
    if (rally.winning_team == null) continue;
    const losingTeam = (1 - rally.winning_team) as 0 | 1;

    // When focused, skip rallies where that player's team didn't lose
    if (focusedPlayer && focusedPlayer.team !== losingTeam) continue;

    const rallyShots = (shotsByRally.get(rally.id) ?? []).sort(
      (a, b) => a.shot_index - b.shot_index,
    );
    const firstShot = rallyShots[0];
    const servingTeam = teamOf(firstShot?.player_index);

    const pointScored = !isSideOut || servingTeam === rally.winning_team;

    const reason = categorizeRallyLoss(
      rallyShots,
      losingTeam,
      focusedPlayerIndex,
    );
    if (!reason) continue;

    if (focusedPlayer) {
      playerCounts[reason].opps += 1;
      if (pointScored) playerCounts[reason].pts += 1;
    } else {
      const bucket = losingTeam === 0 ? team0Counts : team1Counts;
      bucket[reason].opps += 1;
      if (pointScored) bucket[reason].pts += 1;
    }
  }

  // Labels
  const team0Label =
    players
      .filter((p) => p.team === 0)
      .map((p) => p.display_name.split(" ")[0])
      .join(" & ") || "Team 0";
  const team1Label =
    players
      .filter((p) => p.team === 1)
      .map((p) => p.display_name.split(" ")[0])
      .join(" & ") || "Team 1";

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 12,
        padding: "16px 18px",
      }}
    >
      <h3 style={{ fontSize: 14, fontWeight: 600, margin: "0 0 12px" }}>
        Reasons for Losing Rally
        {focusedPlayer && (
          <span style={{ fontSize: 12, fontWeight: 400, color: "#666", marginLeft: 8 }}>
            — focused on {focusedPlayer.display_name}
          </span>
        )}
      </h3>
      {focusedPlayer ? (
        <TeamTable
          teamLabel={focusedPlayer.display_name}
          teamColor={focusedPlayer.team === 0 ? "#1a73e8" : "#4caf50"}
          counts={playerCounts}
          avatarUrl={focusedPlayer.avatar_url ?? null}
        />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <TeamTable teamLabel={team0Label} teamColor="#1a73e8" counts={team0Counts} />
          <TeamTable teamLabel={team1Label} teamColor="#4caf50" counts={team1Counts} />
        </div>
      )}
    </div>
  );
}

function TeamTable({
  teamLabel,
  teamColor,
  counts,
  avatarUrl,
}: {
  teamLabel: string;
  teamColor: string;
  counts: Record<string, { opps: number; pts: number }>;
  avatarUrl?: string | null;
}) {
  const visibleReasons = REASONS.filter((r) => counts[r.id]?.opps > 0);
  const totalOpps = Object.values(counts).reduce((s, v) => s + v.opps, 0);
  const totalPts = Object.values(counts).reduce((s, v) => s + v.pts, 0);

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          background: teamColor + "15",
          borderLeft: `3px solid ${teamColor}`,
          borderRadius: 4,
          marginBottom: 8,
        }}
      >
        {avatarUrl && (
          <img
            src={avatarUrl}
            alt=""
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              objectFit: "cover",
              flexShrink: 0,
            }}
          />
        )}
        <span style={{ fontSize: 13, fontWeight: 600, color: "#333", flex: 1 }}>
          {teamLabel}
        </span>
        <span style={{ fontSize: 11, color: "#666" }}>
          {totalOpps} rallies lost · {totalPts} game pts
        </span>
      </div>

      {visibleReasons.length === 0 ? (
        <div style={{ fontSize: 13, color: "#999", padding: 10, textAlign: "center" }}>
          No losses categorized yet.
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle("left")}>Reason</th>
              <th style={thStyle("right")}>Game Pts</th>
              <th style={thStyle("right")}>Opportunities</th>
            </tr>
          </thead>
          <tbody>
            {visibleReasons.map((r) => {
              const c = counts[r.id];
              return (
                <tr key={r.id}>
                  <td style={{ ...tdStyle, display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 18,
                        height: 18,
                        borderRadius: 4,
                        background: r.color + "20",
                        color: r.color,
                        fontSize: 10,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {r.icon}
                    </span>
                    <span>{r.label}</span>
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", fontWeight: 600 }}>
                    {c.pts || "—"}
                  </td>
                  <td style={{ ...tdStyle, textAlign: "right", color: "#666" }}>
                    {c.opps}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

const thStyle = (align: "left" | "right"): React.CSSProperties => ({
  padding: "6px 8px",
  textAlign: align,
  fontSize: 11,
  fontWeight: 600,
  color: "#888",
  textTransform: "uppercase",
  letterSpacing: 0.3,
  borderBottom: "1px solid #eee",
});

const tdStyle: React.CSSProperties = {
  padding: "6px 8px",
  fontSize: 13,
  borderBottom: "1px solid #f5f5f5",
  color: "#333",
};
