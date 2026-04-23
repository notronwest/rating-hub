/**
 * ReviewPointsPanel — the unified "review points" panel that lives below the
 * Analyze video (Variant E from prototypes/review-points-aligned.html).
 *
 * A review point is anything the coach might want to look at: a coach-flagged
 * shot (⚑), a coach-built sequence (⚑ with a `▤ N shots` context chip), or
 * an auto-detected rally-ending fault (●). They all land in one list sorted
 * by video time so the coach doesn't juggle three stacked panels.
 *
 * Data is computed at render time (option A from NEXT.md) by merging the
 * existing `flags`, `sequences`, and `is_final` shot data — no migration.
 * If the UX sticks we can promote `review_points` to a real table later.
 *
 * FPTM display is intentionally dropped (per NEXT.md); the row's free-form
 * note comes from `flag.note` / `sequence.what_went_wrong`. The presence of
 * `drills` on either row shows as a green "drill" chip.
 */

import { useMemo, useState } from "react";
import type { RallyShot } from "../../types/database";
import type { AnalysisSequence, FlaggedShot, GameAnalysis } from "../../types/coach";
import { formatMs } from "../../lib/pbvVideo";

// ──────────────────────────────────────────────────────────────────────────
// Shared inputs

interface PlayerLite {
  player_index: number;
  display_name: string;
  avatar_url?: string | null;
}

interface RallyLite {
  id: string;
  rally_index: number;
  winning_team: number | null;
}

interface Props {
  analysis: GameAnalysis | null;
  flags: FlaggedShot[];
  sequences: AnalysisSequence[];
  shots: RallyShot[];
  rallies: RallyLite[];
  players: PlayerLite[];
  /** Seek + play a shot (used for Review / Open on flags and auto-faults). */
  onJumpToShot: (shot: RallyShot) => void;
  /** Activate a saved sequence (seek + loop). */
  onActivateSequence: (seq: AnalysisSequence) => void;
  /** Persist a new dismissed-loss key set on the analysis row. */
  onSetDismissedLossKeys: (keys: string[]) => Promise<void> | void;
}

// ──────────────────────────────────────────────────────────────────────────
// Computed model

type Source = "flag" | "auto";
type ReviewAction = "review" | "open" | "restore";

interface ReviewPoint {
  id: string;
  kind: "flag" | "sequence" | "auto";
  source: Source;
  playerName: string;
  rallyIndex: number;
  rallyId: string;
  startMs: number;
  shotType: string | null;
  shotId: string;
  note: string | null;
  hasDrill: boolean;
  /** When present → renders a "▤ N shots" context chip. */
  contextSize: number | null;
  isReviewed: boolean;
  isDismissed: boolean;
  /** Drives the button label + onAction branch. */
  action: ReviewAction;
  // Backing rows for the action handler
  flag?: FlaggedShot;
  sequence?: AnalysisSequence;
  shot?: RallyShot;
}

type Filter = "all" | "needs" | "coach" | "auto" | "drill";

// ──────────────────────────────────────────────────────────────────────────
// Helpers — building review points from existing state

