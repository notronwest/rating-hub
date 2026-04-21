/**
 * PatternsToolbar — launcher for the analytical Patterns / Moments panels on
 * the Coach Review page. Matches the top toolbar in PB Vision's own UI so
 * coaches have a familiar entry point.
 *
 * Each button opens a full-screen modal. Unimplemented panels are rendered
 * disabled with a "coming soon" hint so the roadmap is visible inline.
 */

import { useState } from "react";
import ShotLocationsPanel from "./ShotLocationsPanel";
import type { RallyShot } from "../../types/database";

interface PlayerLite {
  id: string;
  player_index: number;
  display_name: string;
  team: number;
  avatar_url: string | null;
}

interface RallyLite {
  id: string;
  rally_index: number;
  winning_team: number | null;
}

interface Props {
  shots: RallyShot[];
  rallies: RallyLite[];
  players: PlayerLite[];
}

type PanelId =
  | "third"
  | "fourth"
  | "serve"
  | "return"
  | "dinks"
  | "pounce"
  | "shot_quality"
  | "rally_quality"
  | "fast_shots"
  | "fast_reactions"
  | "firefights"
  | "ai_history"
  | "full_ai";

interface ToolbarBtn {
  id: PanelId;
  label: string;
  icon: string;
  section: "Patterns" | "Moments" | "Other";
  implemented: boolean;
}

const BUTTONS: ToolbarBtn[] = [
  { id: "pounce", label: "Pounce Opportunities", icon: "🐆", section: "Patterns", implemented: false },
  { id: "third", label: "3rd Shot Locations", icon: "🪢", section: "Patterns", implemented: true },
  { id: "fourth", label: "4th Shot Locations", icon: "🪢", section: "Patterns", implemented: true },
  { id: "dinks", label: "Dinks", icon: "🪀", section: "Patterns", implemented: false },
  { id: "serve", label: "Serve Locations", icon: "🎯", section: "Patterns", implemented: true },
  { id: "return", label: "Return Locations", icon: "↩️", section: "Patterns", implemented: true },
  { id: "shot_quality", label: "Shot Quality", icon: "⭐", section: "Moments", implemented: false },
  { id: "rally_quality", label: "Rally Quality", icon: "📈", section: "Moments", implemented: false },
  { id: "fast_shots", label: "Fast shots", icon: "🚀", section: "Moments", implemented: false },
  { id: "fast_reactions", label: "Fast reactions", icon: "⏱️", section: "Moments", implemented: false },
  { id: "firefights", label: "Firefights", icon: "🔥", section: "Moments", implemented: false },
  { id: "ai_history", label: "AI History", icon: "🧠", section: "Other", implemented: false },
  { id: "full_ai", label: "Full Game AI (WIP)", icon: "🤖", section: "Other", implemented: false },
];

export default function PatternsToolbar({ shots, rallies, players }: Props) {
  const [openPanel, setOpenPanel] = useState<PanelId | null>(null);

  const grouped = {
    Patterns: BUTTONS.filter((b) => b.section === "Patterns"),
    Moments: BUTTONS.filter((b) => b.section === "Moments"),
    Other: BUTTONS.filter((b) => b.section === "Other"),
  };

  // Surface whether any shots have geometry at all — if not, every panel
  // renders empty and the coach deserves a nudge to re-import augmented.
  const hasGeometry = shots.some((s) => s.contact_x != null);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 10,
        padding: "10px 12px",
        marginBottom: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#666", textTransform: "uppercase", letterSpacing: 0.5 }}>
          Patterns · Moments · Other
        </div>
        {!hasGeometry && (
          <div style={{ fontSize: 11, color: "#b45309", fontStyle: "italic" }}>
            No shot geometry yet — re-import augmented insights to populate.
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
        {(["Patterns", "Moments", "Other"] as const).map((section) => (
          <div key={section}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>
              {section}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {grouped[section].map((b) => (
                <ToolbarButton
                  key={b.id}
                  button={b}
                  onClick={() => setOpenPanel(b.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Modals */}
      {openPanel === "third" && (
        <ShotLocationsPanel
          title="3rd Shot Contact Locations"
          shots={shots}
          rallies={rallies}
          players={players}
          shotFilter={(s) => s.shot_index === 2}
          subTypes={[
            { label: "Drive", match: (s) => s.shot_type === "drive" },
            { label: "Drop", match: (s) => s.shot_type === "drop" },
          ]}
          onClose={() => setOpenPanel(null)}
        />
      )}
      {openPanel === "fourth" && (
        <ShotLocationsPanel
          title="4th Shot Contact Locations"
          shots={shots}
          rallies={rallies}
          players={players}
          shotFilter={(s) => s.shot_index === 3}
          onClose={() => setOpenPanel(null)}
        />
      )}
      {openPanel === "serve" && (
        <ShotLocationsPanel
          title="Serve Contact Locations"
          shots={shots}
          rallies={rallies}
          players={players}
          shotFilter={(s) => s.shot_index === 0 || s.shot_type === "serve"}
          onClose={() => setOpenPanel(null)}
        />
      )}
      {openPanel === "return" && (
        <ShotLocationsPanel
          title="Return Contact Locations"
          shots={shots}
          rallies={rallies}
          players={players}
          shotFilter={(s) => s.shot_index === 1 || s.shot_type === "return"}
          onClose={() => setOpenPanel(null)}
        />
      )}
    </div>
  );
}

function ToolbarButton({
  button,
  onClick,
}: {
  button: ToolbarBtn;
  onClick: () => void;
}) {
  const { label, icon, implemented } = button;
  return (
    <button
      onClick={implemented ? onClick : undefined}
      disabled={!implemented}
      title={implemented ? label : `${label} — coming soon`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        fontSize: 12,
        fontWeight: 600,
        background: implemented ? "#1a1a1a" : "#f0f0f0",
        color: implemented ? "#fff" : "#999",
        border: `1px solid ${implemented ? "#1a1a1a" : "#e0e0e0"}`,
        borderRadius: 6,
        cursor: implemented ? "pointer" : "not-allowed",
        fontFamily: "inherit",
        opacity: implemented ? 1 : 0.7,
      }}
    >
      <span style={{ fontSize: 14 }}>{icon}</span>
      {label}
    </button>
  );
}
