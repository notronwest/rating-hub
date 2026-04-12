import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// PB Vision serve speed buckets: 17 bins from <15 to >=55 mph
const SPEED_LABELS = [
  "<15", "15", "17.5", "20", "22.5", "25", "27.5", "30",
  "32.5", "35", "37.5", "40", "42.5", "45", "47.5", "50", "55",
];

interface Props {
  /** Array of 17 values (0-1) representing percentage in each speed bucket, aggregated across games */
  distribution: number[];
}

export default function ServeSpeedHistogram({ distribution }: Props) {
  if (!distribution || distribution.length === 0) return null;

  const data = SPEED_LABELS.map((label, i) => ({
    mph: label,
    pct: Math.round((distribution[i] ?? 0) * 100),
  }));

  const maxPct = Math.max(...data.map((d) => d.pct));
  if (maxPct === 0) return null;

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e2e2", borderRadius: 12, padding: "20px 20px 12px" }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, marginTop: 0 }}>
        Serve Speed
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis
            dataKey="mph"
            tick={{ fontSize: 10, fill: "#999" }}
            label={{ value: "mph", position: "insideBottomRight", offset: -5, fontSize: 11, fill: "#999" }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "#999" }}
            tickFormatter={(v: number) => `${v}%`}
            width={40}
          />
          <Tooltip
            formatter={(value: number) => `${value}%`}
            labelFormatter={(label: string) => `${label} mph`}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #eee" }}
          />
          <Bar dataKey="pct" fill="#bdbdbd" radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
