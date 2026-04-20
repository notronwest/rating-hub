import { useState } from "react";
import type { RallyShot } from "../../types/database";
import type { AnalysisSequence } from "../../types/coach";
import {
  createSequence,
  updateSequence,
  deleteSequence,
} from "../../lib/coachApi";
import { formatMs } from "../../lib/pbvVideo";

interface PlayerInfo {
  id: string;
  player_index: number;
  display_name: string;
  team: number;
}

interface Rally {
  id: string;
  rally_index: number;
}

interface Props {
  analysisId: string;
  rally: Rally | null;
  shots: RallyShot[];
  players: PlayerInfo[];
  sequences: AnalysisSequence[];
  activeSequenceId: string | null;
  buildMode: boolean;
  draftShotIds: Set<string>;
  focusedPlayerIndex: number | null;
  onCancelBuild: () => void;
  onClearDraft: () => void;
  onPlayDraft: () => void;
  onActivateSequence: (seq: AnalysisSequence) => void;
  onReload: () => void;
}

export default function SequenceManager({
  analysisId,
  rally,
  shots,
  players,
  sequences,
  activeSequenceId,
  buildMode,
  draftShotIds,
  focusedPlayerIndex,
  onCancelBuild,
  onClearDraft,
  onPlayDraft,
  onActivateSequence,
  onReload,
}: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [playerId, setPlayerId] = useState<string>("");
  const [whatWentWrong, setWhatWentWrong] = useState("");
  const [howToFix, setHowToFix] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (!rally || draftShotIds.size === 0) {
      setError("Select at least one shot.");
      return;
    }
    if (!whatWentWrong.trim() && !howToFix.trim()) {
      setError("Please add notes in at least one field.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const orderedShotIds = shots
        .filter((s) => draftShotIds.has(s.id))
        .sort((a, b) => a.shot_index - b.shot_index)
        .map((s) => s.id);

      const focusedPlayer = focusedPlayerIndex != null
        ? players.find((p) => p.player_index === focusedPlayerIndex) ?? null
        : null;

      await createSequence({
        analysisId,
        rallyId: rally.id,
        shotIds: orderedShotIds,
        label: label.trim() || null,
        playerId: playerId || focusedPlayer?.id || null,
        whatWentWrong: whatWentWrong.trim() || null,
        howToFix: howToFix.trim() || null,
      });

      // Reset form
      setLabel("");
      setPlayerId("");
      setWhatWentWrong("");
      setHowToFix("");
      setFormOpen(false);
      onClearDraft();
      onCancelBuild();
      onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(seq: AnalysisSequence) {
    if (!confirm("Delete this sequence?")) return;
    try {
      await deleteSequence(seq.id);
      onReload();
    } catch (e) {
      console.error(e);
    }
  }

  // Find the current rally's saved sequences
  const rallySequences = rally
    ? sequences.filter((s) => s.rally_id === rally.id)
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Build-mode toolbar */}
      {buildMode && (
        <div
          style={{
            padding: "10px 12px",
            background: "#fff8e1",
            border: "1px solid #f0d169",
            borderRadius: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: formOpen ? 10 : 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#7a5d00" }}>
              📋 Building sequence
            </span>
            <span style={{ fontSize: 12, color: "#7a5d00" }}>
              {draftShotIds.size} shot{draftShotIds.size !== 1 ? "s" : ""} selected
            </span>
            <span style={{ flex: 1 }} />
            <button
              onClick={onPlayDraft}
              disabled={draftShotIds.size === 0}
              style={btn(false, draftShotIds.size === 0)}
            >
              ▶ Play on loop
            </button>
            <button
              onClick={() => {
                if (draftShotIds.size === 0) {
                  setError("Select at least one shot first.");
                  return;
                }
                setFormOpen(true);
                setError(null);
              }}
              disabled={draftShotIds.size === 0}
              style={btn(true, draftShotIds.size === 0)}
            >
              💾 Save with notes
            </button>
            <button
              onClick={() => {
                onClearDraft();
                onCancelBuild();
                setFormOpen(false);
                setError(null);
              }}
              style={{ ...btn(false, false), background: "transparent", color: "#7a5d00" }}
            >
              × Cancel
            </button>
          </div>

          {formOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                type="text"
                placeholder="Optional label (e.g. 'Third-shot drop went too deep')"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                style={inputStyle}
              />
              <select
                value={playerId}
                onChange={(e) => setPlayerId(e.target.value)}
                style={{ ...inputStyle, padding: "6px 8px" }}
              >
                <option value="">Focus player (optional)</option>
                {players.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.display_name} (T{p.team})
                  </option>
                ))}
              </select>
              <div>
                <label style={labelStyle}>What went wrong</label>
                <textarea
                  value={whatWentWrong}
                  onChange={(e) => setWhatWentWrong(e.target.value)}
                  rows={3}
                  placeholder="Describe the error or missed opportunity…"
                  style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
                />
              </div>
              <div>
                <label style={labelStyle}>How to fix it</label>
                <textarea
                  value={howToFix}
                  onChange={(e) => setHowToFix(e.target.value)}
                  rows={3}
                  placeholder="Coaching correction, drill suggestion, reminder cue…"
                  style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }}
                />
              </div>
              {error && <div style={{ color: "crimson", fontSize: 12 }}>{error}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={() => setFormOpen(false)}
                  style={{ ...btn(false, false), background: "transparent" }}
                >
                  Close form
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  style={btn(true, saving)}
                >
                  {saving ? "Saving…" : "Save sequence"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Saved sequences for this rally */}
      {rallySequences.length > 0 && (
        <div
          style={{
            background: "#fff",
            border: "1px solid #e2e2e2",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "8px 12px",
              background: "#f8f9fa",
              borderBottom: "1px solid #eee",
              fontSize: 12,
              fontWeight: 600,
              color: "#666",
            }}
          >
            Saved sequences for this rally · {rallySequences.length}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {rallySequences.map((seq) => (
              <SavedSequenceRow
                key={seq.id}
                seq={seq}
                shots={shots}
                players={players}
                isActive={seq.id === activeSequenceId}
                onActivate={() => onActivateSequence(seq)}
                onDelete={() => handleDelete(seq)}
                onReload={onReload}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SavedSequenceRow({
  seq,
  shots,
  players,
  isActive,
  onActivate,
  onDelete,
  onReload,
}: {
  seq: AnalysisSequence;
  shots: RallyShot[];
  players: PlayerInfo[];
  isActive: boolean;
  onActivate: () => void;
  onDelete: () => void;
  onReload: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [whatWrong, setWhatWrong] = useState(seq.what_went_wrong ?? "");
  const [howFix, setHowFix] = useState(seq.how_to_fix ?? "");

  const seqShots = seq.shot_ids
    .map((id) => shots.find((s) => s.id === id))
    .filter((s): s is RallyShot => !!s);
  const firstShot = seqShots[0];
  const lastShot = seqShots[seqShots.length - 1];
  const player = seq.player_id
    ? players.find((p) => p.id === seq.player_id) ?? null
    : null;

  async function handleSaveEdit() {
    try {
      await updateSequence(seq.id, {
        what_went_wrong: whatWrong.trim() || null,
        how_to_fix: howFix.trim() || null,
      });
      setEditing(false);
      onReload();
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div style={{ borderBottom: "1px solid #f0f0f0" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          background: isActive ? "#e8f0fe" : "#fff",
          borderLeft: isActive ? "3px solid #1a73e8" : "3px solid transparent",
          cursor: "pointer",
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            onActivate();
          }}
          style={playBtn(isActive)}
          title="Play this sequence on loop"
        >
          ▶
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#333", display: "flex", alignItems: "center", gap: 8 }}>
            {seq.label ?? `Shots ${seqShots.map((s) => s.shot_index + 1).join(", ")}`}
            {player && (
              <span
                style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  background: "#f0f0f0",
                  color: "#555",
                  borderRadius: 3,
                }}
              >
                {player.display_name.split(" ")[0]}
              </span>
            )}
          </div>
          <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
            {seqShots.length} shot{seqShots.length !== 1 ? "s" : ""}
            {firstShot && lastShot && (
              <span> · {formatMs(firstShot.start_ms)}–{formatMs(lastShot.end_ms)}</span>
            )}
            {seq.what_went_wrong && !expanded && (
              <span style={{ marginLeft: 8, color: "#999" }}>
                · {seq.what_went_wrong.slice(0, 60)}{seq.what_went_wrong.length > 60 ? "…" : ""}
              </span>
            )}
          </div>
        </div>
        <span style={{ fontSize: 10, color: "#bbb" }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div style={{ padding: "10px 14px 14px", fontSize: 13, background: "#fafafa" }}>
          {editing ? (
            <>
              <label style={labelStyle}>What went wrong</label>
              <textarea
                value={whatWrong}
                onChange={(e) => setWhatWrong(e.target.value)}
                rows={3}
                style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", marginBottom: 8 }}
              />
              <label style={labelStyle}>How to fix it</label>
              <textarea
                value={howFix}
                onChange={(e) => setHowFix(e.target.value)}
                rows={3}
                style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit", marginBottom: 8 }}
              />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button onClick={() => setEditing(false)} style={{ ...btn(false, false), background: "#fff" }}>
                  Cancel
                </button>
                <button onClick={handleSaveEdit} style={btn(true, false)}>
                  Save
                </button>
              </div>
            </>
          ) : (
            <>
              {seq.what_went_wrong && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: "#c62828", fontWeight: 600, marginBottom: 2 }}>
                    What went wrong
                  </div>
                  <div style={{ color: "#333", whiteSpace: "pre-wrap" }}>{seq.what_went_wrong}</div>
                </div>
              )}
              {seq.how_to_fix && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 11, color: "#1e7e34", fontWeight: 600, marginBottom: 2 }}>
                    How to fix it
                  </div>
                  <div style={{ color: "#333", whiteSpace: "pre-wrap" }}>{seq.how_to_fix}</div>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(true);
                  }}
                  style={{ ...btn(false, false), background: "#fff" }}
                >
                  Edit
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  style={{ ...btn(false, false), background: "#fff", color: "#c62828", borderColor: "#f5c0bd" } as React.CSSProperties}
                >
                  Delete
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── styles ──
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  fontSize: 13,
  borderTop: "1px solid #ddd",
  borderBottom: "1px solid #ddd",
  borderLeft: "1px solid #ddd",
  borderRight: "1px solid #ddd",
  borderRadius: 5,
  outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 11,
  fontWeight: 600,
  color: "#666",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  marginBottom: 3,
  marginTop: 4,
};

function btn(primary: boolean, disabled: boolean): React.CSSProperties {
  return {
    padding: "5px 12px",
    fontSize: 12,
    fontWeight: 600,
    borderTop: `1px solid ${primary ? "#1a73e8" : "#ddd"}`,
    borderBottom: `1px solid ${primary ? "#1a73e8" : "#ddd"}`,
    borderLeft: `1px solid ${primary ? "#1a73e8" : "#ddd"}`,
    borderRight: `1px solid ${primary ? "#1a73e8" : "#ddd"}`,
    borderRadius: 5,
    background: disabled ? "#aab" : primary ? "#1a73e8" : "#fff",
    color: primary ? "#fff" : "#333",
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "inherit",
    opacity: disabled ? 0.6 : 1,
  };
}

function playBtn(active: boolean): React.CSSProperties {
  return {
    flexShrink: 0,
    width: 28,
    height: 28,
    borderRadius: "50%",
    borderTop: "1px solid",
    borderBottom: "1px solid",
    borderLeft: "1px solid",
    borderRight: "1px solid",
    borderColor: active ? "#1a73e8" : "#ddd",
    background: active ? "#1a73e8" : "#fff",
    color: active ? "#fff" : "#1a73e8",
    fontSize: 11,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "inherit",
  };
}
