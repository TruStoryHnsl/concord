/**
 * Concord launch animation / boot buffer (INS-023).
 *
 * Timing coordinator — *renders nothing*. The visible splash is the
 * #boot-splash block in client/index.html, which is already painted
 * by the time React even evaluates this module. Rendering a second
 * visual layer here caused two regressions:
 *
 *   1. A fresh <img src="/boot-splash.webp"> in React's tree starts
 *      the animated WebP decode from frame 0, so when the HTML
 *      splash faded and React's splash faded in, the motion visibly
 *      restarted.
 *   2. Two stacked overlays with independent fade schedules made
 *      the splash flicker during the handoff window.
 *
 * This component now just holds the *timing* state machine: it waits
 * until (a) `minimumDurationMs` has elapsed AND (b) `isLoading` has
 * flipped false, then triggers `handoffBootSplash()` which starts the
 * HTML splash's own CSS fade, then fires `onDone` after the fade
 * completes so the caller can unmount us.
 */
import { useEffect, useRef, useState } from "react";
import { handoffBootSplash } from "../bootSplash";

export interface LaunchAnimationProps {
  /** Splash stays up while true. Once false AND min time elapsed, dismisses. */
  isLoading: boolean;
  /** Fires exactly once, after the splash fade completes. */
  onDone?: () => void;
  /** Minimum visible duration in ms. Default 1200. */
  minimumDurationMs?: number;
  /** Test seam for fake timers. */
  setTimeoutFn?: typeof window.setTimeout;
}

type Phase = "showing" | "fading" | "done";
const FADE_DURATION_MS = 420;

export function LaunchAnimation({
  isLoading,
  onDone,
  minimumDurationMs = 1200,
  setTimeoutFn,
}: LaunchAnimationProps) {
  const [phase, setPhase] = useState<Phase>("showing");
  const [minElapsed, setMinElapsed] = useState(false);
  const fadeTimerRef = useRef<number | null>(null);
  const minTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (minTimerRef.current !== null) window.clearTimeout(minTimerRef.current);
      if (fadeTimerRef.current !== null) window.clearTimeout(fadeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const scheduler = setTimeoutFn ?? window.setTimeout;
    minTimerRef.current = scheduler(
      () => setMinElapsed(true),
      minimumDurationMs,
    ) as unknown as number;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== "showing") return;
    if (!minElapsed || isLoading) return;
    if (fadeTimerRef.current !== null) return;

    setPhase("fading");
    handoffBootSplash();

    const scheduler = setTimeoutFn ?? window.setTimeout;
    fadeTimerRef.current = scheduler(() => {
      fadeTimerRef.current = null;
      setPhase("done");
      onDone?.();
    }, FADE_DURATION_MS) as unknown as number;
  }, [minElapsed, isLoading, phase, onDone, setTimeoutFn]);

  return null;
}
