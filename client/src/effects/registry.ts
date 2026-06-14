// Effect registry — the lookup table mapping a built-in effect id to its
// definition, plus pure helpers the authoring UI, the live engine and the
// broadcast layer all share. No React, no canvas, no side effects: this
// module is fully unit-testable.

import type {
  EffectConfig,
  EffectDefinition,
  EffectMetadata,
} from "./types";
import { EFFECT_METADATA_VERSION } from "./types";
import { resolveConfig } from "./config";
import { confetti } from "./builtins/confetti";
import { hearts } from "./builtins/hearts";
import { sparkles } from "./builtins/sparkles";
import { screenShake } from "./builtins/screenShake";

/** Ordered list of built-ins — drives the authoring picker order. */
export const BUILTIN_EFFECTS: readonly EffectDefinition[] = [
  confetti,
  hearts,
  sparkles,
  screenShake,
];

const BY_ID: ReadonlyMap<string, EffectDefinition> = new Map(
  BUILTIN_EFFECTS.map((def) => [def.id, def]),
);

/** Look up a built-in by id. Returns undefined for unknown ids. */
export function getEffectDefinition(id: string | null | undefined): EffectDefinition | undefined {
  if (!id) return undefined;
  return BY_ID.get(id);
}

/** True if `id` names a known built-in. */
export function isKnownEffect(id: string | null | undefined): boolean {
  return !!id && BY_ID.has(id);
}

/**
 * Resolve an effect's runtime config from persisted/broadcast metadata.
 * Returns null when the metadata has no visual (sound-only item) or names
 * an unknown effect (forward-compat: a peer on a newer build broadcast an
 * effect this client doesn't have → we silently skip the visual rather
 * than crash). On success, returns the definition plus the fully-resolved,
 * clamped config ready to hand to `def.create`.
 */
export function resolveEffect(
  meta: EffectMetadata | null | undefined,
): { def: EffectDefinition; config: EffectConfig } | null {
  if (!meta || !meta.visualId) return null;
  const def = BY_ID.get(meta.visualId);
  if (!def) return null;
  return { def, config: resolveConfig(def, meta.config) };
}

/**
 * Build a clean, persistable `EffectMetadata` from an authoring session.
 * - A null/unknown visualId yields a sound-only descriptor (`visualId:
 *   null`), which the caller stores to mean "no visual".
 * - Config is normalised against the definition's schema and stripped to
 *   only the fields that DIFFER from the defaults, keeping the persisted
 *   JSON minimal and resilient to future default changes.
 * Pure.
 */
export function buildEffectMetadata(
  visualId: string | null,
  config: EffectConfig | null | undefined,
): EffectMetadata {
  const def = visualId ? BY_ID.get(visualId) : undefined;
  if (!visualId || !def) {
    return { visualId: null, version: EFFECT_METADATA_VERSION };
  }

  const resolved = resolveConfig(def, config);
  const diff: EffectConfig = {};
  for (const field of def.fields) {
    const current = resolved[field.key];
    const fallback = def.defaultConfig[field.key];
    if (!configValueEquals(current, fallback)) {
      diff[field.key] = current;
    }
  }

  const meta: EffectMetadata = { visualId, version: EFFECT_METADATA_VERSION };
  if (Object.keys(diff).length > 0) meta.config = diff;
  return meta;
}

/** Structural equality for config values (handles the colorList arrays). */
export function configValueEquals(
  a: EffectConfig[string] | undefined,
  b: EffectConfig[string] | undefined,
): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

/**
 * Parse arbitrary JSON (from the server column or a broadcast packet) into
 * a validated `EffectMetadata`, or null if it isn't a usable effect
 * descriptor. Defensive: never throws.
 */
export function parseEffectMetadata(raw: unknown): EffectMetadata | null {
  if (raw == null) return null;
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null) return null;
  const record = obj as Record<string, unknown>;
  const visualId =
    typeof record.visualId === "string" ? record.visualId : null;
  const config =
    record.config && typeof record.config === "object" && !Array.isArray(record.config)
      ? (record.config as EffectConfig)
      : undefined;
  const version =
    typeof record.version === "number" ? record.version : EFFECT_METADATA_VERSION;
  return { visualId, config, version };
}
