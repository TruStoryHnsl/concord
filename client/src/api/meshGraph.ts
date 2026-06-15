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
 * Web build: the browser has no swarm, so it sources the graph over HTTP
 * from the server's `GET /api/mesh/topology` endpoint instead (the docker
 * node assembles a real topology from its federation neighbors + hub role
 * — see `server/routers/mesh.py`). `fetchMeshGraph()` GETs that endpoint
 * and `subscribeToMeshGraph()` polls it on a timer. The two surfaces
 * (native Tauri command, web HTTP) return the SAME `MeshGraph` shape, so
 * `MeshMap` renders identically either way.
 */

import { isTauri } from "./servitude";
import { getApiBase } from "./serverUrl";

/** Web poll interval for the HTTP topology endpoint (ms). The docker
 * node's federation-derived topology changes slowly (an admin editing the
 * allowlist), so a 5s poll is ample and cheap. */
const WEB_POLL_INTERVAL_MS = 5000;

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

/**
 * Raw wire shape from the web `GET /api/mesh/topology` endpoint. Extends
 * the native snapshot with this node's hub (relay/backup) role so the web
 * map can surface the docker node's "big brother" infrastructure status.
 */
interface MeshTopologyWire extends MeshGraphWire {
  hub_enabled: boolean;
  relay: boolean;
  backup_blob_count: number;
  source: string;
}

/**
 * The docker node's hub (relay + backup) role, surfaced on the web map.
 * `null` on native (the desktop install is not a hub) and until the first
 * web fetch resolves.
 */
export interface MeshHubRole {
  /** `CONCORD_HUB` is set — this node relays + stores encrypted backups. */
  hubEnabled: boolean;
  /** This node relays mesh traffic for others (== hubEnabled today). */
  relay: boolean;
  /** Count of encrypted backup blobs held (count only — never identities). */
  backupBlobCount: number;
  /** Where the graph came from: `rust_snapshot` (real libp2p) or `federation`. */
  source: string;
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
  /**
   * The local node's hub (relay/backup) role. Present only on the web /
   * docker build (sourced from `GET /api/mesh/topology`); `undefined` on
   * native, where the desktop install is not a hub. Lets the map surface
   * the docker node's "big brother" relay + backup status.
   */
  hub?: MeshHubRole;
}

/** The empty graph — the correct "no mesh / web mode" state. */
export const EMPTY_MESH_GRAPH: MeshGraph = { nodes: [], edges: [] };

/**
 * One-shot mesh-graph snapshot.
 *
 * - **Native** (Tauri): reads the in-process libp2p graph via the
 *   `mesh_graph_snapshot` command. Errors propagate.
 * - **Web / docker**: GETs `/api/mesh/topology`, the server-assembled
 *   topology (federation neighbors + hub role). The `hub` field carries
 *   the docker node's relay/backup status. A network/HTTP error resolves
 *   to the empty graph (the map shows a graceful empty state) rather than
 *   throwing — the web map must never hard-crash on a transient fetch
 *   failure.
 */
export async function fetchMeshGraph(): Promise<MeshGraph> {
  if (!isTauri()) {
    return fetchMeshGraphWeb();
  }
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
 * Web/docker mesh-graph fetch over HTTP. Maps the snake_case wire shape
 * (matching `server/routers/mesh.py`) into the camelCase UI type and
 * attaches the hub role. On any error, returns the empty graph so the map
 * renders its graceful empty state.
 */
async function fetchMeshGraphWeb(): Promise<MeshGraph> {
  try {
    const resp = await fetch(`${getApiBase()}/mesh/topology`, {
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) {
      console.warn(
        `[meshGraph] /api/mesh/topology returned ${resp.status}`,
      );
      return EMPTY_MESH_GRAPH;
    }
    const wire = (await resp.json()) as MeshTopologyWire;
    return {
      nodes: (wire.nodes ?? []).map((n) => ({
        peerId: n.peer_id,
        hopDistance: n.hop_distance,
      })),
      edges: (wire.edges ?? []).map((e) => ({ a: e.a, b: e.b })),
      hub: {
        hubEnabled: !!wire.hub_enabled,
        relay: !!wire.relay,
        backupBlobCount: wire.backup_blob_count ?? 0,
        source: wire.source ?? "federation",
      },
    };
  } catch (err) {
    console.warn(
      "[meshGraph] web topology fetch failed:",
      err instanceof Error ? err.message : err,
    );
    return EMPTY_MESH_GRAPH;
  }
}

/**
 * Subscribe to mesh-graph change notifications. The callback fires (with
 * no argument — it's a "re-pull" signal) every time the topology may have
 * moved. Returns a teardown the caller MUST invoke on unmount.
 *
 * - **Native** (Tauri): wires the push-based `mesh_graph_changed` event;
 *   the callback fires exactly when the swarm topology changes.
 * - **Web / docker**: the browser has no push channel, so it POLLS the
 *   HTTP topology endpoint on a fixed interval (`WEB_POLL_INTERVAL_MS`),
 *   firing the callback on each tick so the map re-pulls. The teardown
 *   clears the interval.
 */
export function subscribeToMeshGraph(onChanged: () => void): () => void {
  if (!isTauri()) {
    const handle = setInterval(onChanged, WEB_POLL_INTERVAL_MS);
    return () => clearInterval(handle);
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
