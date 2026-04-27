/**
 * StrengthsPanel — 1–3 things the player is doing well, surfaced
 * alongside Top Priorities on the Session Report. Uses the same
 * underlying player_coaching_themes table with kind='strength' so
 * the lifecycle (draft/active/archived) and AI-original snapshots
 * work identically to priorities.
 *
 * Smaller / lighter UI than priorities: no rank circle, green accent
 * instead of blue, inline "Promote to active" / "Archive" controls.
 */

import { useEffect, useState } from "react";
import {
  deletePriority,
  listStrengths,
  setPriorityStatus,
  updatePriority,
  type CoachingTheme,
  type PriorityChip,
} from "../../lib/coachApi";

interface Props {
  sessionId: string;
  playerId: string;
  /** Hide every coach control + only show active strengths. Used by
   *  the player-facing PDF / email render. */
  readOnly?: boolean;
}

export default function StrengthsPanel({ sessionId, playerId, readOnly = false }: Props) {
  const [strengths, setStrengths] = useState<CoachingTheme[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listStrengths(sessionId, playerId);
        if (!cancelled) setStrengths(rows);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, playerId]);

  // Read-only filters out drafts — only coach-approved strengths ship
  // to the player. Editor mode shows everything so the coach can review.
  const visible = readOnly
    ? (strengths ?? []).filter((s) => s.status === "active")
    : (strengths ?? []);

  if (visible.length === 0) return null;

  async function handleStatus(
    id: string,
    status: "active" | "archived" | "draft",
  ) {
    setStrengths((prev) =>
      (prev ?? []).map((s) => (s.id === id ? { ...s, status } : s)),
    );
    try {
      await setPriorityStatus(id, status);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function handleEdit(
    id: string,
    field: "title" | "problem" | "solution",
    value: string,
  ) {
    setStrengths((prev) =>
      (prev ?? []).map((s) =>
        s.id === id ? { ...s, [field]: value, edited: true } : s,
      ),
    );
    try {
      await updatePriority(id, { [field]: value });
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this strength?")) return;
    setStrengths((prev) => (prev ?? []).filter((s) => s.id !== id));
    try {
      await deletePriority(id);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <span>💪 What you're doing well</span>
        <span style={taglineStyle}>Lean into these — they're working.</span>
      </div>

      {err && (
        <div style={errorStyle}>{err}</div>
      )}

      <div>
        {visible.map((s) => (
          <StrengthRow
            key={s.id}
            strength={s}
            readOnly={readOnly}
            isEditing={editingId === s.id}
            onStartEdit={() => setEditingId(s.id)}
            onStopEdit={() => setEditingId(null)}
            onEdit={handleEdit}
            onPromote={() => handleStatus(s.id, "active")}
            onArchive={() => handleStatus(s.id, "archived")}
            onUndoPromote={() => handleStatus(s.id, "draft")}
            onDelete={() => handleDelete(s.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ────────────────────────────── Row ──────────────────────────────

function StrengthRow({
  strength: s,
  readOnly,
  isEditing,
  onStartEdit,
  onStopEdit,
  onEdit,
  onPromote,
  onArchive,
  onUndoPromote,
  onDelete,
}: {
  strength: CoachingTheme;
  readOnly: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onEdit: (id: string, field: "title" | "problem" | "solution", value: string) => void;
  onPromote: () => void;
  onArchive: () => void;
  onUndoPromote: () => void;
  onDelete: () => void;
}) {
  const isDraft = s.status === "draft";

  return (
    <div
      style={{
        padding: "12px 14px",
        borderTop: "1px solid #e6f4ea",
        opacity: isDraft && !readOnly ? 0.7 : 1,
      }}
    >
      {/* Title row */}
      {isEditing ? (
        <input
          defaultValue={s.title}
          autoFocus
          onBlur={(e) => {
            if (e.target.value !== s.title) onEdit(s.id, "title", e.target.value);
            onStopEdit();
          }}
          style={inputStyle}
        />
      ) : (
        <div style={titleStyle} onDoubleClick={readOnly ? undefined : onStartEdit}>
          <span style={{ color: "#1e7e34", marginRight: 6 }}>✓</span>
          {s.title}
          {!readOnly && (
            <StatusBadge status={s.status} />
          )}
        </div>
      )}

      {/* Body */}
      {isEditing ? (
        <textarea
          defaultValue={s.problem}
          rows={2}
          onBlur={(e) => {
            if (e.target.value !== s.problem) onEdit(s.id, "problem", e.target.value);
          }}
          style={textareaStyle}
        />
      ) : (
        <div style={bodyStyle}>{s.problem}</div>
      )}

      {/* Chips */}
      <ChipStrip chips={s.evidence_chips} />

      {/* Solution / "lean into it" */}
      {isEditing ? (
        <textarea
          defaultValue={s.solution}
          rows={2}
          onBlur={(e) => {
            if (e.target.value !== s.solution) onEdit(s.id, "solution", e.target.value);
            onStopEdit();
          }}
          style={{ ...textareaStyle, marginTop: 6 }}
        />
      ) : (
        <div style={leanIntoStyle}>
          <b style={{ color: "#1e7e34" }}>Keep going: </b>
          {s.solution}
        </div>
      )}

      {/* Coach-only controls */}
      {!readOnly && (
        <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
          {isDraft && (
            <button onClick={onPromote} style={promoteBtnStyle} title="Mark this strength as active so it shows up on the player's Working-on view">
              ✓ Promote to active
            </button>
          )}
          {!isDraft && (
            <button onClick={onUndoPromote} style={ghostBtnStyle} title="Demote back to draft">
              ↺ Demote
            </button>
          )}
          <button onClick={isEditing ? onStopEdit : onStartEdit} style={ghostBtnStyle}>
            {isEditing ? "✓ Done" : "✎ Edit"}
          </button>
          <button onClick={onArchive} style={ghostBtnStyle}>📦 Archive</button>
          <button onClick={onDelete} style={ghostBtnStyle}>🗑</button>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: CoachingTheme["status"] }) {
  const map: Record<CoachingTheme["status"], { label: string; bg: string; fg: string }> = {
    draft: { label: "DRAFT", bg: "#fff3cd", fg: "#92400e" },
    active: { label: "ACTIVE", bg: "#e6f4ea", fg: "#1e7e34" },
    archived: { label: "ARCHIVED", bg: "#f1f3f5", fg: "#6b7280" },
    mastered: { label: "MASTERED", bg: "#e7f1fa", fg: "#0b6ea8" },
  };
  const m = map[status];
  return (
    <span
      style={{
        marginLeft: 8,
        padding: "1px 7px",
        borderRadius: 3,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 0.4,
        background: m.bg,
        color: m.fg,
        verticalAlign: "middle",
      }}
    >
      {m.label}
    </span>
  );
}

function ChipStrip({ chips }: { chips: PriorityChip[] }) {
  if (!chips || chips.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
      {chips.map((c, i) => {
        const palette =
          c.kind === "stat-good"
            ? { bg: "#e6f4ea", fg: "#1e7e34", bd: "#c3e6cb" }
            : c.kind === "stat-bad"
            ? { bg: "#fdecea", fg: "#c62828", bd: "#f5c6cb" }
            : { bg: "#f1f3f5", fg: "#555", bd: "#e2e2e2" };
        return (
          <span
            key={i}
            title={c.key}
            style={{
              fontSize: 11,
              padding: "2px 8px",
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

// ─────────────────────────── Styles ───────────────────────────

const panelStyle: React.CSSProperties = {
  background: "linear-gradient(180deg, #f4faf6 0%, #fff 60%)",
  border: "1px solid #c8e6d4",
  borderRadius: 12,
  marginBottom: 16,
  overflow: "hidden",
};

const headerStyle: React.CSSProperties = {
  padding: "12px 16px 8px",
  fontSize: 16,
  fontWeight: 700,
  color: "#1a3d22",
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const taglineStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 400,
  color: "#666",
};

const titleStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: "#222",
  marginBottom: 6,
};

const bodyStyle: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.55,
  color: "#333",
  marginBottom: 6,
};

const leanIntoStyle: React.CSSProperties = {
  marginTop: 8,
  padding: "8px 10px",
  borderLeft: "3px solid #1e7e34",
  background: "#e6f4ea",
  borderRadius: 4,
  fontSize: 12,
  color: "#1a3d22",
  lineHeight: 1.5,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 15,
  fontWeight: 700,
  padding: "4px 6px",
  border: "1px solid #c8e6d4",
  borderRadius: 4,
  fontFamily: "inherit",
  marginBottom: 6,
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  fontSize: 13,
  padding: "6px 8px",
  border: "1px solid #c8e6d4",
  borderRadius: 4,
  fontFamily: "inherit",
  resize: "vertical",
};

const promoteBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  fontWeight: 600,
  background: "#1e7e34",
  color: "#fff",
  border: "1px solid #1e7e34",
  borderRadius: 6,
  cursor: "pointer",
  fontFamily: "inherit",
};

const ghostBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  fontWeight: 600,
  background: "#fff",
  color: "#555",
  border: "1px solid #e2e2e2",
  borderRadius: 6,
  cursor: "pointer",
  fontFamily: "inherit",
};

const errorStyle: React.CSSProperties = {
  margin: "8px 14px",
  padding: "8px 10px",
  background: "#fdecea",
  border: "1px solid #f5c6cb",
  borderRadius: 6,
  color: "#c62828",
  fontSize: 12,
};
