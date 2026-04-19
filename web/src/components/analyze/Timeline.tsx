import type { AnalysisNote } from "../../types/coach";

interface Rally {
  id: string;
  rally_index: number;
  start_ms: number;
  end_ms: number;
  winning_team: number | null;
}

interface HighlightEvent {
  s: number; // start_ms
  e: number; // end_ms
  kind: string;
  short_description: string;
}

interface Props {
  durationMs: number;
  currentMs: number;
  rallies: Rally[];
  highlights?: HighlightEvent[];
  notes: AnalysisNote[];
  onSeek: (ms: number) => void;
}

export default function Timeline({
  durationMs,
  currentMs,
  rallies,
  highlights = [],
  notes,
  onSeek,
}: Props) {
  const W = 1000;
  const H = 60;
  const pct = (ms: number) => (ms / Math.max(durationMs, 1)) * 100;

  function handleClick(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ms = Math.round((x / rect.width) * durationMs);
    onSeek(ms);
  }

  return (
    <div style={{ marginTop: 12 }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height: H, cursor: "pointer" }}
        onClick={handleClick}
      >
        {/* Background */}
        <rect x={0} y={0} width={W} height={H} fill="#f8f9fa" />

        {/* Rally bars */}
        {rallies.map((r) => {
          const x = (pct(r.start_ms) / 100) * W;
          const w = Math.max(((r.end_ms - r.start_ms) / durationMs) * W, 1);
          const color =
            r.winning_team === 0
              ? "#4caf50"
              : r.winning_team === 1
              ? "#ef5350"
              : "#bbb";
          return (
            <rect
              key={r.id}
              x={x}
              y={24}
              width={w}
              height={14}
              fill={color}
              opacity={0.6}
            >
              <title>
                Rally {r.rally_index + 1} — {r.winning_team === 0 ? "T0" : r.winning_team === 1 ? "T1" : "?"}
              </title>
            </rect>
          );
        })}

        {/* Highlight markers */}
        {highlights.map((h, i) => {
          const x = (pct(h.s) / 100) * W;
          return (
            <polygon
              key={i}
              points={`${x - 5},8 ${x + 5},8 ${x},18`}
              fill="#ffc107"
            >
              <title>{h.short_description} ({h.kind})</title>
            </polygon>
          );
        })}

        {/* Note markers */}
        {notes
          .filter((n) => n.timestamp_ms != null)
          .map((n) => {
            const x = (pct(n.timestamp_ms!) / 100) * W;
            return (
              <circle key={n.id} cx={x} cy={48} r={4} fill="#1a73e8">
                <title>{n.note.slice(0, 60)}</title>
              </circle>
            );
          })}

        {/* Playhead */}
        <line
          x1={(pct(currentMs) / 100) * W}
          y1={0}
          x2={(pct(currentMs) / 100) * W}
          y2={H}
          stroke="#333"
          strokeWidth={1.5}
        />
      </svg>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#999", marginTop: 2 }}>
        <span>0:00</span>
        <span style={{ display: "flex", gap: 12 }}>
          <LegendDot color="#4caf50" label="Team 0 won" />
          <LegendDot color="#ef5350" label="Team 1 won" />
          <LegendDot color="#ffc107" label="Highlight" />
          <LegendDot color="#1a73e8" label="Note" />
        </span>
        <span>{formatMs(durationMs)}</span>
      </div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          background: color,
          borderRadius: "50%",
        }}
      />
      {label}
    </span>
  );
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
