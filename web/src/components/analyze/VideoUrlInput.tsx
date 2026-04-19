import { useState } from "react";
import { parsePlaybackId } from "../../lib/pbvVideo";

interface Props {
  pbvisionVideoId: string;
  onSubmit: (playbackId: string) => Promise<void>;
}

/**
 * Bookmarklet: runs on a pb.vision video page, grabs the Mux playback ID
 * and PB Vision video ID, and opens our app's /pbv-link page to auto-save.
 *
 * Re-derive the origin at click time so the bookmarklet works in dev + prod
 * whichever app URL created it.
 */
function buildBookmarklet(appOrigin: string): string {
  const js = `(function(){var p=document.querySelector('mux-player');var id=p&&p.getAttribute('playback-id');var m=location.pathname.match(/\\/video\\/([^/]+)/);var vid=m&&m[1];if(!id||!vid){alert('Open a pb.vision video page (and wait for it to load) first.');return;}window.open('${appOrigin}/pbv-link?pbv='+encodeURIComponent(vid)+'&mux='+encodeURIComponent(id),'_blank');})();`;
  return `javascript:${encodeURIComponent(js)}`;
}

export default function VideoUrlInput({ pbvisionVideoId, onSubmit }: Props) {
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const appOrigin =
    typeof window !== "undefined" ? window.location.origin : "";
  const bookmarkletHref = buildBookmarklet(appOrigin);
  const pbvPageUrl = `https://pb.vision/video/${pbvisionVideoId}/0/overview`;

  async function handlePaste() {
    setError(null);
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        setError("Clipboard is empty.");
        return;
      }
      const id = parsePlaybackId(text);
      if (!id) {
        setError("Clipboard doesn't contain a valid Mux playback ID.");
        return;
      }
      setInput(id);
      await saveId(id);
    } catch (e) {
      setError(
        e instanceof Error
          ? `Clipboard access failed: ${e.message}`
          : "Clipboard access failed",
      );
    }
  }

  async function saveId(id: string) {
    setSaving(true);
    try {
      await onSubmit(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleManualSave() {
    setError(null);
    const id = parsePlaybackId(input);
    if (!id) {
      setError("Couldn't recognize a Mux playback ID.");
      return;
    }
    await saveId(id);
  }

  return (
    <div
      style={{
        padding: 24,
        background: "#f8f9fa",
        border: "1px dashed #ccc",
        borderRadius: 10,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
        Connect the video
      </div>
      <div style={{ fontSize: 13, color: "#666", marginBottom: 16 }}>
        This game's video lives on pb.vision. Link it once and you're set.
      </div>

      {/* Recommended: bookmarklet flow */}
      <div
        style={{
          padding: 16,
          background: "#fff",
          border: "1px solid #e2e2e2",
          borderRadius: 8,
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          One-time setup (easiest)
        </div>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8, color: "#333" }}>
          <li>
            Drag this button to your bookmarks bar:{" "}
            <a
              href={bookmarkletHref}
              onClick={(e) => {
                e.preventDefault();
                alert(
                  "Drag this button to your bookmarks bar — don't click it. Once it's saved there, click it from any pb.vision video page.",
                );
              }}
              draggable
              style={{
                display: "inline-block",
                padding: "4px 10px",
                marginLeft: 4,
                fontSize: 12,
                fontWeight: 600,
                background: "#1a73e8",
                color: "#fff",
                borderRadius: 4,
                textDecoration: "none",
                cursor: "grab",
                verticalAlign: "middle",
              }}
            >
              📌 PBV Grab
            </a>
          </li>
          <li>
            Open{" "}
            <a
              href={pbvPageUrl}
              target="_blank"
              rel="noreferrer"
              style={{ color: "#1a73e8", textDecoration: "none" }}
            >
              this game's pb.vision page ↗
            </a>{" "}
            and wait for the video to load
          </li>
          <li>
            Click the <strong>📌 PBV Grab</strong> bookmarklet — it auto-saves the link
          </li>
        </ol>
      </div>

      {/* Fallback: manual paste */}
      <div style={{ textAlign: "center", marginTop: 12 }}>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            fontSize: 12,
            color: "#888",
            background: "none",
            border: "none",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          {showAdvanced ? "Hide" : "Or"} paste playback ID manually
        </button>
      </div>

      {showAdvanced && (
        <div style={{ marginTop: 12, padding: 14, background: "#fff", border: "1px solid #e2e2e2", borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
            Paste the 47-char Mux playback ID (or a stream.mux.com URL)
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <input
              type="text"
              placeholder="playback ID"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleManualSave();
              }}
              style={{
                flex: 1,
                padding: "7px 10px",
                fontSize: 13,
                borderRadius: 6,
                border: "1px solid #ddd",
                outline: "none",
                fontFamily: "monospace",
              }}
            />
            <button
              onClick={handleManualSave}
              disabled={saving || !input.trim()}
              style={{
                padding: "7px 14px",
                fontSize: 13,
                fontWeight: 600,
                background: saving || !input.trim() ? "#9ab8e8" : "#1a73e8",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                cursor: saving || !input.trim() ? "not-allowed" : "pointer",
              }}
            >
              {saving ? "…" : "Save"}
            </button>
          </div>
          <button
            onClick={handlePaste}
            disabled={saving}
            style={{
              padding: "5px 12px",
              fontSize: 12,
              background: "#fff",
              color: "#555",
              borderTop: "1px solid #ddd",
              borderBottom: "1px solid #ddd",
              borderLeft: "1px solid #ddd",
              borderRight: "1px solid #ddd",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            📋 Paste from clipboard
          </button>
        </div>
      )}

      {error && (
        <div style={{ color: "crimson", fontSize: 12, marginTop: 8 }}>{error}</div>
      )}
    </div>
  );
}
