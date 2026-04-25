import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

interface Props {
  shotSelection: Record<string, number>;
}

const COLORS: Record<string, string> = {
  drive: "#5e35b1",
  dink: "#4caf50",
  // Orange distinguishes Reset from Drive (which is deep-purple) and
  // from the analyze-page per-shot palette where Reset is cyan.
  reset: "#f57c00",
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
      {/* `label + labelLine` on a recharts pie draws labels outside the
          ring, which overflows narrow containers (the profile page's
          4-column grid). We render percentages inside each slice
          instead, and lean on the legend below for the category name. */}
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
            label={renderInsideLabel}
            labelLine={false}
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

// Position the label at the midpoint of each slice's radial arc, inside
// the donut band. Recharts passes per-slice geometry; we recompute the
// (x, y) rather than using its default outside-ring placement which was
// clipping against the profile page's 200px column.
function renderInsideLabel(props: {
  cx: number;
  cy: number;
  midAngle: number;
  innerRadius: number;
  outerRadius: number;
  value: number;
}) {
  const { cx, cy, midAngle, innerRadius, outerRadius, value } = props;
  if (value < 6) return null; // skip tiny slices — no room to read
  const radius = innerRadius + (outerRadius - innerRadius) / 2;
  const RADIAN = Math.PI / 180;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      fill="#fff"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontWeight={700}
    >
      {value}%
    </text>
  );
}
