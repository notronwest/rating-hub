interface PlayerInfo {
  id: string;
  display_name: string;
  team: number;
  player_index: number;
  avatar_url?: string | null;
}

interface Props {
  players: PlayerInfo[];
  focusedPlayerIndex: number | null;
  onFocus: (playerIndex: number | null) => void;
}

/**
 * Chip bar showing player avatars. Clicking filters views to just that player's
 * shots. "All" clears the filter.
 */
export default function PlayerFocusBar({
  players,
  focusedPlayerIndex,
  onFocus,
}: Props) {
  if (players.length === 0) return null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
      <span style={{ color: "#666", fontWeight: 500 }}>Focus:</span>

      <button
        onClick={() => onFocus(null)}
        style={chipStyle(focusedPlayerIndex == null)}
      >
        All
      </button>

      {[...players]
        .sort((a, b) => a.player_index - b.player_index)
        .map((p) => {
          const isActive = focusedPlayerIndex === p.player_index;
          return (
            <button
              key={p.id}
              onClick={() => onFocus(isActive ? null : p.player_index)}
              title={p.display_name}
              style={{
                ...chipStyle(isActive),
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "2px 8px 2px 2px",
              }}
            >
              {p.avatar_url ? (
                <img
                  src={p.avatar_url}
                  alt=""
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    objectFit: "cover",
                    background: "#eee",
                  }}
                />
              ) : (
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: p.team === 0 ? "#60a5fa" : "#4ade80",
                    color: "#fff",
                    fontSize: 10,
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  p{p.player_index}
                </span>
              )}
              <span>{p.display_name.split(" ")[0]}</span>
            </button>
          );
        })}
    </div>
  );
}

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    borderTop: `1px solid ${active ? "#1a73e8" : "#ddd"}`,
    borderBottom: `1px solid ${active ? "#1a73e8" : "#ddd"}`,
    borderLeft: `1px solid ${active ? "#1a73e8" : "#ddd"}`,
    borderRight: `1px solid ${active ? "#1a73e8" : "#ddd"}`,
    borderRadius: 16,
    background: active ? "#e8f0fe" : "#fff",
    color: active ? "#1a73e8" : "#555",
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
