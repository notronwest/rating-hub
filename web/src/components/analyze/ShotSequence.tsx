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
}

/** Colors for shot type badges. */
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
  putaway: "#b71c1c",
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
  isLooping,
  playbackRate,
  isPaused,
  onActivateShot,
  onReplayShot,
  onToggleLoop,
  onSetPlaybackRate,
  onTogglePlay,
}: Props) {
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
        {scoreDisplay && (
          <div style={{ fontSize: 16, fontWeight: 700, color: "#333" }}>
            {scoreDisplay}
          </div>
        )}
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
            <button
              onClick={onTogglePlay}
              style={ctrlBtn(false)}
              title={isPaused ? "Play" : "Pause"}
            >
              {isPaused ? "▶ Play" : "⏸ Pause"}
            </button>
            <button
              onClick={onToggleLoop}
              style={ctrlBtn(isLooping)}
              title="Loop this shot on repeat"
            >
              {isLooping ? "🔁 Looping" : "🔁 Loop"}
            </button>

            <span style={{ width: 1, background: "#d4dff7", alignSelf: "stretch", margin: "0 4px" }} />

            <span style={{ fontSize: 11, color: "#666", marginRight: 4 }}>Speed:</span>
            {[0.25, 0.5, 0.75, 1, 1.5, 2].map((rate) => (
              <button
                key={rate}
                onClick={() => onSetPlaybackRate(rate)}
                style={ctrlBtn(playbackRate === rate)}
              >
                {rate}×
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Shot list */}
      {shots.length === 0 ? (
        <div style={{ padding: 16, fontSize: 13, color: "#999", textAlign: "center" }}>
          No shot data imported for this rally yet. Re-import the compact JSON to populate shots.
        </div>
      ) : (
        <div style={{ maxHeight: 340, overflowY: "auto" }}>
          {shots.map((shot) => {
            const player = players.find((p) => p.player_index === shot.player_index);
            const isPlaying = currentMs >= shot.start_ms && currentMs <= shot.end_ms;
            const isActive = shot.id === activeShotId;
            const color = SHOT_COLORS[shot.shot_type ?? "shot"] ?? SHOT_COLORS.shot;

            const bgColor = isActive ? "#f0f4ff" : isPlaying ? "#e8f0fe" : "#fff";

            return (
              <button
                key={shot.id}
                onClick={() => onActivateShot(shot)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  width: "100%",
                  padding: "8px 14px",
                  fontSize: 13,
                  background: bgColor,
                  borderTop: "none",
                  borderBottom: "1px solid #f0f0f0",
                  borderLeft: isActive
                    ? `3px solid #1a73e8`
                    : isPlaying
                    ? `3px solid #4caf50`
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

                {/* Final shot marker */}
                {shot.is_final && (
                  <span
                    style={{
                      flexShrink: 0,
                      fontSize: 10,
                      padding: "1px 6px",
                      background: "#fff3cd",
                      color: "#856404",
                      borderRadius: 3,
                      fontWeight: 600,
                    }}
                    title="Rally-ending shot"
                  >
                    END
                  </span>
                )}
              </button>
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
