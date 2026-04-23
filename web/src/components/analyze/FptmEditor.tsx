/**
 * FptmEditor — coach-facing diagnosis panel driven by the FPTM framework
 * (Footwork, Paddle, Tactics, Mindset). Each pillar is a checkbox; clicking
 * the chevron expands to reveal the five specific sub-items plus an optional
 * per-pillar note. A shared "Drills" textarea at the bottom captures drills
 * to address the flagged issues.
 */

import { useState } from "react";
import {
  FPTM_PILLARS,
  type FptmPillarDef,
  type FptmPillarId,
  type FptmPillarState,
  type FptmTone,
  type FptmValue,
} from "../../lib/fptm";

const TONE_COLORS: Record<FptmTone, string> = {
  strength: "#1e7e34",
  weakness: "#c62828",
};

function ToneChip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "2px 8px",
        fontSize: 10,
        fontWeight: 700,
        color: active ? "#fff" : color,
        background: active ? color : "#fff",
        border: "none",
        cursor: "pointer",
        fontFamily: "inherit",
        letterSpacing: 0.3,
      }}
    >
      {children}
    </button>
  );
}

interface Props {
  fptm: FptmValue | null;
  drills: string | null;
  onChange: (next: { fptm: FptmValue; drills: string | null }) => void;
  /** Hide the drills field (for small contexts). */
  hideDrills?: boolean;
  /** Header label above the pillars. Defaults to "Coaching diagnosis (FPTM)". */
  heading?: string | null;
}

