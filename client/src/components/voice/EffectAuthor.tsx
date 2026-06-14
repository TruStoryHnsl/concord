// EffectAuthor — the "author your own effect" panel for the Effects board.
//
// Flow: pick a built-in visual → tune its config with sliders / color
// pickers → optionally attach a sound file → name it → Preview (fires it
// on the local screen) → Save. Saving with a sound uploads the clip with
// the effect descriptor attached (sound+visual); saving without a sound
// creates a visual-only item. Kept deliberately simple — every knob comes
// straight from the chosen effect's `fields` schema, so adding a new
// built-in automatically gets an authoring UI with zero extra code.

import { useState, useMemo, useCallback } from "react";
import {
  uploadSoundboardClip,
  createVisualEffect,
  type SoundboardClip,
} from "../../api/concord";
import { useAuthStore } from "../../stores/auth";
import { BUILTIN_EFFECTS, buildEffectMetadata } from "../../effects/registry";
import { resolveConfig, asColorList } from "../../effects/config";
import { fireEffect } from "../../effects/store";
import type { EffectConfig, EffectConfigField, EffectDefinition } from "../../effects/types";
import { Slider } from "../ui/Slider";

interface EffectAuthorProps {
  serverId: string;
  onSaved: (clip: SoundboardClip) => void;
  onCancel: () => void;
}

