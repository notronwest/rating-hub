/**
 * Court3DMap — tilted "3D" court view with arced shot trajectories.
 *
 * Uses a simple oblique axonometric projection instead of a true perspective
 * camera — it's cheap, reads well on an SVG, and stays visually stable as the
 * set of dots changes. The projection rules:
 *
 *   screenX = x                           (court width unchanged)
 *   screenY = y * cos(tilt) − z * zScale  (height lifts points upward)
 *
 * The tilt squashes the far end of the court so it looks like you're behind
 * the baseline looking across the net. Heights above the court lift the point
 * off the surface along the same axis.
 *
 * Each shot's trajectory is drawn as a quadratic bezier from the projected
 * contact point through the projected `trajectory.peak` to the projected
 * landing point — so the arc genuinely traces the ball's flight in 3D.
 *
 * Coordinate system matches CourtMap: PBV feet, x ∈ [0, 20], y ∈ [0, 44] with
 * the net at y = 22; z is height above the court.
 */

import type { CSSProperties, MouseEvent } from "react";

export interface CourtDot3D {
  id: string;
  /** Landing point in PBV feet. */
  x: number;
  y: number;
  z: number;
  team: 0 | 1;
  /** true = rally won, false = lost, null = unknown. Drives dot color. */
  won: boolean | null;
  /** Shot ended the rally (fault or winner). */
  isFinal: boolean;
  /** PBV detected an error on this shot (rally-ending fault). */
  isFault?: boolean;
}

export interface ShotArc {
  contact: { x: number; y: number; z: number };
  peak?: { x: number; y: number; z: number };
}

interface Props {
  dots: CourtDot3D[];
  /** contact + optional peak per shot id → drawn as a bezier arc. */
  arcs?: Map<string, ShotArc>;
  onDotClick?: (dot: CourtDot3D) => void;
  onDotHover?: (dot: CourtDot3D | null) => void;
  activeDotId?: string | null;
  width?: number;
  style?: CSSProperties;
}

// Court geometry in PBV feet.
const COURT_W = 20;
const COURT_L = 44;
const NET_Y = 22;
const KITCHEN_FAR = 15;
const KITCHEN_NEAR = 29;
const NET_H = 3; // 36" net

// Projection parameters. TILT in degrees measured from top-down (0°) toward
// behind-baseline (90°). Higher = flatter court, taller arcs.
const TILT_DEG = 32;
const TILT = (TILT_DEG * Math.PI) / 180;
const COS_T = Math.cos(TILT);
const SIN_T = Math.sin(TILT);
// Feet-of-height → feet-of-screen-lift. 1.0 keeps units consistent with the
// court; bump up slightly so arcs read clearly on a compressed court.
const Z_SCALE = 1.4;

// Margins so dots + arcs near edges don't clip.
const MARGIN_X = 2;
const MARGIN_TOP = 10; // extra room at top for peak of high arcs
const MARGIN_BOTTOM = 2;

/** Project a 3D PBV point into 2D SVG space. */
function project(x: number, y: number, z: number) {
  return {
    sx: x,
    sy: y * COS_T - z * Z_SCALE * SIN_T,
  };
}

const TEAM_COLORS: Record<0 | 1, string> = { 0: "#1a73e8", 1: "#4caf50" };