export default function FptmEditor({
  fptm,
  drills,
  onChange,
  hideDrills,
  heading = "Coaching diagnosis (FPTM)",
}: Props) {
  const value: FptmValue = fptm ?? {};
  // Which pillars have their sub-items expanded locally. Not persisted — purely UI.
  const [open, setOpen] = useState<Set<FptmPillarId>>(new Set());

  function patchPillar(id: FptmPillarId, next: Partial<FptmPillarState>) {
    const prev = value[id] ?? { on: false, items: [] as string[] };
    const merged: FptmPillarState = { ...prev, ...next };
    const nextValue: FptmValue = { ...value, [id]: merged };
    // Strip pillars that are entirely empty to keep the payload tidy
    if (!merged.on && merged.items.length === 0 && !merged.note) {
      delete nextValue[id];
    }
    onChange({ fptm: nextValue, drills });
  }

  function togglePillarOn(id: FptmPillarId) {
    const st = value[id] ?? { on: false, items: [] };
    // Turning on defaults to "weakness" framing (coach usually notes things to
    // work on); they can flip it to "strength" via the tone toggle.
    const nextOn = !st.on;
    patchPillar(id, {
      on: nextOn,
      tone: nextOn ? st.tone ?? "weakness" : st.tone,
    });
    // Auto-expand when turning on, auto-collapse when turning off (unless notes exist)
    setOpen((prev) => {
      const next = new Set(prev);
      if (!st.on) next.add(id);
      else if (!(st.items.length > 0 || st.note)) next.delete(id);
      return next;
    });
  }

  function setTone(id: FptmPillarId, tone: FptmTone) {
    // Setting a tone implicitly turns the pillar on
    patchPillar(id, { tone, on: true });
  }

  function toggleItem(id: FptmPillarId, itemId: string) {
    const st = value[id] ?? { on: false, items: [] };
    const items = st.items.includes(itemId)
      ? st.items.filter((i) => i !== itemId)
      : [...st.items, itemId];
    // Turn pillar on if any items are selected; default tone to weakness
    patchPillar(id, {
      items,
      on: st.on || items.length > 0,
      tone: st.tone ?? (items.length > 0 ? "weakness" : undefined),
    });
  }

  function toggleExpanded(id: FptmPillarId) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      {heading !== null && (
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#666",
            textTransform: "uppercase",
            letterSpacing: 0.5,
            marginBottom: 8,
          }}
        >
          {heading}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {FPTM_PILLARS.map((pillar) => (
          <PillarRow
            key={pillar.id}
            pillar={pillar}
            state={value[pillar.id]}
            expanded={open.has(pillar.id)}
            onToggleOn={() => togglePillarOn(pillar.id)}
            onToggleItem={(itemId) => toggleItem(pillar.id, itemId)}
            onToggleExpanded={() => toggleExpanded(pillar.id)}
            onNoteChange={(note) => patchPillar(pillar.id, { note })}
            onProblemChange={(problem) => patchPillar(pillar.id, { problem })}
            onResolutionChange={(resolution) =>
              patchPillar(pillar.id, { resolution })
            }
            onSetTone={(tone) => setTone(pillar.id, tone)}
          />
        ))}
      </div>

      {!hideDrills && (
        <div style={{ marginTop: 12 }}>
          <label
            style={{
              display: "block",
              fontSize: 11,
              fontWeight: 700,
              color: "#1e7e34",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 4,
            }}
          >
            Drills to resolve
          </label>
          <textarea
            value={drills ?? ""}
            onChange={(e) =>
              onChange({ fptm: value, drills: e.target.value || null })
            }
            rows={3}
            placeholder="Drills, reps, or cues to address the FPTM issues above…"
            style={{
              width: "100%",
              padding: "8px 10px",
              fontSize: 13,
              borderTop: "1px solid #ddd",
              borderBottom: "1px solid #ddd",
              borderLeft: "1px solid #ddd",
              borderRight: "1px solid #ddd",
              borderRadius: 6,
              outline: "none",
              resize: "vertical",
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
        </div>
      )}
    </div>
  );
}

function PillarRow({
  pillar,
  state,
  expanded,
  onToggleOn,
  onToggleItem,
  onToggleExpanded,
  onNoteChange,
  onProblemChange,
  onResolutionChange,
  onSetTone,
}: {
  pillar: FptmPillarDef;
  state: FptmPillarState | undefined;
  expanded: boolean;
  onToggleOn: () => void;
  onToggleItem: (itemId: string) => void;
  onToggleExpanded: () => void;
  onNoteChange: (note: string) => void;
  onProblemChange: (problem: string) => void;
  onResolutionChange: (resolution: string) => void;
  onSetTone: (tone: FptmTone) => void;
}) {
  const on = state?.on ?? false;
  const tone: FptmTone = state?.tone ?? "weakness";
  const selectedItems = state?.items ?? [];
  const note = state?.note ?? "";
  const problem = state?.problem ?? "";
  const resolution = state?.resolution ?? "";
  const hasDetail =
    selectedItems.length > 0 || !!note || !!problem || !!resolution;
  // Active tone colors the border / accent; pillar.color is the brand color
  const accent = on ? TONE_COLORS[tone] : pillar.color;

  return (
    <div
      style={{
        border: `1px solid ${on ? accent : "#e2e2e2"}`,
        borderLeft: `3px solid ${pillar.color}`,
        borderRadius: 6,
        background: on ? `${accent}08` : "#fff",
        overflow: "hidden",
      }}
    >
      {/* Header row: checkbox + pillar label + expand chevron */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: 1,
            cursor: "pointer",
            minWidth: 0,
          }}
        >
          <input
            type="checkbox"
            checked={on}
            onChange={onToggleOn}
            style={{ accentColor: pillar.color, flexShrink: 0 }}
          />
          <span
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: pillar.color,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {pillar.letter}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: on ? accent : "#333",
              }}
            >
              {pillar.label}
              {on && (
                <span style={{ fontWeight: 500, color: accent, marginLeft: 4 }}>
                  {tone === "strength" ? "— strength" : "— needs work"}
                </span>
              )}
            </div>
            {!expanded && !hasDetail && (
              <div
                style={{
                  fontSize: 10,
                  color: "#888",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {pillar.summary}
              </div>
            )}
            {!expanded && hasDetail && (
              <div
                style={{
                  fontSize: 10,
                  color: accent,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {selectedItems.length > 0
                  ? `${selectedItems.length} item${selectedItems.length !== 1 ? "s" : ""}`
                  : "note"}
                {selectedItems
                  .slice(0, 2)
                  .map(
                    (id) =>
                      pillar.items.find((it) => it.id === id)?.label ?? null,
                  )
                  .filter(Boolean)
                  .map((label, i) => (
                    <span key={i} style={{ color: "#666", fontWeight: 400 }}>
                      {" · "}
                      {label}
                    </span>
                  ))}
              </div>
            )}
          </span>
        </label>
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          {on && (
            <div
              role="group"
              aria-label="Tone"
              style={{
                display: "inline-flex",
                border: "1px solid #ddd",
                borderRadius: 4,
                overflow: "hidden",
              }}
            >
              <ToneChip
                active={tone === "weakness"}
                color={TONE_COLORS.weakness}
                onClick={(e) => {
                  e.preventDefault();
                  onSetTone("weakness");
                }}
              >
                Needs work
              </ToneChip>
              <ToneChip
                active={tone === "strength"}
                color={TONE_COLORS.strength}
                onClick={(e) => {
                  e.preventDefault();
                  onSetTone("strength");
                }}
              >
                Strength
              </ToneChip>
            </div>
          )}
          <button
            type="button"
            onClick={onToggleExpanded}
            title={expanded ? "Collapse" : "Expand for specifics"}
            style={{
              padding: "2px 8px",
              fontSize: 10,
              fontWeight: 600,
              color: "#666",
              background: "transparent",
              border: "1px solid #ddd",
              borderRadius: 4,
              cursor: "pointer",
              fontFamily: "inherit",
              flexShrink: 0,
            }}
          >
            {expanded ? "▲" : "▼"}
          </button>
        </div>
      </div>

      {/* Expanded detail: sub-items + optional note */}
      {expanded && (
        <div
          style={{
            padding: "4px 10px 10px",
            borderTop: `1px solid ${on ? pillar.color + "33" : "#eee"}`,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {pillar.items.map((item) => {
            const checked = selectedItems.includes(item.id);
            return (
              <label
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: checked ? "#333" : "#555",
                  cursor: "pointer",
                  padding: "2px 0",
                  lineHeight: 1.3,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleItem(item.id)}
                  style={{ accentColor: pillar.color }}
                />
                <span style={{ fontWeight: checked ? 600 : 400 }}>{item.label}</span>
              </label>
            );
          })}
          {tone === "weakness" ? (
            // "Needs work" gets a problem/resolution pair so the coach
            // captures both halves of the diagnosis in one place. The old
            // single `note` field is intentionally not rendered in this
            // tone, but existing payloads are migrated below if they
            // had one pre-split.
            <>
              <PillarField
                label="Here's the problem"
                accent="#c62828"
                value={problem || note /* fall back to legacy note */}
                placeholder={`What ${pillar.label.toLowerCase()} issue did you see?`}
                onChange={(v) => {
                  onProblemChange(v);
                  // If we're migrating a legacy note into `problem`, clear
                  // `note` on the same patch so the fallback doesn't keep
                  // echoing into this field.
                  if (!problem && note) onNoteChange("");
                }}
              />
              <PillarField
                label="Here's the resolution"
                accent="#1e7e34"
                value={resolution}
                placeholder="What should they practice to fix it?"
                onChange={onResolutionChange}
              />
            </>
          ) : (
            // "Strength / Good job" keeps the single-field flow — one note
            // is enough to call out what the player did well.
            <PillarField
              label="Notes"
              accent={pillar.color}
              value={note}
              placeholder={`What ${pillar.label.toLowerCase()} did they do well?`}
              onChange={onNoteChange}
            />
          )}
        </div>
      )}
    </div>
  );
}

// Labeled textarea shared by the strength/weakness branches. The colored
// uppercase label matches the style used in Common Themes so the two
// flows look like siblings — one is per-pillar detail, the other is
// session-level summary, but they speak the same visual language.
function PillarField({
  label,
  accent,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  accent: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ marginTop: 4 }}>
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
        rows={2}
        placeholder={placeholder}
        style={{
          width: "100%",
          padding: "6px 8px",
          fontSize: 12,
          border: "1px solid #e0e0e0",
          borderRadius: 4,
          outline: "none",
          resize: "vertical",
          fontFamily: "inherit",
          boxSizing: "border-box",
        }}
      />
    </div>
  );
}
