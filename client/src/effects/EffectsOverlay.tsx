// EffectsOverlay — the single fullscreen canvas that plays every
// screenspace effect. Mounted once at the app root (see App.tsx). It:
//
//   1. Owns a pointer-events-none, fixed, top-layer <canvas> sized to the
//      viewport (DPR-aware) so effects never block clicks.
//   2. Subscribes to the effects store queue; each new QueuedEffect spins
//      up the matching built-in renderer.
//   3. Runs a single requestAnimationFrame loop that ticks all live
//      renderers, clears+parks the canvas when none remain (zero idle
//      cost — no rAF churning over an empty screen).
//   4. Wires screen-shake to a transform on the app shell element and
//      always resets it on teardown.
//   5. Respects reduced-motion: OS `prefers-reduced-motion` OR the
//      in-app "Reduce screen effects" toggle suppresses the *visual*
//      (paired sound, handled elsewhere, still plays).
//
// The component renders nothing visible itself beyond the canvas; the
// rendering is imperative for performance (no React re-render per frame).

import { useEffect, useRef } from "react";
import { useSettingsStore } from "../stores/settings";
import { useEffectsStore } from "./store";
import { resolveEffect } from "./registry";
import { setShakeApplier } from "./builtins/screenShake";
import type { EffectFrameContext, EffectRenderer } from "./types";

interface LiveInstance {
  seq: number;
  renderer: EffectRenderer;
  startedAt: number;
  lastFrameAt: number;
}

/** Hard cap so a runaway/looping renderer can never pin the canvas open. */
const MAX_INSTANCE_LIFETIME_MS = 12_000;
/** Clamp per-frame dt so a backgrounded tab resuming doesn't teleport
 *  particles across the screen in one giant step. */
const MAX_DT_SECONDS = 1 / 20;

export function EffectsOverlay() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reduceSetting = useSettingsStore((s) => s.reduceScreenEffects);

  // Mutable refs the rAF loop reads without re-subscribing.
  const instancesRef = useRef<LiveInstance[]>([]);
  const rafRef = useRef<number | null>(null);
  const reduceRef = useRef(reduceSetting);
  const prefersReducedRef = useRef(false);

  // Keep the reduce flag fresh for the imperative loop / queue drain.
  useEffect(() => {
    reduceRef.current = reduceSetting;
  }, [reduceSetting]);

  // Track OS prefers-reduced-motion.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    prefersReducedRef.current = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      prefersReducedRef.current = e.matches;
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // Wire screen-shake to a transform on the app shell. We target the
  // first child of #root (the shell wrapper) so the overlay canvas itself
  // — a sibling, fixed-position — does NOT inherit the shake (otherwise
  // the flash would jitter with the UI). Reset to identity on unmount.
  useEffect(() => {
    const shellEl =
      (document.getElementById("root")?.firstElementChild as HTMLElement | null) ??
      document.body;
    setShakeApplier((ox, oy) => {
      if (ox === 0 && oy === 0) {
        shellEl.style.transform = "";
        shellEl.style.willChange = "";
      } else {
        shellEl.style.transform = `translate3d(${ox}px, ${oy}px, 0)`;
        shellEl.style.willChange = "transform";
      }
    });
    return () => {
      setShakeApplier(() => {});
      shellEl.style.transform = "";
      shellEl.style.willChange = "";
    };
  }, []);

  // Size the canvas to the viewport, DPR-aware. Re-runs on resize.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // The render loop. Started on demand when the queue grows; self-stops
  // when no instances remain so an idle overlay costs nothing.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const tick = (now: number) => {
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.width / dpr;
      const cssH = canvas.height / dpr;

      // Clear in device pixels, then scale to CSS pixels for renderers.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      const live = instancesRef.current;
      for (let i = live.length - 1; i >= 0; i--) {
        const inst = live[i];
        const elapsed = now - inst.startedAt;
        const dt = Math.min(MAX_DT_SECONDS, (now - inst.lastFrameAt) / 1000) || 1 / 60;
        inst.lastFrameAt = now;

        const frame: EffectFrameContext = {
          ctx,
          width: cssW,
          height: cssH,
          elapsed,
          dt,
          dpr,
        };
        try {
          inst.renderer.draw(frame);
        } catch (err) {
          console.warn("Effect renderer threw — dropping instance:", err);
          live.splice(i, 1);
          continue;
        }

        if (inst.renderer.done(elapsed) || elapsed > MAX_INSTANCE_LIFETIME_MS) {
          live.splice(i, 1);
        }
      }

      if (live.length > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        // Park: clear once more and stop the loop.
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        rafRef.current = null;
      }
    };

    const startLoop = () => {
      if (rafRef.current == null && instancesRef.current.length > 0) {
        rafRef.current = requestAnimationFrame(tick);
      }
    };

    // Drain the store queue: each not-yet-consumed effect becomes a live
    // instance (unless reduced-motion suppresses the visual). We consume
    // every queued item regardless so the queue can't grow unbounded.
    const drain = () => {
      const { queue, consume } = useEffectsStore.getState();
      if (queue.length === 0) return;
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.width / dpr;
      const cssH = canvas.height / dpr;
      const reduce = reduceRef.current || prefersReducedRef.current;

      for (const q of queue) {
        // Optional local sound for the authoring preview path.
        if (q.soundUrl) {
          try {
            const audio = new Audio(q.soundUrl);
            audio.volume = clampVolume(useSettingsStore.getState().soundboardVolume);
            void audio.play().catch(() => {});
          } catch {
            /* best effort */
          }
        }

        if (!reduce) {
          const resolved = resolveEffect(q.meta);
          if (resolved) {
            const renderer = resolved.def.create(resolved.config, cssW, cssH);
            const t = performance.now();
            instancesRef.current.push({
              seq: q.seq,
              renderer,
              startedAt: t,
              lastFrameAt: t,
            });
          }
        }
        consume(q.seq);
      }
      startLoop();
    };

    // Subscribe to queue changes + drain whatever's already queued.
    const unsub = useEffectsStore.subscribe(drain);
    drain();

    return () => {
      unsub();
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      instancesRef.current = [];
      // Reset any in-flight shake.
      setShakeApplier(() => {});
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 9998, // below the launch splash (9999), above app chrome
      }}
    />
  );
}

function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}
