import { useState } from "react";
import type { AssessmentKind } from "../../types/coach";
import { tagsByCategory, CATEGORY_LABELS } from "../../lib/coachTags";

interface Props {
  kind: AssessmentKind;
  /** Currently selected tag IDs for this player+kind */
  selected: Set<string>;
  /** Per-tag notes (keyed by tag id) */
  notes: Record<string, string>;
  onToggle: (tagId: string, active: boolean) => void;
  onNoteChange: (tagId: string, note: string) => void;
}

export default function TagPicker({
  kind,
  selected,
  notes,
  onToggle,
  onNoteChange,
}: Props) {
  const grouped = tagsByCategory(kind);
  const [expandedTag, setExpandedTag] = useState<string | null>(null);

  const color = kind === "strength" ? "#1e7e34" : "#c62828";
  const bgColor = kind === "strength" ? "#e6f4ea" : "#fce8e6";

  return (
    <div>
      {Object.entries(grouped).map(([category, tags]) => (
        <div key={category} style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#888",
              textTransform: "uppercase",
              letterSpacing: 0.5,
              marginBottom: 6,
            }}
          >
            {CATEGORY_LABELS[category] ?? category}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {tags.map((tag) => {
              const isSelected = selected.has(tag.id);
              return (
                <div key={tag.id} style={{ display: "flex", flexDirection: "column" }}>
                  <button
                    onClick={() => onToggle(tag.id, !isSelected)}
                    onDoubleClick={() => setExpandedTag(isSelected ? tag.id : null)}
                    style={{
                      padding: "5px 10px",
                      fontSize: 12,
                      fontWeight: isSelected ? 600 : 400,
                      borderRadius: 14,
                      borderTop: `1px solid ${isSelected ? color : "#ddd"}`,
                      borderBottom: `1px solid ${isSelected ? color : "#ddd"}`,
                      borderLeft: `1px solid ${isSelected ? color : "#ddd"}`,
                      borderRight: `1px solid ${isSelected ? color : "#ddd"}`,
                      background: isSelected ? bgColor : "#fff",
                      color: isSelected ? color : "#555",
                      cursor: "pointer",
                    }}
                  >
                    {tag.label}
                    {isSelected && notes[tag.id] && (
                      <span style={{ marginLeft: 4, fontSize: 10 }}>📝</span>
                    )}
                  </button>
                  {isSelected && expandedTag === tag.id && (
                    <textarea
                      value={notes[tag.id] ?? ""}
                      onChange={(e) => onNoteChange(tag.id, e.target.value)}
                      placeholder="Optional note…"
                      rows={2}
                      style={{
                        marginTop: 4,
                        padding: "4px 8px",
                        fontSize: 12,
                        borderRadius: 6,
                        border: "1px solid #ddd",
                        outline: "none",
                        width: "100%",
                        minWidth: 200,
                        fontFamily: "inherit",
                        resize: "vertical",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: "#999", marginTop: 8 }}>
        Click a tag to toggle. Double-click a selected tag to add a note.
      </div>
    </div>
  );
}
