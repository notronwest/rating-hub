import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  listPlayerAssessmentHistory,
  type PlayerAssessmentHistoryRow,
} from "../lib/coachApi";
import { getTag, CATEGORY_LABELS } from "../lib/coachTags";

interface Props {
  playerId: string;
  orgId: string;
}

interface AggregatedTag {
  tag: string;
  label: string;
  category: string;
  count: number;
  lastSeen: string | null;
  rows: PlayerAssessmentHistoryRow[];
}

export default function CoachFeedback({ playerId, orgId }: Props) {
  const [rows, setRows] = useState<PlayerAssessmentHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    listPlayerAssessmentHistory(playerId)
      .then(setRows)
      .catch((e) => console.error("Failed to load coach feedback:", e))
      .finally(() => setLoading(false));
  }, [playerId]);

  if (loading) return null;
  if (rows.length === 0) return null;

  const strengths = aggregate(rows.filter((r) => r.kind === "strength"));
  const weaknesses = aggregate(rows.filter((r) => r.kind === "weakness"));

  return (
    <div
      style={{
        marginBottom: 28,
        padding: 20,
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 12,
      }}
    >
      <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4, marginTop: 0 }}>
        Coach Feedback
      </h3>
      <div style={{ fontSize: 12, color: "#999", marginBottom: 16 }}>
        Tagged observations across {new Set(rows.map((r) => r.game_id)).size} analyzed games
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <TagColumn
          title="Strengths"
          emoji="💪"
          color="#1e7e34"
          bgColor="#e6f4ea"
          tags={strengths}
          orgId={orgId}
          expandedKey={expandedKey}
          setExpandedKey={setExpandedKey}
          keyPrefix="s"
        />
        <TagColumn
          title="Areas to improve"
          emoji="🎯"
          color="#c62828"
          bgColor="#fce8e6"
          tags={weaknesses}
          orgId={orgId}
          expandedKey={expandedKey}
          setExpandedKey={setExpandedKey}
          keyPrefix="w"
        />
      </div>
    </div>
  );
}

function TagColumn({
  title,
  emoji,
  color,
  bgColor,
  tags,
  orgId,
  expandedKey,
  setExpandedKey,
  keyPrefix,
}: {
  title: string;
  emoji: string;
  color: string;
  bgColor: string;
  tags: AggregatedTag[];
  orgId: string;
  expandedKey: string | null;
  setExpandedKey: (k: string | null) => void;
  keyPrefix: string;
}) {
  if (tags.length === 0) {
    return (
      <div>
        <h4 style={{ fontSize: 13, fontWeight: 600, color, marginBottom: 8, marginTop: 0 }}>
          {emoji} {title}
        </h4>
        <div style={{ fontSize: 13, color: "#999" }}>None yet.</div>
      </div>
    );
  }

  return (
    <div>
      <h4 style={{ fontSize: 13, fontWeight: 600, color, marginBottom: 8, marginTop: 0 }}>
        {emoji} {title}
      </h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {tags.map((t) => {
          const key = `${keyPrefix}:${t.tag}`;
          const expanded = expandedKey === key;
          return (
            <div key={key}>
              <button
                onClick={() => setExpandedKey(expanded ? null : key)}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  width: "100%",
                  padding: "6px 10px",
                  fontSize: 13,
                  borderRadius: 6,
                  borderTop: "1px solid #e2e2e2",
                  borderBottom: "1px solid #e2e2e2",
                  borderLeft: `3px solid ${color}`,
                  borderRight: "1px solid #e2e2e2",
                  background: expanded ? bgColor : "#fff",
                  color: "#333",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span>
                  <span style={{ fontWeight: 500 }}>{t.label}</span>
                  <span style={{ fontSize: 11, color: "#888", marginLeft: 8 }}>
                    {CATEGORY_LABELS[t.category] ?? t.category}
                  </span>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "#666" }}>
                    {t.count} {t.count === 1 ? "game" : "games"}
                  </span>
                  {t.lastSeen && (
                    <span style={{ fontSize: 10, color: "#999" }}>
                      · last {new Date(t.lastSeen).toLocaleDateString()}
                    </span>
                  )}
                  <span style={{ color: "#bbb", fontSize: 10 }}>{expanded ? "▲" : "▼"}</span>
                </span>
              </button>
              {expanded && (
                <div
                  style={{
                    marginTop: 4,
                    padding: "6px 10px 6px 16px",
                    fontSize: 12,
                    color: "#555",
                  }}
                >
                  {t.rows.map((r) => (
                    <div
                      key={r.id}
                      style={{ padding: "3px 0", display: "flex", gap: 8, alignItems: "baseline" }}
                    >
                      <Link
                        to={`/org/${orgId}/games/${r.game_id}`}
                        style={{ fontSize: 11, color: "#1a73e8", textDecoration: "none", whiteSpace: "nowrap" }}
                      >
                        {r.played_at
                          ? new Date(r.played_at).toLocaleDateString()
                          : "?"}
                      </Link>
                      {r.note && <span style={{ color: "#333" }}>— {r.note}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function aggregate(rows: PlayerAssessmentHistoryRow[]): AggregatedTag[] {
  const map = new Map<string, AggregatedTag>();
  for (const r of rows) {
    const tag = getTag(r.tag);
    const key = r.tag;
    if (!map.has(key)) {
      map.set(key, {
        tag: r.tag,
        label: tag?.label ?? r.tag,
        category: tag?.category ?? "general",
        count: 0,
        lastSeen: null,
        rows: [],
      });
    }
    const entry = map.get(key)!;
    entry.count += 1;
    entry.rows.push(r);
    if (r.played_at && (!entry.lastSeen || r.played_at > entry.lastSeen)) {
      entry.lastSeen = r.played_at;
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
