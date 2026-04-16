/**
 * LaunchAnimation — full-screen branded intro displayed on every app boot and
 * page reload, across all platforms (web, Tauri desktop, mobile).
 *
 * Animation sequence:
 *   0–300ms   Logo + wordmark fade in (opacity 0→1, scale 0.85→1.0)
 *   300–700ms Hold at full opacity
 *   700–1000ms Entire overlay fades out (opacity 1→0)
 *
 * After 1000ms `onComplete` is called and the overlay should be removed from
 * the tree. The overlay uses `pointer-events: none` from 700ms onward so it
 * does not block clicks during the fade-out.
 */

import { useEffect, useRef, useState } from "react";

interface LaunchAnimationProps {
  /** Called when the animation has finished and the overlay should be hidden. */
  onComplete: () => void;
}

const FADE_IN_DURATION = 300;
const HOLD_DURATION = 400; // 300–700ms
const FADE_OUT_DURATION = 300; // 700–1000ms

// Total: 1000ms
const TOTAL_DURATION = FADE_IN_DURATION + HOLD_DURATION + FADE_OUT_DURATION;

export function LaunchAnimation({ onComplete }: LaunchAnimationProps) {
  // Phase: "in" | "hold" | "out" | "done"
  const [phase, setPhase] = useState<"in" | "hold" | "out" | "done">("in");
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    let holdTimer: ReturnType<typeof setTimeout>;
    let outTimer: ReturnType<typeof setTimeout>;
    let doneTimer: ReturnType<typeof setTimeout>;

    holdTimer = setTimeout(() => setPhase("hold"), FADE_IN_DURATION);
    outTimer = setTimeout(
      () => setPhase("out"),
      FADE_IN_DURATION + HOLD_DURATION,
    );
    doneTimer = setTimeout(() => {
      setPhase("done");
      onCompleteRef.current();
    }, TOTAL_DURATION);

    return () => {
      clearTimeout(holdTimer);
      clearTimeout(outTimer);
      clearTimeout(doneTimer);
    };
  }, []);

  if (phase === "done") return null;

  const overlayOpacity = phase === "out" ? 0 : 1;
  const logoOpacity = phase === "in" ? 1 : 1; // always 1 during in/hold/out — overlay handles exit
  const logoScale = phase === "in" ? 1 : 1; // scale completes within the CSS transition

  // pointer-events off during fade-out so the main UI underneath is interactive
  const pointerEvents = phase === "out" ? "none" : "auto";

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0e0e10",
        opacity: overlayOpacity,
        pointerEvents,
        transition:
          phase === "out"
            ? `opacity ${FADE_OUT_DURATION}ms ease-out`
            : undefined,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "0.75rem",
          animation:
            phase === "in"
              ? `concord-launch-fadein ${FADE_IN_DURATION}ms ease-out both`
              : undefined,
        }}
      >
        {/* Brand mark — stylised "C" */}
        <div
          aria-label="Concord"
          style={{
            width: 64,
            height: 64,
            borderRadius: "50%",
            border: "3px solid #7c6cfc",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#7c6cfc",
            fontSize: "2rem",
            fontWeight: 700,
            fontFamily: "system-ui, sans-serif",
            letterSpacing: "-0.02em",
            userSelect: "none",
          }}
        >
          C
        </div>

        {/* Wordmark */}
        <span
          style={{
            color: "#e2e2e8",
            fontSize: "1.125rem",
            fontWeight: 600,
            fontFamily: "system-ui, sans-serif",
            letterSpacing: "0.04em",
            userSelect: "none",
          }}
        >
          Concord
        </span>
      </div>

      {/* Keyframe injection — avoid creating a style sheet node if SSR */}
      <style>{`
        @keyframes concord-launch-fadein {
          from { opacity: 0; transform: scale(0.85); }
          to   { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
