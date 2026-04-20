import type { RallyShot } from "../../types/database";

interface PlayerInfo {
  player_index: number;
  display_name: string;
  avatar_url?: string | null;
}

interface Props {
  shot: RallyShot | null;
  player: PlayerInfo | null;
}

const TYPE_COLORS: Record<string, string> = {
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

/**
 * Floating pill overlaid on top of the video showing the currently-playing
 * shot's info: shot number, player (with avatar), shot type. Hidden when no
 * shot is active or data is unavailable.
 */
export default function ShotTooltip({ shot, player }: Props) {
  if (!shot) return null;

  // Derive optional speed from raw_data (compact: q.ex is quality, speed is in
  // augmented's resulting_ball_movement.speed — we don't have that in compact).
  // Leave out speed for now; can add later from augmented.
  const raw = (shot.raw_data ?? {}) as Record<string, unknown>;
  const speed =
    (raw.resulting_ball_movement as Record<string, unknown> | undefined)
      ?.speed as number | undefined;

  const color = TYPE_COLORS[shot.shot_type ?? "shot"] ?? "#666";

  return (
    <div
      style={{
        position: "absolute",
        top: 10,
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(0, 0, 0, 0.75)",
        color: "#fff",
        padding: "6px 12px",
        borderRadius: 20,
        fontSize: 12,
        display: "flex",
        alignItems: "center",
        gap: 8,
        pointerEvents: "none",
        backdropFilter: "blur(4px)",
        zIndex: 10,
      }}
    >
      <span style={{ fontWeight: 600 }}>Shot {shot.shot_index + 1}</span>

      {player?.avatar_url ? (
        <img
          src={player.avatar_url}
          alt=""
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            objectFit: "cover",
          }}
        />
      ) : player ? (
        <span style={{ opacity: 0.8 }}>·</span>
      ) : null}

      {player && (
        <span style={{ opacity: 0.9 }}>{player.display_name.split(" ")[0]}</span>
      )}

      <span
        style={{
          padding: "1px 6px",
          background: color + "30",
          color: "#fff",
          borderRadius: 3,
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          fontWeight: 700,
        }}
      >
        {shot.shot_type ?? "shot"}
      </span>

      {speed != null && (
        <span style={{ opacity: 0.8 }}>{speed.toFixed(0)} mph</span>
      )}
    </div>
  );
}
