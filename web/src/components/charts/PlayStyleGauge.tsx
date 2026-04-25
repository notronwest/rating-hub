/**
 * Play style gauge: Defensive ← → Aggressive
 * Computed from shot selection: more drives = aggressive, more dinks/drops/resets = defensive.
 */

interface Props {
  shotSelection: Record<string, number>;
}

export default function PlayStyleGauge({ shotSelection }: Props) {
  // Score: 0 = fully defensive, 1 = fully aggressive
  const aggressive = (shotSelection.drive ?? 0);
  const defensive = (shotSelection.dink ?? 0) + (shotSelection.drop ?? 0) + (shotSelection.reset ?? 0);
  const total = aggressive + defensive;
  const score = total > 0 ? aggressive / total : 0.5;

  // Map score to needle angle, in SVG degrees (0° = right, -90° = up,
  // 180° = left). We want the arc to read: defensive far-left → center
  // top → aggressive far-right, so the angle traces that upper
  // semicircle.
  //   score 0    → 180°  (left, "Defensive")
  //   score 0.5  → -90°  (straight up, "neutral")
  //   score 1    →  0°   (right, "Aggressive")
  // The previous formula (-90 + score * 180) mapped 0.5 → horizontal
  // right, which made even 60% drivers look fully aggressive.
  const angle = -180 + score * 180;
  const needleLength = 58;
  const cx = 100;
  const cy = 90;
  const rad = (angle * Math.PI) / 180;
  const nx = cx + needleLength * Math.cos(rad);
  const ny = cy + needleLength * Math.sin(rad);

  return (
    <div>
      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, marginTop: 0, textAlign: "center" }}>
        Play Style
      </h4>
      <svg viewBox="0 0 200 110" style={{ width: "100%", maxWidth: 240, display: "block", margin: "0 auto" }}>
        {/* Arc background — left half (defensive/blue) */}
        <path
          d="M 25 90 A 75 75 0 0 1 100 15"
          fill="none"
          stroke="#5c6bc0"
          strokeWidth={16}
          strokeLinecap="round"
          opacity={0.3}
        />
        {/* Arc background — right half (aggressive/red) */}
        <path
          d="M 100 15 A 75 75 0 0 1 175 90"
          fill="none"
          stroke="#ef5350"
          strokeWidth={16}
          strokeLinecap="round"
          opacity={0.3}
        />
        {/* Needle */}
        <line
          x1={cx}
          y1={cy}
          x2={nx}
          y2={ny}
          stroke="#333"
          strokeWidth={3}
          strokeLinecap="round"
        />
        <circle cx={cx} cy={cy} r={5} fill="#333" />
        {/* Labels */}
        <text x={25} y={108} textAnchor="middle" fontSize={10} fill="#5c6bc0" fontWeight={600}>
          Defensive
        </text>
        <text x={175} y={108} textAnchor="middle" fontSize={10} fill="#ef5350" fontWeight={600}>
          Aggressive
        </text>
      </svg>
    </div>
  );
}
