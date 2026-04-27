/**
 * PrioritiesPanel — the hero "Top priorities to work on" block on the
 * Session Report. Lives above the older Common Themes panel and the
 * KPI strip.
 *
 * Coach-only mechanics (hidden in PDF / player-facing email):
 *   • ↻ Refresh suggestions — calls generate-priorities; pinned and
 *     coach-edited rows survive at their current ranks.
 *   • + Add — manual insert (TODO: opens a small editor; v1 inserts a
 *     blank row the coach can fill in).
 *   • Per-row ↑ / ↓ — bumps priority_rank.
 *   • Per-row ✎ — inline edit title/problem/solution; auto-saves on
 *     blur, flips edited=true so the row is protected.
 *   • Per-row 📌 — toggles the pinned flag.
 *   • Per-row 🗑 — delete.
 *
 * Player-facing render (≥ N_VISIBLE) shows the top 4 ranked priorities
 * with title, evidence chips, problem narrative, and a green "Drill"
 * solution block. Ranks 5–10 sit behind a "Show 6 more suggestions"
 * expander so the coach can promote any of them into the visible set.
 */

import { useEffect, useMemo, useState } from "react";
import {
  deletePriority,
  generatePriorities,
  listPriorities,
  reorderPriorities,
  setPriorityPinned,
  updatePriority,
  type CoachingTheme,
  type PriorityChip,
} from "../../lib/coachApi";

const N_VISIBLE = 4;

interface Props {
  sessionId: string;
  playerId: string;
  /** When true, hides every coach-only control + the expander; the
   *  panel renders as a clean read-only list. Used by the PDF / email
   *  render. */
  readOnly?: boolean;
}

