/**
 * Hand-rolled SVG charts for the rating report. Intentionally library-
 * free so they render identically in the browser, in `window.print()`
 * PDFs, and on the shared/public HTML. Three primitives cover the
 * report's needs:
 *
 *   - <BarChart>   — grouped bars with a labeled x-axis and a 0–max y
 *   - <Sparkline>  — tiny inline trend line, used under each rating
 *   - <TrendChart> — bigger rating-over-time line with dots and a
 *                    y-axis fixed to the PB Vision 2–8 scale
 */

import type { CSSProperties } from "react";

// ─────────────────────────── Bar chart ───────────────────────────

export interface BarDatum {
  label: string;
  /** 0–100 assumed for percentages; pass `max` explicitly if different. */
  value: number | null;
  /** Optional per-bar color override — used for tier-colored bars in the
   *  rating report. Falls back to the chart-level `color`. */
  color?: string;
}

export function BarChart({
  data,
  title,
  max = 100,
  width = 420,
  height = 180,
  color = "#1a73e8",
  style,
}: {
  data: BarDatum[];
  title?: string;
  max?: number;
  width?: number;
  height?: number;
  color?: string;
  style?: CSSProperties;
}) {
  const padTop = title ? 22 : 8;
  const padBottom = 28;
  const padLeft = 30;
  const padRight = 8;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  const barGap = 10;
  const barW = Math.max(
    10,
    (innerW - barGap * (data.length - 1)) / Math.max(1, data.length),
  );
  const ticks = [0, 25, 50, 75, 100].filter((t) => t <= max);

  return (
    <svg
      width={width}
      height={height}
      style={{ display: "block", ...style }}
      role="img"
      aria-label={title ?? "Bar chart"}
    >
      {title && (
        <text
          x={0}
          y={14}
          fontSize={12}
          fontWeight={600}
          fill="#444"
        >
          {title}
        </text>
      )}
      {/* Y-axis grid lines */}
      {ticks.map((t) => {
        const y = padTop + innerH - (t / max) * innerH;
        return (
          <g key={t}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={y}
              y2={y}
              stroke="#eee"
              strokeWidth={1}
            />
            <text x={padLeft - 4} y={y + 3} fontSize={9} textAnchor="end" fill="#888">
              {t}
            </text>
          </g>
        );
      })}
      {/* Bars */}
      {data.map((d, i) => {
        const v = d.value ?? 0;
        const h = Math.max(0, (v / max) * innerH);
        const x = padLeft + i * (barW + barGap);
        const y = padTop + innerH - h;
        const barColor = d.value == null ? "#ccc" : d.color ?? color;
        return (
          <g key={d.label}>
            <rect
              x={x}
              y={y}
              width={barW}
              height={h}
              fill={barColor}
              opacity={d.value == null ? 0.4 : 1}
              rx={2}
            />
            {d.value != null && (
              <text
                x={x + barW / 2}
                y={y - 3}
                fontSize={10}
                fontWeight={600}
                textAnchor="middle"
                fill="#333"
              >
                {Math.round(v)}
                {max === 100 ? "%" : ""}
              </text>
            )}
            <text
              x={x + barW / 2}
              y={height - 10}
              fontSize={10}
              textAnchor="middle"
              fill="#555"
            >
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─────────────────────────── Sparkline ───────────────────────────

export function Sparkline({
  values,
  width = 80,
  height = 22,
  color = "#1a73e8",
  style,
}: {
  values: Array<number | null>;
  width?: number;
  height?: number;
  color?: string;
  style?: CSSProperties;
}) {
  const points = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v != null);
  if (points.length < 2) {
    return (
      <div
        style={{
          fontSize: 9,
          color: "#aaa",
          width,
          height,
          display: "grid",
          placeItems: "center",
          ...style,
        }}
      >
        not enough data
      </div>
    );
  }
  const min = Math.min(...points.map((p) => p.v));
  const max = Math.max(...points.map((p) => p.v));
  const range = Math.max(0.2, max - min); // minimum range so flat-ish lines still visible
  const n = values.length;
  const path = points
    .map((p, idx) => {
      const x = (p.i / Math.max(1, n - 1)) * (width - 4) + 2;
      const y = height - 2 - ((p.v - min) / range) * (height - 4);
      return `${idx === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const last = points[points.length - 1];
  const lastX = (last.i / Math.max(1, n - 1)) * (width - 4) + 2;
  const lastY = height - 2 - ((last.v - min) / range) * (height - 4);

  return (
    <svg width={width} height={height} style={{ display: "block", ...style }}>
      <path d={path} fill="none" stroke={color} strokeWidth={1.4} />
      <circle cx={lastX} cy={lastY} r={2} fill={color} />
    </svg>
  );
}

// ─────────────────────────── Trend chart ───────────────────────────

export function TrendChart({
  samples,
  title,
  yMin = 2,
  yMax = 8,
  width = 640,
  height = 200,
  color = "#1a73e8",
  style,
}: {
  samples: Array<{ playedAt: string; overall: number | null }>;
  title?: string;
  yMin?: number;
  yMax?: number;
  width?: number;
  height?: number;
  color?: string;
  style?: CSSProperties;
}) {
  const pts = samples
    .map((s, i) => ({
      i,
      v: s.overall,
      t: new Date(s.playedAt).getTime(),
    }))
    .filter((p): p is { i: number; v: number; t: number } => p.v != null);
  if (pts.length === 0) {
    return (
      <div
        style={{
          width,
          height,
          display: "grid",
          placeItems: "center",
          background: "#fafafa",
          border: "1px solid #eee",
          borderRadius: 6,
          color: "#888",
          fontSize: 12,
        }}
      >
        No rating data yet
      </div>
    );
  }
  const padTop = title ? 22 : 10;
  const padBottom = 22;
  const padLeft = 32;
  const padRight = 8;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;
  const tMin = Math.min(...pts.map((p) => p.t));
  const tMax = Math.max(...pts.map((p) => p.t));
  const tRange = Math.max(1, tMax - tMin);
  const yTicks = [];
  for (let y = yMin; y <= yMax; y += 1) yTicks.push(y);

  const projected = pts.map((p) => ({
    x: padLeft + ((p.t - tMin) / tRange) * innerW,
    y: padTop + innerH - ((p.v - yMin) / (yMax - yMin)) * innerH,
    v: p.v,
    t: p.t,
  }));
  const pathD = projected
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      style={{ display: "block", ...style }}
      role="img"
      aria-label={title ?? "Rating trend"}
    >
      {title && (
        <text x={0} y={14} fontSize={12} fontWeight={600} fill="#444">
          {title}
        </text>
      )}
      {/* Y-axis grid */}
      {yTicks.map((t) => {
        const y = padTop + innerH - ((t - yMin) / (yMax - yMin)) * innerH;
        return (
          <g key={t}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={y}
              y2={y}
              stroke={t === Math.round((yMin + yMax) / 2) ? "#e2e2e2" : "#f0f0f0"}
              strokeWidth={1}
            />
            <text x={padLeft - 4} y={y + 3} fontSize={9} textAnchor="end" fill="#888">
              {t.toFixed(0)}
            </text>
          </g>
        );
      })}
      {/* X-axis end labels — just earliest + latest to avoid crowding. */}
      {pts.length >= 2 && (
        <>
          <text
            x={padLeft}
            y={height - 6}
            fontSize={9}
            fill="#888"
            textAnchor="start"
          >
            {formatShortDate(tMin)}
          </text>
          <text
            x={width - padRight}
            y={height - 6}
            fontSize={9}
            fill="#888"
            textAnchor="end"
          >
            {formatShortDate(tMax)}
          </text>
        </>
      )}
      {/* Line */}
      <path d={pathD} fill="none" stroke={color} strokeWidth={2} />
      {/* Dots */}
      {projected.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill={color} />
      ))}
      {/* Value labels on first + last — just enough to anchor readers. */}
      {projected.length > 0 && (
        <>
          <text
            x={projected[0].x + 6}
            y={projected[0].y - 6}
            fontSize={10}
            fontWeight={600}
            fill="#333"
          >
            {projected[0].v.toFixed(2)}
          </text>
          <text
            x={projected[projected.length - 1].x - 6}
            y={projected[projected.length - 1].y - 6}
            fontSize={10}
            fontWeight={700}
            fill={color}
            textAnchor="end"
          >
            {projected[projected.length - 1].v.toFixed(2)}
          </text>
        </>
      )}
    </svg>
  );
}

function formatShortDate(t: number): string {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
}
