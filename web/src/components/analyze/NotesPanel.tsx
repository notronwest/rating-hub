import { useEffect, useRef, useState } from "react";
import type {
  AnalysisNote,
  NoteCategory,
  PlayerAssessment,
} from "../../types/coach";
import {
  deleteNote,
  insertNote,
  upsertAssessment,
  deleteAssessment,
  updateAnalysis,
} from "../../lib/coachApi";
import { formatMs } from "../../lib/pbvVideo";
import TagPicker from "./TagPicker";
import { getTag } from "../../lib/coachTags";

interface PlayerInfo {
  id: string;
  display_name: string;
  team: number;
  player_index: number;
}

interface Rally {
  id: string;
  rally_index: number;
  start_ms: number;
  end_ms: number;
}

interface Props {
  analysisId: string;
  overallNotes: string | null;
  players: PlayerInfo[];
  rallies: Rally[];
  notes: AnalysisNote[];
  assessments: PlayerAssessment[];
  currentMs: number;
  onSeek: (ms: number) => void;
  onReload: () => void;
}

type TabId = "overall" | "notes" | "assessments";

const CATEGORIES: { id: NoteCategory; label: string }[] = [
  { id: "general", label: "General" },
  { id: "serve", label: "Serve" },
  { id: "return", label: "Return" },
  { id: "third", label: "Third Shot" },
  { id: "dink", label: "Dink" },
  { id: "movement", label: "Movement" },
  { id: "positioning", label: "Positioning" },
];