export function EffectAuthor({ serverId, onSaved, onCancel }: EffectAuthorProps) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [selectedId, setSelectedId] = useState<string>(BUILTIN_EFFECTS[0].id);
  const def = useMemo<EffectDefinition>(
    () => BUILTIN_EFFECTS.find((d) => d.id === selectedId) ?? BUILTIN_EFFECTS[0],
    [selectedId],
  );

  // Per-effect config overrides. Reset to the effect's defaults whenever
  // the user switches effects (keyed by selectedId via the reset below).
  const [config, setConfig] = useState<EffectConfig>(() => ({ ...def.defaultConfig }));
  const [name, setName] = useState("");
  const [soundFile, setSoundFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectEffect = useCallback((id: string) => {
    setSelectedId(id);
    const next = BUILTIN_EFFECTS.find((d) => d.id === id);
    if (next) setConfig({ ...next.defaultConfig });
  }, []);

  const setField = useCallback((key: string, value: EffectConfig[string]) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handlePreview = useCallback(() => {
    // Resolve+clamp through the same path the live engine uses so the
    // preview is exactly what gets saved/broadcast.
    const meta = buildEffectMetadata(def.id, resolveConfig(def, config));
    fireEffect(meta, {
      soundUrl: soundFile ? URL.createObjectURL(soundFile) : undefined,
    });
  }, [def, config, soundFile]);

  const handleSave = useCallback(async () => {
    if (!accessToken || saving) return;
    const finalName = name.trim() || def.name;
    setSaving(true);
    setError(null);
    try {
      const meta = buildEffectMetadata(def.id, resolveConfig(def, config));
      const metaJson = JSON.stringify(meta);
      let clip: SoundboardClip;
      if (soundFile) {
        clip = await uploadSoundboardClip(serverId, finalName, soundFile, accessToken, metaJson);
      } else {
        clip = await createVisualEffect(serverId, finalName, metaJson, accessToken);
      }
      onSaved(clip);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [accessToken, saving, name, def, config, soundFile, serverId, onSaved]);

  return (
    <div className="px-4 py-3 bg-surface-container/30 border-b border-outline-variant/15 space-y-3">
      {/* Effect picker */}
      <div className="flex flex-wrap gap-1">
        {BUILTIN_EFFECTS.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => selectEffect(d.id)}
            className={`px-2.5 py-1.5 text-xs rounded transition-colors ${
              d.id === selectedId
                ? "bg-primary text-on-surface"
                : "bg-surface-container text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high"
            }`}
            title={d.description}
          >
            <span className="mr-1">{d.glyph}</span>
            {d.name}
          </button>
        ))}
      </div>

      <p className="text-[10px] text-on-surface-variant/70">{def.description}</p>

      {/* Config knobs, generated from the effect's field schema */}
      <div className="space-y-2">
        {def.fields.map((field) => (
          <ConfigControl
            key={field.key}
            field={field}
            value={config[field.key]}
            fallback={def.defaultConfig[field.key]}
            onChange={(v) => setField(field.key, v)}
          />
        ))}
      </div>

      {/* Name + optional sound */}
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={`Name (defaults to "${def.name}")`}
        className="w-full px-3 py-1.5 bg-surface-container border border-outline-variant rounded text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
      />
      <div>
        <label className="text-[10px] text-on-surface-variant uppercase tracking-wider">
          Optional sound
        </label>
        <input
          type="file"
          accept=".mp3,.wav,.ogg,.webm,.m4a"
          onChange={(e) => setSoundFile(e.target.files?.[0] ?? null)}
          className="w-full text-xs text-on-surface-variant file:mr-2 file:px-3 file:py-1 file:bg-surface-container-highest file:border-0 file:rounded file:text-xs file:text-on-surface file:cursor-pointer"
        />
        {soundFile && (
          <button
            type="button"
            onClick={() => setSoundFile(null)}
            className="mt-1 text-[10px] text-on-surface-variant hover:text-error"
          >
            Remove sound ({soundFile.name})
          </button>
        )}
      </div>

      {error && <p className="text-xs text-error">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handlePreview}
          className="flex-1 px-3 py-1.5 bg-surface-container-highest hover:bg-surface-bright text-on-surface text-sm rounded transition-colors"
        >
          Preview
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex-1 px-3 py-1.5 primary-glow hover:brightness-110 disabled:opacity-40 text-on-surface text-sm rounded transition-colors"
        >
          {saving ? "Saving..." : "Save effect"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-on-surface-variant hover:text-on-surface text-sm rounded transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}

/** One config knob, rendered per its field type. */
function ConfigControl({
  field,
  value,
  fallback,
  onChange,
}: {
  field: EffectConfigField;
  value: EffectConfig[string] | undefined;
  fallback: EffectConfig[string];
  onChange: (v: EffectConfig[string]) => void;
}) {
  switch (field.type) {
    case "number": {
      const num = typeof value === "number" ? value : Number(value);
      const safe = Number.isFinite(num) ? num : Number(fallback) || 0;
      return (
        <Slider
          label={field.label}
          value={safe}
          min={field.min ?? 0}
          max={field.max ?? 100}
          step={field.step ?? 1}
          onChange={onChange}
          formatValue={(v) =>
            field.unit ? `${round(v)}${field.unit}` : String(round(v))
          }
        />
      );
    }
    case "color": {
      const color = typeof value === "string" ? value : String(fallback);
      return (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-on-surface-variant">{field.label}</span>
          <input
            type="color"
            value={normalizeHex(color)}
            onChange={(e) => onChange(e.target.value)}
            className="w-8 h-6 rounded border border-outline-variant bg-transparent cursor-pointer"
          />
        </div>
      );
    }
    case "colorList": {
      const colors = asColorList({ c: value as never } as EffectConfig, "c",
        Array.isArray(fallback) ? fallback : [String(fallback)]);
      return (
        <div className="space-y-1">
          <span className="text-xs text-on-surface-variant">{field.label}</span>
          <div className="flex flex-wrap items-center gap-1">
            {colors.map((c, i) => (
              <div key={i} className="relative group">
                <input
                  type="color"
                  value={normalizeHex(c)}
                  onChange={(e) => {
                    const next = [...colors];
                    next[i] = e.target.value;
                    onChange(next);
                  }}
                  className="w-7 h-6 rounded border border-outline-variant bg-transparent cursor-pointer"
                />
                {colors.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onChange(colors.filter((_, j) => j !== i))}
                    className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-error text-on-error text-[8px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove color"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => onChange([...colors, "#ffffff"])}
              className="w-7 h-6 rounded border border-dashed border-outline-variant text-on-surface-variant hover:text-on-surface text-xs"
              title="Add color"
            >
              +
            </button>
          </div>
        </div>
      );
    }
    case "boolean": {
      const on = typeof value === "boolean" ? value : Boolean(fallback);
      return (
        <label className="flex items-center justify-between gap-2 cursor-pointer">
          <span className="text-xs text-on-surface-variant">{field.label}</span>
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => onChange(e.target.checked)}
            className="accent-primary"
          />
        </label>
      );
    }
    default:
      return null;
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

/** <input type="color"> only accepts #rrggbb. Coerce anything else to a
 *  safe default so the picker doesn't reset to black on a named color. */
function normalizeHex(c: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#ffffff";
}
