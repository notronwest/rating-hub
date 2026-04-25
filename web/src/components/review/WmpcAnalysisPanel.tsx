/**
 * WmpcAnalysisPanel — the primary WMPC Analysis review surface on the Coach
 * Review page. Renders the player's six review topics as an accordion of
 * collapsed rows; expanding a topic shows a video clip + instance timeline
 * (passes vs fails) + recommendation editor.
 *
 * Exactly one topic expanded at a time. Recommendations auto-save on save.
 * Dismiss asks for confirmation. Progress counter reflects addressed topics.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { RallyShot } from "../../types/database";
import {
  buildReviewTopics,
  isTopicAddressed,
  type ReviewTopic,
  type TopicId,
  type TopicInstance,
  type TopicRecommendation,
} from "../../lib/reviewTopics";
import type { PlayerInfo, RallyInfo as ScriptRallyInfo } from "../../lib/firstFourShots";
import type { RallyInfo as BeatRallyInfo } from "../../lib/defensiveBeats";
import {
  listTopicRecommendations,
  upsertTopicRecommendation,
} from "../../lib/coachApi";
import InstanceTimeline from "./InstanceTimeline";
import VideoPlayer, { type VideoPlayerHandle } from "../analyze/VideoPlayer";
import FptmEditor from "../analyze/FptmEditor";
import type { FptmValue } from "../../lib/fptm";

/** Loop the clip for this many ms after the instance's seek point. */
const CLIP_LOOP_MS = 5000;

const TAG_PRESETS = [
  "positioning",
  "third-shot",
  "reset",
  "dink battle",
  "transition",
  "mindset",
  "stacking",
  "serve depth",
];

interface Props {
  analysisId: string | null;
  player: PlayerInfo;
  shots: RallyShot[];
  rallies: Array<ScriptRallyInfo & BeatRallyInfo>;
  players: PlayerInfo[];
  /** Mux playback id for the game's video (null while waiting for it). */
  playbackId: string | null;
  /** PBV poster URL for the video. */
  posterUrl: string;
  /** Coach-set flags from Analyze. We use these to decorate timeline tiles
   *  for rallies the coach has already flagged, so the same moment isn't
   *  accidentally written up twice. */
  flags?: Array<{ shot_id: string }>;
}

