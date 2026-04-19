import { forwardRef, useImperativeHandle, useRef, useEffect } from "react";
import MuxPlayer from "@mux/mux-player-react";
import type MuxPlayerElement from "@mux/mux-player";

export interface VideoPlayerHandle {
  seek: (ms: number) => void;
  getCurrentMs: () => number;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setPlaybackRate: (rate: number) => void;
  isPaused: () => boolean;
}

interface Props {
  playbackId: string;
  posterUrl?: string;
  onTimeUpdate?: (ms: number) => void;
}

const VideoPlayer = forwardRef<VideoPlayerHandle, Props>(function VideoPlayer(
  { playbackId, posterUrl, onTimeUpdate },
  ref,
) {
  const playerRef = useRef<MuxPlayerElement>(null);

  useImperativeHandle(ref, () => ({
    seek: (ms: number) => {
      if (playerRef.current) playerRef.current.currentTime = ms / 1000;
    },
    getCurrentMs: () => Math.round((playerRef.current?.currentTime ?? 0) * 1000),
    play: () => {
      void playerRef.current?.play();
    },
    pause: () => playerRef.current?.pause(),
    togglePlay: () => {
      if (!playerRef.current) return;
      if (playerRef.current.paused) void playerRef.current.play();
      else playerRef.current.pause();
    },
    setPlaybackRate: (rate: number) => {
      if (playerRef.current) playerRef.current.playbackRate = rate;
    },
    isPaused: () => !!playerRef.current?.paused,
  }));

  useEffect(() => {
    const el = playerRef.current;
    if (!el || !onTimeUpdate) return;
    const handler = () => onTimeUpdate(Math.round(el.currentTime * 1000));
    el.addEventListener("timeupdate", handler);
    return () => el.removeEventListener("timeupdate", handler);
  }, [onTimeUpdate]);

  return (
    <div style={{ borderRadius: 10, overflow: "hidden", background: "#000" }}>
      <MuxPlayer
        ref={playerRef}
        playbackId={playbackId}
        poster={posterUrl}
        accentColor="#1a73e8"
        style={{ display: "block", width: "100%", aspectRatio: "16/9" }}
      />
    </div>
  );
});

export default VideoPlayer;
