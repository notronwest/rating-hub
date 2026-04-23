/**
 * CommonThemesPanel — AI-generated + coach-editable "common themes" for a
 * player across all games in a session.
 *
 * Flow:
 *   1. Coach opens the session report. If themes exist already, they
 *      render with inline edit affordances and a "Regenerate" button.
 *   2. If no themes exist yet, a prompt card offers to generate N (coach
 *      picks the count).
 *   3. Clicking Generate hits the `generate-themes` edge function, which
 *      runs Claude over the player's games and persists the results.
 *      Regenerating replaces unedited AI rows; coach-edited rows are
 *      preserved (the edge function skips them on delete).
 *   4. Any coach edit flips the row's `source` to `coach` and `edited` to
 *      `true`, so their changes stick across regenerates.
 *
 * Each theme renders as a card with editable title / "Here's the problem"
 * / "Here's the solution" fields and a remove button.
 */

import { useEffect, useState } from "react";
import {
  deleteCoachingTheme,
  generateCoachingThemes,
  listCoachingThemes,
  updateCoachingTheme,
  type CoachingTheme,
} from "../../lib/coachApi";

interface Props {
  sessionId: string;
  playerId: string;
}

export default function CommonThemesPanel({ sessionId, playerId }: Props) {
  const [themes, setThemes] = useState<CoachingTheme[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [n, setN] = useState(5);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await listCoachingThemes(sessionId, playerId);
        if (!cancelled) setThemes(rows);
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

  async function handleGenerate() {
    setGenerating(true);
    setErr(null);
    try {
      const rows = await generateCoachingThemes({ sessionId, playerId, n });
      // Merge with any coach-edited rows that the edge function preserved
      // — easiest way is to re-list.
      const fresh = await listCoachingThemes(sessionId, playerId);
      setThemes(fresh.length > 0 ? fresh : rows);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleFieldChange(
    id: string,
    field: "title" | "problem" | "solution",
    value: string,
  ) {
    setThemes((prev) =>
      prev
        ? prev.map((t) =>
            t.id === id ? { ...t, [field]: value, source: "coach", edited: true } : t,
          )
        : prev,
    );
  }

  async function handleFieldBlur(id: string, patch: Partial<CoachingTheme>) {
    try {
      await updateCoachingTheme(id, patch);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function handleDelete(id: string) {
    setThemes((prev) => (prev ? prev.filter((t) => t.id !== id) : prev));
    try {
      await deleteCoachingTheme(id);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  if (loading) {
    return <div style={{ color: "#888", fontSize: 13 }}>Loading themes…</div>;
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {err && (
        <div
          style={{
            padding: "8px 12px",
            border: "1px solid #f5c6cb",
            background: "#f8d7da",
            color: "#721c24",
            borderRadius: 6,
            fontSize: 12,
          }}
        >
          {err}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 12px",
          background: "#f7f9ff",
          border: "1px solid #dce6fa",
          borderRadius: 8,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 13, color: "#333" }}>
          <b>AI pass · </b>
          {themes && themes.length > 0
            ? "regenerate to refresh, or tweak any theme in place — coach edits stick."
            : "run the model over every game in this session to surface recurring patterns."}
        </div>
        <span style={{ flex: 1 }} />
        <label
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "#444",
          }}
        >
          <span>Themes:</span>
          <input
            type="number"
            min={1}
            max={10}
            value={n}
            onChange={(e) => setN(Math.max(1, Math.min(10, parseInt(e.target.value || "5"))))}
            style={{
              width: 52,
              padding: "4px 6px",
              fontSize: 13,
              border: "1px solid #ccc",
              borderRadius: 4,
              fontFamily: "inherit",
            }}
          />
        </label>
        <button
          onClick={handleGenerate}
          disabled={generating}
          style={{
            padding: "6px 14px",
            fontSize: 12,
            fontWeight: 700,
            color: "#fff",
            background: generating ? "#5c8ff0" : "#1a73e8",
            border: "1px solid #1a73e8",
            borderRadius: 6,
            cursor: generating ? "wait" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {generating
            ? "Generating…"
            : themes && themes.length > 0
            ? "🔄 Regenerate"
            : "✨ Generate"}
        </button>
      </div>

      {(!themes || themes.length === 0) && !generating && (
        <div
          style={{
            color: "#888",
            fontSize: 13,
            fontStyle: "italic",
            padding: "16px 4px",
          }}
        >
          No themes yet. Click Generate — the AI will scan the coach's notes,
          FPTM diagnoses, flags, and sequences across all games and return
          the top {n} patterns.
        </div>
      )}

      {themes &&
        themes.map((t, i) => (
          <ThemeCard
            key={t.id}
            theme={t}
            index={i}
            onFieldChange={handleFieldChange}
            onFieldBlur={handleFieldBlur}
            onDelete={() => handleDelete(t.id)}
          />
        ))}
    </div>
  );
}

// ─────────────────────────── Theme card ───────────────────────────

function ThemeCard({
  theme,
  index,
  onFieldChange,
  onFieldBlur,
  onDelete,
}: {
  theme: CoachingTheme;
  index: number;
  onFieldChange: (id: string, field: "title" | "problem" | "solution", value: string) => void;
  onFieldBlur: (id: string, patch: Partial<CoachingTheme>) => void;
  onDelete: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid #e2e2e2",
        borderLeft: `4px solid ${theme.edited ? "#7c3aed" : "#1a73e8"}`,
        borderRadius: 8,
        padding: "12px 14px",
        background: "#fff",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            display: "inline-grid",
            placeItems: "center",
            width: 22,
            height: 22,
            borderRadius: "50%",
            background: "#eef3ff",
            color: "#1a73e8",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {index + 1}
        </span>
        <input
          value={theme.title}
          onChange={(e) => onFieldChange(theme.id, "title", e.target.value)}
          onBlur={(e) => onFieldBlur(theme.id, { title: e.target.value })}
          placeholder="Theme title"
          style={{
            flex: 1,
            padding: "6px 8px",
            fontSize: 15,
            fontWeight: 700,
            color: "#222",
            border: "1px solid transparent",
            borderRadius: 4,
            background: "transparent",
            fontFamily: "inherit",
          }}
          onFocus={(e) => (e.currentTarget.style.border = "1px solid #dce6fa")}
          onBlurCapture={(e) => (e.currentTarget.style.border = "1px solid transparent")}
        />
        {theme.edited && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#7c3aed",
              textTransform: "uppercase",
              letterSpacing: 0.4,
            }}
            title="You've edited this theme — the AI won't overwrite it on regenerate."
          >
            Edited
          </span>
        )}
        <button
          onClick={onDelete}
          title="Remove this theme"
          style={{
            padding: "4px 10px",
            fontSize: 11,
            color: "#c62828",
            background: "#fff",
            border: "1px solid #f0b5b5",
            borderRadius: 4,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
        >
          Remove
        </button>
      </div>

      <FieldBlock
        label="Here's the problem"
        accent="#c62828"
        value={theme.problem}
        onChange={(v) => onFieldChange(theme.id, "problem", v)}
        onBlur={(v) => onFieldBlur(theme.id, { problem: v })}
      />
      <FieldBlock
        label="Here's the solution"
        accent="#1e7e34"
        value={theme.solution}
        onChange={(v) => onFieldChange(theme.id, "solution", v)}
        onBlur={(v) => onFieldBlur(theme.id, { solution: v })}
      />
    </div>
  );
}

function FieldBlock({
  label,
  accent,
  value,
  onChange,
  onBlur,
}: {
  label: string;
  accent: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: (v: string) => void;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: accent,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onBlur(e.target.value)}
        rows={2}
        style={{
          width: "100%",
          padding: "6px 8px",
          fontSize: 13,
          lineHeight: 1.5,
          color: "#333",
          border: "1px solid #e2e2e2",
          borderRadius: 4,
          outline: "none",
          resize: "vertical",
          fontFamily: "inherit",
          boxSizing: "border-box",
          background: "#fff",
          whiteSpace: "pre-wrap",
        }}
      />
    </div>
  );
}
