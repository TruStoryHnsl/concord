// Sparkles — twinkling four-point stars that pop in at random positions,
// flare bright, then fade. A gentle ambient shimmer. Cheap to render and
// reads well behind UI as a subtle "✨" accent.

import type {
  EffectConfig,
  EffectDefinition,
  EffectFrameContext,
  EffectRenderer,
} from "../types";
import { asColorList, asNumber, pick, rand } from "../config";

interface Sparkle {
  x: number;
  y: number;
  maxRadius: number;
  color: string;
  spawnDelay: number;
  /** seconds each sparkle lives once spawned */
  life: number;
  age: number;
  born: boolean;
}

/** Draw a four-point sparkle (north/south/east/west spikes) of `r`. */
function drawSparkle(ctx: CanvasRenderingContext2D, r: number): void {
  const thin = r * 0.18;
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(thin, -thin);
  ctx.lineTo(r, 0);
  ctx.lineTo(thin, thin);
  ctx.lineTo(0, r);
  ctx.lineTo(-thin, thin);
  ctx.lineTo(-r, 0);
  ctx.lineTo(-thin, -thin);
  ctx.closePath();
  ctx.fill();
}

class SparklesRenderer implements EffectRenderer {
  private sparkles: Sparkle[];
  private readonly durationMs: number;

  constructor(config: EffectConfig, width: number, height: number) {
    const count = Math.round(asNumber(config, "count", 60));
    const colors = asColorList(config, "colors", ["#fde68a", "#ffffff", "#fcd34d"]);
    const intensity = asNumber(config, "intensity", 1);
    this.durationMs = asNumber(config, "durationMs", 2400);

    const spawnWindow = this.durationMs * 0.7;
    this.sparkles = Array.from({ length: count }, () => ({
      x: rand(0, width),
      y: rand(0, height),
      maxRadius: rand(6, 16) * intensity,
      color: pick(colors),
      spawnDelay: rand(0, spawnWindow),
      life: rand(0.5, 1.1),
      age: 0,
      born: false,
    }));
  }

  draw({ ctx, elapsed, dt }: EffectFrameContext): void {
    ctx.save();
    ctx.globalCompositeOperation = "lighter"; // additive sparkle glow
    for (const s of this.sparkles) {
      if (!s.born) {
        if (elapsed >= s.spawnDelay) s.born = true;
        else continue;
      }
      s.age += dt;
      const t = s.age / s.life;
      if (t >= 1) {
        s.maxRadius = 0; // dead
        continue;
      }
      // Ease in fast, fade out slow: brightness peaks early.
      const env = t < 0.3 ? t / 0.3 : 1 - (t - 0.3) / 0.7;
      const r = s.maxRadius * (0.4 + 0.6 * env);

      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.globalAlpha = Math.max(0, env);
      ctx.fillStyle = s.color;
      drawSparkle(ctx, r);
      ctx.restore();
    }
    ctx.restore();
    this.sparkles = this.sparkles.filter((s) => s.maxRadius > 0);
  }

  done(elapsed: number): boolean {
    return this.sparkles.length === 0 || elapsed > this.durationMs + 1500;
  }
}

export const sparkles: EffectDefinition = {
  id: "sparkles",
  name: "Sparkles",
  description: "Twinkling stars that shimmer and fade.",
  glyph: "✨",
  durationMs: 2400,
  defaultConfig: {
    count: 60,
    colors: ["#fde68a", "#ffffff", "#fcd34d", "#a7f3d0"],
    intensity: 1,
    durationMs: 2400,
  },
  fields: [
    { key: "count", label: "Sparkles", type: "number", min: 10, max: 200, step: 10 },
    { key: "colors", label: "Colors", type: "colorList" },
    { key: "intensity", label: "Size", type: "number", min: 0.4, max: 2.5, step: 0.1, unit: "×" },
    { key: "durationMs", label: "Duration", type: "number", min: 800, max: 6000, step: 100, unit: "ms" },
  ],
  create: (config, width, height) => new SparklesRenderer(config, width, height),
};
