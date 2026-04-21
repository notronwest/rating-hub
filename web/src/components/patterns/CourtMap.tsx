/**
 * CourtMap — renders a pickleball court (top-down) and plots a collection of
 * shots as dots keyed by team, outcome (win/loss), and whether they ended the
 * rally. Serves as the foundation for every "Contact Locations" panel in the
 * Patterns toolbar (3rd Shot, 4th Shot, Serve, Return, …).
 *
 * PB Vision coordinate system (in feet):
 *   x ∈ [0, 20]  — court width
 *   y ∈ [0, 44]  — court length; net at y=22
 *   Team 0 (far) occupies y ∈ [0, 22);  Team 1 (near) occupies y ∈ (22, 44].
 *   Kitchen / NVZ: y ∈ [15, 22] and y ∈ [22, 29].
 */

import type { CSSProperties, MouseEvent } from "react";

/** One dot on the court. */
export interface CourtDot {
  id: string;
  x: number;          // PBV feet
  y: number;          // PBV feet
  team: 0 | 1;
  /** true = rally won, false = lost, null = unknown */
  won: boolean | null;
  /** Shot ended the rally (fault or winner) */
  isFinal: boolean;
  /** PBV detected an error on this shot — e.g. rally-ending fault */
  isFault?: boolean;
}

interface Props {
  dots: CourtDot[];
  /** Draw a dashed trajectory line per dot from (x, y) → this point. */
  trajectories?: Map<string, { x: number; y: number }>;
  /** Restrict the visible half of the court. Default = full court. */
  half?: "full" | "team0" | "team1";
  /** Called when the user clicks a dot. */
  onDotClick?: (dot: CourtDot) => void;
  /** Called on hover — use to drive a preview panel outside. */
  onDotHover?: (dot: CourtDot | null) => void;
  /** Highlighted dot (e.g. the one currently being previewed). */
  activeDotId?: string | null;
  /** Fixed width; height is derived from aspect ratio. */
  width?: number;
  style?: CSSProperties;
}

// Court in PBV feet. We add a small margin so dots near the baseline aren't
// clipped by the SVG viewport.
const COURT_WIDTH_FT = 20;
const COURT_LENGTH_FT = 44;
const MARGIN_FT = 2;
const NET_Y = 22;
const KITCHEN_FAR_Y = 15;   // team 0 side kitchen line
const KITCHEN_NEAR_Y = 29;  // team 1 side kitchen line

const TEAM_COLORS: Record<0 | 1, string> = { 0: "#1a73e8", 1: "#4caf50" };

