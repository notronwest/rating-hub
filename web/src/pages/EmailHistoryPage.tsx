/**
 * EmailHistoryPage — every rating-report email the system has ever
 * sent, with delivery + open + click stats.
 *
 * Read-only list; no send actions here (those live on the session
 * detail page and the player profile). Useful for "did Patti get her
 * report last Wednesday, and did she open it?" without clicking into
 * each session.
 *
 * RLS scopes the query to the coach's org, so no need for an org_id
 * filter beyond what the table policy already enforces.
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../supabase";
import type { RatingReportEmailRow } from "../lib/coachApi";

interface PlayerLite {
  id: string;
  display_name: string;
  slug: string;
}
interface SessionLite {
  id: string;
  label: string | null;
  played_date: string;
}

type Filter = "all" | "sent" | "opened" | "clicked" | "bounced" | "failed";

export default function EmailHistoryPage() {
  const { orgId } = useParams();
  const [rows, setRows] = useState<RatingReportEmailRow[]>([]);
  const [playersById, setPlayersById] = useState<Map<string, PlayerLite>>(new Map());
  const [sessionsById, setSessionsById] = useState<Map<string, SessionLite>>(new Map());
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const { data: emailRows, error } = await supabase
          .from("rating_report_emails")
          .select("*")
          .order("created_at", { ascending: false });
        if (error) throw new Error(error.message);
        const list = (emailRows ?? []) as RatingReportEmailRow[];
        if (cancelled) return;
        setRows(list);

        // Hydrate player + session names in one round trip each.
        const playerIds = Array.from(new Set(list.map((r) => r.player_id)));
        const sessionIds = Array.from(
          new Set(list.map((r) => r.session_id).filter((id): id is string => !!id)),
        );
        const [pRes, sRes] = await Promise.all([
          playerIds.length > 0
            ? supabase
                .from("players")
                .select("id, display_name, slug")
                .in("id", playerIds)
            : Promise.resolve({ data: [] }),
          sessionIds.length > 0
            ? supabase
                .from("sessions")
                .select("id, label, played_date")
                .in("id", sessionIds)
            : Promise.resolve({ data: [] }),
        ]);
        if (cancelled) return;
        setPlayersById(
          new Map(((pRes.data ?? []) as PlayerLite[]).map((p) => [p.id, p])),
        );
        setSessionsById(
          new Map(((sRes.data ?? []) as SessionLite[]).map((s) => [s.id, s])),
        );
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    return rows.filter((r) => {
      if (filter === "sent") return r.status !== "failed" && r.status !== "bounced";
      if (filter === "opened") return !!r.opened_at;
      if (filter === "clicked") return !!r.clicked_at;
      if (filter === "bounced") return r.status === "bounced";
      if (filter === "failed") return r.status === "failed";
      return true;
    });
  }, [rows, filter]);

  // Summary metrics — derived once, shown as pill stats at top.
  const summary = useMemo(() => {
    const delivered = rows.filter(
      (r) => r.status === "delivered" || r.status === "opened" || r.status === "clicked",
    ).length;
    const opened = rows.filter((r) => !!r.opened_at).length;
    const clicked = rows.filter((r) => !!r.clicked_at).length;
    const bounced = rows.filter((r) => r.status === "bounced").length;
    const failed = rows.filter((r) => r.status === "failed").length;
    const sentTotal = rows.length;
    const pct = (num: number, den: number) =>
      den > 0 ? Math.round((num / den) * 100) : 0;
    return {
      sentTotal,
      delivered,
      opened,
      clicked,
      bounced,
      failed,
      openRate: pct(opened, sentTotal),
      clickRate: pct(clicked, sentTotal),
    };
  }, [rows]);

  return (
    <div style={{ maxWidth: 1100 }}>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginTop: 0, marginBottom: 4 }}>
        📧 Email history
      </h2>
      <p style={{ color: "#666", fontSize: 13, marginTop: 0, marginBottom: 18 }}>
        Every rating-report email the system has sent, with delivery +
        open + click tracking from Resend's webhook.
      </p>

      {err && (
        <div
          style={{
            padding: "10px 12px",
            background: "#f8d7da",
            color: "#721c24",
            border: "1px solid #f5c6cb",
            borderRadius: 6,
            fontSize: 13,
            marginBottom: 14,
          }}
        >
          {err}
        </div>
      )}

      {/* Summary tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: 10,
          marginBottom: 18,
        }}
      >
        <SummaryTile
          label="Sent"
          value={String(summary.sentTotal)}
          sub={
            summary.sentTotal === 0
              ? "No emails yet"
              : `${summary.delivered} delivered`
          }
          color="#1a73e8"
        />
        <SummaryTile
          label="Open rate"
          value={`${summary.openRate}%`}
          sub={`${summary.opened} / ${summary.sentTotal} opened`}
          color="#1e7e34"
        />
        <SummaryTile
          label="Click rate"
          value={`${summary.clickRate}%`}
          sub={`${summary.clicked} clicked a link`}
          color="#0b6ea8"
        />
        <SummaryTile
          label="Bounced"
          value={String(summary.bounced)}
          sub={summary.bounced > 0 ? "check addresses" : "—"}
          color={summary.bounced > 0 ? "#c62828" : "#888"}
        />
        <SummaryTile
          label="Failed"
          value={String(summary.failed)}
          sub={summary.failed > 0 ? "check logs" : "—"}
          color={summary.failed > 0 ? "#c62828" : "#888"}
        />
      </div>

      {/* Filter row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontSize: 11, color: "#888" }}>Filter:</span>
        {(
          [
            ["all", "All"],
            ["sent", "Sent"],
            ["opened", "Opened"],
            ["clicked", "Clicked"],
            ["bounced", "Bounced"],
            ["failed", "Failed"],
          ] as Array<[Filter, string]>
        ).map(([key, label]) => {
          const active = filter === key;
          return (
            <button
              key={key}
              onClick={() => setFilter(key)}
              style={{
                padding: "5px 10px",
                fontSize: 12,
                fontWeight: active ? 700 : 500,
                background: active ? "#1a73e8" : "#fff",
                color: active ? "#fff" : "#333",
                border: "1px solid " + (active ? "#1a73e8" : "#ccc"),
                borderRadius: 5,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {label}
            </button>
          );
        })}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "#888" }}>
          {filtered.length} of {rows.length} shown
        </span>
      </div>

      {/* Table */}
      <div
        style={{
          border: "1px solid #eee",
          borderRadius: 8,
          overflow: "hidden",
          background: "#fff",
        }}
      >
        {loading ? (
          <div style={{ padding: 18, color: "#888", fontSize: 13 }}>
            Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div
            style={{
              padding: 24,
              color: "#888",
              fontSize: 13,
              textAlign: "center",
              fontStyle: "italic",
            }}
          >
            {rows.length === 0
              ? "No emails sent yet — send a rating report from a session or player profile to see activity here."
              : "No emails match this filter."}
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead style={{ background: "#fafafa" }}>
              <tr>
                <Th>Sent</Th>
                <Th>Player</Th>
                <Th>Email</Th>
                <Th>Scope</Th>
                <Th>Status</Th>
                <Th>Opened</Th>
                <Th>Clicked</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const player = playersById.get(row.player_id);
                const session = row.session_id
                  ? sessionsById.get(row.session_id)
                  : null;
                return (
                  <tr key={row.id} style={{ borderTop: "1px solid #eee" }}>
                    <Td>{fmtTs(row.created_at)}</Td>
                    <Td>
                      {player ? (
                        <Link
                          to={`/org/${orgId}/players/${player.slug}`}
                          style={{
                            color: "#1a73e8",
                            textDecoration: "none",
                            fontWeight: 500,
                          }}
                        >
                          {player.display_name}
                        </Link>
                      ) : (
                        <span style={{ color: "#888" }}>
                          {row.player_id.slice(0, 8)}
                        </span>
                      )}
                    </Td>
                    <Td style={{ color: "#555" }}>{row.email_to}</Td>
                    <Td>
                      {session ? (
                        <Link
                          to={`/org/${orgId}/sessions/${session.id}`}
                          style={{ color: "#1a73e8", textDecoration: "none" }}
                        >
                          {session.label ?? session.played_date}
                        </Link>
                      ) : (
                        <span
                          style={{
                            color: "#888",
                            fontStyle: "italic",
                            fontSize: 12,
                          }}
                        >
                          rolling window
                        </span>
                      )}
                    </Td>
                    <Td>
                      <StatusBadge
                        status={row.status}
                        error={row.last_error}
                      />
                    </Td>
                    <Td style={{ color: "#555" }}>
                      {row.opened_at ? (
                        <>
                          {fmtTs(row.opened_at)}
                          {row.open_count > 1 && (
                            <span style={{ color: "#888", marginLeft: 4 }}>
                              ×{row.open_count}
                            </span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td style={{ color: "#555" }}>
                      {row.clicked_at ? (
                        <>
                          {fmtTs(row.clicked_at)}
                          {row.click_count > 1 && (
                            <span style={{ color: "#888", marginLeft: 4 }}>
                              ×{row.click_count}
                            </span>
                          )}
                        </>
                      ) : (
                        "—"
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────── Small bits ───────────────────────────

function SummaryTile({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderLeft: `3px solid ${color}`,
        borderRadius: 8,
        padding: "10px 12px",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "#888",
          textTransform: "uppercase",
          letterSpacing: 0.4,
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color, marginTop: 2 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "10px 12px",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: 0.4,
        color: "#666",
        fontWeight: 700,
      }}
    >
      {children}
    </th>
  );
}
function Td({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <td
      style={{
        padding: "10px 12px",
        verticalAlign: "top",
        ...style,
      }}
    >
      {children}
    </td>
  );
}

function StatusBadge({
  status,
  error,
}: {
  status: string;
  error: string | null;
}) {
  const specs: Record<string, { label: string; color: string; bg: string }> = {
    pending: { label: "Pending", color: "#555", bg: "#eee" },
    sent: { label: "Sent", color: "#0b6ea8", bg: "#e7f1fa" },
    delivered: { label: "Delivered", color: "#0b6ea8", bg: "#e7f1fa" },
    opened: { label: "Opened", color: "#1e7e34", bg: "#e6f4ea" },
    clicked: { label: "Clicked", color: "#1e7e34", bg: "#d4edda" },
    bounced: { label: "Bounced", color: "#c62828", bg: "#fdecea" },
    failed: { label: "Failed", color: "#c62828", bg: "#fdecea" },
  };
  const spec = specs[status] ?? specs.pending;
  return (
    <span
      title={error ?? undefined}
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 3,
        background: spec.bg,
        color: spec.color,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.3,
        textTransform: "uppercase",
      }}
    >
      {spec.label}
    </span>
  );
}

function fmtTs(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
