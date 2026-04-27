/**
 * Session-level Coach Review queue aggregator.
 *
 * Walks every game in a session and builds the unified per-rally queue
 * for one player: flagged moments, coach-tagged sequences, and
 * auto-attributed rally losses, all merged into one chronologically-
 * sortable list. Each item carries its game_id so the page can swap
 * the active Mux playback ID as the coach scrolls between games.
 *
 * Input shape mirrors the per-game CoachReviewPage's data — we accept
 * a `GameBundle` per game in the session and pool them. The mutual-
 * exclusion rules (flag overrides loss; sequence overrides loss; etc.)
 * apply within each game, same as the per-game flow.
 */
import type { Rally, RallyShot } from "../types/database";
import type { AnalysisSequence, FlaggedShot } from "../types/coach";
import {
  buildLossSequence,
  categorizeRallyLoss,
  type ReasonId,
} from "./rallyAnalysis";

export interface SessionReviewPlayer {
  id: string;
  player_index: number;
  team: number;
  display_name: string;
  avatar_url: string | null;
}

export interface GameBundle {
  gameId: string;
  /** Numeric label parsed from session_name (gm-N / GmN / Game NN).
   *  Used to label items in the queue ("Game 02 · Rally 7"). */
  gameLabel: string;
  /** played_at — used to order games chronologically. */
  playedAt: string;
  rallies: Rally[];
  shots: RallyShot[];
  sequences: AnalysisSequence[];
  flags: FlaggedShot[];
  /** Loss-keys the coach already dismissed at the GAME level (legacy
   *  per-game game_analyses.dismissed_loss_keys). They're filtered out
   *  here too so a dismissal from per-game review carries over. */
  gameDismissedLossKeys: string[];
}

export type ReviewItemKind = "flag" | "sequence" | "loss";

export interface SessionReviewItem {
  kind: ReviewItemKind;
  /** Stable unique id across kinds + games — also the dismissed-keys
   *  format. Per-game shape: "flag:<flag.id>", "seq:<seq.id>",
   *  "loss:<rallyId>:<attributedShotId>". */
  itemKey: string;
  gameId: string;
  gameLabel: string;
  rallyId: string;
  rallyIndex: number;
  /** Only for "loss" items — the categorized reason (3rd-shot drive,
   *  unforced into net, etc.). */
  reason?: ReasonId;
  sequenceShotIds: string[];
  sequenceStartMs: number;
  sequenceEndMs: number;
  /** For flags: the flagged shot id. For losses: the attributed error
   *  shot id. For sequences: the last shot id. */
  attributedShotId: string;
  /** For losses: the auto-matched saved sequence, if any. For
   *  "sequence" kind: the sequence itself (so hydration uniformly
   *  reads from existingSequence). For flags: always null. */
  existingSequence: AnalysisSequence | null;
  scoreAfter: string | null;
  flag?: FlaggedShot;
  sequence?: AnalysisSequence;
}

/** Aggregate every game's queue items into one ordered list for the
 *  selected player. Order: by `playedAt` ascending across games, then
 *  by `rally_index` within a game, then by kind (flags first, then
 *  sequences, then losses) — matches the per-game CoachReviewPage's
 *  default queue ordering. */
export function buildSessionReviewQueue(args: {
  player: SessionReviewPlayer;
  bundles: GameBundle[];
  /** Loss-keys dismissed at the SESSION level (session_analyses.
   *  dismissed_loss_keys). Filtered against itemKey before emitting. */
  sessionDismissedLossKeys: string[];
}): SessionReviewItem[] {
  const { player, bundles, sessionDismissedLossKeys } = args;
  const dismissedAtSession = new Set(sessionDismissedLossKeys);
  const out: SessionReviewItem[] = [];

  // Stable ordering — newer games last. Same convention as the rest
  // of the codebase: played_at primary.
  const orderedBundles = [...bundles].sort((a, b) => {
    return new Date(a.playedAt).getTime() - new Date(b.playedAt).getTime();
  });

  for (const b of orderedBundles) {
    out.push(...buildGameQueueItems(player, b, dismissedAtSession));
  }
  return out;
}

