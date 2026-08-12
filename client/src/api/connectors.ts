/**
 * External-mesh connectors (F7 / W2.4 — Reticulum, Meshtastic, LoRa).
 *
 * A connector bridges Concord onto an external mesh and registers a
 * `MeshLayer` so its nodes/edges feed the same `MeshCanvas` the Concord
 * layer uses (see `client/src/components/mesh/`). The settings "Connectors"
 * menu lists every connector with an enable/disable toggle plus per-connector
 * config (e.g. the Meshtastic device interface).
 *
 * Native-only: connectors live in the `src-tauri` swarm, so on web every
 * call here is inert. The UI stays callable so call sites don't branch on
 * platform — `listConnectors()` returns the static catalog (all disabled,
 * marked native-only) and mutations are no-ops on web.
 *
 * The native side gates each connector behind a Cargo feature
 * (`reticulum`, `meshtastic`); a connector whose feature isn't compiled in
 * reports `compiledIn: false` so the UI can show "not in this build".
 */

import { isTauri } from "./servitude";
import type { MeshLayerId } from "../components/mesh/LayerToggles";
import { EMPTY_MESH_GRAPH, type MeshGraph } from "./meshGraph";

/** How a Meshtastic connector reaches the radio. Mirrors the Rust
 *  `MeshtasticInterface` enum. */
export type MeshtasticInterfaceKind = "ble" | "serial" | "tcp";

/** A Meshtastic device/interface selection. */
export interface MeshtasticInterfaceConfig {
  kind: MeshtasticInterfaceKind;
  /** BLE peripheral id (kind=ble) or serial port (kind=serial) or host (kind=tcp). */
  target?: string;
  /** TCP port (kind=tcp only). */
  port?: number;
  /** Serial baud (kind=serial only). */
  baud?: number;
}

/** One connector row in the settings menu. */
export interface ConnectorDescriptor {
  /** Stable id — also the mesh layer id it registers. */
  id: MeshLayerId;
  /** Display label. */
  label: string;
  /** Material-symbols icon. */
  icon: string;
  /** Short one-line description for the menu. */
  description: string;
  /** Whether the native build compiled this connector's Cargo feature. */
  compiledIn: boolean;
  /** Whether the connector is currently enabled (registers its layer). */
  enabled: boolean;
}

/**
 * The static connector catalog. The native side overlays runtime state
 * (compiledIn / enabled) onto this; web returns it as-is (all disabled).
 */
export const CONNECTOR_CATALOG: Omit<
  ConnectorDescriptor,
  "compiledIn" | "enabled"
>[] = [
  {
    id: "reticulum",
    label: "Reticulum",
    icon: "lan",
    description:
      "Reticulum overlay network (rnsd). Routes Concord over an encrypted mesh of TCP / serial / LoRa interfaces.",
  },
  {
    id: "meshtastic",
    label: "Meshtastic",
    icon: "cell_tower",
    description:
      "Meshtastic LoRa radios over BLE (mobile), USB serial (desktop), or TCP (networked node). Bridges text to a channel.",
  },
  {
    id: "lora",
    label: "LoRa",
    icon: "settings_input_antenna",
    description:
      "Generic LoRa interface. Configured through the Reticulum or Meshtastic connector that owns the radio.",
  },
];

/** Raw wire shape from the Rust `connectors_list` command (snake_case). */
interface ConnectorWire {
  id: string;
  compiled_in: boolean;
  enabled: boolean;
}

/**
 * List the connectors with their current native state. On web, returns the
 * catalog with everything disabled and `compiledIn: false` (the browser has
 * no swarm to run a connector in).
 */
export async function listConnectors(): Promise<ConnectorDescriptor[]> {
  const base = CONNECTOR_CATALOG.map((c) => ({
    ...c,
    compiledIn: false,
    enabled: false,
  }));
  if (!isTauri()) return base;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const wire = await invoke<ConnectorWire[]>("connectors_list");
    const byId = new Map(wire.map((w) => [w.id, w]));
    return base.map((c) => {
      const w = byId.get(c.id);
      return w
        ? { ...c, compiledIn: w.compiled_in, enabled: w.enabled }
        : c;
    });
  } catch (err) {
    console.warn("[connectors] list failed:", err);
    return base;
  }
}

/**
 * Enable or disable a connector. Enabling registers its `MeshLayer` (the
 * matching LayerToggles toggle flips to available); disabling removes it.
 * No-op on web.
 */
export async function setConnectorEnabled(
  id: MeshLayerId,
  enabled: boolean,
): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("connectors_set_enabled", { id, enabled });
}

