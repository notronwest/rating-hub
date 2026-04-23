/**
 * Full-game defensive beats panel — one card per player showing how they
 * were beat in direct vs diagonal roles.
 */

import { useMemo } from "react";
import type { RallyShot } from "../../types/database";
import {
  analyzeDefensiveBeats,
  type PlayerInfo,
  type RallyInfo,
} from "../../lib/defensiveBeats";
import DefensiveBeatsCard from "./DefensiveBeatsCard";

interface Props {
  shots: RallyShot[];
  rallies: RallyInfo[];
  players: PlayerInfo[];
  onClose: () => void;
}

export default function DefensiveBeatsPanel({
  shots,
  rallies,
  players,
  onClose,
}: Props) {
  const { perPlayer, events } = useMemo(
    () => analyzeDefensiveBeats(shots, rallies, players),
    [shots, rallies, players],
  );

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
          padding: 22,
          width: "100%",
          maxWidth: 1100,
          maxHeight: "100%",
          overflow: "auto",
        }}
      >
        <header style={{ display: "flex", alignItems: "baseline", gap: 14, marginBottom: 10 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
            Defensive Beats — Line vs Middle
          </h2>
          <span style={{ fontSize: 12, color: "#666" }}>
            {events.length} rally-ending winners analyzed
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
        </header>

        <p style={{ fontSize: 12, color: "#666", margin: "0 0 14px 0", lineHeight: 1.5 }}>
          Every time an opponent hit a rally-ending winner, we classify where the ball landed
          (line vs middle vs body) and the defenders' positions at that moment. <b>Line</b> and
          <b> body on your side</b> are your duty as the <b>direct</b> defender (across from the
          shooter). <b>Middle</b> and <b>your own body from cross</b> are your duty as the{" "}
          <b>diagonal</b> defender. Drift numbers show how far from the ideal coverage spot you
          were averaged across these events.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
            gap: 12,
          }}
        >
          {perPlayer.map((s) => (
            <DefensiveBeatsCard key={s.player.id} summary={s} />
          ))}
        </div>
      </div>
    </div>
  );
}