export default function Court3DMap({
  dots,
  arcs,
  onDotClick,
  onDotHover,
  activeDotId,
  width = 520,
  style,
}: Props) {
  // Derive view-box bounds from the court + margins.
  const courtBottomSy = project(0, COURT_L, 0).sy;
  const minSy = -MARGIN_TOP;
  const maxSy = courtBottomSy + MARGIN_BOTTOM;

  const vbWidth = COURT_W + MARGIN_X * 2;
  const vbHeight = maxSy - minSy;
  const height = Math.round(width * (vbHeight / vbWidth));

  // Helper — shift projection by (MARGIN_X, −minSy) so the SVG origin is (0,0)
  // at top-left with a little padding.
  const proj = (x: number, y: number, z: number) => {
    const { sx, sy } = project(x, y, z);
    return { sx: sx + MARGIN_X, sy: sy - minSy };
  };

  // Court corners for the ground rectangle (traced as a polygon so we can
  // render net bands, kitchen lines, etc. on the same projected surface).
  const farNear = proj(0, 0, 0);
  const farFar = proj(COURT_W, 0, 0);
  const nearFar = proj(COURT_W, COURT_L, 0);
  const nearNear = proj(0, COURT_L, 0);
  const courtPath = `M ${farNear.sx},${farNear.sy} L ${farFar.sx},${farFar.sy} L ${nearFar.sx},${nearFar.sy} L ${nearNear.sx},${nearNear.sy} Z`;

  // Horizontal lines (kitchen + net) — straight-across segments at constant y.
  const hline = (y: number) => {
    const a = proj(0, y, 0);
    const b = proj(COURT_W, y, 0);
    return { x1: a.sx, y1: a.sy, x2: b.sx, y2: b.sy };
  };

  // Net as a raised band — bottom edge at z=0, top edge at z=NET_H. Draw as a
  // filled quad so it visually separates near/far halves.
  const netBotL = proj(0, NET_Y, 0);
  const netBotR = proj(COURT_W, NET_Y, 0);
  const netTopL = proj(0, NET_Y, NET_H);
  const netTopR = proj(COURT_W, NET_Y, NET_H);
  const netPath = `M ${netBotL.sx},${netBotL.sy} L ${netBotR.sx},${netBotR.sy} L ${netTopR.sx},${netTopR.sy} L ${netTopL.sx},${netTopL.sy} Z`;

  // T-lines per side (center service line).
  const tLineFar = {
    a: proj(COURT_W / 2, 0, 0),
    b: proj(COURT_W / 2, KITCHEN_FAR, 0),
  };
  const tLineNear = {
    a: proj(COURT_W / 2, KITCHEN_NEAR, 0),
    b: proj(COURT_W / 2, COURT_L, 0),
  };

  const kitchenFar = hline(KITCHEN_FAR);
  const kitchenNear = hline(KITCHEN_NEAR);

  // Kitchen fill polygons — shaded bands on each side of the net.
  const kitchenFarPoly = [
    proj(0, KITCHEN_FAR, 0),
    proj(COURT_W, KITCHEN_FAR, 0),
    proj(COURT_W, NET_Y, 0),
    proj(0, NET_Y, 0),
  ];
  const kitchenNearPoly = [
    proj(0, NET_Y, 0),
    proj(COURT_W, NET_Y, 0),
    proj(COURT_W, KITCHEN_NEAR, 0),
    proj(0, KITCHEN_NEAR, 0),
  ];
  const polyD = (pts: { sx: number; sy: number }[]) =>
    `M ${pts.map((p) => `${p.sx},${p.sy}`).join(" L ")} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${vbWidth} ${vbHeight}`}
      style={{
        background: "#fafafa",
        borderRadius: 8,
        border: "1px solid #e2e2e2",
        display: "block",
        ...style,
      }}
    >
      {/* Court surface */}
      <path d={courtPath} fill="#e7ecea" stroke="#9aa2a0" strokeWidth={0.12} />

      {/* Kitchen shading */}
      <path d={polyD(kitchenFarPoly)} fill="#d6ded9" />
      <path d={polyD(kitchenNearPoly)} fill="#d6ded9" />

      {/* Kitchen lines */}
      <line {...kitchenFar} stroke="#9aa2a0" strokeWidth={0.1} />
      <line {...kitchenNear} stroke="#9aa2a0" strokeWidth={0.1} />

      {/* Center T-lines */}
      <line x1={tLineFar.a.sx} y1={tLineFar.a.sy} x2={tLineFar.b.sx} y2={tLineFar.b.sy} stroke="#9aa2a0" strokeWidth={0.1} />
      <line x1={tLineNear.a.sx} y1={tLineNear.a.sy} x2={tLineNear.b.sx} y2={tLineNear.b.sy} stroke="#9aa2a0" strokeWidth={0.1} />

      {/* Net — drawn BEFORE arcs that land on the far side, but after the
          ground, so it correctly occludes shots grazing the net. Rendered at
          low opacity so arcs crossing it remain visible. */}
      <path d={netPath} fill="#444" fillOpacity={0.25} stroke="#333" strokeWidth={0.12} />

      {/* Arcs — quadratic bezier through the projected peak. Drawn under the
          dots so the endpoint marker reads cleanly on top. */}
      {arcs &&
        dots.map((d) => {
          const arc = arcs.get(d.id);
          if (!arc) return null;
          const start = proj(arc.contact.x, arc.contact.y, arc.contact.z);
          const end = proj(d.x, d.y, d.z);
          // Fall back to a straight midpoint-peak if PBV didn't supply one —
          // gives the arc a visible bow at roughly the expected height.
          const midX = (arc.contact.x + d.x) / 2;
          const midY = (arc.contact.y + d.y) / 2;
          const midZ = arc.peak?.z ?? Math.max(arc.contact.z, d.z) + 3;
          const peak = arc.peak ?? { x: midX, y: midY, z: midZ };
          const projPeak = proj(peak.x, peak.y, peak.z);
          // Bezier control point = 2*peak − (start+end)/2 so the curve passes
          // through the peak (quadratic bezier formula).
          const cx = 2 * projPeak.sx - (start.sx + end.sx) / 2;
          const cy = 2 * projPeak.sy - (start.sy + end.sy) / 2;
          const color = d.won === false ? "#ef4444" : "#4caf50";
          const active = activeDotId === d.id;
          return (
            <path
              key={`arc-${d.id}`}
              d={`M ${start.sx},${start.sy} Q ${cx},${cy} ${end.sx},${end.sy}`}
              fill="none"
              stroke={color}
              strokeWidth={active ? 0.18 : 0.1}
              strokeOpacity={active ? 0.95 : 0.7}
              strokeLinecap="round"
            />
          );
        })}

      {/* Landing dots */}
      {dots.map((d) => {
        const p = proj(d.x, d.y, d.z);
        const color = d.won === false ? "#ef4444" : "#4caf50";
        const teamColor = TEAM_COLORS[d.team];
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
              cx={p.sx}
              cy={p.sy}
              r={active ? 0.55 : 0.42}
              fill={color}
              stroke={teamColor}
              strokeWidth={0.08}
              opacity={active ? 1 : 0.9}
            />
            {d.isFault && (
              <text
                x={p.sx}
                y={p.sy + 0.25}
                fontSize={1}
                textAnchor="middle"
                fontWeight={700}
                fill="#111"
              >
                ×
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Helper: project a RallyShot-like record → CourtDot3D. Returns null when
 *  landing geometry is missing (no point plotting on the surface). */
export function shotToDot3D(args: {
  id: string;
  land_x: number | null;
  land_y: number | null;
  land_z: number | null;
  contact_x: number | null;
  contact_y: number | null;
  team: 0 | 1;
  won: boolean | null;
  is_final: boolean;
  shot_errors?: Record<string, unknown> | null;
}): CourtDot3D | null {
  const x = args.land_x ?? args.contact_x;
  const y = args.land_y ?? args.contact_y;
  if (x == null || y == null) return null;
  return {
    id: args.id,
    x,
    y,
    z: args.land_z ?? 0,
    team: args.team,
    won: args.won,
    isFinal: args.is_final,
    isFault: !!args.shot_errors && Object.keys(args.shot_errors).length > 0,
  };
}