export default function WmpcAnalysisPanel({
  analysisId,
  player,
  shots,
  rallies,
  players,
  playbackId,
  posterUrl,
  flags = [],
}: Props) {
  // Rallies that have at least one flagged shot — used as a lightweight
  // "already-reviewed-in-Analyze" signal on the instance tiles. A shot-level
  // match would be more precise but TopicInstance doesn't carry a shot id.
  const flaggedRallyIds = useMemo(() => {
    const shotToRally = new Map(shots.map((s) => [s.id, s.rally_id]));
    const out = new Set<string>();
    for (const f of flags) {
      const rallyId = shotToRally.get(f.shot_id);
      if (rallyId) out.add(rallyId);
    }
    return out;
  }, [shots, flags]);
  const [recsByTopic, setRecsByTopic] = useState<Map<TopicId, TopicRecommendation>>(new Map());
  const [openTopicId, setOpenTopicId] = useState<TopicId | null>(null);
  const [loading, setLoading] = useState(false);

  // Fetch saved recommendations for this analysis+player
  useEffect(() => {
    if (!analysisId) return;
    let cancelled = false;
    setLoading(true);
    listTopicRecommendations(analysisId, player.id)
      .then((rows) => {
        if (cancelled) return;
        const m = new Map<TopicId, TopicRecommendation>();
        for (const r of rows) {
          m.set(r.topic_id as TopicId, {
            id: r.id,
            recommendation: r.recommendation,
            tags: r.tags,
            dismissed: r.dismissed,
            fptm: r.fptm,
            drills: r.drills,
            updated_at: r.updated_at,
          });
        }
        setRecsByTopic(m);
      })
      .catch((e) => console.error("Topic rec load failed:", e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [analysisId, player.id]);

  // Topic reset when player changes
  useEffect(() => {
    setOpenTopicId(null);
  }, [player.id]);

  const topics = useMemo<ReviewTopic[]>(
    () =>
      buildReviewTopics({
        player,
        shots,
        rallies,
        players,
        recommendationsByTopic: recsByTopic,
      }),
    [player, shots, rallies, players, recsByTopic],
  );

  const addressedCount = topics.filter(isTopicAddressed).length;

  async function saveTopic(
    topic: ReviewTopic,
    patch: {
      recommendation?: string | null;
      tags?: string[];
      dismissed?: boolean;
      fptm?: unknown;
      drills?: string | null;
    },
  ) {
    if (!analysisId) return;
    const current = topic.recommendation;
    const next = await upsertTopicRecommendation({
      analysisId,
      playerId: player.id,
      topicId: topic.id,
      recommendation: patch.recommendation ?? current?.recommendation ?? null,
      tags: patch.tags ?? current?.tags ?? [],
      dismissed: patch.dismissed ?? current?.dismissed ?? false,
      fptm: patch.fptm ?? current?.fptm ?? null,
      drills: patch.drills ?? current?.drills ?? null,
    });
    setRecsByTopic((prev) => {
      const m = new Map(prev);
      m.set(topic.id as TopicId, {
        id: next.id,
        recommendation: next.recommendation,
        tags: next.tags,
        dismissed: next.dismissed,
        fptm: next.fptm,
        drills: next.drills,
        updated_at: next.updated_at,
      });
      return m;
    });
  }

  function handleToggle(topicId: TopicId) {
    setOpenTopicId((prev) => (prev === topicId ? null : topicId));
  }

  // After a save or dismiss, move the coach to the next topic so they can
  // walk straight through the six-topic list — mirroring the Review Queue's
  // "save → advance" flow. If this was the last topic we just close; there
  // isn't a wrap-up panel on this component.
  function advanceFrom(topicId: TopicId) {
    const idx = topics.findIndex((t) => t.id === topicId);
    const next = topics[idx + 1];
    setOpenTopicId(next?.id ?? null);
  }

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 10,
        overflow: "hidden",
        marginBottom: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 14px",
          fontSize: 13,
          fontWeight: 700,
          background: "#fafafa",
          borderBottom: "1px solid #eee",
        }}
      >
        <span>📊 WMPC Analysis</span>
        <span style={{ fontWeight: 400, color: "#666", fontSize: 12 }}>
          Walk the topics in place · leave a recommendation or dismiss.
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "#666", fontWeight: 500 }}>
          {loading
            ? "Loading…"
            : `${addressedCount} of ${topics.length} addressed`}
        </span>
      </div>

      {topics.map((t) => (
        <TopicItem
          key={t.id}
          topic={t}
          isOpen={openTopicId === t.id}
          onToggle={() => handleToggle(t.id)}
          playbackId={playbackId}
          posterUrl={posterUrl}
          onSave={(patch) => saveTopic(t, patch)}
          onAdvance={() => advanceFrom(t.id)}
          flaggedRallyIds={flaggedRallyIds}
          shots={shots}
        />
      ))}
    </div>
  );
}

// ────────────────────────────── Topic row + expanded ──────────────────────────

interface TopicItemProps {
  topic: ReviewTopic;
  isOpen: boolean;
  onToggle: () => void;
  playbackId: string | null;
  posterUrl: string;
  onSave: (patch: {
    recommendation?: string | null;
    tags?: string[];
    dismissed?: boolean;
    fptm?: unknown;
    drills?: string | null;
  }) => Promise<void>;
  flaggedRallyIds: Set<string>;
  shots: RallyShot[];
  /** Called after a successful save or dismiss — lets the parent advance
   *  the coach to the next topic, mirroring the Review Queue's flow. */
  onAdvance: () => void;
}

/** Exported so the new "Stats to Review" panel can reuse the exact same
 *  expanded shell (FPTM editor, drills, overall note, instance timeline,
 *  video clip) without UI duplication. */
