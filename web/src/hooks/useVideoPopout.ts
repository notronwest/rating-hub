/**
 * Sync the Analyze page's video with a second browser tab.
 *
 * Main always keeps a BroadcastChannel open so the popout can talk as soon
 * as it loads. The popout's "ready" message flips popoutActive on, and
 * "closing" flips it off. No time is spent waiting for the channel to
 * open after a click.
 *
 * Messages:
 *   main → popout:   { type: 'seek', ms } | { type: 'play' } | { type: 'pause' }
 *                    | { type: 'togglePlay' } | { type: 'setRate', rate } | { type: 'close' }
 *   popout → main:   { type: 'ready' } | { type: 'time', ms } | { type: 'paused', paused }
 *                    | { type: 'closing' }
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import type { VideoPlayerHandle } from "../components/analyze/VideoPlayer";

export interface VideoPopoutState {
  popoutActive: boolean;
  openPopout: () => void;
  closePopout: () => void;
  /** Unified controller — use this instead of the local ref. */
  controller: VideoPlayerHandle;
  currentMs: number;
  setCurrentMs: Dispatch<SetStateAction<number>>;
  isPaused: boolean;
  setIsPaused: Dispatch<SetStateAction<boolean>>;
}

export function useVideoPopout(
  gameId: string,
  localRef: RefObject<VideoPlayerHandle | null>,
): VideoPopoutState {
  const [popoutActive, setPopoutActive] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [isPaused, setIsPaused] = useState(true);

  const channelRef = useRef<BroadcastChannel | null>(null);
  const popoutWindowRef = useRef<Window | null>(null);

  // Keep a BroadcastChannel open for the lifetime of the page so the popout
  // can communicate from the moment it loads.
  useEffect(() => {
    if (!gameId) return;
    const ch = new BroadcastChannel(`analyze-video-${gameId}`);
    channelRef.current = ch;
    console.log("[popout] main: channel opened", ch.name);

    ch.onmessage = (e: MessageEvent<PopoutMessage>) => {
      const msg = e.data;
      if (!msg) return;
      console.log("[popout] main ← ", msg.type);
      if (msg.type === "time") {
        setCurrentMs(msg.ms);
      } else if (msg.type === "paused") {
        setIsPaused(msg.paused);
      } else if (msg.type === "ready") {
        setPopoutActive(true);
      } else if (msg.type === "closing") {
        setPopoutActive(false);
      }
    };

    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, [gameId]);

  // If the popout window is closed manually (no beforeunload fired), detect it
  useEffect(() => {
    if (!popoutActive) return;
    const iv = setInterval(() => {
      if (popoutWindowRef.current && popoutWindowRef.current.closed) {
        console.log("[popout] main: detected popout window closed");
        popoutWindowRef.current = null;
        setPopoutActive(false);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [popoutActive]);

  function openPopout() {
    if (!gameId) return;
    const url = `${window.location.origin}/video-popout/${gameId}`;
    console.log("[popout] main: opening", url);
    const w = window.open(url, `video-popout-${gameId}`);
    if (!w) {
      alert(
        "Popup blocked. Allow popups for this site, or open the link in a new tab manually:\n\n" +
          url,
      );
      return;
    }
    popoutWindowRef.current = w;
    // Optimistic: flip to active now; will be confirmed by the popout's "ready"
    setPopoutActive(true);
  }

  function closePopout() {
    console.log("[popout] main: closing popout");
    channelRef.current?.postMessage({ type: "close" });
    setTimeout(() => {
      try {
        popoutWindowRef.current?.close();
      } catch {
        // ignore
      }
      popoutWindowRef.current = null;
      setPopoutActive(false);
    }, 100);
  }

  // Unified controller
  const controller: VideoPlayerHandle = useMemo(
    () => ({
      seek: (ms) => {
        if (popoutActive) {
          console.log("[popout] main → seek", ms);
          channelRef.current?.postMessage({ type: "seek", ms });
        } else {
          localRef.current?.seek(ms);
        }
      },
      getCurrentMs: () =>
        popoutActive ? currentMs : localRef.current?.getCurrentMs() ?? 0,
      play: () => {
        if (popoutActive) channelRef.current?.postMessage({ type: "play" });
        else localRef.current?.play();
      },
      pause: () => {
        if (popoutActive) channelRef.current?.postMessage({ type: "pause" });
        else localRef.current?.pause();
      },
      togglePlay: () => {
        if (popoutActive)
          channelRef.current?.postMessage({ type: "togglePlay" });
        else localRef.current?.togglePlay();
      },
      setPlaybackRate: (rate) => {
        if (popoutActive)
          channelRef.current?.postMessage({ type: "setRate", rate });
        else localRef.current?.setPlaybackRate(rate);
      },
      isPaused: () =>
        popoutActive ? isPaused : localRef.current?.isPaused() ?? true,
    }),
    [popoutActive, currentMs, isPaused, localRef],
  );

  return {
    popoutActive,
    openPopout,
    closePopout,
    controller,
    currentMs,
    setCurrentMs,
    isPaused,
    setIsPaused,
  };
}

export type PopoutMessage =
  | { type: "seek"; ms: number }
  | { type: "play" }
  | { type: "pause" }
  | { type: "togglePlay" }
  | { type: "setRate"; rate: number }
  | { type: "close" }
  | { type: "ready" }
  | { type: "time"; ms: number }
  | { type: "paused"; paused: boolean }
  | { type: "closing" };
