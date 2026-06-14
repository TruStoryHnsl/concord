// Screen shake — a decaying camera shake applied to the whole app, with
// an optional impact flash painted on the overlay canvas. Pairs with a
// thud/explosion/"grunt" sound for a physical "hit" feel.
//
// Unlike the particle effects, shake can't live purely on the overlay
// canvas (that layer is pointer-events-none and sits ABOVE the UI, so
// translating only it wouldn't move what the user is looking at). The
// renderer therefore applies a transient `transform` to a host element
// (the app root) via the injected `applyShake` callback and is careful to
// reset it to identity when finished. The engine guarantees `draw` keeps
// being called until `done()` so the final identity reset always lands.

import type {
  EffectConfig,
  EffectDefinition,
  EffectFrameContext,
  EffectRenderer,
} from "../types";
import { asColor, asNumber } from "../config";

/**
 * Host hook the engine wires up so screen-shake can move the real app.
 * Defaults to a no-op (e.g. in tests / SSR) — the effect still runs and
 * paints its flash, it just won't translate anything.
 */
export type ShakeApplier = (offsetX: number, offsetY: number) => void;

let shakeApplier: ShakeApplier = () => {};

/** Engine wires the real applier (a transform on the app root) at mount. */
export function setShakeApplier(fn: ShakeApplier): void {
  shakeApplier = fn;
}

class ScreenShakeRenderer implements EffectRenderer {
  private readonly durationMs: number;
  private readonly amplitude: number;
  private readonly flashColor: string;
  private readonly flashStrength: number;
  private finished = false;

  constructor(config: EffectConfig) {
    this.durationMs = asNumber(config, "durationMs", 600);
    this.amplitude = asNumber(config, "intensity", 14);
    this.flashColor = asColor(config, "flashColor", "#ffffff");
    this.flashStrength = asNumber(config, "flash", 0.25);
  }

  draw({ ctx, width, height, elapsed }: EffectFrameContext): void {
    const t = Math.min(1, elapsed / this.durationMs);
    const decay = 1 - t; // linear decay to zero

    if (t >= 1) {
      // Settle: reset transform exactly once and stop painting.
      if (!this.finished) {
        shakeApplier(0, 0);
        this.finished = true;
      }
      return;
    }

    // High-frequency pseudo-random offset, amplitude decaying over time.
    const mag = this.amplitude * decay * decay;
    const ox = (Math.random() * 2 - 1) * mag;
    const oy = (Math.random() * 2 - 1) * mag;
    shakeApplier(ox, oy);

    // Impact flash: brightest at the start, fades fast.
    if (this.flashStrength > 0) {
      const flashAlpha = this.flashStrength * Math.max(0, 1 - t * 4);
      if (flashAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = flashAlpha;
        ctx.fillStyle = this.flashColor;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }
    }
  }

  done(elapsed: number): boolean {
    if (elapsed >= this.durationMs && !this.finished) {
      // Safety: ensure the transform is reset even if `draw` somehow
      // didn't run on the final frame.
      shakeApplier(0, 0);
      this.finished = true;
    }
    return this.finished;
  }
}

export const screenShake: EffectDefinition = {
  id: "screen-shake",
  name: "Screen Shake",
  description: "A decaying impact shake with a flash.",
  glyph: "💥",
  durationMs: 600,
  defaultConfig: {
    durationMs: 600,
    intensity: 14,
    flash: 0.25,
    flashColor: "#ffffff",
  },
  fields: [
    { key: "intensity", label: "Strength", type: "number", min: 2, max: 40, step: 1, unit: "px" },
    { key: "durationMs", label: "Duration", type: "number", min: 200, max: 2000, step: 50, unit: "ms" },
    { key: "flash", label: "Flash", type: "number", min: 0, max: 1, step: 0.05 },
    { key: "flashColor", label: "Flash color", type: "color" },
  ],
  create: (config) => new ScreenShakeRenderer(config),
};
