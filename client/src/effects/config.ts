// Pure config helpers shared by built-in effects and the registry.
//
// These are deliberately defensive: an effect's config can arrive from
// persisted JSON (an old saved effect), a peer's broadcast packet, or a
// half-finished authoring session. A malformed field must never throw
// mid-render — it falls back to the supplied default instead. All
// functions here are pure (aside from the explicitly-random `rand`/`pick`
// used to seed particles) and unit-tested.

import type { EffectConfig, EffectConfigField, EffectDefinition } from "./types";

/** Read a numeric field, coercing strings and rejecting NaN/Infinity. */
export function asNumber(config: EffectConfig, key: string, fallback: number): number {
  const raw = config[key];
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** Read a boolean field. */
export function asBoolean(config: EffectConfig, key: string, fallback: boolean): boolean {
  const raw = config[key];
  return typeof raw === "boolean" ? raw : fallback;
}

/** Read a single CSS color string, rejecting empty/non-string values. */
export function asColor(config: EffectConfig, key: string, fallback: string): string {
  const raw = config[key];
  return typeof raw === "string" && raw.trim().length > 0 ? raw : fallback;
}

/**
 * Read a list of CSS colors. Accepts an array of strings, a single
 * comma-separated string, or falls back. Always returns a non-empty
 * array so `pick()` is safe.
 */
export function asColorList(config: EffectConfig, key: string, fallback: string[]): string[] {
  const raw = config[key];
  let list: string[] | null = null;
  if (Array.isArray(raw)) {
    list = raw.filter((c): c is string => typeof c === "string" && c.trim().length > 0);
  } else if (typeof raw === "string" && raw.trim().length > 0) {
    list = raw.split(",").map((c) => c.trim()).filter((c) => c.length > 0);
  }
  return list && list.length > 0 ? list : fallback;
}

/** Uniform random in [min, max). */
export function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Pick a uniformly-random element. Caller guarantees non-empty. */
export function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Clamp helper. */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Validate + normalise a single config field against its schema. Numeric
 * fields are clamped to [min, max] and snapped to a finite number;
 * color/colorList fields are coerced to well-formed shapes; booleans are
 * coerced. Returns the normalised value, or the default when the input is
 * unusable. Pure.
 */
export function normalizeField(
  field: EffectConfigField,
  value: unknown,
  defaultValue: EffectConfig[string],
): EffectConfig[string] {
  switch (field.type) {
    case "number": {
      const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
      if (!Number.isFinite(n)) return defaultValue;
      const min = field.min ?? -Infinity;
      const max = field.max ?? Infinity;
      return clamp(n, min, max);
    }
    case "boolean":
      return typeof value === "boolean" ? value : Boolean(defaultValue);
    case "color":
      return typeof value === "string" && value.trim().length > 0
        ? value
        : defaultValue;
    case "colorList": {
      let list: string[] | null = null;
      if (Array.isArray(value)) {
        list = value.filter((c): c is string => typeof c === "string" && c.trim().length > 0);
      } else if (typeof value === "string" && value.trim().length > 0) {
        list = value.split(",").map((c) => c.trim()).filter(Boolean);
      }
      return list && list.length > 0
        ? list
        : (Array.isArray(defaultValue) ? defaultValue : [String(defaultValue)]);
    }
    default:
      return defaultValue;
  }
}

/**
 * Resolve a user-supplied (partial, possibly malformed) config against a
 * definition: start from the definition's defaults, then for each known
 * field overlay the normalised user value. Unknown keys in `overrides`
 * are dropped (they can't be rendered and shouldn't be persisted). Pure —
 * the single source of truth for "what config will this effect actually
 * run with", used by both the live engine and the authoring preview.
 */
export function resolveConfig(
  def: EffectDefinition,
  overrides: EffectConfig | undefined | null,
): EffectConfig {
  const resolved: EffectConfig = { ...def.defaultConfig };
  if (!overrides) return resolved;
  for (const field of def.fields) {
    if (Object.prototype.hasOwnProperty.call(overrides, field.key)) {
      resolved[field.key] = normalizeField(
        field,
        overrides[field.key],
        def.defaultConfig[field.key],
      );
    }
  }
  return resolved;
}