function buildGameQueueItems(
  player: SessionReviewPlayer,
  b: GameBundle,
  dismissedAtSession: Set<string>,
): SessionReviewItem[] {
  const dismissedAtGame = new Set(b.gameDismissedLossKeys);
  const shotsByRally = new Map<string, RallyShot[]>();
  for (const s of b.shots) {
    if (!shotsByRally.has(s.rally_id)) shotsByRally.set(s.rally_id, []);
    shotsByRally.get(s.rally_id)!.push(s);
  }
  for (const [, arr] of shotsByRally) {
    arr.sort((a, x) => a.shot_index - x.shot_index);
  }

  const flaggedShotIds = new Set(b.flags.map((f) => f.shot_id));

  // ── Flags on this player's shots in this game ──
  const flagItems: SessionReviewItem[] = [];
  for (const flag of b.flags) {
    const shot = b.shots.find((s) => s.id === flag.shot_id);
    if (!shot || shot.player_index !== player.player_index) continue;
    const rally = b.rallies.find((r) => r.id === shot.rally_id);
    if (!rally) continue;
    const rs = shotsByRally.get(shot.rally_id) ?? [];
    const seqIds = buildLossSequence(rs, shot, 3);
    const seqShots = seqIds
      .map((id) => rs.find((s) => s.id === id))
      .filter((s): s is RallyShot => !!s);
    if (seqShots.length === 0) continue;

    const existing = b.sequences.find(
      (seq) =>
        seq.rally_id === rally.id &&
        seq.player_id === player.id &&
        seq.shot_ids.length === seqIds.length &&
        seq.shot_ids.every((id) => seqIds.includes(id)),
    ) ?? null;

    flagItems.push({
      kind: "flag",
      itemKey: `flag:${flag.id}`,
      gameId: b.gameId,
      gameLabel: b.gameLabel,
      rallyId: rally.id,
      rallyIndex: rally.rally_index,
      sequenceShotIds: seqIds,
      sequenceStartMs: Math.min(...seqShots.map((s) => s.start_ms)),
      sequenceEndMs: Math.max(...seqShots.map((s) => s.end_ms)),
      attributedShotId: shot.id,
      existingSequence: existing,
      scoreAfter: rallyScoreAfter(rally),
      flag,
    });
  }

  // ── Saved sequences tagged to this player (excluding ones that
  //    will be surfaced as losses below) ──
  const sequenceItems: SessionReviewItem[] = [];
  const sequenceLossOverlap = new Set<string>(); // seq ids whose shots
  // exactly match a soon-to-be-emitted loss; populated by the loss loop.

  // First, compute losses so we know which sequence ids overlap.
  const lossItems: SessionReviewItem[] = [];
  for (const rally of b.rallies) {
    if (rally.winning_team == null) continue;
    const losingTeam = (1 - rally.winning_team) as 0 | 1;
    if (player.team !== losingTeam) continue;
    const rs = shotsByRally.get(rally.id) ?? [];
    const res = categorizeRallyLoss(rs, losingTeam);
    if (!res) continue;
    if (res.attributedShot.player_index !== player.player_index) continue;
    if (flaggedShotIds.has(res.attributedShot.id)) continue;

    const itemKey = `loss:${rally.id}:${res.attributedShot.id}`;
    if (dismissedAtGame.has(itemKey) || dismissedAtSession.has(itemKey)) continue;

    const seqIds = buildLossSequence(rs, res.attributedShot, 4);
    const seqShots = seqIds
      .map((id) => rs.find((s) => s.id === id))
      .filter((s): s is RallyShot => !!s);
    if (seqShots.length === 0) continue;

    const existing = b.sequences.find(
      (seq) =>
        seq.rally_id === rally.id &&
        seq.player_id === player.id &&
        seq.shot_ids.length === seqIds.length &&
        seq.shot_ids.every((id) => seqIds.includes(id)),
    ) ?? null;
    if (existing) sequenceLossOverlap.add(existing.id);

    lossItems.push({
      kind: "loss",
      itemKey,
      gameId: b.gameId,
      gameLabel: b.gameLabel,
      rallyId: rally.id,
      rallyIndex: rally.rally_index,
      reason: res.reason,
      sequenceShotIds: seqIds,
      sequenceStartMs: Math.min(...seqShots.map((s) => s.start_ms)),
      sequenceEndMs: Math.max(...seqShots.map((s) => s.end_ms)),
      attributedShotId: res.attributedShot.id,
      existingSequence: existing,
      scoreAfter: rallyScoreAfter(rally),
    });
  }

  // Now standalone sequences (not the loss-built ones).
  for (const seq of b.sequences) {
    const tagged =
      seq.player_id === player.id ||
      (seq.player_ids ?? []).includes(player.id);
    if (!tagged) continue;
    if (sequenceLossOverlap.has(seq.id)) continue;
    const rally = b.rallies.find((r) => r.id === seq.rally_id);
    if (!rally) continue;
    const seqShots = seq.shot_ids
      .map((id) => b.shots.find((s) => s.id === id))
      .filter((s): s is RallyShot => !!s)
      .sort((a, x) => a.start_ms - x.start_ms);
    if (seqShots.length === 0) continue;

    sequenceItems.push({
      kind: "sequence",
      itemKey: `seq:${seq.id}`,
      gameId: b.gameId,
      gameLabel: b.gameLabel,
      rallyId: rally.id,
      rallyIndex: rally.rally_index,
      sequenceShotIds: seq.shot_ids,
      sequenceStartMs: seqShots[0].start_ms,
      sequenceEndMs: seqShots[seqShots.length - 1].end_ms,
      attributedShotId: seqShots[seqShots.length - 1].id,
      existingSequence: seq,
      sequence: seq,
      scoreAfter: rallyScoreAfter(rally),
    });
  }

  // Per-game order: flags first, then sequences, then losses, each
  // ordered by rally_index. Mirrors the per-game CoachReviewPage.
  const order: Record<ReviewItemKind, number> = { flag: 0, sequence: 1, loss: 2 };
  const all = [...flagItems, ...sequenceItems, ...lossItems];
  all.sort((a, x) => {
    const k = order[a.kind] - order[x.kind];
    if (k !== 0) return k;
    return a.rallyIndex - x.rallyIndex;
  });
  return all;
}

function rallyScoreAfter(rally: Rally): string | null {
  if (rally.score_team0 == null || rally.score_team1 == null) return null;
  return `${rally.score_team0}–${rally.score_team1}`;
}
