/**
 * Mesh-topology graph (Wave-1 W1.1 / Feature F2, Concord layer).
 *
 * The native swarm assembles an N-hop mesh graph from signed
 * `NeighborAnnounce` gossip (see `src-tauri/src/servitude/mesh_topology.rs`)
 * and exposes it two ways, mirroring the LAN-map surface:
 *
 *   1. **Pull** — the `mesh_graph_snapshot` command returns the current
 *      graph (nodes with per-node hop distances + undirected edges) in one
 *      read. The map hydrates from this on mount.
 *   2. **Push** — the Rust side emits a payload-less `mesh_graph_changed`
 *      Tauri event whenever the topology moves (a peer connected /
 *      disconnected, an announce folded in). The map uses it as a cheap
 *      "re-pull the snapshot" signal, debounced so a burst coalesces.
 *
 * Web build: the browser has no swarm, so this surface is no-op on web —
 * `fetchMeshGraph()` resolves to an empty graph and `subscribeToMeshGraph`
 * never fires. Consumers should guard with `isTauri()` themselves; the API
 * stays callable so call sites don't need conditional imports.
 */

import { isTauri } from "./servitude";

/** One node in the mesh graph as the Rust side serializes it (snake_case). */
interface MeshGraphNodeWire {
  peer_id: string;
  /** BFS hop distance from the local node; `null` when unreachable. */
  hop_distance: number | null;
}

/** One undirected edge (endpoints lexicographically ordered, snake_case). */
interface MeshGraphEdgeWire {
  a: string;
  b: string;
}

/** Raw wire shape from the Rust `mesh_graph_snapshot` command. */
interface MeshGraphWire {
  nodes: MeshGraphNodeWire[];
  edges: MeshGraphEdgeWire[];
}

/** A node in the assembled mesh graph (camelCase, UI-facing). */
export interface MeshGraphNode {
  /** libp2p PeerId in base58 form. */
  peerId: string;
  /**
   * Hop distance from the local node: `0` = this device, `1` = directly
   * connected, `2+` = farther. `null` when the node is present in the
   * adjacency but unreachable from local (a disjoint island — possible
   * under adversarial gossip input).
   */
  hopDistance: number | null;
}

/** An undirected edge between two peer ids. */
export interface MeshGraphEdge {
  a: string;
  b: string;
}

/** The full assembled mesh-topology snapshot. */
export interface MeshGraph {
  nodes: MeshGraphNode[];
  edges: MeshGraphEdge[];
}

/** The empty graph — the correct "no mesh / web mode" state. */
export const EMPTY_MESH_GRAPH: MeshGraph = { nodes: [], edges: [] };

/**
 * One-shot mesh-graph snapshot. Native-only — resolves to an empty graph
 * on web (no swarm to assemble). Native command errors propagate.
 */
export async function fetchMeshGraph(): Promise<MeshGraph> {
  if (!isTauri()) return EMPTY_MESH_GRAPH;
  const { invoke } = await import("@tauri-apps/api/core");
  const wire = await invoke<MeshGraphWire>("mesh_graph_snapshot");
  return {
    nodes: wire.nodes.map((n) => ({
      peerId: n.peer_id,
      hopDistance: n.hop_distance,
    })),
    edges: wire.edges.map((e) => ({ a: e.a, b: e.b })),
  };
}

/**
 * Subscribe to mesh-graph change notifications. The callback fires (with
 * no argument — it's a "re-pull" signal) every time the native topology
 * moves. Returns a teardown the caller MUST invoke on unmount.
 *
 * Native-only by design — on web the listener is never wired and the
 * returned teardown is a no-op.
 */
export function subscribeToMeshGraph(onChanged: () => void): () => void {
  if (!isTauri()) {
    return () => {};
  }

  let teardown: (() => void) | null = null;
  let cancelled = false;

  void (async () => {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      const unlisten = await listen("mesh_graph_changed", () => {
        onChanged();
      });
      if (cancelled) {
        // Unmounted before the listener attached — tear it down now.
        unlisten();
      } else {
        teardown = unlisten;
      }
    } catch (err) {
      // Web path / Tauri unavailable — the graph stays empty, which is
      // correct (the browser can't observe the mesh anyway).
      console.warn(
        "[meshGraph] failed to attach Tauri event listener:",
        err instanceof Error ? err.message : err,
      );
    }
  })();

  return () => {
    cancelled = true;
    if (teardown) {
      try {
        teardown();
      } catch {
        // Ignore teardown errors.
      }
      teardown = null;
    }
  };
}

/**
 * The maximum hop distance present in a graph (excluding unreachable
 * `null` nodes). Drives the upper bound of the hop-scale slider. Returns
 * `1` for an empty / local-only graph so the slider always has a sane
 * range.
 */
export function maxHopDistance(graph: MeshGraph): number {
  let max = 1;
  for (const n of graph.nodes) {
    if (n.hopDistance != null && n.hopDistance > max) {
      max = n.hopDistance;
    }
  }
  return max;
}
