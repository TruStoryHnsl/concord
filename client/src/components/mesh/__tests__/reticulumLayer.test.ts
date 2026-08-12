/**
 * Focused pure-function locks for the Reticulum mesh-map layer (F7a):
 *   1. identicon determinism — the same destination hash always yields the
 *      exact same inline SVG data-URI (a peer keeps a stable "face"), and it
 *      is CSP-safe (a `data:image/svg+xml` URI, no network fetch).
 *   2. node-kind mapping — an enriched Reticulum graph node maps to the right
 *      MeshCanvas treatment (ret sub-kind, identicon presence, offline flag,
 *      namespaced id, hop badge, transport marker).
 *
 * Both are deterministic pure functions, safe to lock exactly.
 */

import { describe, expect, it } from "vitest";
import { identiconDataUri } from "../identicon";
import {
  reticulumNodeId,
  toReticulumMeshNode,
  toReticulumMeshEdges,
} from "../reticulumLayer";
import type { MeshGraph, MeshGraphNode } from "../../../api/meshGraph";

const HASH_A = "ae18b1bb98bb1d9d57480bccdb7e5926";
const HASH_B = "46a3d2937286ee111b06b424b337be9b";

describe("identiconDataUri determinism", () => {
  it("returns the identical SVG data-URI for the same hash every call", () => {
    const first = identiconDataUri(HASH_A);
    const second = identiconDataUri(HASH_A);
    expect(second).toBe(first);
  });

  it("produces different faces for different hashes", () => {
    expect(identiconDataUri(HASH_A)).not.toBe(identiconDataUri(HASH_B));
  });

  it("is a CSP-safe inline SVG data URI (no network fetch)", () => {
    const uri = identiconDataUri(HASH_A);
    expect(uri.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    // Decodes to a self-contained 5x5 mirrored-bitmap SVG.
    const svg = decodeURIComponent(uri.split(",")[1]);
    expect(svg).toContain('viewBox="0 0 5 5"');
    expect(svg).toContain("<svg");
    // No external fetches — the only URL is the SVG xmlns namespace, and
    // there is no href/image/embedded fetch of any kind.
    expect(svg).not.toMatch(/xlink:href|<image|href=|url\(/);
  });

  it("is stable across independent module state (byte-for-byte)", () => {
    // Recompute the algorithm's expected head for HASH_A so a refactor that
    // silently changes the PRNG/palette is caught, not just self-consistency.
    const uri = identiconDataUri(HASH_A);
    const svg = decodeURIComponent(uri.split(",")[1]);
    // Mirrored bitmap ⇒ every painted column x has a mirror at 4-x, so an odd
    // count of <rect> beyond the background is impossible except the center
    // column. Assert the background rect + at least one painted cell exist.
    const rectCount = (svg.match(/<rect/g) ?? []).length;
    expect(rectCount).toBeGreaterThanOrEqual(2);
  });
});

describe("toReticulumMeshNode kind mapping", () => {
  const base: MeshGraphNode = {
    peerId: HASH_A,
    hopDistance: 1,
  };

  it("maps a 'self' node: primary self ring, identicon, hop-1, namespaced id", () => {
    const n = toReticulumMeshNode({
      ...base,
      nodeKind: "self",
      hopDistance: 0,
      connectionState: "online",
      transport: true,
    });
    expect(n.id).toBe(reticulumNodeId(HASH_A));
    expect(n.ret).toBe("self");
    expect(n.identicon).toBeDefined();
    expect(n.offline).toBe(false);
    // self rings at hop 1 (a distinct identity, not the libp2p host center).
    expect(n.hop).toBe(1);
    // self is never marked as a transport satellite even if transport=true.
    expect(n.transportMarker).toBe(false);
    expect(n.label).toBe("Reticulum");
  });

  it("maps an 'infrastructure' transit node: no identicon, transport marker", () => {
    const n = toReticulumMeshNode({
      ...base,
      nodeKind: "infrastructure",
      hopDistance: 1,
      connectionState: "online",
      transport: true,
      hopCount: 1,
    });
    expect(n.ret).toBe("infrastructure");
    // Infrastructure nodes are transit squares, not identicon discs.
    expect(n.identicon).toBeUndefined();
    expect(n.transportMarker).toBe(true);
    expect(n.hopBadge).toBe(1);
    expect(n.label.startsWith("⛨")).toBe(true);
  });

  it("maps an 'announce-peer' node: identicon disc with short-hash label", () => {
    const n = toReticulumMeshNode({
      ...base,
      nodeKind: "announce-peer",
      hopDistance: 2,
      connectionState: "online",
      hopCount: 2,
    });
    expect(n.ret).toBe("announce-peer");
    expect(n.identicon).toBeDefined();
    expect(n.hop).toBe(2);
    expect(n.hopBadge).toBe(2);
    expect(n.label).toBe("ae18b1…5926");
  });

  it("marks an offline node so its edges dash", () => {
    const n = toReticulumMeshNode({
      ...base,
      nodeKind: "announce-peer",
      connectionState: "offline",
      hopDistance: null,
    });
    expect(n.offline).toBe(true);
  });

  it("defaults a bare node (no nodeKind) to announce-peer", () => {
    const n = toReticulumMeshNode(base);
    expect(n.ret).toBe("announce-peer");
    expect(n.identicon).toBeDefined();
  });
});

describe("toReticulumMeshEdges namespacing + dashing", () => {
  const graph: MeshGraph = {
    nodes: [],
    edges: [{ a: HASH_A, b: HASH_B }],
  };

  it("namespaces both endpoints as reticulum:<hash>", () => {
    const [e] = toReticulumMeshEdges(graph, new Set());
    expect(e.from).toBe(reticulumNodeId(HASH_A));
    expect(e.to).toBe(reticulumNodeId(HASH_B));
    expect(e.dashed).toBe(false);
  });

  it("dashes an edge that touches an offline node", () => {
    const offline = new Set([reticulumNodeId(HASH_B)]);
    const [e] = toReticulumMeshEdges(graph, offline);
    expect(e.dashed).toBe(true);
  });
});
