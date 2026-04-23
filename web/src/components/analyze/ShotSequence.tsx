import { useState } from "react";
import type { RallyShot } from "../../types/database";
import { formatMs } from "../../lib/pbvVideo";

interface PlayerInfo {
  id: string;
  display_name: string;
  team: number;
  player_index: number;
}

interface Rally {
  id: string;
  rally_index: number;
  start_ms: number;
  end_ms: number;
  winning_team: number | null;
  score_team0: number | null;
  score_team1: number | null;
}

interface Props {
  rally: Rally | null;
  shots: RallyShot[];
  players: PlayerInfo[];
  currentMs: number;
  // Shot playback controls
  activeShotId: string | null;
  isLooping: boolean;
  playbackRate: number;
  isPaused: boolean;
  onActivateShot: (shot: RallyShot) => void;
  onReplayShot: () => void;
  onToggleLoop: () => void;
  onSetPlaybackRate: (rate: number) => void;
  onTogglePlay: () => void;
  // Sequence build mode
  buildMode: boolean;
  draftShotIds: Set<string>;
  onToggleBuildMode: () => void;
  onToggleDraftShot: (shotId: string) => void;
  // Flags
  flaggedShotIds: Set<string>;
  onToggleFlag: (shotId: string) => void;
  /** shot_id → the flag's saved note (null = flag exists but no note). Only
   *  populated for flagged shots; unflagged shots won't have a key. */
  flagNoteByShotId?: Map<string, string | null>;
  /** Persist a flag's note. Called when the coach hits Save in the inline
   *  note popover next to the flag chip. */
  onUpdateFlagNote?: (shotId: string, note: string | null) => Promise<void>;
  /** Ids of shots that belong to any saved sequence on this rally — used for
   *  highlight-only styling (not interactive here). */
  savedSequenceShotIds?: Set<string>;
  /** Ids of shots that ended the rally on a fault (PB Vision `err` in raw_data). */
  faultShotIds?: Set<string>;
  /** Set of `loss:<rally_id>:<shot_id>` keys the coach has marked as
   *  insignificant. Shots in this set have their fault-style tuned down and
   *  the action button flips to "restore". */
  dismissedLossKeys?: Set<string>;
  /** Called when the coach toggles a fault as (in)significant. Receives the
   *  fault shot and whether it should now be dismissed. */
  onToggleDismissFault?: (shot: RallyShot, dismissed: boolean) => void;
}

/** Colors for shot type badges. */
const SHOT_COLORS: Record<string, string> = {
  serve: "#e8710a",
  return: "#0d904f",
  third: "#9334e6",
  drive: "#5e35b1",
  dink: "#4caf50",
  drop: "#29b6f6",
  lob: "#fdd835",
  smash: "#303f9f",
  volley: "#7e57c2",
  reset: "#00bcd4",
  speedup: "#ef6c00",
  putaway: "#455a64",
  poach: "#6a1b9a",
  passing: "#3949ab",
  shot: "#757575",
};

