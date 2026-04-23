/**
 * EmailRatingReportsPanel — sits on the Session Detail page. Surfaces a
 * "Send rating reports" button + the history of every email the system
 * has sent for this session (status, who, when, opens, clicks).
 *
 * Send flow:
 *   1. Button opens a modal with every player in the session that has
 *      an email on file.
 *   2. Coach un-checks anyone they don't want to email, confirms.
 *   3. We hit the `send-rating-reports` edge function, which inserts
 *      pending rows and fires the Resend requests.
 *   4. History below refreshes — opens/clicks trickle in via the
 *      `resend-webhook` as Resend observes them.
 */

import { useEffect, useState } from "react";
import { supabase } from "../../supabase";
import {
  listRatingReportEmails,
  sendRatingReports,
  type RatingReportEmailRow,
} from "../../lib/coachApi";

interface PlayerWithEmail {
  id: string;
  display_name: string;
  email: string | null;
  avatar_url: string | null;
}

interface Props {
  sessionId: string;
}

export default function EmailRatingReportsPanel({ sessionId }: Props) {
  const [players, setPlayers] = useState<PlayerWithEmail[]>([]);
  const [history, setHistory] = useState<RatingReportEmailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      // Load the session's players (join through game_players → players).
      const { data: games } = await supabase
        .from("games")
        .select("id")
        .eq("session_id", sessionId);
      const gameIds = (games ?? []).map((g) => g.id);
      if (gameIds.length === 0) {
        setPlayers([]);
      } else {
        const { data: gps } = await supabase
          .from("game_players")
          .select("player_id")
          .in("game_id", gameIds);
        const playerIds = Array.from(
          new Set((gps ?? []).map((gp) => gp.player_id as string)),
        );
        const { data: playerRows } = await supabase
          .from("players")
          .select("id, display_name, email, avatar_url")
          .in("id", playerIds);
        setPlayers(
          ((playerRows ?? []) as PlayerWithEmail[]).sort((a, b) =>
            a.display_name.localeCompare(b.display_name),
          ),
        );
      }
      setHistory(await listRatingReportEmails(sessionId));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const withEmail = players.filter((p) => !!p.email);
  const withoutEmail = players.filter((p) => !p.email);

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 10,
        padding: "14px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: "#222" }}>
          📧 Email rating reports
        </div>
        <span style={{ color: "#888", fontSize: 12 }}>
          {withEmail.length} of {players.length} players have an email on file
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setShowModal(true)}
          disabled={loading || withEmail.length === 0}
          style={{
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 600,
            background: "#1a73e8",
            color: "#fff",
            border: "1px solid #1a73e8",
            borderRadius: 6,
            cursor:
              loading || withEmail.length === 0 ? "not-allowed" : "pointer",
            fontFamily: "inherit",
            opacity: loading || withEmail.length === 0 ? 0.6 : 1,
          }}
        >
          Send rating reports
        </button>
      </div>

      {err && (
        <div
          style={{
            marginTop: 10,
            padding: "8px 10px",
            background: "#f8d7da",
            color: "#721c24",
            border: "1px solid #f5c6cb",
            borderRadius: 4,
            fontSize: 12,
          }}
        >
          {err}
        </div>
      )}

      {withoutEmail.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#8a6d00" }}>
          No email on file for: {withoutEmail.map((p) => p.display_name).join(", ")}.
          Add via the player's profile, or skip them.
        </div>
      )}

      {/* History */}
      <HistoryTable history={history} players={players} />

      {showModal && (
        <SendModal
          sessionId={sessionId}
          players={withEmail}
          onClose={() => setShowModal(false)}
          onSent={async () => {
            setShowModal(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────── History table ───────────────────────────

function HistoryTable({
  history,
  players,
}: {
  history: RatingReportEmailRow[];
  players: PlayerWithEmail[];
}) {
  if (history.length === 0) {
    return (
      <div
        style={{
          marginTop: 12,
          fontSize: 12,
          color: "#888",
          fontStyle: "italic",
        }}
      >
        No emails sent yet.
      </div>
    );
  }
  const playerById = new Map(players.map((p) => [p.id, p]));
  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          fontSize: 11,
          color: "#666",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          marginBottom: 6,
        }}
      >
        Delivery log
      </div>
      <div style={{ border: "1px solid #eee", borderRadius: 6, overflow: "hidden" }}>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 12,
            background: "#fff",
          }}
        >
          <thead style={{ background: "#fafafa" }}>
            <tr>
              <Th>Player</Th>
              <Th>Email</Th>
              <Th>Status</Th>
              <Th>Sent</Th>
              <Th>Opened</Th>
              <Th>Clicked</Th>
            </tr>
          </thead>
          <tbody>
            {history.map((row) => {
              const p = playerById.get(row.player_id);
              return (
                <tr key={row.id} style={{ borderTop: "1px solid #eee" }}>
                  <Td>{p?.display_name ?? row.player_id.slice(0, 8)}</Td>
                  <Td style={{ color: "#555" }}>{row.email_to}</Td>
                  <Td>
                    <StatusBadge status={row.status} error={row.last_error} />
                  </Td>
                  <Td style={{ color: "#555" }}>{fmtTs(row.sent_at)}</Td>
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
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "7px 10px",
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
        padding: "7px 10px",
        fontSize: 12,
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

// ─────────────────────────── Send modal ───────────────────────────

function SendModal({
  sessionId,
  players,
  onClose,
  onSent,
}: {
  sessionId: string;
  players: PlayerWithEmail[];
  onClose: () => void;
  onSent: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(
    new Set(players.map((p) => p.id)),
  );
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function toggle(id: string) {
    setChecked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function handleSend() {
    setSending(true);
    setErr(null);
    try {
      await sendRatingReports({
        sessionId,
        playerIds: Array.from(checked),
      });
      onSent();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const count = checked.size;

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.45)",
        display: "grid",
        placeItems: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 10,
          width: "min(540px, 92vw)",
          maxHeight: "86vh",
          overflowY: "auto",
          padding: 20,
          fontFamily: "inherit",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "#222" }}>
          Send rating reports
        </h3>
        <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
          Each selected player will get an email with their session summary
          and a link to the full report. Opens and clicks will show up in
          the delivery log.
        </div>

        <div
          style={{
            marginTop: 14,
            border: "1px solid #eee",
            borderRadius: 6,
            overflow: "hidden",
          }}
        >
          {players.map((p) => {
            const on = checked.has(p.id);
            return (
              <label
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderTop: "1px solid #eee",
                  cursor: "pointer",
                  background: on ? "#f7fbff" : "#fff",
                }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => toggle(p.id)}
                  style={{ accentColor: "#1a73e8" }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: "#222", fontWeight: 600 }}>
                    {p.display_name}
                  </div>
                  <div style={{ fontSize: 11, color: "#666" }}>{p.email}</div>
                </div>
              </label>
            );
          })}
        </div>

        {err && (
          <div
            style={{
              marginTop: 12,
              padding: "8px 10px",
              background: "#f8d7da",
              color: "#721c24",
              border: "1px solid #f5c6cb",
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            {err}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 16,
          }}
        >
          <button
            onClick={onClose}
            disabled={sending}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              background: "#fff",
              color: "#333",
              border: "1px solid #ccc",
              borderRadius: 5,
              cursor: sending ? "wait" : "pointer",
              fontFamily: "inherit",
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || count === 0}
            style={{
              padding: "6px 16px",
              fontSize: 13,
              fontWeight: 600,
              background: "#1a73e8",
              color: "#fff",
              border: "1px solid #1a73e8",
              borderRadius: 5,
              cursor: sending || count === 0 ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              opacity: sending || count === 0 ? 0.6 : 1,
            }}
          >
            {sending
              ? "Sending…"
              : count === 1
              ? "Send 1 email"
              : `Send ${count} emails`}
          </button>
        </div>
      </div>
    </div>
  );
}
