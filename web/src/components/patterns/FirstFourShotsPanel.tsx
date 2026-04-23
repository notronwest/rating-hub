/**
 * First-4-Shots Panel — per-player report card on the scripted opening of
 * each rally (deep serve, deep return + kitchen arrival, 3rd-shot drop, 4th
 * out of the air). Reads directly from shot geometry + shot type; no extra
 * DB state.
 */

import { useMemo } from "react";
import type { RallyShot } from "../../types/database";
import {
  computePlayerScripts,
  type PlayerInfo,
  type RallyInfo,
} from "../../lib/firstFourShots";
import PlayerScriptCard from "./PlayerScriptCard";

interface Props {
  shots: RallyShot[];
  rallies: RallyInfo[];
  players: PlayerInfo[];
  onClose: () => void;
}

export default function FirstFourShotsPanel({ shots, rallies, players, onClose }: Props) {
  const scripts = useMemo(
    () => computePlayerScripts(shots, rallies, players),
    [shots, rallies, players],
  );
  const hasGeometry = shots.some((s) => s.player_positions != null);

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
          maxWidth: 1000,
          maxHeight: "100%",
          overflow: "auto",
          position: "relative",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 14,
            marginBottom: 10,
            flexWrap: "wrap",
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>
            First 4 Shots — Scripted Start
          </h2>
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
          The textbook opening: <b>deep serve</b>, <b>deep return + returner up to the kitchen by the 4th shot</b>,
          a <b>3rd-shot drop</b> (or a drive followed by the same player's drop on the 5th — signifying they know
          they couldn't drive their way in), and the <b>4th struck out of the air</b> when possible. Scores below
          are against every rally where that player took that shot.
        </p>

        {!hasGeometry && (
          <div
            style={{
              padding: 10,
              background: "#fef3c7",
              border: "1px solid #fde68a",
              borderRadius: 6,
              fontSize: 12,
              color: "#92400e",
              marginBottom: 14,
            }}
          >
            Geometry missing. Re-import augmented insights to populate contact / position data.
          </div>
        )}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
            gap: 12,
          }}
        >
          {scripts.map((s) => (
            <PlayerScriptCard key={s.player.id} script={s} />
          ))}
        </div>
      </div>
    </div>
  );
}
