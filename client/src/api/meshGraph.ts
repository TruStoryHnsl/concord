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

// ---------------------------------------------------------------------------
// W1.3 / F4b — local-spring (one-hop-up) render
// ---------------------------------------------------------------------------

/**
 * Trust tier a LAN peer must hold for its remote neighbors to be surfaced
 * as one-hop-up nodes (friend-of-friend opt-in). Mirrors the native
 * `SpringTier` / `TrustTier`. Ordered weakest → strongest.
 */
export type SpringTier = "recent" | "friend" | "close_friend" | "supertrusted";

/** Raw wire shape from the Rust `mesh_local_spring` command (snake_case). */
interface OneHopUpNodeWire {
  peer_id: string;
  reached_via: string;
}

interface LocalSpringWire {
  nodes: OneHopUpNodeWire[];
}

/**
 * One surfaced one-hop-up node: a remote neighbor of a LAN peer, labeled
 * with the LAN peer it was reached through. The render shows it as
 * "reached-via-&lt;reachedVia&gt;".
 */
export interface OneHopUpNode {
  /** libp2p PeerId of the one-hop-up node (hop distance exactly 2). */
  peerId: string;
  /** libp2p PeerId of the LAN peer through which it is reachable. */
  reachedVia: string;
}

/** The local-spring slice — the set of one-hop-up nodes to render. */
export interface LocalSpring {
  nodes: OneHopUpNode[];
}

/** The empty spring — the conservative default (governance off) / web mode. */
export const EMPTY_LOCAL_SPRING: LocalSpring = { nodes: [] };

/**
 * Fetch the local-spring (one-hop-up) slice. Surfaces hop=2 nodes reachable
 * through the operator's LAN peers, gated by the per-trust-tier governance
 * toggle.
 *
 * - `enabled` is the master governance switch. **The conservative default
 *   is `false`** — pass `false` and the result is always empty (no
 *   friend-of-friend exposure). The caller's settings toggle drives this.
 * - `minTier` is the lowest trust tier a LAN peer must hold for its remote
 *   neighbors to be surfaced (only LAN peers at/above this tier become
 *   spring roots).
 *
 * Native-only — resolves to an empty spring on web (no swarm).
 */
export async function fetchLocalSpring(
  enabled: boolean,
  minTier: SpringTier = "friend",
): Promise<LocalSpring> {
  if (!isTauri() || !enabled) return EMPTY_LOCAL_SPRING;
  const { invoke } = await import("@tauri-apps/api/core");
  const wire = await invoke<LocalSpringWire>("mesh_local_spring", {
    enabled,
    minTier,
  });
  return {
    nodes: wire.nodes.map((n) => ({
      peerId: n.peer_id,
      reachedVia: n.reached_via,
    })),
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
