import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

interface Props {
  title: string;
  won: number;
  total: number;
  recentWon?: number;
  recentTotal?: number;
}

const COLORS = { won: "#4caf50", lost: "#ef5350" };

export default function WinRateDonut({ title, won, total, recentWon, recentTotal }: Props) {
  const lost = total - won;
  const pct = total > 0 ? Math.round((won / total) * 100) : 0;
  const data = [
    { name: "Won", value: won },
    { name: "Lost", value: lost },
  ];

  return (
    <div style={{ textAlign: "center" }}>
      <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, marginTop: 0 }}>{title}</h4>
      <div style={{ position: "relative", width: 160, height: 160, margin: "0 auto" }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={48}
              outerRadius={72}
              dataKey="value"
              startAngle={90}
              endAngle={-270}
              stroke="none"
            >
              <Cell fill={COLORS.won} />
              <Cell fill={COLORS.lost} />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 22, fontWeight: 700 }}>{pct}%</div>
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
        {recentWon != null && recentTotal != null && recentTotal > 0 && (
          <div>Recent: {recentWon} / {recentTotal} ({Math.round((recentWon / recentTotal) * 100)}%)</div>
        )}
        <div style={{ color: "#999" }}>
          Lifetime: {won} / {total} ({pct}%)
        </div>
      </div>
    </div>
  );
}
