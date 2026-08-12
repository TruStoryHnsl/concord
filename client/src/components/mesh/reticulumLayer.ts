/**
 * Reticulum-layer → MeshCanvas mapping (F7a).
 *
 * Pure translation from the live Reticulum discovery graph
 * ([`MeshGraphNode`]/[`MeshGraphEdge`], enriched by the Rust connector) into
 * the [`MeshNode`]/[`MeshEdge`] the shared [`MeshCanvas`] draws. Kept out of
 * the React component so the node-kind → visual-treatment decision and the
 * `reticulum:<hash>` namespacing are unit-testable without mounting anything.
 *
 * Namespacing: Reticulum node ids are `reticulum:<32-hex-hash>` so they never
 * collide with Concord base58 peer ids (mirrors the `meshtastic:<num>` scheme).
 * The raw hash is preserved as the identicon seed + short label.
 */

import type { MeshGraph, MeshGraphNode } from "../../api/meshGraph";
import type { MeshNode, MeshEdge } from "./MeshCanvas";
import { identiconDataUri } from "./identicon";

/** Id namespace prefix for Reticulum nodes. */
export const RETICULUM_ID_PREFIX = "reticulum:";

/** Namespace a raw Reticulum destination hash into a collision-free node id. */
export function reticulumNodeId(hash: string): string {
  return `${RETICULUM_ID_PREFIX}${hash}`;
}

/** Shorten a 32-hex Reticulum hash for a node label. */
function shortHash(hash: string): string {
  return hash.length > 10 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
}

/**
 * Map one enriched Reticulum graph node to a canvas node. The `nodeKind`
 * drives the visual treatment (see [`MeshNode.ret`]); an identicon is attached
 * only for the identity-bearing kinds (`self` / `announce-peer`), reachability
 * becomes the `offline` flag + dashed edges, and the raw hop count is shown as
 * a badge.
 */
export function toReticulumMeshNode(n: MeshGraphNode): MeshNode {
  const hash = n.peerId;
  const ret = n.nodeKind ?? "announce-peer";
  const offline = n.connectionState === "offline";
  const short = shortHash(hash);
  const label =
    ret === "self"
      ? "Reticulum"
      : ret === "infrastructure"
        ? `⛨ ${short}`
        : short;
  return {
    id: reticulumNodeId(hash),
    label,
    // The Reticulum self identity is a distinct node, not the libp2p host, so
    // it rings alongside hop 1 rather than the center.
    hop: ret === "self" ? 1 : (n.hopDistance ?? 1),
    kind: "known",
    ret,
    identicon:
      ret === "self" || ret === "announce-peer"
        ? identiconDataUri(hash)
        : undefined,
    offline,
    hopBadge: n.hopCount ?? n.hopDistance ?? undefined,
    transportMarker: n.transport === true && ret !== "self",
  };
}

/** Map the full Reticulum layer graph to canvas nodes. */
export function toReticulumMeshNodes(graph: MeshGraph): MeshNode[] {
  return graph.nodes.map(toReticulumMeshNode);
}

/**
 * Map the Reticulum layer edges to canvas edges, namespacing both endpoints
 * and dashing any edge touching an offline node. `offlineIds` is the set of
 * already-namespaced node ids currently marked offline.
 */
export function toReticulumMeshEdges(
  graph: MeshGraph,
  offlineIds: ReadonlySet<string>,
): MeshEdge[] {
  return graph.edges.map((e) => {
    const from = reticulumNodeId(e.a);
    const to = reticulumNodeId(e.b);
    return { from, to, dashed: offlineIds.has(from) || offlineIds.has(to) };
  });
}
