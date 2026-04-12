import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

interface Props {
  shotSelection: Record<string, number>;
}

const COLORS: Record<string, string> = {
  drive: "#ef5350",
  dink: "#4caf50",
  reset: "#7e57c2",
  drop: "#29b6f6",
};

const LABEL_MAP: Record<string, string> = {
  drive: "Drive",
  dink: "Dink",
  reset: "Reset",
  drop: "Drop",
};

export default function ShotTypeDonut({ shotSelection }: Props) {
  const data = Object.entries(shotSelection)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({
      name: LABEL_MAP[k] ?? k,
      value: Math.round(v * 100),
      color: COLORS[k] ?? "#bbb",
    }));

  if (data.length === 0) return null;

  return (
    <div>
      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, marginTop: 0, textAlign: "center" }}>
        Shot Type
      </h4>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={45}
            outerRadius={75}
            dataKey="value"
            startAngle={90}
            endAngle={-270}
            stroke="none"
            label={({ name, value }) => `${value}%`}
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
            formatter={(value: string) => <span style={{ color: "#555" }}>{value}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