function buildReviewPoints(args: {
  analysis: GameAnalysis | null;
  flags: FlaggedShot[];
  sequences: AnalysisSequence[];
  shots: RallyShot[];
  rallies: RallyLite[];
  players: PlayerLite[];
}): ReviewPoint[] {
  const { analysis, flags, sequences, shots, rallies, players } = args;
  const shotById = new Map(shots.map((s) => [s.id, s]));
  const rallyById = new Map(rallies.map((r) => [r.id, r]));
  const playerByIdx = new Map(players.map((p) => [p.player_index, p]));
  const dismissed = new Set(analysis?.dismissed_loss_keys ?? []);
  const out: ReviewPoint[] = [];

  // 1) Coach flags
  for (const flag of flags) {
    const shot = shotById.get(flag.shot_id);
    if (!shot) continue;
    const rally = rallyById.get(shot.rally_id);
    if (!rally) continue;
    const player = shot.player_index != null
      ? playerByIdx.get(shot.player_index)
      : null;
    const hasFptm = !!flag.fptm && Object.keys(flag.fptm).length > 0;
    const isReviewed = hasFptm || !!flag.drills || !!flag.note;
    out.push({
      id: `flag:${flag.id}`,
      kind: "flag",
      source: "flag",
      playerName: player?.display_name ?? `Player ${shot.player_index ?? "?"}`,
      rallyIndex: rally.rally_index,
      rallyId: rally.id,
      startMs: shot.start_ms,
      shotType: shot.shot_type,
      shotId: shot.id,
      note: flag.note ?? null,
      hasDrill: !!flag.drills,
      contextSize: null,
      isReviewed,
      isDismissed: false,
      action: isReviewed ? "open" : "review",
      flag,
      shot,
    });
  }

  // 2) Coach sequences — anchored at the last shot for ordering; shows a
  //    context chip with the length of the sequence.
  for (const seq of sequences) {
    const shotIds = seq.shot_ids ?? [];
    if (shotIds.length === 0) continue;
    const seqShots = shotIds
      .map((id) => shotById.get(id))
      .filter((s): s is RallyShot => !!s)
      .sort((a, b) => a.start_ms - b.start_ms);
    if (seqShots.length === 0) continue;
    const anchor = seqShots[seqShots.length - 1];
    const rally = rallyById.get(seq.rally_id);
    if (!rally) continue;
    const taggedPlayerId = seq.player_id ?? (seq.player_ids?.[0] ?? null);
    const player = taggedPlayerId
      ? players.find((_p) => false) /* by id not available on PlayerLite */
      : anchor.player_index != null
      ? playerByIdx.get(anchor.player_index)
      : null;
    // Fall back to the anchor shot's player name
    const resolvedName = player?.display_name
      ?? (anchor.player_index != null
        ? playerByIdx.get(anchor.player_index)?.display_name
        : null)
      ?? "Sequence";
    const hasFptm = !!seq.fptm && Object.keys(seq.fptm).length > 0;
    const note = seq.what_went_wrong ?? seq.how_to_fix ?? seq.label ?? null;
    const isReviewed = hasFptm || !!seq.drills || !!note;
    out.push({
      id: `seq:${seq.id}`,
      kind: "sequence",
      source: "flag",
      playerName: resolvedName,
      rallyIndex: rally.rally_index,
      rallyId: rally.id,
      startMs: anchor.start_ms,
      shotType: anchor.shot_type,
      shotId: anchor.id,
      note,
      hasDrill: !!seq.drills,
      contextSize: seqShots.length,
      isReviewed,
      isDismissed: false,
      action: "open",
      sequence: seq,
      shot: anchor,
    });
  }

  // 3) Auto-detected rally-ending faults — every is_final shot that isn't
  //    covered by an existing coach row is fodder for review.
  const flaggedShotIds = new Set(flags.map((f) => f.shot_id));
  const sequenceAnchorShotIds = new Set<string>();
  for (const seq of sequences) {
    const shotIds = seq.shot_ids ?? [];
    const last = shotIds[shotIds.length - 1];
    if (last) sequenceAnchorShotIds.add(last);
  }
  for (const shot of shots) {
    if (!shot.is_final) continue;
    // Skip if this shot is already surfaced as a flag or sequence anchor.
    if (flaggedShotIds.has(shot.id) || sequenceAnchorShotIds.has(shot.id)) continue;
    const rally = rallyById.get(shot.rally_id);
    if (!rally) continue;
    const player = shot.player_index != null
      ? playerByIdx.get(shot.player_index)
      : null;
    const key = `loss:${rally.id}:${shot.id}`;
    const isDismissed = dismissed.has(key);
    // An auto point counts as reviewed only if a coach sequence was saved
    // that *contains* this shot (rare without the flag-anchor path, but
    // possible if the coach built a sequence manually around a fault).
    const isReviewed = sequences.some(
      (s) => (s.shot_ids ?? []).includes(shot.id),
    );
    out.push({
      id: `auto:${shot.id}`,
      kind: "auto",
      source: "auto",
      playerName: player?.display_name ?? `Player ${shot.player_index ?? "?"}`,
      rallyIndex: rally.rally_index,
      rallyId: rally.id,
      startMs: shot.start_ms,
      shotType: shot.shot_type,
      shotId: shot.id,
      note: null,
      hasDrill: false,
      contextSize: null,
      isReviewed,
      isDismissed,
      action: isDismissed ? "restore" : isReviewed ? "open" : "review",
      shot,
    });
  }

  // Order by video time so the list reads left-to-right with the rally strip.
  out.sort((a, b) => a.startMs - b.startMs);
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Component

export default function ReviewPointsPanel({
  analysis,
  flags,
  sequences,
  shots,
  rallies,
  players,
  onJumpToShot,
  onActivateSequence,
  onSetDismissedLossKeys,
}: Props) {
  const [filter, setFilter] = useState<Filter>("all");

  const points = useMemo(
    () => buildReviewPoints({ analysis, flags, sequences, shots, rallies, players }),
    [analysis, flags, sequences, shots, rallies, players],
  );

  const counts = useMemo(() => {
    const c = {
      all: points.length,
      needs: 0,
      coach: 0,
      auto: 0,
      drill: 0,
      reviewed: 0,
      dismissed: 0,
    };
    for (const p of points) {
      if (p.isDismissed) c.dismissed++;
      else if (p.isReviewed) c.reviewed++;
      else c.needs++;
      if (p.source === "flag") c.coach++;
      else c.auto++;
      if (p.hasDrill) c.drill++;
    }
    return c;
  }, [points]);

  const visible = useMemo(() => {
    switch (filter) {
      case "needs":
        return points.filter((p) => !p.isReviewed && !p.isDismissed);
      case "coach":
        return points.filter((p) => p.source === "flag");
      case "auto":
        return points.filter((p) => p.source === "auto");
      case "drill":
        return points.filter((p) => p.hasDrill);
      default:
        return points;
    }
  }, [points, filter]);

  function handleAction(p: ReviewPoint) {
    if (p.action === "restore") {
      const keys = (analysis?.dismissed_loss_keys ?? []).filter(
        (k) => k !== `loss:${p.rallyId}:${p.shotId}`,
      );
      void onSetDismissedLossKeys(keys);
      return;
    }
    if (p.kind === "sequence" && p.sequence) {
      onActivateSequence(p.sequence);
      return;
    }
    if (p.shot) {
      onJumpToShot(p.shot);
    }
  }

  if (points.length === 0) return null;

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid #e2e2e2",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* Counts header (Option C) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "10px 14px",
          borderBottom: "1px solid #e2e2e2",
          background: "#fafbff",
        }}
      >
        <span>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#333", marginRight: 3 }}>
            {counts.all}
          </span>
          <span style={labelStyle}>review points</span>
        </span>
        <span style={{ width: 1, background: "#e2e2e2", height: 20 }} />
        <span style={labelStyle}>
          {counts.reviewed} reviewed · {counts.needs} untouched
          {counts.dismissed > 0 && ` · ${counts.dismissed} dismissed`}
        </span>
      </div>

      {/* Filter chips */}
      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          padding: "8px 14px",
          borderBottom: "1px solid #e2e2e2",
          background: "#fafafa",
          flexWrap: "wrap",
        }}
      >
        <span style={{ ...labelStyle, marginRight: 2 }}>Filter:</span>
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
          All <span style={tagStyle(filter === "all")}>{counts.all}</span>
        </FilterChip>
        <FilterChip active={filter === "needs"} onClick={() => setFilter("needs")}>
          Needs review <span style={tagStyle(filter === "needs")}>{counts.needs}</span>
        </FilterChip>
        <FilterChip active={filter === "coach"} onClick={() => setFilter("coach")}>
          ⚑ Coach <span style={tagStyle(filter === "coach")}>{counts.coach}</span>
        </FilterChip>
        <FilterChip active={filter === "auto"} onClick={() => setFilter("auto")}>
          ● Auto <span style={tagStyle(filter === "auto")}>{counts.auto}</span>
        </FilterChip>
        <FilterChip active={filter === "drill"} onClick={() => setFilter("drill")}>
          With drill <span style={tagStyle(filter === "drill")}>{counts.drill}</span>
        </FilterChip>
      </div>

      {/* Rows */}
      {visible.length === 0 ? (
        <div style={{ padding: 16, fontSize: 13, color: "#999", textAlign: "center" }}>
          No review points match this filter.
        </div>
      ) : (
        <div>
          {visible.map((p) => (
            <Row key={p.id} p={p} onAction={() => handleAction(p)} />
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Row

function Row({
  p,
  onAction,
}: {
  p: ReviewPoint;
  onAction: () => void;
}) {
  const needs = !p.isReviewed && !p.isDismissed;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "26px 1fr 90px",
        alignItems: "center",
        gap: 12,
        padding: "10px 14px",
        borderBottom: "1px solid #f0f0f0",
        boxShadow: needs ? "inset 3px 0 0 #1a73e8" : undefined,
        opacity: p.isDismissed ? 0.55 : 1,
      }}
    >
      {/* Left rail: source glyph */}
      <SrcGlyph source={p.source} />

      {/* Primary column: headline → optional note → footer */}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            fontSize: 13,
            color: "#333",
            fontWeight: 600,
          }}
        >
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: "0 1 auto",
            }}
          >
            {p.playerName}
          </span>
          <div
            style={{
              display: "flex",
              gap: 4,
              alignItems: "center",
              minHeight: 16, // reserved even when empty so rows stay aligned
            }}
          >
            {p.contextSize != null && (
              <Chip
                bg="#f5f0ff"
                color="#7c3aed"
                title={`Sequence of ${p.contextSize} shots`}
              >
                ▤ {p.contextSize} shots
              </Chip>
            )}
            {p.hasDrill && (
              <Chip bg="#e6f4ea" color="#1e7e34" title="Drill attached">
                drill
              </Chip>
            )}
          </div>
        </div>
        {p.note && (
          <div
            style={{
              fontSize: 12,
              color: "#666",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontStyle: p.isDismissed ? "italic" : "normal",
            }}
          >
            {p.note}
          </div>
        )}
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            fontSize: 11,
            color: "#999",
            marginTop: 3,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <span>{formatMs(p.startMs)}</span>
          <span style={{ color: "#666" }}>{p.shotType ?? "shot"}</span>
          <span>rally {p.rallyIndex + 1}</span>
        </div>
      </div>

      {/* Right rail: action */}
      <button
        onClick={onAction}
        style={{
          padding: "5px 10px",
          fontSize: 11,
          fontWeight: 600,
          borderRadius: 4,
          border: "1px solid #e2e2e2",
          background: "#fff",
          color: "#666",
          cursor: "pointer",
          fontFamily: "inherit",
          whiteSpace: "nowrap",
          justifySelf: "end",
        }}
      >
        {p.action === "review" ? "Review" : p.action === "restore" ? "Restore" : "Open"}
      </button>
    </div>
  );
}

