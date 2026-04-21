import { useEffect, useState } from "react";
import type { RallyShot } from "../../types/database";
import type { AnalysisSequence } from "../../types/coach";
import {
  createSequence,
  updateSequence,
  deleteSequence,
} from "../../lib/coachApi";
import { formatMs } from "../../lib/pbvVideo";
import FptmEditor from "./FptmEditor";
import { summarizeFptm, type FptmValue } from "../../lib/fptm";

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
  focusedPlayerIndex: _focusedPlayerIndex,
  onCancelBuild,
  onClearDraft,
  onPlayDraft: _onPlayDraft,
  onActivateSequence,
  onReload,
}: Props) {
  const [label, setLabel] = useState("");
  // Default to ALL players selected whenever build mode enters (see effect below)
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(
    new Set(),
  );
  const [fptm, setFptm] = useState<FptmValue>({});
  const [drills, setDrills] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Entering build mode resets the form with all players pre-selected so the
  // coach just needs to pick shots and hit Save.
  useEffect(() => {
    if (buildMode) {
      setSelectedPlayerIds(new Set(players.map((p) => p.id)));
    }
  }, [buildMode, players]);

  function togglePlayer(id: string) {
    setSelectedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    if (!rally || draftShotIds.size === 0) {
      setError("Select at least one shot.");
      return;
    }
    if (selectedPlayerIds.size === 0) {
      setError("Select at least one player.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const orderedShotIds = shots
        .filter((s) => draftShotIds.has(s.id))
        .sort((a, b) => a.shot_index - b.shot_index)
        .map((s) => s.id);

      const ids = Array.from(selectedPlayerIds);

      await createSequence({
        analysisId,
        rallyId: rally.id,
        shotIds: orderedShotIds,
        label: label.trim() || null,
        playerIds: ids,
        playerId: ids.length === 1 ? ids[0] : null,
        fptm: Object.keys(fptm).length > 0 ? fptm : null,
        drills: drills ?? null,
      });

      // Reset form
      setLabel("");
      setSelectedPlayerIds(new Set());
      setFptm({});
      setDrills(null);
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
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#7a5d00" }}>
              📋 Building sequence
            </span>
            <span style={{ fontSize: 12, color: "#7a5d00" }}>
              {draftShotIds.size} shot{draftShotIds.size !== 1 ? "s" : ""} selected
            </span>
            <span style={{ fontSize: 11, color: "#7a5d00", fontStyle: "italic" }}>
              Auto-looping
            </span>
            <span style={{ flex: 1 }} />
            <button
              onClick={() => {
                onClearDraft();
                onCancelBuild();
                setError(null);
              }}
              style={{ ...btn(false, false), background: "transparent", color: "#7a5d00" }}
            >
              × Cancel
            </button>
          </div>

          {/* Edit panel is always open while building — coach picks shots on
              the right, fills in diagnosis/players here, hits Save. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input
                type="text"
                placeholder="Optional label (e.g. 'Third-shot drop went too deep')"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                style={inputStyle}
              />
              <div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 6,
                  }}
                >
                  <label style={{ ...labelStyle, margin: 0 }}>
                    Players in this sequence
                  </label>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedPlayerIds(new Set(players.map((p) => p.id)))
                      }
                      style={tinyBtn}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPlayerIds(new Set())}
                      style={tinyBtn}
                    >
                      None
                    </button>
                  </div>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                    gap: 6,
                  }}
                >
                  {players.map((p) => {
                    const checked = selectedPlayerIds.has(p.id);
                    const teamColor = p.team === 0 ? "#1a73e8" : "#f59e0b";
                    return (
                      <label
                        key={p.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "6px 10px",
                          border: `1px solid ${checked ? teamColor : "#ddd"}`,
                          background: checked ? `${teamColor}14` : "#fff",
                          borderRadius: 6,
                          cursor: "pointer",
                          fontSize: 12,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => togglePlayer(p.id)}
                          style={{ accentColor: teamColor }}
                        />
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: teamColor,
                          }}
                        />
                        <span
                          style={{
                            fontWeight: 600,
                            color: "#333",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {p.display_name}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
              {/* FPTM coaching framework */}
              <FptmEditor
                fptm={fptm}
                drills={drills}
                onChange={({ fptm: f, drills: d }) => {
                  setFptm(f);
                  setDrills(d);
                }}
              />
              {error && <div style={{ color: "crimson", fontSize: 12 }}>{error}</div>}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button
                  onClick={handleSave}
                  disabled={saving || draftShotIds.size === 0}
                  style={btn(true, saving || draftShotIds.size === 0)}
                >
                  {saving ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
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
  const [fptmDraft, setFptmDraft] = useState<FptmValue>(seq.fptm ?? {});
  const [drillsDraft, setDrillsDraft] = useState<string | null>(seq.drills ?? null);

  const seqShots = seq.shot_ids
    .map((id) => shots.find((s) => s.id === id))
    .filter((s): s is RallyShot => !!s);
  const firstShot = seqShots[0];
  const lastShot = seqShots[seqShots.length - 1];
  const player = seq.player_id
    ? players.find((p) => p.id === seq.player_id) ?? null
    : null;
  const fptmSummary = summarizeFptm(seq.fptm);

  async function handleSaveEdit() {
    try {
      await updateSequence(seq.id, {
        fptm: fptmDraft,
        drills: drillsDraft ?? null,
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
          <div style={{ fontSize: 11, color: "#888", marginTop: 2, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span>
              {seqShots.length} shot{seqShots.length !== 1 ? "s" : ""}
              {firstShot && lastShot && (
                <span> · {formatMs(firstShot.start_ms)}–{formatMs(lastShot.end_ms)}</span>
              )}
            </span>
            {fptmSummary.map(({ pillar, itemCount }) => (
              <span
                key={pillar.id}
                title={pillar.label}
                style={{
                  padding: "1px 6px",
                  fontSize: 10,
                  fontWeight: 700,
                  background: `${pillar.color}18`,
                  color: pillar.color,
                  borderRadius: 3,
                }}
              >
                {pillar.letter}
                {itemCount > 0 ? ` ${itemCount}` : ""}
              </span>
            ))}
          </div>
        </div>
        <span style={{ fontSize: 10, color: "#bbb" }}>{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div style={{ padding: "10px 14px 14px", fontSize: 13, background: "#fafafa" }}>
          {editing ? (
            <>
              <FptmEditor
                fptm={fptmDraft}
                drills={drillsDraft}
                onChange={({ fptm, drills }) => {
                  setFptmDraft(fptm);
                  setDrillsDraft(drills);
                }}
              />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditing(false);
                  }}
                  style={{ ...btn(false, false), background: "#fff" }}
                >
                  Cancel
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSaveEdit();
                  }}
                  style={btn(true, false)}
                >
                  Save
                </button>
              </div>
            </>
          ) : (
            <>
              <FptmReadOnly fptm={seq.fptm} drills={seq.drills} />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFptmDraft(seq.fptm ?? {});
                    setDrillsDraft(seq.drills ?? null);
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

const tinyBtn: React.CSSProperties = {
  padding: "2px 8px",
  fontSize: 10,
  fontWeight: 600,
  border: "1px solid #ddd",
  borderRadius: 4,
  background: "#fff",
  color: "#555",
  cursor: "pointer",
  fontFamily: "inherit",
  textTransform: "uppercase",
  letterSpacing: 0.4,
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

/**
 * Read-only FPTM display for saved sequence rows. Shows each populated pillar
 * with its selected sub-items and any per-pillar notes, plus drills.
 */
function FptmReadOnly({
  fptm,
  drills,
}: {
  fptm: FptmValue | null;
  drills: string | null;
}) {
  const summary = summarizeFptm(fptm);
  if (summary.length === 0 && !drills) {
    return (
      <div style={{ fontSize: 12, color: "#999", fontStyle: "italic" }}>
        No diagnosis yet. Click Edit to add one.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {summary.map(({ pillar }) => {
        const state = fptm?.[pillar.id];
        if (!state) return null;
        const labels = state.items
          .map((id) => pillar.items.find((it) => it.id === id)?.label)
          .filter((l): l is string => !!l);
        return (
          <div
            key={pillar.id}
            style={{
              borderLeft: `3px solid ${pillar.color}`,
              background: `${pillar.color}10`,
              padding: "6px 10px",
              borderRadius: 4,
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: pillar.color,
                marginBottom: 2,
              }}
            >
              {pillar.letter} — {pillar.label}
            </div>
            {labels.length > 0 && (
              <ul style={{ margin: "2px 0 0 18px", padding: 0, fontSize: 12, color: "#333" }}>
                {labels.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            )}
            {state.note && (
              <div style={{ fontSize: 12, color: "#555", marginTop: 4, whiteSpace: "pre-wrap" }}>
                {state.note}
              </div>
            )}
          </div>
        );
      })}
      {drills && (
        <div
          style={{
            borderLeft: "3px solid #1e7e34",
            background: "#e6f4ea",
            padding: "6px 10px",
            borderRadius: 4,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: "#1e7e34", marginBottom: 2 }}>
            Drills
          </div>
          <div style={{ fontSize: 12, color: "#333", whiteSpace: "pre-wrap" }}>{drills}</div>
        </div>
      )}
    </div>
  );
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