export default function CourtMap({
  dots,
  trajectories,
  half = "full",
  onDotClick,
  onDotHover,
  activeDotId,
  width = 420,
  style,
}: Props) {
  // Viewport bounds in PBV feet
  const minY = half === "team1" ? NET_Y - MARGIN_FT : -MARGIN_FT;
  const maxY = half === "team0" ? NET_Y + MARGIN_FT : COURT_LENGTH_FT + MARGIN_FT;
  const vbWidth = COURT_WIDTH_FT + MARGIN_FT * 2;
  const vbHeight = maxY - minY;
  const height = Math.round(width * (vbHeight / vbWidth));

  // Helper: project a PBV (x, y) into SVG space.
  const sx = (x: number) => x + MARGIN_FT;
  const sy = (y: number) => y - minY;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${vbWidth} ${vbHeight}`}
      style={{
        background: "#f4f7f4",
        borderRadius: 8,
        border: "1px solid #e2e2e2",
        display: "block",
        ...style,
      }}
    >
      {/* Court surface */}
      <rect
        x={MARGIN_FT}
        y={sy(0)}
        width={COURT_WIDTH_FT}
        height={COURT_LENGTH_FT}
        fill="#dbe8d9"
        stroke="#bbb"
        strokeWidth={0.1}
      />

      {/* Kitchen / NVZ — shaded bands */}
      {(half === "full" || half === "team0") && (
        <rect
          x={MARGIN_FT}
          y={sy(KITCHEN_FAR_Y)}
          width={COURT_WIDTH_FT}
          height={NET_Y - KITCHEN_FAR_Y}
          fill="#c9dcc5"
        />
      )}
      {(half === "full" || half === "team1") && (
        <rect
          x={MARGIN_FT}
          y={sy(NET_Y)}
          width={COURT_WIDTH_FT}
          height={KITCHEN_NEAR_Y - NET_Y}
          fill="#c9dcc5"
        />
      )}

      {/* Center service line (T-line for each side) */}
      {(half === "full" || half === "team0") && (
        <line
          x1={sx(COURT_WIDTH_FT / 2)}
          x2={sx(COURT_WIDTH_FT / 2)}
          y1={sy(0)}
          y2={sy(KITCHEN_FAR_Y)}
          stroke="#bbb"
          strokeWidth={0.1}
        />
      )}
      {(half === "full" || half === "team1") && (
        <line
          x1={sx(COURT_WIDTH_FT / 2)}
          x2={sx(COURT_WIDTH_FT / 2)}
          y1={sy(KITCHEN_NEAR_Y)}
          y2={sy(COURT_LENGTH_FT)}
          stroke="#bbb"
          strokeWidth={0.1}
        />
      )}

      {/* Kitchen lines */}
      {(half === "full" || half === "team0") && (
        <line
          x1={sx(0)}
          x2={sx(COURT_WIDTH_FT)}
          y1={sy(KITCHEN_FAR_Y)}
          y2={sy(KITCHEN_FAR_Y)}
          stroke="#bbb"
          strokeWidth={0.1}
        />
      )}
      {(half === "full" || half === "team1") && (
        <line
          x1={sx(0)}
          x2={sx(COURT_WIDTH_FT)}
          y1={sy(KITCHEN_NEAR_Y)}
          y2={sy(KITCHEN_NEAR_Y)}
          stroke="#bbb"
          strokeWidth={0.1}
        />
      )}

      {/* Net */}
      {half !== "team0" && half !== "team1" ? (
        <line
          x1={sx(0)}
          x2={sx(COURT_WIDTH_FT)}
          y1={sy(NET_Y)}
          y2={sy(NET_Y)}
          stroke="#444"
          strokeWidth={0.2}
          strokeDasharray="0.4,0.3"
        />
      ) : null}

      {/* Trajectory lines — drawn under the dots */}
      {trajectories &&
        dots.map((d) => {
          const to = trajectories.get(d.id);
          if (!to) return null;
          const color = TEAM_COLORS[d.team];
          return (
            <line
              key={`traj-${d.id}`}
              x1={sx(d.x)}
              y1={sy(d.y)}
              x2={sx(to.x)}
              y2={sy(to.y)}
              stroke={color}
              strokeOpacity={d.won === false ? 0.25 : 0.4}
              strokeWidth={0.12}
              strokeDasharray="0.35,0.25"
            />
          );
        })}

      {/* Shot dots */}
      {dots.map((d) => {
        const color = TEAM_COLORS[d.team];
        const active = activeDotId === d.id;
        return (
          <g
            key={d.id}
            onMouseEnter={() => onDotHover?.(d)}
            onMouseLeave={() => onDotHover?.(null)}
            onClick={(e: MouseEvent) => {
              e.stopPropagation();
              onDotClick?.(d);
            }}
            style={{ cursor: onDotClick ? "pointer" : "default" }}
          >
            <circle
              cx={sx(d.x)}
              cy={sy(d.y)}
              r={active ? 0.95 : 0.7}
              fill={d.won === false ? "none" : color}
              stroke={color}
              strokeWidth={d.won === false ? 0.2 : 0.1}
              opacity={active ? 1 : 0.85}
            />
            {/* Rally-ending marker: circle for point-ended, black X for the
                losing team's fault. */}
            {d.isFault && (
              <text
                x={sx(d.x)}
                y={sy(d.y) + 0.3}
                fontSize={1.1}
                textAnchor="middle"
                fontWeight={700}
                fill="#111"
              >
                ×
              </text>
            )}
            {d.isFinal && !d.isFault && (
              <circle
                cx={sx(d.x)}
                cy={sy(d.y)}
                r={1.2}
                fill="none"
                stroke="#ef4444"
                strokeWidth={0.15}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Helper: project a RallyShot → CourtDot, returning null if no geometry. */
export function shotToDot(args: {
  id: string;
  contact_x: number | null;
  contact_y: number | null;
  team: 0 | 1;
  won: boolean | null;
  is_final: boolean;
  shot_errors?: Record<string, unknown> | null;
}): CourtDot | null {
  if (args.contact_x == null || args.contact_y == null) return null;
  return {
    id: args.id,
    x: args.contact_x,
    y: args.contact_y,
    team: args.team,
    won: args.won,
    isFinal: args.is_final,
    isFault: !!args.shot_errors && Object.keys(args.shot_errors).length > 0,
  };
}