export default function PrioritiesPanel({ sessionId, playerId, readOnly = false }: Props) {
  const [priorities, setPriorities] = useState<CoachingTheme[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await listPriorities(sessionId, playerId);
        if (!cancelled) setPriorities(rows);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, playerId]);

  // Sort by priority_rank ascending so 1 is at the top.
  const sorted = useMemo(() => {
    return [...(priorities ?? [])].sort(
      (a, b) => (a.priority_rank ?? 99) - (b.priority_rank ?? 99),
    );
  }, [priorities]);

  const visible = sorted.slice(0, N_VISIBLE);
  const drafts = sorted.slice(N_VISIBLE);

  async function handleRefresh() {
    setGenerating(true);
    setErr(null);
    try {
      const rows = await generatePriorities({ sessionId, playerId });
      setPriorities(rows);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleEdit(
    id: string,
    field: "title" | "problem" | "solution",
    value: string,
  ) {
    // Optimistic update so the textarea/input feels instant; on error
    // we revert by re-listing.
    setPriorities((prev) =>
      (prev ?? []).map((p) =>
        p.id === id ? { ...p, [field]: value, edited: true, source: "coach" } : p,
      ),
    );
    try {
      await updatePriority(id, { [field]: value });
    } catch (e) {
      setErr((e as Error).message);
      // Reload on failure to recover.
      const rows = await listPriorities(sessionId, playerId);
      setPriorities(rows);
    }
  }

  async function handlePin(id: string, currentlyPinned: boolean) {
    setPriorities((prev) =>
      (prev ?? []).map((p) => (p.id === id ? { ...p, pinned: !currentlyPinned } : p)),
    );
    try {
      await setPriorityPinned(id, !currentlyPinned);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this priority?")) return;
    setPriorities((prev) => (prev ?? []).filter((p) => p.id !== id));
    try {
      await deletePriority(id);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  /** Move a priority up or down by swapping ranks with its neighbor. */
  async function handleMove(id: string, direction: "up" | "down") {
    const list = sorted;
    const idx = list.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const swapIdx = direction === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= list.length) return;
    const a = list[idx];
    const b = list[swapIdx];
    if (a.priority_rank == null || b.priority_rank == null) return;
    const aNew = b.priority_rank;
    const bNew = a.priority_rank;
    setPriorities((prev) =>
      (prev ?? []).map((p) =>
        p.id === a.id
          ? { ...p, priority_rank: aNew }
          : p.id === b.id
          ? { ...p, priority_rank: bNew }
          : p,
      ),
    );
    try {
      await reorderPriorities([
        { id: a.id, priority_rank: aNew },
        { id: b.id, priority_rank: bNew },
      ]);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  /** Promote a draft (rank 5+) into the visible top-N by giving it the
   *  rank of the lowest-visible priority and demoting that priority
   *  down to where the draft was. Coach can fine-tune with ↑/↓ after. */
  async function handlePromote(id: string) {
    if (visible.length === 0) return;
    const draft = sorted.find((p) => p.id === id);
    const last = visible[visible.length - 1];
    if (!draft || !last || draft.priority_rank == null || last.priority_rank == null) return;
    const draftNew = last.priority_rank;
    const lastNew = draft.priority_rank;
    setPriorities((prev) =>
      (prev ?? []).map((p) =>
        p.id === draft.id
          ? { ...p, priority_rank: draftNew }
          : p.id === last.id
          ? { ...p, priority_rank: lastNew }
          : p,
      ),
    );
    try {
      await reorderPriorities([
        { id: draft.id, priority_rank: draftNew },
        { id: last.id, priority_rank: lastNew },
      ]);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (loading) {
    return (
      <div style={panelStyle}>
        <div style={panelHeaderStyle}>🎯 Top priorities to work on</div>
        <div style={{ padding: 14, color: "#888", fontSize: 13 }}>Loading…</div>
      </div>
    );
  }

  if (sorted.length === 0) {
    return (
      <div style={panelStyle}>
        <div style={panelHeaderStyle}>🎯 Top priorities to work on</div>
        <div style={{ padding: 18, fontSize: 13, color: "#555", lineHeight: 1.6 }}>
          No priorities generated yet for this player's session.
          {!readOnly && (
            <>
              {" "}
              <button
                onClick={handleRefresh}
                disabled={generating}
                style={primaryBtnStyle}
              >
                {generating ? "Generating…" : "Generate suggestions"}
              </button>
            </>
          )}
        </div>
        {err && <ErrorBar msg={err} />}
      </div>
    );
  }

  return (
    <div style={panelStyle}>
      <div style={panelHeaderStyle}>
        <span>🎯 Top priorities to work on</span>
        <span style={taglineStyle}>
          In order — most impactful first. Drilled and prescribed by your coach.
        </span>
        {!readOnly && (
          <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
            <button
              onClick={handleRefresh}
              disabled={generating}
              style={primaryBtnStyle}
              title="Regenerate AI drafts; pinned + edited priorities survive"
            >
              {generating ? "Refreshing…" : "↻ Refresh suggestions"}
            </button>
          </span>
        )}
      </div>

      {err && <ErrorBar msg={err} />}

      <div style={{ padding: "0 4px" }}>
        {visible.map((p) => (
          <PriorityRow
            key={p.id}
            priority={p}
            readOnly={readOnly}
            isEditing={editingId === p.id}
            onStartEdit={() => setEditingId(p.id)}
            onStopEdit={() => setEditingId(null)}
            onEdit={handleEdit}
            onPin={() => handlePin(p.id, p.pinned)}
            onMoveUp={() => handleMove(p.id, "up")}
            onMoveDown={() => handleMove(p.id, "down")}
            onDelete={() => handleDelete(p.id)}
          />
        ))}
      </div>

      {!readOnly && drafts.length > 0 && (
        <div style={{ padding: "8px 14px 14px" }}>
          <button
            onClick={() => setExpanded((v) => !v)}
            style={ghostBtnStyle}
          >
            {expanded
              ? `▾ Hide ${drafts.length} more`
              : `▸ Show ${drafts.length} more suggestion${drafts.length === 1 ? "" : "s"}`}
          </button>
          {expanded && (
            <div style={{ marginTop: 10, opacity: 0.85 }}>
              {drafts.map((p) => (
                <DraftRow
                  key={p.id}
                  priority={p}
                  isEditing={editingId === p.id}
                  onStartEdit={() => setEditingId(p.id)}
                  onStopEdit={() => setEditingId(null)}
                  onEdit={handleEdit}
                  onPromote={() => handlePromote(p.id)}
                  onPin={() => handlePin(p.id, p.pinned)}
                  onDelete={() => handleDelete(p.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Visible priority row ─────────────────────────

interface RowProps {
  priority: CoachingTheme;
  readOnly: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onEdit: (id: string, field: "title" | "problem" | "solution", value: string) => void;
  onPin: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

function PriorityRow({
  priority: p,
  readOnly,
  isEditing,
  onStartEdit,
  onStopEdit,
  onEdit,
  onPin,
  onMoveUp,
  onMoveDown,
  onDelete,
}: RowProps) {
  const tier = inferTier(p);
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: readOnly ? "56px 1fr" : "56px 1fr auto",
        gap: 14,
        alignItems: "start",
        padding: "14px 10px",
        borderTop: "1px solid #f1f3f5",
      }}
    >
      <div style={rankStyle(p.priority_rank ?? 99)}>{p.priority_rank ?? "?"}</div>

      <div style={{ minWidth: 0 }}>
        {isEditing ? (
          <input
            defaultValue={p.title}
            onBlur={(e) => {
              if (e.target.value !== p.title) onEdit(p.id, "title", e.target.value);
              onStopEdit();
            }}
            autoFocus
            style={inputStyle}
          />
        ) : (
          <div style={titleStyle} onDoubleClick={readOnly ? undefined : onStartEdit}>
            {p.title}
            {p.pinned && <span title="Pinned" style={badgeStyle("#1a73e8")}>📌</span>}
            {p.edited && <span title="Coach-edited" style={badgeStyle("#1e7e34")}>✎</span>}
          </div>
        )}

        <div style={metaRowStyle}>
          <TierPill tier={tier} />
        </div>

        {isEditing ? (
          <textarea
            defaultValue={p.problem}
            rows={3}
            onBlur={(e) => {
              if (e.target.value !== p.problem) onEdit(p.id, "problem", e.target.value);
            }}
            style={textareaStyle}
          />
        ) : (
          <div style={problemStyle}>{p.problem}</div>
        )}

        <ChipStrip chips={p.evidence_chips} />

        {isEditing ? (
          <textarea
            defaultValue={p.solution}
            rows={3}
            onBlur={(e) => {
              if (e.target.value !== p.solution) onEdit(p.id, "solution", e.target.value);
              onStopEdit();
            }}
            style={{ ...textareaStyle, marginTop: 10, background: "#e6f4ea" }}
          />
        ) : (
          <div style={solutionStyle}>
            <b style={{ color: "#1e7e34" }}>Drill: </b>
            {p.solution}
          </div>
        )}
      </div>

      {!readOnly && (
        <div style={controlsStyle}>
          <IconBtn title="Move up" onClick={onMoveUp}>↑</IconBtn>
          <IconBtn title="Move down" onClick={onMoveDown}>↓</IconBtn>
          <IconBtn title="Edit" onClick={isEditing ? onStopEdit : onStartEdit}>
            {isEditing ? "✓" : "✎"}
          </IconBtn>
          <IconBtn
            title={p.pinned ? "Unpin (will be replaced on regenerate)" : "Pin (won't be replaced on regenerate)"}
            onClick={onPin}
            active={p.pinned}
          >
            📌
          </IconBtn>
          <IconBtn title="Delete" onClick={onDelete}>🗑</IconBtn>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Draft (5–10) row ─────────────────────────

function DraftRow({
  priority: p,
  isEditing,
  onStartEdit,
  onStopEdit,
  onEdit,
  onPromote,
  onPin,
  onDelete,
}: {
  priority: CoachingTheme;
  isEditing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onEdit: (id: string, field: "title" | "problem" | "solution", value: string) => void;
  onPromote: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "44px 1fr auto",
        gap: 12,
        alignItems: "start",
        padding: "10px",
        borderTop: "1px dashed #ddd",
      }}
    >
      <div
        style={{
          ...rankStyle(p.priority_rank ?? 99),
          width: 32,
          height: 32,
          fontSize: 14,
          background: "#bcd",
        }}
      >
        {p.priority_rank ?? "?"}
      </div>
      <div style={{ minWidth: 0 }}>
        {isEditing ? (
          <input
            defaultValue={p.title}
            onBlur={(e) => {
              if (e.target.value !== p.title) onEdit(p.id, "title", e.target.value);
              onStopEdit();
            }}
            autoFocus
            style={inputStyle}
          />
        ) : (
          <div style={{ fontSize: 14, fontWeight: 600, color: "#444" }}>
            {p.title}
            {p.pinned && <span title="Pinned" style={badgeStyle("#1a73e8")}>📌</span>}
          </div>
        )}
        <div style={{ ...problemStyle, fontSize: 12, color: "#666" }}>{p.problem}</div>
        <ChipStrip chips={p.evidence_chips} compact />
      </div>
      <div style={controlsStyle}>
        <IconBtn title="Promote into the visible top list" onClick={onPromote}>↑↑</IconBtn>
        <IconBtn title="Edit" onClick={onStartEdit}>✎</IconBtn>
        <IconBtn title="Pin" onClick={onPin} active={p.pinned}>📌</IconBtn>
        <IconBtn title="Delete" onClick={onDelete}>🗑</IconBtn>
      </div>
    </div>
  );
}

// ───────────────────────── Bits ─────────────────────────

function ChipStrip({ chips, compact }: { chips: PriorityChip[]; compact?: boolean }) {
  if (!chips || chips.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      {chips.map((c, i) => {
        const palette =
          c.kind === "stat-bad"
            ? { bg: "#fdecea", fg: "#c62828", bd: "#f5c6cb" }
            : c.kind === "stat-good"
            ? { bg: "#e6f4ea", fg: "#1e7e34", bd: "#c3e6cb" }
            : { bg: "#f1f3f5", fg: "#555", bd: "#e2e2e2" };
        return (
          <span
            key={i}
            title={c.key}
            style={{
              fontSize: compact ? 10 : 11,
              padding: compact ? "1px 6px" : "3px 8px",
              borderRadius: 12,
              background: palette.bg,
              color: palette.fg,
              border: `1px solid ${palette.bd}`,
            }}
          >
            {c.label}
          </span>
        );
      })}
    </div>
  );
}

function TierPill({ tier }: { tier: ReturnType<typeof inferTier> }) {
  const map: Record<typeof tier, { label: string; bg: string; fg: string }> = {
    needs_work: { label: "Needs work", bg: "#fdecea", fg: "#c62828" },
    ok: { label: "OK", bg: "#fff3cd", fg: "#d97706" },
    good: { label: "Good", bg: "#e6f4ea", fg: "#1e7e34" },
    great: { label: "Great", bg: "#e7f1fa", fg: "#0b6ea8" },
  };
  const m = map[tier];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 3,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        background: m.bg,
        color: m.fg,
      }}
    >
      {m.label}
    </span>
  );
}

/** Best-effort tier readout from the priority's chips. The edge function
 *  already classified server-side and stored the result; we just look for
 *  a hint in the lead chip's label (e.g. "Serve deep · 52%") and map by
 *  classifyPct's bands. Falls back to needs_work. */
function inferTier(p: CoachingTheme): "needs_work" | "ok" | "good" | "great" {
  const lead = p.evidence_chips?.find((c) => c.kind === "stat-bad") ?? p.evidence_chips?.[0];
  if (!lead) return "needs_work";
  const m = lead.label.match(/(\d{1,3})%/);
  if (!m) return "needs_work";
  const v = parseInt(m[1], 10);
  if (v < 60) return "needs_work";
  if (v <= 70) return "ok";
  if (v <= 89) return "good";
  return "great";
}

function ErrorBar({ msg }: { msg: string }) {
  return (
    <div
      style={{
        margin: "8px 14px",
        padding: "8px 10px",
        background: "#fdecea",
        border: "1px solid #f5c6cb",
        borderRadius: 6,
        color: "#c62828",
        fontSize: 12,
      }}
    >
      {msg}
    </div>
  );
}

function IconBtn({
  children,
  title,
  onClick,
  active,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 28,
        height: 28,
        border: `1px solid ${active ? "#1a73e8" : "#e2e2e2"}`,
        background: active ? "#eef3ff" : "#fff",
        borderRadius: 6,
        cursor: "pointer",
        color: active ? "#1a73e8" : "#666",
        fontSize: 12,
        lineHeight: 1,
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

// ───────────────────────── Styles ─────────────────────────

const panelStyle: React.CSSProperties = {
  background: "linear-gradient(180deg, #f7faff 0%, #fff 60%)",
  border: "1px solid #dce6fa",
  borderRadius: 14,
  marginBottom: 16,
  overflow: "hidden",
};

const panelHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  padding: "16px 18px 8px",
  fontSize: 18,
  fontWeight: 700,
  color: "#1a3d22",
};

const taglineStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 400,
  color: "#666",
};

function rankStyle(rank: number): React.CSSProperties {
  // Subtle opacity decay so #1 reads as the loudest.
  const opacity = 1 - (rank - 1) * 0.08;
  return {
    display: "grid",
    placeItems: "center",
    width: 44,
    height: 44,
    borderRadius: "50%",
    background: "#1a73e8",
    color: "#fff",
    fontSize: 18,
    fontWeight: 700,
    opacity: Math.max(0.6, opacity),
  };
}

const titleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  color: "#222",
  marginBottom: 4,
  cursor: "text",
};

const metaRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
  marginBottom: 8,
};

const problemStyle: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.55,
  color: "#333",
  marginBottom: 6,
};

const solutionStyle: React.CSSProperties = {
  marginTop: 10,
  padding: "10px 12px",
  borderLeft: "3px solid #1e7e34",
  background: "#e6f4ea",
  borderRadius: 4,
  fontSize: 13,
  color: "#1a3d22",
  lineHeight: 1.5,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 16,
  fontWeight: 700,
  padding: "4px 6px",
  border: "1px solid #c6dafc",
  borderRadius: 4,
  fontFamily: "inherit",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 13,
  padding: "6px 8px",
  border: "1px solid #c6dafc",
  borderRadius: 4,
  fontFamily: "inherit",
  resize: "vertical",
};

const controlsStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  alignItems: "flex-end",
};

const primaryBtnStyle: React.CSSProperties = {
  padding: "5px 11px",
  fontSize: 12,
  fontWeight: 600,
  background: "#1a73e8",
  color: "#fff",
  border: "1px solid #1a73e8",
  borderRadius: 6,
  cursor: "pointer",
  fontFamily: "inherit",
};

const ghostBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 12,
  fontWeight: 600,
  background: "#fff",
  color: "#555",
  border: "1px solid #e2e2e2",
  borderRadius: 6,
  cursor: "pointer",
  fontFamily: "inherit",
};

function badgeStyle(color: string): React.CSSProperties {
  return {
    marginLeft: 6,
    fontSize: 11,
    color,
    verticalAlign: "middle",
  };
}
