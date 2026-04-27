/**
 * Session-game ordering helpers.
 *
 * PB Vision's per-game `played_at` timestamp can drift by seconds
 * within a session (batch-import side effect), so sorting by timestamp
 * alone produces sequences like "Game 6, 7, 2, 5". Across the codebase
 * we sort games by a composite key — date primary, gm-N suffix
 * secondary — and rely on `parseGameIdx` to extract that suffix from
 * `session_name` no matter which naming convention was active when
 * the row landed.
 *
 * Three formats coexist in the wild:
 *   "...gm-N..."     newer raw-PBV (lowercase + hyphen, e.g.
 *                    "ma-js-tb-rs-2026-04-23-gm-3")
 *   "Game 06"        pre-prettified imports
 *   "...Gm N..."     older session_name convention without hyphen
 *                    (e.g. "Rich/Sarah/Amy/Todd Gm1")
 */

export function parseGameIdx(name: string | null | undefined): number | null {
  if (!name) return null;
  const gm = name.match(/gm-(\d+)/i);
  if (gm) return parseInt(gm[1], 10);
  const game = name.match(/\bGame\s+0*(\d+)/i);
  if (game) return parseInt(game[1], 10);
  // `\bGm\s*(\d+)` (case-sensitive on Gm so we don't double-match the
  // lowercase `gm-N` already covered above).
  const gmShort = name.match(/\bGm\s*(\d+)/);
  if (gmShort) return parseInt(gmShort[1], 10);
  return null;
}

/** Composite sort key: YYYY-MM-DD primary, zero-padded gm-N secondary.
 *  Lexically sortable both directions. */
export function gameSortKey(g: {
  played_at: string | null | undefined;
  session_name: string | null | undefined;
}): string {
  const date = (g.played_at ?? "").slice(0, 10);
  const idx = parseGameIdx(g.session_name) ?? 0;
  return `${date}|${String(idx).padStart(4, "0")}`;
}