export function TopicItem({ topic, isOpen, onToggle, playbackId, posterUrl, onSave, onAdvance, flaggedRallyIds, shots }: TopicItemProps) {
  const addressed = isTopicAddressed(topic);
  const pctColor =
    topic.pct >= 80 ? "#1e7e34" : topic.pct >= 60 ? "#d97706" : "#c62828";

  return (
    <div style={{ borderBottom: "1px solid #eee" }}>
      <button
        onClick={onToggle}
        style={topicRowStyle(isOpen, addressed)}
      >
        {/* Green ✓ when addressed, hollow blue ring when open/active,
            gray circle otherwise — same language as the Review Queue's
            per-item status dot so the coach has a consistent mental
            model across both flows. */}
        <span style={topicStatusDotStyle(isOpen, addressed)}>
          {addressed ? "✓" : isOpen ? "▶" : ""}
        </span>
        <span style={{ fontSize: 16 }}>{topic.icon}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#222", lineHeight: 1.2 }}>
            {topic.title}
          </div>
          <div style={{ fontSize: 11, color: "#8a8a8a", marginTop: 2 }}>{topic.subtitle}</div>
        </span>
        <span
          style={{
            textAlign: "right",
            minWidth: 90,
            fontSize: 13,
            fontWeight: 700,
            color: pctColor,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {topic.correct}/{topic.total}
          <span style={{ fontSize: 11, color: "#999", marginLeft: 6 }}>{topic.pct}%</span>
        </span>
        <span style={topicStatusChipStyle(addressed, topic.recommendation?.dismissed)}>
          {topic.recommendation?.dismissed
            ? "Dismissed"
            : addressed
            ? "Recommendation saved"
            : "Needs recommendation"}
        </span>
        <span style={{ fontSize: 10, color: "#bbb" }}>{isOpen ? "▴" : "▾"}</span>
      </button>

      {isOpen && (
        <TopicExpanded
          topic={topic}
          playbackId={playbackId}
          posterUrl={posterUrl}
          onSave={onSave}
          onAdvance={onAdvance}
          flaggedRallyIds={flaggedRallyIds}
          shots={shots}
        />
      )}
    </div>
  );
}

function topicRowStyle(isOpen: boolean, addressed: boolean): CSSProperties {
  const base: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    width: "100%",
    border: "none",
    background: "transparent",
    fontFamily: "inherit",
    textAlign: "left",
    cursor: "pointer",
    borderLeft: "3px solid transparent",
    transition: "background 0.12s",
  };
  if (isOpen) {
    return {
      ...base,
      background: "#eef3ff",
      borderLeftColor: "#1a73e8",
      paddingLeft: 11,
    };
  }
  if (addressed) {
    return { ...base, background: "#f8fbf8", borderLeftColor: "#1e7e34" };
  }
  return base;
}

// Circular status dot rendered at the start of each topic row. Matches the
// Review Queue's `statusDotStyle` so the two flows share one visual
// grammar: green-filled ✓ = done, blue ring = in progress, gray ring = not
// started.
function topicStatusDotStyle(isOpen: boolean, addressed: boolean): CSSProperties {
  if (addressed) {
    return {
      width: 18,
      height: 18,
      borderRadius: "50%",
      background: "#1e7e34",
      color: "#fff",
      display: "inline-grid",
      placeItems: "center",
      fontSize: 11,
      fontWeight: 700,
      flexShrink: 0,
    };
  }
  if (isOpen) {
    return {
      width: 18,
      height: 18,
      borderRadius: "50%",
      border: "2px solid #1a73e8",
      boxSizing: "border-box",
      color: "#1a73e8",
      display: "inline-grid",
      placeItems: "center",
      fontSize: 9,
      fontWeight: 700,
      flexShrink: 0,
    };
  }
  return {
    width: 18,
    height: 18,
    borderRadius: "50%",
    border: "2px solid #ccc",
    boxSizing: "border-box",
    flexShrink: 0,
  };
}

function topicStatusChipStyle(addressed: boolean, dismissed: boolean | undefined): CSSProperties {
  const base: CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    padding: "3px 8px",
    borderRadius: 4,
    textTransform: "uppercase",
    letterSpacing: 0.3,
    whiteSpace: "nowrap",
  };
  if (dismissed) return { ...base, background: "#f1f3f5", color: "#6b7280" };
  if (addressed) return { ...base, background: "#e6f4ea", color: "#1e7e34" };
  return { ...base, background: "#fff3cd", color: "#92400e" };
}

// ─────────────────────────── Expanded topic ───────────────────────────

interface TopicExpandedProps {
  topic: ReviewTopic;
  playbackId: string | null;
  posterUrl: string;
  onSave: (patch: {
    recommendation?: string | null;
    tags?: string[];
    dismissed?: boolean;
    fptm?: unknown;
    drills?: string | null;
  }) => Promise<void>;
  flaggedRallyIds: Set<string>;
  shots: RallyShot[];
  onAdvance: () => void;
}

