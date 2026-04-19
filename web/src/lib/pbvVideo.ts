/**
 * PB Vision videos are served via Mux. Each video has a Mux playback ID
 * (~47 chars). We store it in games.mux_playback_id.
 *
 * If a coach pastes a full pb.vision URL, extract the video ID from it
 * for display. The playback ID must be entered separately (or scraped
 * from the page, which requires authentication).
 */

/** Convert ms to "mm:ss" display */
export function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

/**
 * Extract a Mux playback ID from various inputs:
 * - Raw playback ID (47 chars alphanumeric)
 * - Full stream.mux.com URL: https://stream.mux.com/{id}.m3u8
 * - If user pastes a pb.vision URL, we can't auto-extract (Firestore auth required)
 *   so return null and UI asks for playback ID directly.
 */
export function parsePlaybackId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // stream.mux.com URL
  const muxMatch = trimmed.match(/stream\.mux\.com\/([a-zA-Z0-9]{20,60})(?:\.|\/|$)/);
  if (muxMatch) return muxMatch[1];

  // Raw ID: alphanumeric, 20-60 chars, no protocol/slashes
  if (/^[a-zA-Z0-9]{20,60}$/.test(trimmed)) return trimmed;

  return null;
}

/**
 * Extract the PB Vision video ID from a pb.vision URL.
 * e.g. "https://pb.vision/video/ocpcqffh9dwt/0/overview" → "ocpcqffh9dwt"
 */
export function parsePbVisionVideoId(url: string): string | null {
  const m = url.match(/pb\.vision\/video\/([a-zA-Z0-9]+)/);
  return m?.[1] ?? null;
}

/** Build Mux poster URL (public) from PB Vision video ID */
export function pbvPosterUrl(pbvisionVideoId: string, bucket = "pbv-pro"): string {
  return `https://storage.googleapis.com/${bucket}/${pbvisionVideoId}/poster.jpg`;
}
