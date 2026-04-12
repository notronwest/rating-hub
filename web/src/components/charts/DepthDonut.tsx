import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

interface Props {
  title: string;
  depth: Record<string, number>;
}

const COLORS: Record<string, string> = {
  deep: "#e8710a",
  medium: "#ffc107",
  shallow: "#ef5350",
  net: "#999",
  out: "#666",
};

const LABELS: Record<string, string> = {
  deep: "Deep",
  medium: "Medium",
  shallow: "Shallow",
  net: "Net",
  out: "Out",
};

export default function DepthDonut({ title, depth }: Props) {
  const data = Object.entries(depth)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({
      name: LABELS[k] ?? k,
      value: Math.round(v * 100),
      color: COLORS[k] ?? "#ccc",
    }));

  if (data.length === 0) return null;

  return (
    <div>
      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, marginTop: 0, textAlign: "center" }}>
        {title}
      </h4>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={40}
            outerRadius={68}
            dataKey="value"
            startAngle={90}
            endAngle={-270}
            stroke="none"
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip formatter={(value: number) => `${value}%`} />
          <Legend
            iconType="circle"
            iconSize={10}
            wrapperStyle={{ fontSize: 12 }}
            formatter={(value: string, entry: { color?: string }) => (
              <span style={{ color: "#555" }}>
                <span style={{ fontWeight: 600, color: entry.color, marginRight: 4 }}>
                  {data.find((d) => d.name === value)?.value}%
                </span>
                {value}
              </span>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