function TopicExpanded({ topic, playbackId, posterUrl, onSave, onAdvance, flaggedRallyIds, shots }: TopicExpandedProps) {
  const videoRef = useRef<VideoPlayerHandle>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(0.5);
  const [current, setCurrent] = useState<TopicInstance | null>(
    topic.instances.find((i) => !i.passed) ?? topic.instances[0] ?? null,
  );
  const [draftRec, setDraftRec] = useState(topic.recommendation?.recommendation ?? "");
  const [draftTags, setDraftTags] = useState<Set<string>>(
    new Set(topic.recommendation?.tags ?? []),
  );
  const [draftFptm, setDraftFptm] = useState<FptmValue>(
    (topic.recommendation?.fptm as FptmValue) ?? {},
  );
  const [draftDrills, setDraftDrills] = useState<string | null>(
    topic.recommendation?.drills ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  // In-app confirmation modal state — replaces the native window.confirm
  // that blocks the page and looks jarring against the rest of the UI.
  const [showDismissConfirm, setShowDismissConfirm] = useState(false);

  // Reset drafts when the saved recommendation changes
  useEffect(() => {
    setDraftRec(topic.recommendation?.recommendation ?? "");
    setDraftTags(new Set(topic.recommendation?.tags ?? []));
    setDraftFptm((topic.recommendation?.fptm as FptmValue) ?? {});
    setDraftDrills(topic.recommendation?.drills ?? null);
  }, [topic.recommendation?.id]);

  // Seek start — backs up to the start of the shot TWO shots before the one
  // the instance points at. Rationale: for topics like "4th out of the air"
  // the coach can only judge whether the 4th was the right choice by seeing
  // the 2nd and 3rd that set it up. Falls back to the instance's own seekMs
  // when we don't have enough shot history in the rally (e.g. a serve).
  const clipStartMs = useMemo(() => {
    if (!current) return 0;
    const rallyShots = shots
      .filter((s) => s.rally_id === current.rallyId)
      .sort((a, b) => a.shot_index - b.shot_index);
    if (rallyShots.length === 0) return current.seekMs;
    // Pick the shot that the instance refers to — closest start_ms to seekMs.
    let targetIdx = 0;
    let bestDelta = Infinity;
    for (let i = 0; i < rallyShots.length; i++) {
      const delta = Math.abs(rallyShots[i].start_ms - current.seekMs);
      if (delta < bestDelta) {
        bestDelta = delta;
        targetIdx = i;
      }
    }
    const preRollIdx = Math.max(0, targetIdx - 2);
    // Nudge a hair earlier so the first frame isn't mid-contact.
    return Math.max(0, rallyShots[preRollIdx].start_ms - 250);
  }, [current, shots]);

  // End of the loop window — stop a little past the TARGET shot rather than
  // past the pre-roll, so short clips don't end before the moment of
  // interest even with the 2-shot lead-in.
  const clipEndMs = useMemo(() => {
    if (!current) return clipStartMs + CLIP_LOOP_MS;
    return current.seekMs + CLIP_LOOP_MS;
  }, [current, clipStartMs]);

  // Auto-seek + play when the current instance changes
  useEffect(() => {
    if (!current) return;
    videoRef.current?.seek(clipStartMs);
    videoRef.current?.setPlaybackRate(playbackRate);
    void videoRef.current?.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, clipStartMs]);

  // Loop the clip — after the loop window ends, reset to the pre-roll start.
  useEffect(() => {
    if (!current) return;
    if (currentMs > clipEndMs) {
      videoRef.current?.seek(clipStartMs);
    }
  }, [currentMs, current, clipEndMs, clipStartMs]);

  function handleSelect(it: TopicInstance) {
    setCurrent(it);
    // Actual seek happens via the effect above to avoid duplicate seeks
  }

  function changeRate(r: number) {
    setPlaybackRate(r);
    videoRef.current?.setPlaybackRate(r);
  }

  async function save(
    patch: Parameters<typeof onSave>[0],
    opts: { advance?: boolean } = {},
  ) {
    setSaving(true);
    setSavedMsg(null);
    try {
      await onSave(patch);
      setSavedMsg("✓ Saved");
      setTimeout(() => setSavedMsg(null), 1200);
      if (opts.advance) {
        // Small delay so the coach sees the tick before the row collapses
        // and the next topic opens, matching the Review Queue's cadence.
        setTimeout(() => onAdvance(), 400);
      }
    } catch (e) {
      setSavedMsg(e instanceof Error ? `Error: ${e.message}` : String(e));
    } finally {
      setSaving(false);
    }
  }

  function handleDismiss() {
    setShowDismissConfirm(true);
  }

  async function confirmDismiss() {
    setShowDismissConfirm(false);
    await save(
      { dismissed: true, recommendation: null, fptm: {}, drills: null },
      { advance: true },
    );
  }

  async function handleUndismiss() {
    await save({ dismissed: false });
  }

  function toggleTag(t: string) {
    setDraftTags((prev) => {
      const n = new Set(prev);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  }

  const dismissed = !!topic.recommendation?.dismissed;

  return (
    <div style={{ padding: 14, background: "#fbfbfc" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "3fr 2fr",
          gap: 14,
        }}
      >
        {/* Left: inline video + speed + instance timeline */}
        <div>
          {playbackId ? (
            <>
              <div style={{ position: "relative" }}>
                <VideoPlayer
                  ref={videoRef}
                  playbackId={playbackId}
                  posterUrl={posterUrl}
                  onTimeUpdate={setCurrentMs}
                />
                {current && (
                  <span
                    style={{
                      position: "absolute",
                      top: 10,
                      right: 10,
                      padding: "3px 10px",
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: 0.3,
                      textTransform: "uppercase",
                      borderRadius: 3,
                      background: current.passed
                        ? "rgba(30,126,52,0.9)"
                        : "rgba(198,40,40,0.9)",
                      color: "#fff",
                    }}
                  >
                    {current.passed ? "Pass" : "Fail"} · Rally {current.rallyIndex + 1}
                  </span>
                )}
              </div>

              {/* Speed + restart controls */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginTop: 8,
                  fontSize: 12,
                  color: "#666",
                }}
              >
                <span>Speed:</span>
                {[0.25, 0.5, 0.75, 1].map((r) => {
                  const active = playbackRate === r;
                  return (
                    <button
                      key={r}
                      onClick={() => changeRate(r)}
                      style={{
                        padding: "4px 10px",
                        fontSize: 11,
                        fontWeight: active ? 700 : 500,
                        background: active ? "#1a73e8" : "#fff",
                        color: active ? "#fff" : "#666",
                        border: `1px solid ${active ? "#1a73e8" : "#e2e2e2"}`,
                        borderRadius: 5,
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {r}×
                    </button>
                  );
                })}
                <span style={{ flex: 1 }} />
                {current && (
                  <button
                    onClick={() => videoRef.current?.seek(current.seekMs)}
                    style={{
                      padding: "4px 10px",
                      fontSize: 11,
                      fontWeight: 600,
                      background: "#fff",
                      color: "#666",
                      border: "1px solid #e2e2e2",
                      borderRadius: 5,
                      cursor: "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    ⟲ Restart clip
                  </button>
                )}
              </div>
            </>
          ) : (
            <div
              style={{
                background: "#0b1020",
                borderRadius: 8,
                aspectRatio: "16/9",
                display: "grid",
                placeItems: "center",
                color: "#8aa8d8",
                fontSize: 12,
                textAlign: "center",
                padding: 20,
              }}
            >
              No Mux playback ID yet — paste one from the Analyze page to enable clips.
            </div>
          )}

          <InstanceTimeline
            instances={topic.instances}
            currentId={current?.id ?? null}
            onSelect={handleSelect}
            flaggedRallyIds={flaggedRallyIds}
          />

          <div style={{ marginTop: 8, fontSize: 11, color: "#8a8a8a" }}>
            💡 <b>Compare passes to fails</b> — what's happening on the good ones that isn't on the bad?
          </div>
        </div>

        {/* Right: recommendation + tags */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={panelCardStyle}>
            <h4 style={panelHeadStyle}>
              FPTM diagnosis
              <span style={panelHintStyle}>· applies to the pattern</span>
            </h4>
            <FptmEditor
              fptm={draftFptm}
              drills={draftDrills}
              heading={null}
              onChange={({ fptm, drills }) => {
                setDraftFptm(fptm);
                setDraftDrills(drills);
              }}
            />
          </div>

          <div style={panelCardStyle}>
            <h4 style={panelHeadStyle}>
              Overall note
              <span style={panelHintStyle}>· applies to all {topic.total} attempts</span>
            </h4>
            <textarea
              value={draftRec}
              onChange={(e) => setDraftRec(e.target.value)}
              rows={4}
              placeholder="What's your coaching takeaway for this pattern? Compare what successful attempts do that the missed ones don't."
              style={textareaStyle}
              disabled={dismissed}
            />
          </div>

          <div style={panelCardStyle}>
            <h4 style={panelHeadStyle}>Tags</h4>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {TAG_PRESETS.map((t) => {
                const on = draftTags.has(t);
                return (
                  <button
                    key={t}
                    onClick={() => toggleTag(t)}
                    disabled={dismissed}
                    style={tagChipStyle(on)}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 10, color: "#8a8a8a", marginTop: 6 }}>
              Tags are global across games &amp; players.
            </div>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginTop: 12,
          paddingTop: 10,
          borderTop: "1px dashed #eee",
        }}
      >
        <div style={{ flex: 1, fontSize: 11, color: "#8a8a8a" }}>
          {savedMsg
            ? savedMsg
            : dismissed
            ? "Topic is dismissed — undo to enable editing."
            : "Save or dismiss to mark addressed."}
        </div>
        {dismissed ? (
          <button onClick={handleUndismiss} disabled={saving} style={btnStyle(false)}>
            Undo dismiss
          </button>
        ) : (
          <button onClick={handleDismiss} disabled={saving} style={{ ...btnStyle(false), color: "#666" }}>
            ⊘ Dismiss topic
          </button>
        )}
        <button
          onClick={() =>
            save(
              {
                recommendation: draftRec.trim() || null,
                tags: Array.from(draftTags),
                dismissed: false,
                fptm: draftFptm,
                drills: draftDrills,
              },
              { advance: true },
            )
          }
          disabled={saving || dismissed}
          style={btnStyle(true)}
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {showDismissConfirm && (
        <DismissConfirmModal
          topicTitle={topic.title}
          onCancel={() => setShowDismissConfirm(false)}
          onConfirm={confirmDismiss}
        />
      )}
    </div>
  );
}

// ──────────────── Dismiss-topic confirmation modal ────────────────

function DismissConfirmModal({
  topicTitle,
  onCancel,
  onConfirm,
}: {
  topicTitle: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Close on Escape — matches the feel of other modals in the app.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      onClick={onCancel}
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
          padding: 20,
          width: "min(420px, 92vw)",
          boxShadow: "0 12px 32px rgba(0,0,0,0.25)",
          fontFamily: "inherit",
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "#222" }}>
          Dismiss topic?
        </h3>
        <p style={{ margin: "10px 0 16px 0", fontSize: 13, color: "#555", lineHeight: 1.5 }}>
          "<b>{topicTitle}</b>" will be marked addressed without a recommendation.
          You can undo this later.
        </p>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontFamily: "inherit",
              background: "#fff",
              color: "#333",
              border: "1px solid #ccc",
              borderRadius: 5,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            style={{
              padding: "6px 14px",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "inherit",
              background: "#c62828",
              color: "#fff",
              border: "1px solid #c62828",
              borderRadius: 5,
              cursor: "pointer",
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────── styles ──────────────────────────────

const panelCardStyle: CSSProperties = {
  background: "#fff",
  border: "1px solid #e2e2e2",
  borderRadius: 8,
  padding: "10px 12px",
};
const panelHeadStyle: CSSProperties = {
  margin: "0 0 6px",
  fontSize: 11,
  fontWeight: 700,
  color: "#666",
  textTransform: "uppercase",
  letterSpacing: 0.5,
};
const panelHintStyle: CSSProperties = {
  fontWeight: 500,
  color: "#8a8a8a",
  textTransform: "none",
  letterSpacing: 0,
  marginLeft: 6,
};
const textareaStyle: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "8px 10px",
  fontSize: 12,
  fontFamily: "inherit",
  border: "1px solid #e2e2e2",
  borderRadius: 5,
  resize: "vertical",
};

function tagChipStyle(on: boolean): CSSProperties {
  return {
    fontSize: 10,
    fontWeight: 600,
    padding: "3px 8px",
    borderRadius: 12,
    background: on ? "#1a73e8" : "#f2f4f7",
    color: on ? "#fff" : "#666",
    border: "1px solid transparent",
    cursor: "pointer",
    fontFamily: "inherit",
  };
}

function btnStyle(primary: boolean): CSSProperties {
  return {
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 600,
    border: primary ? "1px solid #1a73e8" : "1px solid #e2e2e2",
    borderRadius: 5,
    background: primary ? "#1a73e8" : "#fff",
    color: primary ? "#fff" : "#222",
    cursor: "pointer",
    fontFamily: "inherit",
  };
}
