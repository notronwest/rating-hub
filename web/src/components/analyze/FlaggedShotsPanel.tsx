import { useState } from "react";
import type { RallyShot } from "../../types/database";
import type { FlaggedShot } from "../../types/coach";
import { updateFlagNote } from "../../lib/coachApi";
import { formatMs } from "../../lib/pbvVideo";

interface PlayerInfo {
  player_index: number;
  display_name: string;
  avatar_url?: string | null;
}

interface RallyLite {
  id: string;
  rally_index: number;
}

interface Props {
  flags: FlaggedShot[];
  shots: RallyShot[];
  rallies: RallyLite[];
  players: PlayerInfo[];
  onJumpToShot: (shot: RallyShot) => void;
  onUnflag: (shotId: string) => void;
  onReload: () => void;
}

const SHOT_COLORS: Record<string, string> = {
  serve: "#e8710a",
  return: "#0d904f",
  third: "#9334e6",
  drive: "#ef5350",
  dink: "#4caf50",
  drop: "#29b6f6",
  lob: "#fdd835",
  smash: "#d93025",
  volley: "#7e57c2",
  reset: "#00bcd4",
  speedup: "#ff5722",
};

export default function FlaggedShotsPanel({
  flags,
  shots,
  rallies,
  players,
  onJumpToShot,
  onUnflag,
  onReload,
}: Props) {
  const [open, setOpen] = useState(true);

  if (flags.length === 0) return null;

  // Join flags with shot + rally info, sorted by video time
  const rows = flags
    .map((f) => {
      const shot = shots.find((s) => s.id === f.shot_id);
      if (!shot) return null;
      const rally = rallies.find((r) => r.id === shot.rally_id);
      const player = players.find((p) => p.player_index === shot.player_index);
      return { flag: f, shot, rally, player };
    })
    .filter((r): r is NonNullable<typeof r> => !!r)
    .sort((a, b) => a.shot.start_ms - b.shot.start_ms);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "10px 14px",
          background: "#fff7e6",
          borderTop: "none",
          borderBottom: open ? "1px solid #f0d169" : "none",
          borderLeft: "none",
          borderRight: "none",
          cursor: "pointer",
          fontFamily: "inherit",
          fontSize: 13,
          fontWeight: 600,
          color: "#7a5d00",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: 16 }}>🚩</span>
        <span>
          {flags.length} flagged shot{flags.length !== 1 ? "s" : ""}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: "#b88400" }}>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ maxHeight: 320, overflowY: "auto" }}>
          {rows.map(({ flag, shot, rally, player }) => (
            <FlagRow
              key={flag.id}
              flag={flag}
              shot={shot}
              rallyNumber={rally ? rally.rally_index + 1 : undefined}
              player={player ?? null}
              onJump={() => onJumpToShot(shot)}
              onUnflag={() => onUnflag(shot.id)}
              onReload={onReload}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FlagRow({
  flag,
  shot,
  rallyNumber,
  player,
  onJump,
  onUnflag,
  onReload,
}: {
  flag: FlaggedShot;
  shot: RallyShot;
  rallyNumber?: number;
  player: PlayerInfo | null;
  onJump: () => void;
  onUnflag: () => void;
  onReload: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState(flag.note ?? "");
  const [saving, setSaving] = useState(false);

  const color = SHOT_COLORS[shot.shot_type ?? "shot"] ?? "#757575";

  async function saveNote() {
    setSaving(true);
    try {
      await updateFlagNote(flag.id, noteDraft.trim() || null);
      setEditing(false);
      onReload();
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "8px 14px",
        borderBottom: "1px solid #f0f0f0",
        fontSize: 13,
      }}
    >
      <button
        onClick={onJump}
        style={{
          flexShrink: 0,
          padding: "4px 10px",
          fontSize: 11,
          fontWeight: 600,
          background: "#e8f0fe",
          color: "#1a73e8",
          borderTop: "1px solid #c6dafc",
          borderBottom: "1px solid #c6dafc",
          borderLeft: "1px solid #c6dafc",
          borderRight: "1px solid #c6dafc",
          borderRadius: 4,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        {formatMs(shot.start_ms)} ▶
      </button>

      <span
        style={{
          flexShrink: 0,
          padding: "2px 8px",
          fontSize: 10,
          fontWeight: 700,
          background: color + "22",
          color,
          borderRadius: 3,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          alignSelf: "center",
        }}
      >
        {shot.shot_type ?? "shot"}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "#333" }}>
          {rallyNumber != null && (
            <span style={{ color: "#888" }}>Rally {rallyNumber} · </span>
          )}
          <strong>{player?.display_name ?? `Player ${shot.player_index}`}</strong>
          <span style={{ color: "#888" }}> · shot {shot.shot_index + 1}</span>
        </div>

        {editing ? (
          <div style={{ marginTop: 6, display: "flex", gap: 6 }}>
            <input
              type="text"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder="Add a quick note…"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") saveNote();
                if (e.key === "Escape") setEditing(false);
              }}
              style={{
                flex: 1,
                padding: "4px 8px",
                fontSize: 12,
                borderTop: "1px solid #ddd",
                borderBottom: "1px solid #ddd",
                borderLeft: "1px solid #ddd",
                borderRight: "1px solid #ddd",
                borderRadius: 4,
                outline: "none",
                fontFamily: "inherit",
              }}
            />
            <button
              onClick={saveNote}
              disabled={saving}
              style={{
                padding: "3px 10px",
                fontSize: 11,
                fontWeight: 600,
                background: "#1a73e8",
                color: "#fff",
                borderTop: "1px solid #1a73e8",
                borderBottom: "1px solid #1a73e8",
                borderLeft: "1px solid #1a73e8",
                borderRight: "1px solid #1a73e8",
                borderRadius: 4,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {saving ? "…" : "Save"}
            </button>
            <button
              onClick={() => setEditing(false)}
              style={{
                padding: "3px 8px",
                fontSize: 11,
                background: "#fff",
                color: "#666",
                borderTop: "1px solid #ddd",
                borderBottom: "1px solid #ddd",
                borderLeft: "1px solid #ddd",
                borderRight: "1px solid #ddd",
                borderRadius: 4,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Cancel
            </button>
          </div>
        ) : (
          <div
            onClick={() => setEditing(true)}
            style={{
              fontSize: 12,
              color: flag.note ? "#555" : "#bbb",
              marginTop: 3,
              cursor: "pointer",
              fontStyle: flag.note ? "normal" : "italic",
            }}
          >
            {flag.note ?? "Add a note…"}
          </div>
        )}
      </div>

      <button
        onClick={onUnflag}
        title="Unflag"
        style={{
          flexShrink: 0,
          padding: "3px 6px",
          background: "transparent",
          borderTop: "none",
          borderBottom: "none",
          borderLeft: "none",
          borderRight: "none",
          cursor: "pointer",
          fontSize: 12,
          color: "#999",
          fontFamily: "inherit",
        }}
      >
        ✕
      </button>
    </div>
  );
}