function SrcGlyph({ source }: { source: Source }) {
  const isCoach = source === "flag";
  return (
    <span
      style={{
        width: 22,
        height: 22,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        fontWeight: 700,
        background: isCoach ? "#fff3cd" : "#fdebea",
        color: isCoach ? "#856404" : "#b91c1c",
      }}
      aria-label={isCoach ? "Coach-flagged" : "Auto-detected"}
    >
      {isCoach ? "⚑" : "●"}
    </span>
  );
}

function Chip({
  bg,
  color,
  title,
  children,
}: {
  bg: string;
  color: string;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      style={{
        padding: "1px 6px",
        borderRadius: 3,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.3,
        textTransform: "uppercase",
        background: bg,
        color,
      }}
    >
      {children}
    </span>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 10px",
        fontSize: 11,
        fontWeight: 600,
        borderRadius: 999,
        background: active ? "#e8f0fe" : "#fff",
        border: `1px solid ${active ? "#c6dafc" : "#e2e2e2"}`,
        color: active ? "#1a73e8" : "#666",
        cursor: "pointer",
        fontFamily: "inherit",
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      {children}
    </button>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#666",
  textTransform: "uppercase",
  letterSpacing: 0.4,
};

function tagStyle(active: boolean): React.CSSProperties {
  return {
    padding: "0 5px",
    fontSize: 9,
    background: active ? "#fff" : "#f4f4f5",
    borderRadius: 999,
    color: active ? "#1a73e8" : "#666",
    fontWeight: 700,
  };
}
