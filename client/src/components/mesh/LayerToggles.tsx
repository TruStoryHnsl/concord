/**
 * LayerToggles — mesh-map layer selector (Wave-1 W1.1 / Feature F2).
 *
 * The mesh map is layerable: the Concord libp2p overlay is one layer;
 * later features add external-mesh layers (Reticulum, Meshtastic, generic
 * LoRa — Feature F7). This component renders one toggle per layer.
 *
 * Only the **Concord** layer is live in W1.1. The external-mesh layers are
 * rendered as disabled toggles with a "coming with F7" affordance so the
 * UI contract for a multi-layer map lands now and F7 only has to flip the
 * `available` flag + wire the data — no layout churn later.
 *
 * State is intentionally lifted to the parent (the map owns which layers
 * are on) so this stays a pure controlled component, testable in
 * isolation.
 */

/** Identifier for a mesh layer. Mirrors the Rust `MeshLayer` enum (F2). */
export type MeshLayerId = "concord" | "reticulum" | "meshtastic" | "lora";

/** A layer toggle's static descriptor. */
export interface MeshLayerDescriptor {
  id: MeshLayerId;
  label: string;
  /** Material-symbols icon name. */
  icon: string;
  /**
   * `false` for layers whose connector isn't implemented yet (F7). A
   * disabled toggle still renders so the contract is visible, but it can't
   * be turned on.
   */
  available: boolean;
}

/**
 * The canonical layer list. W1.1 ships only `concord` as available;
 * external-mesh layers are placeholders until F7 lands their connectors.
 */
export const MESH_LAYERS: MeshLayerDescriptor[] = [
  { id: "concord", label: "Concord", icon: "hub", available: true },
  { id: "reticulum", label: "Reticulum", icon: "lan", available: false },
  { id: "meshtastic", label: "Meshtastic", icon: "cell_tower", available: false },
  { id: "lora", label: "LoRa", icon: "settings_input_antenna", available: false },
];

export interface LayerTogglesProps {
  /** Set of currently-enabled layer ids. */
  enabled: Set<MeshLayerId>;
  /** Fired with the layer id when an available toggle is clicked. */
  onToggle: (id: MeshLayerId) => void;
  /**
   * Layer ids made available at runtime by an enabled connector (F7). A
   * layer listed here renders as a live (clickable) toggle even though its
   * static [`MeshLayerDescriptor.available`] is `false` — that flag is just
   * the conservative default before any connector registers. The Concord
   * layer is always available regardless. When omitted, only statically-
   * available layers are clickable (the W1.1 contract).
   */
  availableOverride?: Set<MeshLayerId>;
}

export function LayerToggles({
  enabled,
  onToggle,
  availableOverride,
}: LayerTogglesProps) {
  return (
    <div
      className="flex items-center gap-1.5 flex-wrap"
      data-testid="mesh-layer-toggles"
    >
      {MESH_LAYERS.map((layer) => {
        const on = enabled.has(layer.id);
        const available =
          layer.available || (availableOverride?.has(layer.id) ?? false);
        const disabled = !available;
        return (
          <button
            key={layer.id}
            type="button"
            data-testid={`mesh-layer-toggle-${layer.id}`}
            data-layer-available={available}
            data-layer-on={on}
            disabled={disabled}
            title={
              disabled
                ? `${layer.label} layer arrives with external-mesh connectors (F7)`
                : `Toggle the ${layer.label} layer`
            }
            onClick={() => {
              if (!disabled) onToggle(layer.id);
            }}
            className={`px-2.5 py-1 rounded-full text-xs font-label flex items-center gap-1.5 transition-colors border ${
              disabled
                ? "opacity-40 cursor-not-allowed border-outline-variant text-on-surface-variant"
                : on
                  ? "bg-primary text-on-primary border-primary"
                  : "border-outline-variant text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            }`}
          >
            <span
              className="material-symbols-outlined"
              style={{ fontSize: "14px" }}
            >
              {layer.icon}
            </span>
            <span>{layer.label}</span>
          </button>
        );
      })}
    </div>
  );
}