export default function ShotSequence({
  rally,
  shots,
  players,
  currentMs,
  activeShotId,
  isLooping: _isLooping,
  playbackRate: _playbackRate,
  isPaused: _isPaused,
  onActivateShot,
  onReplayShot,
  onToggleLoop: _onToggleLoop,
  onSetPlaybackRate: _onSetPlaybackRate,
  onTogglePlay: _onTogglePlay,
  buildMode,
  draftShotIds,
  onToggleBuildMode,
  onToggleDraftShot,
  flaggedShotIds,
  onToggleFlag,
  flagNoteByShotId,
  onUpdateFlagNote,
  savedSequenceShotIds,
  faultShotIds,
  dismissedLossKeys,
  onToggleDismissFault,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  /** shot_id whose flag-note popover is currently open. Only one at a time. */
  const [noteOpenShotId, setNoteOpenShotId] = useState<string | null>(null);
  const activeShot = activeShotId ? shots.find((s) => s.id === activeShotId) : null;
  const activePlayer = activeShot
    ? players.find((p) => p.player_index === activeShot.player_index)
    : null;
  if (!rally) {
    return (
      <div
        style={{
          padding: 16,
          background: "#fff",
          border: "1px solid #e2e2e2",
          borderRadius: 10,
          fontSize: 13,
          color: "#999",
          textAlign: "center",
        }}
      >
        Click a rally on the timeline, or play the video, to see its shot sequence.
      </div>
    );
  }

  // Team counts for score display
  const scoreDisplay =
    rally.score_team0 != null && rally.score_team1 != null
      ? `${rally.score_team0}–${rally.score_team1}`
      : null;

  const winningColor =
    rally.winning_team === 0 ? "#1e7e34" : rally.winning_team === 1 ? "#c62828" : "#666";

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* Rally header */}
      <div
        style={{
          padding: "10px 14px",
          background: "#f8f9fa",
          borderBottom: "1px solid #eee",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            Rally {rally.rally_index + 1}
            <span style={{ marginLeft: 8, fontSize: 11, color: "#888", fontWeight: 400 }}>
              {formatMs(rally.start_ms)} – {formatMs(rally.end_ms)}
            </span>
          </div>
          <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>
            {shots.length} shot{shots.length !== 1 ? "s" : ""}
            {rally.winning_team != null && (
              <span style={{ marginLeft: 8, color: winningColor, fontWeight: 600 }}>
                · Team {rally.winning_team} won
              </span>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {scoreDisplay && (
            <div style={{ fontSize: 16, fontWeight: 700, color: "#333" }}>
              {scoreDisplay}
            </div>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? "Collapse shot list" : "Expand shot list"}
            style={{
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: 500,
              borderTop: "1px solid #ddd",
              borderBottom: "1px solid #ddd",
              borderLeft: "1px solid #ddd",
              borderRight: "1px solid #ddd",
              borderRadius: 5,
              background: "#fff",
              color: "#555",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {expanded ? "▲ Collapse" : "▼ Expand"}
          </button>
          <button
            onClick={onToggleBuildMode}
            title="Select shots to build a sequence"
            style={{
              padding: "4px 10px",
              fontSize: 11,
              fontWeight: buildMode ? 700 : 500,
              borderTop: `1px solid ${buildMode ? "#1a73e8" : "#ddd"}`,
              borderBottom: `1px solid ${buildMode ? "#1a73e8" : "#ddd"}`,
              borderLeft: `1px solid ${buildMode ? "#1a73e8" : "#ddd"}`,
              borderRight: `1px solid ${buildMode ? "#1a73e8" : "#ddd"}`,
              borderRadius: 5,
              background: buildMode ? "#1a73e8" : "#fff",
              color: buildMode ? "#fff" : "#555",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            📋 {buildMode ? "Building…" : "Build sequence"}
          </button>
        </div>
      </div>

      {/* Active shot controls */}
      {activeShot && (
        <div
          style={{
            padding: "10px 14px",
            background: "#f0f4ff",
            borderBottom: "1px solid #d4dff7",
          }}
        >
          <div
            style={{
              fontSize: 12,
              color: "#1a73e8",
              fontWeight: 600,
              marginBottom: 6,
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Now playing — Shot {activeShot.shot_index + 1}
            {activePlayer && (
              <span style={{ fontWeight: 400, marginLeft: 6, color: "#555" }}>
                · {activePlayer.display_name} · {activeShot.shot_type}
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button
              onClick={onReplayShot}
              style={ctrlBtn(false)}
              title="Replay this shot"
            >
              ⟲ Replay
            </button>
            <span style={{ fontSize: 11, color: "#666" }}>
              Play / pause · speed · loop controls are under the video.
            </span>
          </div>
        </div>
      )}

      {/* Shot list */}
      {shots.length === 0 ? (
        <div style={{ padding: 16, fontSize: 13, color: "#999", textAlign: "center" }}>
          No shot data imported for this rally yet. Re-import the compact JSON to populate shots.
        </div>
      ) : (
        <div
          key={expanded ? "expanded" : "collapsed"}
          style={{
            height: expanded ? 680 : 340,
            minHeight: 200,
            maxHeight: "85vh",
            overflowY: "auto",
            resize: "vertical",
          }}
        >
          {shots.map((shot) => {
            const player = players.find((p) => p.player_index === shot.player_index);
            const isPlaying = currentMs >= shot.start_ms && currentMs <= shot.end_ms;
            const isActive = shot.id === activeShotId;
            const inSavedSequence = savedSequenceShotIds?.has(shot.id) ?? false;
            const isFault = faultShotIds?.has(shot.id) ?? false;
            const lossKey = `loss:${shot.rally_id}:${shot.id}`;
            const faultDismissed = isFault && (dismissedLossKeys?.has(lossKey) ?? false);
            const color = SHOT_COLORS[shot.shot_type ?? "shot"] ?? SHOT_COLORS.shot;

            // Active/playing use soft background tints (transient state).
            // Fault + saved-sequence membership are conveyed by the left
            // border stripe + a small right-side badge instead of a
            // full-row tint — keeps the list calm while reviewing.
            const bgColor = isActive
              ? "#f0f4ff"
              : isPlaying
              ? "#e8f0fe"
              : "#fff";

            return (
              <div
                key={shot.id}
                style={{
                  position: "relative",
                  borderBottom: "1px solid #f0f0f0",
                  display: "flex",
                  alignItems: "stretch",
                }}
              >
              <button
                onClick={() =>
                  buildMode ? onToggleDraftShot(shot.id) : onActivateShot(shot)
                }
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  flex: 1,
                  minWidth: 0,
                  padding: "8px 12px 8px 14px",
                  fontSize: 13,
                  background: buildMode && draftShotIds.has(shot.id)
                    ? "#fff3cd"
                    : bgColor,
                  borderTop: "none",
                  borderBottom: "none",
                  borderLeft: buildMode && draftShotIds.has(shot.id)
                    ? "3px solid #f59e0b"
                    : isActive
                    ? `3px solid #1a73e8`
                    : isFault && !buildMode
                    ? faultDismissed
                      ? "3px solid #e5e5e5"
                      : "3px solid #ef4444"
                    : inSavedSequence && !buildMode
                    ? "3px solid #7c3aed"
                    : `3px solid transparent`,
                  borderRight: "none",
                  cursor: "pointer",
                  textAlign: "left",
                }}
                onMouseOver={(e) => {
                  if (!isActive && !isPlaying) e.currentTarget.style.background = "#f8f9fa";
                }}
                onMouseOut={(e) => {
                  e.currentTarget.style.background = bgColor;
                }}
              >
                {/* Build-mode checkbox */}
                {buildMode && (
                  <span
                    style={{
                      flexShrink: 0,
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      borderTop: `1px solid ${draftShotIds.has(shot.id) ? "#f59e0b" : "#bbb"}`,
                      borderBottom: `1px solid ${draftShotIds.has(shot.id) ? "#f59e0b" : "#bbb"}`,
                      borderLeft: `1px solid ${draftShotIds.has(shot.id) ? "#f59e0b" : "#bbb"}`,
                      borderRight: `1px solid ${draftShotIds.has(shot.id) ? "#f59e0b" : "#bbb"}`,
                      background: draftShotIds.has(shot.id) ? "#f59e0b" : "#fff",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {draftShotIds.has(shot.id) ? "✓" : ""}
                  </span>
                )}

                {/* Shot number */}
                <span
                  style={{
                    flexShrink: 0,
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: isActive ? "#1a73e8" : isPlaying ? "#4caf50" : "#f0f0f0",
                    color: isActive || isPlaying ? "#fff" : "#555",
                    fontSize: 11,
                    fontWeight: 600,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {shot.shot_index + 1}
                </span>

                {/* Shot type badge */}
                <span
                  style={{
                    flexShrink: 0,
                    padding: "2px 8px",
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    background: color + "22",
                    color: color,
                    borderRadius: 4,
                    minWidth: 52,
                    textAlign: "center",
                  }}
                >
                  {shot.shot_type ?? "shot"}
                </span>

                {/* Player + stroke info */}
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 500,
                      color: "#333",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {player?.display_name ?? `Player ${shot.player_index}`}
                  </div>
                  {(shot.stroke_type || shot.vertical_type) && (
                    <div style={{ fontSize: 11, color: "#888" }}>
                      {[shot.stroke_type, shot.vertical_type]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  )}
                </span>

                {/* Quality + timestamp */}
                <span style={{ flexShrink: 0, textAlign: "right", fontSize: 11, color: "#999" }}>
                  {shot.quality != null && (
                    <div style={{ fontWeight: 600, color: qualityColor(shot.quality) }}>
                      {(shot.quality * 100).toFixed(0)}%
                    </div>
                  )}
                  <div>{formatMs(shot.start_ms)}</div>
                </span>

                {inSavedSequence && !buildMode && (
                  <span
                    title="Part of a saved sequence"
                    style={{
                      flexShrink: 0,
                      fontSize: 10,
                      fontWeight: 700,
                      color: "#7c3aed",
                      background: "#7c3aed18",
                      padding: "1px 5px",
                      borderRadius: 3,
                      lineHeight: 1,
                    }}
                  >
                    ▤
                  </span>
                )}

              </button>
              {/* Icons rail — outside the shot button's clickable area. Keeps
                  the shot row scannable and lets the coach click flag /
                  dismiss without accidentally selecting the shot.
                  Fixed-width slots keep every icon vertically aligned across
                  all rows: 28px per slot, in the same order (dismiss → pencil
                  → flag). Slots without an applicable icon render an empty
                  placeholder so the rail stays grid-aligned. */}
              {!buildMode && (() => {
                const isFlagged = flaggedShotIds.has(shot.id);
                const note = flagNoteByShotId?.get(shot.id) ?? null;
                const hasNote = !!note && note.trim().length > 0;
                return (
                  <div style={iconRailStyle(bgColor)}>
                    {/* Slot 1: Fault-dismiss — always reserved; renders an
                        icon button only for rally-ending fault shots that
                        aren't flagged. A flagged fault is already "will
                        review" (mutually exclusive with dismiss), so showing
                        a ⊘ button there would be confusing. Coach can unflag
                        first if they want to switch to dismissed. */}
                    <div style={iconSlotStyle}>
                      {isFault && !isFlagged && onToggleDismissFault && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleDismissFault(shot, !faultDismissed);
                          }}
                          title={
                            faultDismissed
                              ? "Restore — count this loss in the review checklist again"
                              : "Mark insignificant — hide this loss from the review checklist"
                          }
                          style={iconBtnStyle({
                            bg: faultDismissed ? "#f4f4f5" : "#fff",
                            border: faultDismissed ? "#d4d4d8" : "#fca5a5",
                            color: faultDismissed ? "#71717a" : "#b91c1c",
                          })}
                        >
                          {faultDismissed ? "✓" : "⊘"}
                        </button>
                      )}
                    </div>

                    {/* Slot 2: Note pencil — always reserved; renders only
                        for already-flagged shots. Yellow-filled when a note
                        is saved, outlined otherwise. */}
                    <div style={iconSlotStyle}>
                      {isFlagged && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setNoteOpenShotId(
                              noteOpenShotId === shot.id ? null : shot.id,
                            );
                          }}
                          title={hasNote ? "Edit flag note" : "Add a note to this flag"}
                          style={iconBtnStyle({
                            bg: hasNote ? "#fef3c7" : "#fff",
                            border: hasNote ? "#fde68a" : "#e2e2e2",
                            color: hasNote ? "#92400e" : "#9ca3af",
                          })}
                        >
                          ✎
                        </button>
                      )}
                    </div>

                    {/* Slot 3: Flag toggle — always rendered. */}
                    <div style={iconSlotStyle}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const wasFlagged = flaggedShotIds.has(shot.id);
                          onToggleFlag(shot.id);
                          // Flagging freshly → auto-open the note editor so
                          // the coach can jot what they plan to say in Review.
                          if (!wasFlagged) setNoteOpenShotId(shot.id);
                          else if (noteOpenShotId === shot.id) setNoteOpenShotId(null);
                        }}
                        title={isFlagged ? "Unflag" : "Flag for review"}
                        style={iconBtnStyle({
                          bg: isFlagged ? "#fff7e6" : "transparent",
                          border: isFlagged ? "#fde68a" : "transparent",
                          color: isFlagged ? "#d97706" : "#9ca3af",
                          size: 14,
                        })}
                      >
                        {isFlagged ? "🚩" : "⚑"}
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Inline flag-note popover. Positioned under the row. Coach can
                  type a quick sentence about why they flagged this shot and
                  save without navigating away. */}
              {!buildMode && noteOpenShotId === shot.id && flaggedShotIds.has(shot.id) && (
                <FlagNotePopover
                  initialNote={flagNoteByShotId?.get(shot.id) ?? null}
                  onClose={() => setNoteOpenShotId(null)}
                  onSave={async (text) => {
                    if (onUpdateFlagNote) {
                      await onUpdateFlagNote(shot.id, text);
                    }
                    setNoteOpenShotId(null);
                  }}
                />
              )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function qualityColor(q: number): string {
  if (q >= 0.7) return "#1e7e34";
  if (q >= 0.4) return "#e8710a";
  return "#c62828";
}

// ─────────────────────── Row icon-rail styling ───────────────────────
// See docs/DESIGN_PREFERENCES.md §"Aligned row indicators": every row
// reserves the same set of slots in the same order so icons line up across
// rows, even when the icon itself is conditional.

const ICON_SLOT_WIDTH = 28;
const ICON_BTN_SIZE = 22;

function iconRailStyle(bg: string): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 2,
    padding: "0 6px 0 4px",
    borderLeft: "1px solid #f0f0f0",
    background: bg,
    flexShrink: 0,
  };
}

const iconSlotStyle: React.CSSProperties = {
  width: ICON_SLOT_WIDTH,
  height: ICON_BTN_SIZE,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

function iconBtnStyle(opts: {
  bg: string;
  border: string;
  color: string;
  size?: number;
}): React.CSSProperties {
  return {
    width: ICON_BTN_SIZE,
    height: ICON_BTN_SIZE,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
    fontSize: opts.size ?? 12,
    fontWeight: 600,
    lineHeight: 1,
    background: opts.bg,
    border: `1px solid ${opts.border}`,
    borderRadius: 4,
    color: opts.color,
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

function ctrlBtn(active: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: active ? 700 : 500,
    borderTop: `1px solid ${active ? "#1a73e8" : "#d4dff7"}`,
    borderBottom: `1px solid ${active ? "#1a73e8" : "#d4dff7"}`,
    borderLeft: `1px solid ${active ? "#1a73e8" : "#d4dff7"}`,
    borderRight: `1px solid ${active ? "#1a73e8" : "#d4dff7"}`,
    borderRadius: 5,
    background: active ? "#1a73e8" : "#fff",
    color: active ? "#fff" : "#1a73e8",
    cursor: "pointer",
  };
}

// ───────────────────── Inline flag-note popover ─────────────────────
// Tiny anchored editor that appears right under a shot row when the coach
// flags it (or taps the pencil on an already-flagged shot). The typed note
// surfaces later in Coach Review as a "note to self" — reminder of what
// the coach saw when they flagged the moment.

function FlagNotePopover({
  initialNote,
  onClose,
  onSave,
}: {
  initialNote: string | null;
  onClose: () => void;
  onSave: (note: string | null) => Promise<void>;
}) {
  const [text, setText] = useState(initialNote ?? "");
  const [saving, setSaving] = useState(false);
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        right: 8,
        top: "calc(100% - 2px)",
        width: 280,
        background: "#fff",
        border: "1px solid #f0d169",
        borderRadius: 6,
        padding: 8,
        boxShadow: "0 6px 16px rgba(0,0,0,0.08)",
        zIndex: 20,
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: "#92400e",
          textTransform: "uppercase",
          letterSpacing: 0.3,
          marginBottom: 4,
        }}
      >
        🚩 Note to self
      </div>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void (async () => {
              setSaving(true);
              try {
                await onSave(text.trim() || null);
              } finally {
                setSaving(false);
              }
            })();
          }
          if (e.key === "Escape") onClose();
        }}
        rows={3}
        placeholder="Why did you flag this? (⌘/Ctrl+Enter to save)"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "6px 8px",
          fontSize: 12,
          fontFamily: "inherit",
          border: "1px solid #e2e2e2",
          borderRadius: 4,
          resize: "vertical",
        }}
      />
      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", marginTop: 6 }}>
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: "3px 8px",
            fontSize: 11,
            background: "#fff",
            color: "#666",
            border: "1px solid #e2e2e2",
            borderRadius: 4,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave(text.trim() || null);
            } finally {
              setSaving(false);
            }
          }}
          style={{
            padding: "3px 10px",
            fontSize: 11,
            fontWeight: 600,
            background: "#1a73e8",
            color: "#fff",
            border: "1px solid #1a73e8",
            borderRadius: 4,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

