/**
 * Standalone video page that pairs with AnalyzePage via BroadcastChannel.
 * Drag this tab to a second monitor. The main tab's controls drive it.
 */
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "../supabase";
import { pbvPosterUrl } from "../lib/pbvVideo";
import VideoPlayer, { type VideoPlayerHandle } from "../components/analyze/VideoPlayer";
import type { PopoutMessage } from "../hooks/useVideoPopout";

interface GameRow {
  id: string;
  pbvision_video_id: string;
  pbvision_bucket: string | null;
  mux_playback_id: string | null;
  session_name: string | null;
}

export default function VideoPopoutPage() {
  const { gameId } = useParams();
  const [game, setGame] = useState<GameRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [mainConnected, setMainConnected] = useState(false);

  const videoRef = useRef<VideoPlayerHandle>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;

    (async () => {
      const { data } = await supabase
        .from("games")
        .select(
          "id, pbvision_video_id, pbvision_bucket, mux_playback_id, session_name",
        )
        .eq("id", gameId)
        .single();
      if (!cancelled) {
        setGame(data as GameRow);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [gameId]);

  useEffect(() => {
    if (!gameId) return;
    const ch = new BroadcastChannel(`analyze-video-${gameId}`);
    channelRef.current = ch;

    ch.onmessage = (e: MessageEvent<PopoutMessage>) => {
      const msg = e.data;
      if (!msg || !videoRef.current) return;
      setMainConnected(true);
      switch (msg.type) {
        case "seek":
          videoRef.current.seek(msg.ms);
          break;
        case "play":
          videoRef.current.play();
          break;
        case "pause":
          videoRef.current.pause();
          break;
        case "togglePlay":
          videoRef.current.togglePlay();
          break;
        case "setRate":
          videoRef.current.setPlaybackRate(msg.rate);
          break;
        case "close":
          // Main asked us to close
          window.close();
          break;
      }
    };

    // Announce readiness
    ch.postMessage({ type: "ready" });

    // When this tab unloads, notify main
    const onUnload = () => {
      try {
        ch.postMessage({ type: "closing" });
      } catch {
        // channel may already be closed
      }
    };
    window.addEventListener("beforeunload", onUnload);

    return () => {
      window.removeEventListener("beforeunload", onUnload);
      try {
        ch.postMessage({ type: "closing" });
      } catch {
        // ignore
      }
      ch.close();
      channelRef.current = null;
    };
  }, [gameId]);

  // Broadcast time + paused state at a modest rate
  useEffect(() => {
    const iv = setInterval(() => {
      const ch = channelRef.current;
      const v = videoRef.current;
      if (!ch || !v) return;
      ch.postMessage({ type: "time", ms: v.getCurrentMs() });
      ch.postMessage({ type: "paused", paused: v.isPaused() });
    }, 250);
    return () => clearInterval(iv);
  }, []);

  // Keep document title informative on the OS tab bar
  useEffect(() => {
    document.title = game?.session_name
      ? `Video · ${game.session_name}`
      : "Video popout";
  }, [game]);

  if (loading) {
    return (
      <div style={{ padding: 40, fontFamily: "system-ui", color: "#999" }}>
        Loading…
      </div>
    );
  }
  if (!game) {
    return (
      <div style={{ padding: 40, fontFamily: "system-ui" }}>Game not found.</div>
    );
  }
  if (!game.mux_playback_id) {
    return (
      <div style={{ padding: 40, fontFamily: "system-ui" }}>
        <p>No video linked for this game yet.</p>
        <p style={{ color: "#666", fontSize: 14 }}>
          Link a Mux playback ID on the main analyze page first.
        </p>
      </div>
    );
  }

  const posterUrl = pbvPosterUrl(
    game.pbvision_video_id,
    game.pbvision_bucket ?? "pbv-pro",
  );

  return (
    <div
      style={{
        background: "#000",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui",
      }}
    >
      {/* Thin header */}
      <div
        style={{
          padding: "6px 14px",
          background: "#111",
          color: "#999",
          fontSize: 11,
          display: "flex",
          alignItems: "center",
          gap: 12,
          borderBottom: "1px solid #222",
        }}
      >
        <span style={{ fontWeight: 600, color: "#ddd" }}>
          {game.session_name ?? "Video"}
        </span>
        <span>
          {mainConnected ? (
            <span style={{ color: "#4ade80" }}>● Synced with analyze tab</span>
          ) : (
            <span>○ Waiting for main tab…</span>
          )}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ color: "#777" }}>
          Close this tab to restore the video on the main page.
        </span>
      </div>

      {/* Video fills the rest of the viewport */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 12,
        }}
      >
        <div style={{ width: "100%", maxWidth: 1600 }}>
          <VideoPlayer
            ref={videoRef}
            playbackId={game.mux_playback_id}
            posterUrl={posterUrl}
          />
        </div>
      </div>
    </div>
  );
}
