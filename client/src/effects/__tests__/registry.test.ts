import { describe, expect, it } from "vitest";
import {
  BUILTIN_EFFECTS,
  buildEffectMetadata,
  configValueEquals,
  getEffectDefinition,
  isKnownEffect,
  parseEffectMetadata,
  resolveEffect,
} from "../registry";
import {
  asColorList,
  asNumber,
  clamp,
  normalizeField,
  resolveConfig,
} from "../config";
import type { EffectConfigField } from "../types";

describe("config helpers", () => {
  it("asNumber coerces strings and rejects NaN/Infinity", () => {
    expect(asNumber({ a: 5 }, "a", 1)).toBe(5);
    expect(asNumber({ a: "7" }, "a", 1)).toBe(7);
    expect(asNumber({ a: "nope" }, "a", 1)).toBe(1);
    expect(asNumber({ a: Infinity }, "a", 1)).toBe(1);
    expect(asNumber({}, "missing", 42)).toBe(42);
  });

  it("clamp bounds values", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });

  it("asColorList accepts arrays, csv strings, and falls back non-empty", () => {
    expect(asColorList({ c: ["#fff", "#000"] }, "c", ["#f00"])).toEqual(["#fff", "#000"]);
    expect(asColorList({ c: "#aaa, #bbb" }, "c", ["#f00"])).toEqual(["#aaa", "#bbb"]);
    expect(asColorList({ c: [] }, "c", ["#f00"])).toEqual(["#f00"]);
    expect(asColorList({}, "c", ["#f00"])).toEqual(["#f00"]);
    // strips empties
    expect(asColorList({ c: ["#fff", "", "  "] }, "c", ["#f00"])).toEqual(["#fff"]);
  });

  it("normalizeField clamps numbers, coerces colors/booleans", () => {
    const numField: EffectConfigField = { key: "n", label: "N", type: "number", min: 0, max: 10 };
    expect(normalizeField(numField, 99, 5)).toBe(10);
    expect(normalizeField(numField, -99, 5)).toBe(0);
    expect(normalizeField(numField, "bad", 5)).toBe(5);

    const colorField: EffectConfigField = { key: "c", label: "C", type: "color" };
    expect(normalizeField(colorField, "#abc", "#fff")).toBe("#abc");
    expect(normalizeField(colorField, "", "#fff")).toBe("#fff");
    expect(normalizeField(colorField, 123, "#fff")).toBe("#fff");

    const boolField: EffectConfigField = { key: "b", label: "B", type: "boolean" };
    expect(normalizeField(boolField, true, false)).toBe(true);
    expect(normalizeField(boolField, "x", false)).toBe(false);

    const listField: EffectConfigField = { key: "l", label: "L", type: "colorList" };
    expect(normalizeField(listField, ["#a", "#b"], ["#z"])).toEqual(["#a", "#b"]);
    expect(normalizeField(listField, [], ["#z"])).toEqual(["#z"]);
    expect(normalizeField(listField, "#x,#y", ["#z"])).toEqual(["#x", "#y"]);
  });

  it("resolveConfig overlays normalised overrides on defaults and drops unknown keys", () => {
    const def = getEffectDefinition("confetti")!;
    const resolved = resolveConfig(def, { count: 9999, bogus: 1 } as never);
    // count clamped to its field max (400)
    expect(resolved.count).toBe(400);
    // unknown key dropped
    expect("bogus" in resolved).toBe(false);
    // untouched fields keep defaults
    expect(resolved.colors).toEqual(def.defaultConfig.colors);
  });

  it("resolveConfig returns a copy of defaults when no overrides", () => {
    const def = getEffectDefinition("hearts")!;
    const a = resolveConfig(def, undefined);
    const b = resolveConfig(def, null);
    expect(a).toEqual(def.defaultConfig);
    expect(b).toEqual(def.defaultConfig);
    // must be a copy, not the same reference
    expect(a).not.toBe(def.defaultConfig);
  });
});