/**
 * Configure the Meshtastic device interface (BLE / serial / TCP). No-op on
 * web. The native side validates and applies it on the next connector start.
 */
export async function setMeshtasticInterface(
  config: MeshtasticInterfaceConfig,
): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("connectors_set_meshtastic_interface", { config });
}

/** Raw wire shape for a connector layer graph (snake_case, mirrors
 *  `MeshGraph` in `meshGraph.ts`). The Reticulum connector additionally emits
 *  the F7a per-node enrichment fields (absent on the Meshtastic layer). */
interface ConnectorLayerNodeWire {
  peer_id: string;
  hop_distance: number | null;
  /** Reticulum node role — see `MeshGraphNode.nodeKind`. */
  node_kind?: "self" | "infrastructure" | "announce-peer" | "interface";
  /** Reticulum reachability — `"online"` | `"offline"`. */
  connection_state?: "online" | "offline";
  /** Reticulum-reported raw hop count (advisory). */
  hop_count?: number;
  /** Reticulum interface the node is reached over. */
  interface_type?: string;
  /** `true` when the node is a Reticulum transit/transport node. */
  transport?: boolean;
}

interface ConnectorLayerWire {
  nodes: ConnectorLayerNodeWire[];
  edges: { a: string; b: string }[];
}

/**
 * Fetch a single external-mesh layer's graph (nodes/edges) for the map. The
 * graph uses the same {@link MeshGraph} shape the Concord layer emits, so the
 * `MeshCanvas` renders every layer through one code path. Node ids are
 * namespaced (e.g. `meshtastic:<num>`) so they never collide with Concord
 * base58 peer ids.
 *
 * Native: the engine's connector graph via Tauri IPC. Web/docker:
 * the RETICULUM layer is served by the instance's own pillar node
 * (`GET /api/reticulum/mesh` — identity, live interfaces, announce
 * table), which is what makes the docker instance a real mesh
 * entrypoint; other layers resolve empty on web.
 */
export async function fetchConnectorLayerGraph(
  layerId: MeshLayerId,
): Promise<MeshGraph> {
  if (!isTauri()) {
    if (layerId !== "reticulum") return EMPTY_MESH_GRAPH;
    try {
      const { getApiBase } = await import("./serverUrl");
      const { useAuthStore } = await import("../stores/auth");
      const token = useAuthStore.getState().accessToken;
      if (!token) return EMPTY_MESH_GRAPH;
      const res = await fetch(`${getApiBase()}/reticulum/mesh`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return EMPTY_MESH_GRAPH;
      const mesh = (await res.json()) as {
        running: boolean;
        dest: string | null;
        display_name?: string | null;
        interfaces: Array<{ name: string; online: boolean }>;
        announces: Array<{
          dest: string;
          hops: number | null;
          name: string | null;
          last_heard: number;
        }>;
      };
      if (!mesh.running || !mesh.dest) return EMPTY_MESH_GRAPH;
      const now = Date.now() / 1000;
      const nodes = [
        {
          peerId: mesh.dest,
          hopDistance: 0,
          nodeKind: "self" as const,
          connectionState: "online" as const,
          hopCount: 0,
          interfaceType:
            mesh.interfaces.find((i) => i.online)?.name ?? undefined,
          transport: true,
        },
        ...mesh.announces.map((a) => ({
          peerId: a.dest,
          hopDistance: a.hops,
          nodeKind: "announce-peer" as const,
          connectionState:
            now - a.last_heard < 30 * 60
              ? ("online" as const)
              : ("offline" as const),
          hopCount: a.hops ?? undefined,
          interfaceType: a.name ?? undefined,
          transport: false,
        })),
      ];
      const edges = mesh.announces.map((a) => ({ a: mesh.dest as string, b: a.dest }));
      return { nodes, edges } as MeshGraph;
    } catch (err) {
      console.warn("[connectors] web reticulum mesh fetch failed:", err);
      return EMPTY_MESH_GRAPH;
    }
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const wire = await invoke<ConnectorLayerWire>("connectors_layer_graph", {
      id: layerId,
    });
    return {
      nodes: wire.nodes.map((n) => ({
        peerId: n.peer_id,
        hopDistance: n.hop_distance,
        // Reticulum-layer enrichment (undefined on other layers).
        nodeKind: n.node_kind,
        connectionState: n.connection_state,
        hopCount: n.hop_count,
        interfaceType: n.interface_type,
        transport: n.transport,
      })),
      edges: wire.edges.map((e) => ({ a: e.a, b: e.b })),
    };
  } catch (err) {
    console.warn("[connectors] layer graph fetch failed:", err);
    return EMPTY_MESH_GRAPH;
  }
}
