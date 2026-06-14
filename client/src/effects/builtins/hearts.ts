// Hearts — a flood of hearts that rise from the bottom of the screen,
// drifting sideways and fading near the top. The user's "flood the
// screen with hearts" example. Hearts are drawn with a parametric heart
// curve so there's no glyph/font dependency.

import type {
  EffectConfig,
  EffectDefinition,
  EffectFrameContext,
  EffectRenderer,
} from "../types";
import { asColorList, asNumber, pick, rand } from "../config";

interface Heart {
  x: number;
  y: number;
  vy: number;
  size: number;
  color: string;
  /** horizontal sway */
  sway: number;
  swaySpeed: number;
  swayAmp: number;
  spawnDelay: number;
  born: number;
  alive: boolean;
}

/** Trace a unit heart (≈[-1,1] range) into the current path. */
function heartPath(ctx: CanvasRenderingContext2D, size: number): void {
  // Parametric heart curve, sampled. Scaled to roughly fit `size`.
  ctx.beginPath();
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t);
    // Curve y points up; canvas y points down → negate.
    const px = (x / 16) * size;
    const py = -(y / 16) * size;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

class HeartsRenderer implements EffectRenderer {
  private hearts: Heart[];
  private readonly durationMs: number;
  private spawnedAll = false;

  constructor(config: EffectConfig, width: number, height: number) {
    const count = Math.round(asNumber(config, "count", 80));
    const colors = asColorList(config, "colors", ["#f472b6", "#fb7185", "#ef4444"]);
    const speed = asNumber(config, "speed", 1);
    this.durationMs = asNumber(config, "durationMs", 3500);

    // Stagger spawns across the first ~60% of the duration so hearts
    // stream upward in waves rather than appearing all at once.
    const spawnWindow = this.durationMs * 0.6;

    this.hearts = Array.from({ length: count }, () => {
      const size = rand(10, 26);
      return {
        x: rand(0, width),
        y: height + size + rand(0, 60),
        vy: -rand(70, 150) * speed,
        size,
        color: pick(colors),
        sway: rand(0, Math.PI * 2),
        swaySpeed: rand(1.5, 3.5),
        swayAmp: rand(10, 40),
        spawnDelay: rand(0, spawnWindow),
        born: 0,
        alive: false,
      };
    });
  }

  draw({ ctx, height, elapsed, dt }: EffectFrameContext): void {
    let liveCount = 0;
    for (const h of this.hearts) {
      if (!h.alive) {
        if (elapsed >= h.spawnDelay) {
          h.alive = true;
          h.born = elapsed;
        } else {
          liveCount++; // still pending
          continue;
        }
      }

      h.y += h.vy * dt;
      h.sway += h.swaySpeed * dt;
      const drawX = h.x + Math.sin(h.sway) * h.swayAmp;

      // Fade out over the top third of the screen.
      const fadeStart = height * 0.33;
      const alpha = h.y > fadeStart ? 1 : Math.max(0, h.y / fadeStart);

      if (h.y < -h.size * 2 || alpha <= 0) {
        h.alive = false;
        h.size = 0; // mark dead — filtered below
        continue;
      }

      liveCount++;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(drawX, h.y);
      ctx.fillStyle = h.color;
      heartPath(ctx, h.size);
      ctx.fill();
      ctx.restore();
    }

    this.hearts = this.hearts.filter((h) => h.size > 0);
    if (this.hearts.length === 0) this.spawnedAll = true;
    void liveCount;
  }

  done(elapsed: number): boolean {
    return (
      (this.spawnedAll && this.hearts.length === 0) ||
      elapsed > this.durationMs + 2500
    );
  }
}

export const hearts: EffectDefinition = {
  id: "hearts",
  name: "Hearts",
  description: "A rising flood of hearts that drift and fade.",
  glyph: "❤️",
  durationMs: 3500,
  defaultConfig: {
    count: 80,
    colors: ["#f472b6", "#fb7185", "#ef4444", "#e879f9"],
    speed: 1,
    durationMs: 3500,
  },
  fields: [
    { key: "count", label: "Hearts", type: "number", min: 10, max: 250, step: 10 },
    { key: "colors", label: "Colors", type: "colorList" },
    { key: "speed", label: "Rise speed", type: "number", min: 0.3, max: 2.5, step: 0.1, unit: "×" },
    { key: "durationMs", label: "Duration", type: "number", min: 1000, max: 7000, step: 100, unit: "ms" },
  ],
  create: (config, width, height) => new HeartsRenderer(config, width, height),
};