describe("registry lookup", () => {
  it("every built-in has a unique id, fields, and a working factory", () => {
    const ids = new Set<string>();
    for (const def of BUILTIN_EFFECTS) {
      expect(ids.has(def.id)).toBe(false);
      ids.add(def.id);
      expect(def.fields.length).toBeGreaterThan(0);
      // factory produces a renderer with draw/done
      const renderer = def.create(def.defaultConfig, 800, 600);
      expect(typeof renderer.draw).toBe("function");
      expect(typeof renderer.done).toBe("function");
    }
  });

  it("default configs only reference declared fields (plus durationMs)", () => {
    for (const def of BUILTIN_EFFECTS) {
      const fieldKeys = new Set(def.fields.map((f) => f.key));
      for (const key of Object.keys(def.defaultConfig)) {
        // durationMs may exist as an internal default without a slider
        // on some effects; everything else must be a tunable field.
        if (key === "durationMs") continue;
        expect(fieldKeys.has(key)).toBe(true);
      }
    }
  });

  it("isKnownEffect / getEffectDefinition handle unknowns", () => {
    expect(isKnownEffect("confetti")).toBe(true);
    expect(isKnownEffect("nope")).toBe(false);
    expect(isKnownEffect(null)).toBe(false);
    expect(getEffectDefinition("nope")).toBeUndefined();
  });
});

describe("configValueEquals", () => {
  it("compares scalars and arrays structurally", () => {
    expect(configValueEquals(5, 5)).toBe(true);
    expect(configValueEquals(5, 6)).toBe(false);
    expect(configValueEquals(["#a", "#b"], ["#a", "#b"])).toBe(true);
    expect(configValueEquals(["#a"], ["#a", "#b"])).toBe(false);
    expect(configValueEquals("x", "x")).toBe(true);
  });
});

describe("buildEffectMetadata", () => {
  it("returns sound-only descriptor for null/unknown visual", () => {
    expect(buildEffectMetadata(null, null)).toEqual({ visualId: null, version: 1 });
    expect(buildEffectMetadata("does-not-exist", { x: 1 })).toEqual({
      visualId: null,
      version: 1,
    });
  });

  it("strips config to only the fields that differ from defaults", () => {
    const def = getEffectDefinition("confetti")!;
    // identical to defaults → no config key persisted
    const same = buildEffectMetadata("confetti", { ...def.defaultConfig });
    expect(same.visualId).toBe("confetti");
    expect(same.config).toBeUndefined();

    // override one field → only that field persisted (clamped)
    const diff = buildEffectMetadata("confetti", { count: 200 } as never);
    expect(diff.config).toEqual({ count: 200 });
  });

  it("clamps out-of-range overrides before persisting", () => {
    const meta = buildEffectMetadata("confetti", { count: 100000 } as never);
    // confetti count field max is 400
    expect(meta.config).toEqual({ count: 400 });
  });
});

describe("parseEffectMetadata", () => {
  it("parses objects and JSON strings, rejecting garbage", () => {
    expect(parseEffectMetadata(null)).toBeNull();
    expect(parseEffectMetadata("not json")).toBeNull();
    expect(parseEffectMetadata(42)).toBeNull();
    expect(parseEffectMetadata({ visualId: "confetti" })).toEqual({
      visualId: "confetti",
      config: undefined,
      version: 1,
    });
    expect(parseEffectMetadata('{"visualId":"hearts","config":{"count":50},"version":1}')).toEqual({
      visualId: "hearts",
      config: { count: 50 },
      version: 1,
    });
  });

  it("normalises a sound-only descriptor (no visualId)", () => {
    expect(parseEffectMetadata({ visualId: null })).toEqual({
      visualId: null,
      config: undefined,
      version: 1,
    });
  });
});

describe("resolveEffect", () => {
  it("returns null for sound-only / unknown / missing", () => {
    expect(resolveEffect(null)).toBeNull();
    expect(resolveEffect({ visualId: null })).toBeNull();
    expect(resolveEffect({ visualId: "ghost" })).toBeNull();
  });

  it("resolves a known effect with clamped config", () => {
    const out = resolveEffect({ visualId: "confetti", config: { count: 99999 } });
    expect(out).not.toBeNull();
    expect(out!.def.id).toBe("confetti");
    expect(out!.config.count).toBe(400); // clamped to field max
  });
});

describe("round-trip: build → parse → resolve", () => {
  it("an authored effect survives serialisation and reproduces the same config", () => {
    const built = buildEffectMetadata("hearts", { count: 120, speed: 1.5 } as never);
    const json = JSON.stringify(built);
    const parsed = parseEffectMetadata(json)!;
    const resolved = resolveEffect(parsed)!;
    expect(resolved.def.id).toBe("hearts");
    expect(resolved.config.count).toBe(120);
    expect(resolved.config.speed).toBe(1.5);
  });
});
