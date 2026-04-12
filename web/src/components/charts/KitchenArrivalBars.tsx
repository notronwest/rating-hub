import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

interface GameKitchenData {
  date: string;
  serving: number | null;
  receiving: number | null;
}

interface Props {
  title: string;
  side: "serving" | "receiving";
  data: GameKitchenData[];
}

export default function KitchenArrivalBars({ title, side, data }: Props) {
  const chartData = data.map((d) => ({
    date: d.date,
    pct: Math.round(((side === "serving" ? d.serving : d.receiving) ?? 0) * 100),
  }));

  if (chartData.length === 0) return null;

  const avg = Math.round(chartData.reduce((sum, d) => sum + d.pct, 0) / chartData.length);

  // Color bars by value: green >= 70, yellow >= 40, red < 40
  const getColor = (pct: number) => {
    if (pct >= 70) return "#4caf50";
    if (pct >= 40) return "#ffc107";
    return "#ef5350";
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e2e2", borderRadius: 12, padding: "20px 20px 12px" }}>
      <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, marginTop: 0 }}>
        {title}
        <span style={{ fontSize: 12, color: "#999", fontWeight: 400, marginLeft: 8 }}>
          Avg: {avg}%
        </span>
      </h3>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#999" }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#999" }} tickFormatter={(v: number) => `${v}%`} width={35} />
          <Tooltip
            formatter={(value: number) => `${value}%`}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #eee" }}
          />
          <ReferenceLine y={avg} stroke="#999" strokeDasharray="3 3" />
          <Bar
            dataKey="pct"
            radius={[3, 3, 0, 0]}
            label={{ position: "top", fontSize: 10, fill: "#666", formatter: (v: number) => `${v}%` }}
          >
            {chartData.map((entry, i) => (
              <rect key={i} fill={getColor(entry.pct)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Helper to build KitchenArrivalBars data from game_players rows
export function buildKitchenData(
  gamePlayerRows: Array<{
    played_at: string | null;
    kitchen_arrivals_summary: { serving_side?: number; receiving_side?: number } | null;
  }>,
): GameKitchenData[] {
  return gamePlayerRows
    .filter((gp) => gp.kitchen_arrivals_summary)
    .map((gp) => ({
      date: gp.played_at
        ? new Date(gp.played_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : "?",
      serving: gp.kitchen_arrivals_summary?.serving_side ?? null,
      receiving: gp.kitchen_arrivals_summary?.receiving_side ?? null,
    }));
}
