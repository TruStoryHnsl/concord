// Confetti — burst of colored rectangles that arc up and rain down under
// gravity, fluttering as they fall. The classic "🎉" pop. Pairs nicely
// with a celebratory or "halo grunt" sound (per the user's example).

import type {
  EffectConfig,
  EffectDefinition,
  EffectFrameContext,
  EffectRenderer,
} from "../types";
import {
  asColorList,
  asNumber,
  pick,
  rand,
} from "../config";

interface Confetto {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** half-width of the rectangle */
  w: number;
  h: number;
  color: string;
  /** rotation + spin */
  rot: number;
  spin: number;
  /** flutter phase so pieces wobble out of sync */
  flutter: number;
  flutterSpeed: number;
}

const GRAVITY = 900; // px/s²
const DRAG = 0.55; // air drag coefficient applied to velocity per second

class ConfettiRenderer implements EffectRenderer {
  private pieces: Confetto[];
  private readonly durationMs: number;

  constructor(config: EffectConfig, width: number, height: number) {
    const count = Math.round(asNumber(config, "count", 120));
    const colors = asColorList(config, "colors", ["#f43f5e"]);
    const speed = asNumber(config, "speed", 1);
    this.durationMs = asNumber(config, "durationMs", 2600);

    // Launch from two lower corners + center, fountain-style, so the
    // burst fills the screen rather than dribbling from one point.
    const origins = [
      { x: width * 0.5, y: height * 0.62 },
      { x: width * 0.15, y: height * 0.85 },
      { x: width * 0.85, y: height * 0.85 },
    ];

    this.pieces = Array.from({ length: count }, () => {
      const o = pick(origins);
      const angle = -Math.PI / 2 + rand(-0.9, 0.9); // mostly upward
      const power = rand(420, 760) * speed;
      const size = rand(5, 11);
      return {
        x: o.x,
        y: o.y,
        vx: Math.cos(angle) * power,
        vy: Math.sin(angle) * power,
        w: size,
        h: size * rand(0.4, 0.7),
        color: pick(colors),
        rot: rand(0, Math.PI * 2),
        spin: rand(-8, 8),
        flutter: rand(0, Math.PI * 2),
        flutterSpeed: rand(4, 9),
      };
    });
  }

  draw({ ctx, height, dt }: EffectFrameContext): void {
    for (const p of this.pieces) {
      // Integrate motion.
      p.vy += GRAVITY * dt;
      const drag = 1 - DRAG * dt;
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      p.flutter += p.flutterSpeed * dt;

      // Flutter squashes the horizontal scale so pieces look like they're
      // tumbling edge-on as they fall.
      const squash = Math.abs(Math.cos(p.flutter));

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(squash, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    // Keep only on-screen pieces so `done()` can settle once they've all
    // fallen past the bottom edge.
    this.pieces = this.pieces.filter((p) => p.y < height + 40);
  }

  done(elapsed: number): boolean {
    return this.pieces.length === 0 || elapsed > this.durationMs + 1500;
  }
}

export const confetti: EffectDefinition = {
  id: "confetti",
  name: "Confetti",
  description: "A celebratory burst of paper that rains down.",
  glyph: "🎉",
  durationMs: 2600,
  defaultConfig: {
    count: 120,
    colors: ["#f43f5e", "#fb923c", "#facc15", "#4ade80", "#38bdf8", "#a78bfa"],
    speed: 1,
    durationMs: 2600,
  },
  fields: [
    { key: "count", label: "Pieces", type: "number", min: 20, max: 400, step: 10 },
    { key: "colors", label: "Colors", type: "colorList" },
    { key: "speed", label: "Launch power", type: "number", min: 0.3, max: 2.5, step: 0.1, unit: "×" },
    { key: "durationMs", label: "Duration", type: "number", min: 800, max: 6000, step: 100, unit: "ms" },
  ],
  create: (config, width, height) => new ConfettiRenderer(config, width, height),
};