export default function NotesPanel({
  analysisId,
  overallNotes,
  players,
  rallies,
  notes,
  assessments,
  currentMs,
  onSeek,
  onReload,
}: Props) {
  const [tab, setTab] = useState<TabId>("notes");

  return (
    <div style={{ border: "1px solid #e2e2e2", borderRadius: 10, background: "#fff" }}>
      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid #e2e2e2" }}>
        {(["overall", "notes", "assessments"] as TabId[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1,
              padding: "10px 12px",
              fontSize: 13,
              fontWeight: tab === t ? 600 : 400,
              color: tab === t ? "#1a73e8" : "#555",
              background: tab === t ? "#f0f4ff" : "transparent",
              border: "none",
              borderBottom: tab === t ? "2px solid #1a73e8" : "2px solid transparent",
              cursor: "pointer",
            }}
          >
            {t === "overall"
              ? "Overall"
              : t === "notes"
              ? `Timestamped (${notes.length})`
              : `Assessments (${assessments.length})`}
          </button>
        ))}
      </div>

      <div style={{ padding: 16 }}>
        {tab === "overall" && (
          <OverallNotesTab
            analysisId={analysisId}
            initialValue={overallNotes ?? ""}
          />
        )}
        {tab === "notes" && (
          <NotesTab
            analysisId={analysisId}
            players={players}
            rallies={rallies}
            notes={notes}
            currentMs={currentMs}
            onSeek={onSeek}
            onReload={onReload}
          />
        )}
        {tab === "assessments" && (
          <AssessmentsTab
            analysisId={analysisId}
            players={players}
            assessments={assessments}
            onReload={onReload}
          />
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Overall notes tab — debounced autosave
// ─────────────────────────────────────────────────────────────────

function OverallNotesTab({
  analysisId,
  initialValue,
}: {
  analysisId: string;
  initialValue: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  function handleChange(v: string) {
    setValue(v);
    setStatus("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        await updateAnalysis(analysisId, { overall_notes: v });
        setStatus("saved");
        setTimeout(() => setStatus("idle"), 1500);
      } catch (e) {
        console.error(e);
        setStatus("idle");
      }
    }, 600);
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 13, color: "#666" }}>
          Summary of the game. Takeaways, themes, match-level observations.
        </div>
        <span style={{ fontSize: 11, color: status === "saved" ? "#1e7e34" : "#999" }}>
          {status === "saving" ? "Saving…" : status === "saved" ? "✓ Saved" : ""}
        </span>
      </div>
      <textarea
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Overall notes about this game…"
        rows={12}
        style={{
          width: "100%",
          padding: "10px 12px",
          fontSize: 14,
          borderRadius: 6,
          border: "1px solid #ddd",
          outline: "none",
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Timestamped notes tab
// ─────────────────────────────────────────────────────────────────

function NotesTab({
  analysisId,
  players,
  rallies,
  notes,
  currentMs,
  onSeek,
  onReload,
}: {
  analysisId: string;
  players: PlayerInfo[];
  rallies: Rally[];
  notes: AnalysisNote[];
  currentMs: number;
  onSeek: (ms: number) => void;
  onReload: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [draftPlayer, setDraftPlayer] = useState<string>("");
  const [draftCategory, setDraftCategory] = useState<NoteCategory>("general");
  const [linkRally, setLinkRally] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Find nearest rally to currentMs
  const nearestRally = rallies.find(
    (r) => currentMs >= r.start_ms && currentMs <= r.end_ms,
  ) ?? rallies.reduce<Rally | null>((best, r) => {
    if (best == null) return r;
    const dBest = Math.abs(best.start_ms - currentMs);
    const dThis = Math.abs(r.start_ms - currentMs);
    return dThis < dBest ? r : best;
  }, null);

  async function handleAdd() {
    if (!draft.trim()) return;
    setSubmitting(true);
    try {
      await insertNote({
        analysisId,
        playerId: draftPlayer || null,
        rallyId: linkRally && nearestRally ? nearestRally.id : null,
        timestampMs: currentMs,
        category: draftCategory,
        note: draft.trim(),
      });
      setDraft("");
      onReload();
    } catch (e) {
      console.error(e);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this note?")) return;
    try {
      await deleteNote(id);
      onReload();
    } catch (e) {
      console.error(e);
    }
  }

  return (
    <div>
      {/* New note form */}
      <div
        style={{
          padding: 12,
          background: "#f8f9fa",
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8, alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#666" }}>
            At <strong style={{ color: "#333" }}>{formatMs(currentMs)}</strong>
          </span>
          <select
            value={draftPlayer}
            onChange={(e) => setDraftPlayer(e.target.value)}
            style={selectStyle}
          >
            <option value="">No specific player</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.display_name} (T{p.team})
              </option>
            ))}
          </select>
          <select
            value={draftCategory}
            onChange={(e) => setDraftCategory(e.target.value as NoteCategory)}
            style={selectStyle}
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          {nearestRally && (
            <label style={{ fontSize: 12, color: "#666", display: "flex", alignItems: "center", gap: 4 }}>
              <input
                type="checkbox"
                checked={linkRally}
                onChange={(e) => setLinkRally(e.target.checked)}
              />
              Link to rally {nearestRally.rally_index + 1}
            </label>
          )}
        </div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleAdd();
          }}
          placeholder="Add a note… (⌘+Enter to save)"
          rows={2}
          style={{
            width: "100%",
            padding: "8px 10px",
            fontSize: 13,
            borderRadius: 6,
            border: "1px solid #ddd",
            outline: "none",
            resize: "vertical",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
          <button
            onClick={handleAdd}
            disabled={!draft.trim() || submitting}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              background: !draft.trim() || submitting ? "#9ab8e8" : "#1a73e8",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              cursor: !draft.trim() || submitting ? "not-allowed" : "pointer",
            }}
          >
            {submitting ? "Adding…" : "Add note"}
          </button>
        </div>
      </div>

      {/* Notes list */}
      {notes.length === 0 ? (
        <div style={{ fontSize: 13, color: "#999", textAlign: "center", padding: "16px 0" }}>
          No notes yet. Start typing above.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {[...notes]
            .sort((a, b) => (a.timestamp_ms ?? 0) - (b.timestamp_ms ?? 0))
            .map((n) => {
              const player = players.find((p) => p.id === n.player_id);
              return (
                <div
                  key={n.id}
                  style={{
                    padding: "8px 10px",
                    border: "1px solid #eee",
                    borderRadius: 6,
                    fontSize: 13,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      {n.timestamp_ms != null && (
                        <button
                          onClick={() => onSeek(n.timestamp_ms!)}
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: "#1a73e8",
                            background: "#e8f0fe",
                            padding: "2px 8px",
                            borderRadius: 4,
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          {formatMs(n.timestamp_ms)} ▶
                        </button>
                      )}
                      {player && (
                        <span style={{ fontSize: 11, color: "#666", fontWeight: 500 }}>
                          {player.display_name}
                        </span>
                      )}
                      {n.category && n.category !== "general" && (
                        <span
                          style={{
                            fontSize: 10,
                            padding: "1px 6px",
                            background: "#f0f0f0",
                            borderRadius: 3,
                            textTransform: "uppercase",
                            color: "#666",
                            letterSpacing: 0.5,
                          }}
                        >
                          {n.category}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => handleDelete(n.id)}
                      style={{
                        fontSize: 11,
                        color: "#999",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      Delete
                    </button>
                  </div>
                  <div style={{ color: "#333", whiteSpace: "pre-wrap" }}>{n.note}</div>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Assessments tab
// ─────────────────────────────────────────────────────────────────

function AssessmentsTab({
  analysisId,
  players,
  assessments,
  onReload,
}: {
  analysisId: string;
  players: PlayerInfo[];
  assessments: PlayerAssessment[];
  onReload: () => void;
}) {
  const [activePlayer, setActivePlayer] = useState<string>(players[0]?.id ?? "");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const playerAssessments = assessments.filter((a) => a.player_id === activePlayer);
  const strengths = new Set(playerAssessments.filter((a) => a.kind === "strength").map((a) => a.tag));
  const weaknesses = new Set(playerAssessments.filter((a) => a.kind === "weakness").map((a) => a.tag));
  const notesByKey = Object.fromEntries(
    playerAssessments.map((a) => [`${a.kind}:${a.tag}`, a.note ?? ""]),
  );

  async function handleToggle(kind: "strength" | "weakness", tagId: string, active: boolean) {
    if (!activePlayer) return;
    try {
      if (active) {
        await upsertAssessment({ analysisId, playerId: activePlayer, kind, tag: tagId });
      } else {
        await deleteAssessment({ analysisId, playerId: activePlayer, kind, tag: tagId });
      }
      onReload();
    } catch (e) {
      console.error(e);
    }
  }

  async function handleNoteChange(kind: "strength" | "weakness", tagId: string, note: string) {
    const key = `${kind}:${tagId}`;
    setNoteDrafts((prev) => ({ ...prev, [key]: note }));
    // Debounce save via timeout stored on ref-less dict
    try {
      await upsertAssessment({
        analysisId,
        playerId: activePlayer,
        kind,
        tag: tagId,
        note: note || null,
      });
    } catch (e) {
      console.error(e);
    }
  }

  if (players.length === 0) {
    return <div style={{ color: "#999", fontSize: 13 }}>No players in this game.</div>;
  }

  return (
    <div>
      {/* Player tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {players.map((p) => {
          const count = assessments.filter((a) => a.player_id === p.id).length;
          return (
            <button
              key={p.id}
              onClick={() => setActivePlayer(p.id)}
              style={{
                padding: "6px 12px",
                fontSize: 13,
                fontWeight: activePlayer === p.id ? 600 : 400,
                borderTop: `1px solid ${activePlayer === p.id ? "#1a73e8" : "#ddd"}`,
                borderBottom: `1px solid ${activePlayer === p.id ? "#1a73e8" : "#ddd"}`,
                borderLeft: `1px solid ${activePlayer === p.id ? "#1a73e8" : "#ddd"}`,
                borderRight: `1px solid ${activePlayer === p.id ? "#1a73e8" : "#ddd"}`,
                borderRadius: 6,
                background: activePlayer === p.id ? "#e8f0fe" : "#fff",
                color: activePlayer === p.id ? "#1a73e8" : "#555",
                cursor: "pointer",
              }}
            >
              {p.display_name}
              {count > 0 && (
                <span style={{ marginLeft: 4, fontSize: 10, color: "#888" }}>({count})</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Strengths */}
      <div style={{ marginBottom: 20 }}>
        <h4 style={{ fontSize: 13, fontWeight: 600, color: "#1e7e34", margin: "0 0 8px" }}>
          💪 Strengths
        </h4>
        <TagPicker
          kind="strength"
          selected={strengths}
          notes={Object.fromEntries(
            Array.from(strengths).map((t) => [t, notesByKey[`strength:${t}`] ?? noteDrafts[`strength:${t}`] ?? ""]),
          )}
          onToggle={(tagId, active) => handleToggle("strength", tagId, active)}
          onNoteChange={(tagId, note) => handleNoteChange("strength", tagId, note)}
        />
      </div>

      {/* Weaknesses */}
      <div>
        <h4 style={{ fontSize: 13, fontWeight: 600, color: "#c62828", margin: "0 0 8px" }}>
          🎯 Areas to improve
        </h4>
        <TagPicker
          kind="weakness"
          selected={weaknesses}
          notes={Object.fromEntries(
            Array.from(weaknesses).map((t) => [t, notesByKey[`weakness:${t}`] ?? noteDrafts[`weakness:${t}`] ?? ""]),
          )}
          onToggle={(tagId, active) => handleToggle("weakness", tagId, active)}
          onNoteChange={(tagId, note) => handleNoteChange("weakness", tagId, note)}
        />
      </div>

      {/* Current tag summary */}
      {playerAssessments.length > 0 && (
        <div
          style={{
            marginTop: 20,
            padding: 10,
            background: "#f8f9fa",
            borderRadius: 6,
            fontSize: 12,
            color: "#666",
          }}
        >
          <strong>{playerAssessments.length}</strong> tag{playerAssessments.length !== 1 ? "s" : ""} selected:{" "}
          {playerAssessments.map((a) => getTag(a.tag)?.label ?? a.tag).join(", ")}
        </div>
      )}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "4px 8px",
  fontSize: 12,
  borderRadius: 4,
  border: "1px solid #ddd",
  background: "#fff",
  outline: "none",
};
