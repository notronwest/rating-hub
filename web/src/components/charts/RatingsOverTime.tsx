import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

export interface RatingSnapshot {
  played_at: string;
  rating_overall: number | null;
  rating_serve: number | null;
  rating_return: number | null;
  rating_offense: number | null;
  rating_defense: number | null;
  rating_agility: number | null;
  rating_consistency: number | null;
}

const LINES = [
  { key: "rating_overall", label: "Overall", color: "#1a73e8" },
  { key: "rating_serve", label: "Serve", color: "#e8710a" },
  { key: "rating_return", label: "Return", color: "#0d904f" },
  { key: "rating_offense", label: "Offense", color: "#d93025" },
  { key: "rating_defense", label: "Defense", color: "#9334e6" },
  { key: "rating_agility", label: "Agility", color: "#00bcd4" },
  { key: "rating_consistency", label: "Consistency", color: "#e91e90" },
] as const;

export default function RatingsOverTime({ data }: { data: RatingSnapshot[] }) {
  if (data.length === 0) return null;

  const chartData = data.map((d) => ({
    date: new Date(d.played_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    ...d,
  }));

  // Compute y-axis domain
  const allVals = data.flatMap((d) =>
    LINES.map((l) => d[l.key as keyof RatingSnapshot] as number | null).filter((v): v is number => v != null),
  );
  const yMin = Math.floor((Math.min(...allVals) - 0.1) * 10) / 10;
  const yMax = Math.ceil((Math.max(...allVals) + 0.1) * 10) / 10;

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e2e2", borderRadius: 12, padding: "20px 20px 12px" }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, marginTop: 0 }}>
        Ratings Over Time
        <span style={{ fontSize: 12, color: "#999", fontWeight: 400, marginLeft: 8 }}>
          {data.length} games
        </span>
      </h3>
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#999" }} />
          <YAxis domain={[yMin, yMax]} tick={{ fontSize: 11, fill: "#999" }} width={35} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #eee" }}
            labelStyle={{ fontWeight: 600, marginBottom: 4 }}
          />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
          {LINES.map((l) => (
            <Line
              key={l.key}
              type="monotone"
              dataKey={l.key}
              name={l.label}
              stroke={l.color}
              strokeWidth={l.key === "rating_overall" ? 2.5 : 1.5}
              dot={{ r: l.key === "rating_overall" ? 4 : 2.5, fill: l.color }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
