/**
 * Rally-loss categorization — shared by ReasonsForLosingRally + CoachReviewPage.
 *
 * Derives "why did this team lose the rally" by looking at the final shot's
 * err field plus shot type context.
 */
import type { RallyShot } from "../types/database";

export type ReasonId =
  | "missed_serve"
  | "missed_return"
  | "missed_3rd_drop"
  | "net"
  | "out"
  | "short"
  | "unforced"
  | "forced"
  | "popup";

export const REASON_LABELS: Record<ReasonId, string> = {
  missed_serve: "Missed serve",
  missed_return: "Missed return",
  missed_3rd_drop: "Missed 3rd drop",
  net: "Net / tape",
  out: "Hit out",
  short: "Short",
  unforced: "Unforced error",
  forced: "Forced fault",
  popup: "Popup exploited",
};

export function teamOf(playerIndex: number | null | undefined): 0 | 1 | null {
  if (playerIndex == null) return null;
  return playerIndex < 2 ? 0 : 1;
}

/**
 * Returns the reason code AND the shot that attribution hangs on
 * (the final shot for most cases; the popup shot for popup cases).
 */
export function categorizeRallyLoss(
  rallyShots: RallyShot[],
  losingTeam: 0 | 1,
): { reason: ReasonId; attributedShot: RallyShot } | null {
  const finalShot = rallyShots[rallyShots.length - 1];
  if (!finalShot) return null;
  const raw = (finalShot.raw_data ?? {}) as {
    err?: {
      f?: { n?: number; out?: unknown; sh?: number };
      uf?: number;
      pop?: number;
    };
  };
  const err = raw.err;
  if (!err) return null;

  const finalShotTeam = teamOf(finalShot.player_index);
  const lostByFinalShot = finalShotTeam === losingTeam;

  // Popup exploited: winning-team putaway off a losing-team popup
  if (err.pop && !lostByFinalShot) {
    const popupShot = rallyShots[rallyShots.length - 2];
    if (!popupShot) return null;
    if (teamOf(popupShot.player_index) !== losingTeam) return null;
    return { reason: "popup", attributedShot: popupShot };
  }

  if (!lostByFinalShot) return null;

  if (finalShot.shot_type === "serve")
    return { reason: "missed_serve", attributedShot: finalShot };
  if (finalShot.shot_type === "return")
    return { reason: "missed_return", attributedShot: finalShot };
  if (
    finalShot.shot_index === 2 &&
    (finalShot.shot_type === "drop" ||
      finalShot.shot_type === "third" ||
      finalShot.shot_type === "third_drops")
  ) {
    return { reason: "missed_3rd_drop", attributedShot: finalShot };
  }

  if (err.f?.n) return { reason: "net", attributedShot: finalShot };
  if (err.f?.out) return { reason: "out", attributedShot: finalShot };
  if (err.f?.sh) return { reason: "short", attributedShot: finalShot };
  if (err.uf === 1) return { reason: "unforced", attributedShot: finalShot };
  return { reason: "forced", attributedShot: finalShot };
}

/**
 * Build the auto-sequence shot IDs for a given rally loss: the attributed
 * shot and up to `contextShots` prior shots in the same rally, ordered.
 */
export function buildLossSequence(
  rallyShots: RallyShot[],
  attributedShot: RallyShot,
  contextShots = 4,
): string[] {
  const sorted = [...rallyShots].sort((a, b) => a.shot_index - b.shot_index);
  const idx = sorted.findIndex((s) => s.id === attributedShot.id);
  if (idx === -1) return [attributedShot.id];
  const start = Math.max(0, idx - contextShots);
  return sorted.slice(start, idx + 1).map((s) => s.id);
}
