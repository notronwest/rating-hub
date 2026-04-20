/**
 * Sync the Analyze page's video with a second browser tab.
 *
 * Flow:
 *   - Main page calls `openPopout()` → opens /video-popout/:gameId in a new tab
 *     and sets popoutActive = true.
 *   - Both sides open a BroadcastChannel named `analyze-video-<gameId>`.
 *   - Popout renders the Mux player and broadcasts its current time + paused
 *     state. It listens for seek/play/pause/rate commands.
 *   - Main page's controls post commands to the channel instead of calling
 *     the local Mux player (which is unmounted).
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
  /** Current playback ms (from either local or remote). */
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

  // Open / close the BroadcastChannel whenever popoutActive flips
  useEffect(() => {
    if (!popoutActive) return;
    const ch = new BroadcastChannel(`analyze-video-${gameId}`);
    channelRef.current = ch;

    ch.onmessage = (e: MessageEvent<PopoutMessage>) => {
      const msg = e.data;
      if (!msg) return;
      if (msg.type === "time") setCurrentMs(msg.ms);
      else if (msg.type === "paused") setIsPaused(msg.paused);
      else if (msg.type === "closing") setPopoutActive(false);
      else if (msg.type === "ready") {
        // Popout came online — no-op, but in future we could sync rate
      }
    };

    return () => {
      ch.close();
      channelRef.current = null;
    };
  }, [popoutActive, gameId]);

  // Detect if the popout window was closed manually
  useEffect(() => {
    if (!popoutActive) return;
    const iv = setInterval(() => {
      if (popoutWindowRef.current?.closed) {
        setPopoutActive(false);
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [popoutActive]);

  function openPopout() {
    const w = window.open(
      `/video-popout/${gameId}`,
      `video-popout-${gameId}`,
      "noopener=false",
    );
    if (!w) {
      alert(
        "Popup blocked. Allow popups for this site, or open /video-popout/" +
          gameId +
          " in a new tab manually.",
      );
      return;
    }
    popoutWindowRef.current = w;
    setPopoutActive(true);
  }

  function closePopout() {
    channelRef.current?.postMessage({ type: "close" });
    // Give popout a moment to receive the message, then close the window
    setTimeout(() => {
      popoutWindowRef.current?.close();
      popoutWindowRef.current = null;
      setPopoutActive(false);
    }, 100);
  }

  // Unified controller: routes calls to either the local player or the channel
  const controller: VideoPlayerHandle = useMemo(
    () => ({
      seek: (ms) => {
        if (popoutActive) channelRef.current?.postMessage({ type: "seek", ms });
        else localRef.current?.seek(ms);
      },
      getCurrentMs: () => {
        if (popoutActive) return currentMs;
        return localRef.current?.getCurrentMs() ?? 0;
      },
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
      isPaused: () => {
        if (popoutActive) return isPaused;
        return localRef.current?.isPaused() ?? true;
      },
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
