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
  /** Header shown above the chart. Defaults to "Serve Speed" so existing
   *  callers don't need to change. Return Speed uses "Return Speed" here. */
  title?: string;
  /** Bar color. Defaults to neutral gray (serve). Return charts pass a
   *  different accent so the two side-by-side readers can tell them
   *  apart at a glance. */
  color?: string;
}

export default function ServeSpeedHistogram({
  distribution,
  title = "Serve Speed",
  color = "#bdbdbd",
}: Props) {
  if (!distribution || distribution.length === 0) return null;

  const data = SPEED_LABELS.map((label, i) => ({
    mph: label,
    pct: Math.round((distribution[i] ?? 0) * 100),
  }));

  const maxPct = Math.max(...data.map((d) => d.pct));
  if (maxPct === 0) return null;

  return (
    <div
      className="speed-histogram-card"
      style={{
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 12,
        // Extra bottom padding so the descender on "mph" isn't clipped
        // when the PDF renderer uses a slightly smaller line-box than
        // the browser. Top/sides stay tight.
        padding: "20px 20px 20px",
        // Keep title + chart on the same page when rendered to PDF.
        breakInside: "avoid",
        pageBreakInside: "avoid",
      }}
    >
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16, marginTop: 0 }}>
        {title}
      </h3>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis
            dataKey="mph"
            tick={{ fontSize: 10, fill: "#999" }}
            // `offset: -5` pulled the "mph" label down into the
            // container padding where its descender got clipped in the
            // PDF. Positive offset puts it above the x-tick baseline
            // with room to spare for the p-descender.
            label={{ value: "mph", position: "insideBottomRight", offset: 4, fontSize: 11, fill: "#999" }}
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
          <Bar dataKey="pct" fill={color} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
