// Effects board — screenspace visual effects engine.
//
// An "effect" is a small imperative canvas renderer (confetti, hearts,
// sparkles, a screen-shake, …) that paints onto a fullscreen
// pointer-events-none canvas mounted at the app root. Effects are
// deliberately simple and user-malleable: every built-in exposes a flat
// `config` object (counts, colors, speed, intensity, duration) so a user
// can tune it with sliders/color pickers and save the result as a named
// soundboard "effect" — optionally paired with a sound clip.
//
// Wire/persistence note: an authored effect rides along on a
// `SoundboardClip` via the nullable `effect_metadata` JSON column. The
// shape persisted there is `EffectMetadata` below. Keep it small and
// JSON-serialisable — it crosses both the REST boundary (server column)
// and the LiveKit data-channel broadcast (so peers can render the same
// visual locally).

/** A single tunable knob on a built-in effect. */
export type EffectConfigFieldType = "number" | "color" | "colorList" | "boolean";

export interface EffectConfigField {
  /** Key into the effect's config object. */
  key: string;
  /** Human label for the authoring UI. */
  label: string;
  type: EffectConfigFieldType;
  /** For `number` fields: slider bounds + step. */
  min?: number;
  max?: number;
  step?: number;
  /** Optional unit suffix for display (e.g. "ms", "×"). */
  unit?: string;
}

/** Flat, JSON-serialisable bag of tunable values for one effect. */
export type EffectConfig = Record<string, number | string | string[] | boolean>;

/**
 * Per-frame draw context handed to an effect's renderer. The engine owns
 * the canvas, sizing, DPR scaling and timing; an effect only paints.
 */
export interface EffectFrameContext {
  ctx: CanvasRenderingContext2D;
  /** CSS-pixel width/height of the canvas (already DPR-normalised). */
  width: number;
  height: number;
  /** Milliseconds elapsed since this instance started. */
  elapsed: number;
  /** Seconds since the previous frame (clamped, never 0 on frame 0). */
  dt: number;
  /** Device pixel ratio the canvas was scaled by. */
  dpr: number;
}

/**
 * A live, playing instance of an effect. The engine constructs one of
 * these per fired effect and ticks it until `done` returns true (or the
 * effect's `durationMs` elapses, whichever the renderer honours).
 */
export interface EffectRenderer {
  /** Paint one frame. */
  draw(frame: EffectFrameContext): void;
  /**
   * True once the effect has fully finished (all particles dead, shake
   * settled, …). The engine removes the instance and, when no instances
   * remain, clears + parks the canvas.
   */
  done(elapsed: number): boolean;
}

/**
 * A built-in visual effect: a factory that, given a resolved config and
 * the initial canvas size, returns a stateful renderer. Pure aside from
 * the `Math.random` it may use to seed particles — given the same config
 * it always produces a visually-equivalent effect.
 */
export interface EffectDefinition {
  /** Stable id used in persistence + broadcast (e.g. "confetti"). */
  id: string;
  /** Display name in the authoring UI. */
  name: string;
  /** One-line description shown under the name in the picker. */
  description: string;
  /** Emoji/glyph for compact buttons. */
  glyph: string;
  /** Default config — also the schema's default values. */
  defaultConfig: EffectConfig;
  /** Tunable fields exposed to the authoring UI. */
  fields: EffectConfigField[];
  /**
   * Nominal duration in ms. Authoring UIs surface this; the renderer is
   * free to run shorter (particles all died) but should not exceed it by
   * much. Used by the engine as a hard safety cap.
   */
  durationMs: number;
  /** Build a renderer for a fired instance. */
  create(config: EffectConfig, width: number, height: number): EffectRenderer;
}

/**
 * The persisted/broadcast description of an authored effect. Stored as
 * JSON in `SoundboardClip.effect_metadata` and sent verbatim over the
 * LiveKit data channel so receivers render an identical visual.
 *
 * `visualId === null` ⇒ sound-only item (legacy soundboard behaviour).
 * `clip has no sound` (handled at the clip layer) ⇒ visual-only.
 */
export interface EffectMetadata {
  /** Built-in effect id, or null for a sound-only item. */
  visualId: string | null;
  /** Config overrides merged over the built-in's `defaultConfig`. */
  config?: EffectConfig;
  /** Metadata schema version for forward-compat. */
  version?: number;
}

export const EFFECT_METADATA_VERSION = 1;
