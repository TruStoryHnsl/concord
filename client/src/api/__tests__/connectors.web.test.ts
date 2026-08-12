/**
 * Cold-session coverage for the WEB reticulum-mesh branch of
 * `fetchConnectorLayerGraph` (client/src/api/connectors.ts) — the data
 * layer that turns a docker pillar's `GET /api/reticulum/mesh` snapshot
 * into the node/edge graph the MeshMap renders.
 *
 * N2 cold-reader test: a web build (no Tauri) with a bound account asks
 * for the "reticulum" layer. The user-visible outcome is that the
 * Reticulum layer becomes AVAILABLE (a non-empty graph) and draws the
 * pillar as `self` plus every heard announce as an `announce-peer` node
 * carrying its hop count — with stale announces aged to offline. We drive
 * it through the real fetch path (stubbed transport) so the wire mapping
 * (snake_case pillar JSON → camelCase MeshGraph) is exercised, not mocked
 * away.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchConnectorLayerGraph } from "../connectors";
import { useAuthStore } from "../../stores/auth";

const PILLAR = "aa".repeat(16);
const PEER_ONLINE = "bb".repeat(16);
const PEER_STALE = "cc".repeat(16);

function meshResponse() {
  const now = Date.now() / 1000;
  return {
    running: true,
    dest: PILLAR,
    interfaces: [{ name: "TCPClientInterface[dev]", online: true }],
    announces: [
      { dest: PEER_ONLINE, hops: 2, name: "peer-online", last_heard: now - 10 },
      // Heard ~40 min ago — past the 30-min online window → offline.
      { dest: PEER_STALE, hops: null, name: null, last_heard: now - 40 * 60 },
    ],
  };
}

describe("web reticulum mesh — pillar snapshot becomes the map graph", () => {
  beforeEach(() => {
    // Web build: no Tauri global.
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    useAuthStore.setState({ accessToken: "web-session-token" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({ accessToken: null });
  });

  it("renders the pillar as self and announces as announce-peers with hops", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify(meshResponse()), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    const graph = await fetchConnectorLayerGraph("reticulum");

    // It actually hit the pillar's mesh endpoint.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/reticulum/mesh");

    // The layer is available: a non-empty graph with the pillar rooted as self.
    const self = graph.nodes.find((n) => n.nodeKind === "self");
    expect(self).toBeDefined();
    expect(self?.peerId).toBe(PILLAR);
    expect(self?.hopDistance).toBe(0);

    // Both announces surface as announce-peer nodes.
    const online = graph.nodes.find((n) => n.peerId === PEER_ONLINE);
    const stale = graph.nodes.find((n) => n.peerId === PEER_STALE);
    expect(online?.nodeKind).toBe("announce-peer");
    expect(online?.hopCount).toBe(2);
    expect(online?.connectionState).toBe("online");
    expect(stale?.nodeKind).toBe("announce-peer");
    expect(stale?.connectionState).toBe("offline");

    // The pillar links to each announced peer (an edge the map draws).
    const edgeTargets = graph.edges
      .filter((e) => e.a === PILLAR)
      .map((e) => e.b);
    expect(edgeTargets).toContain(PEER_ONLINE);
    expect(edgeTargets).toContain(PEER_STALE);
  });

  it("degrades to an empty graph when the pillar node isn't running", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ running: false, dest: null, interfaces: [], announces: [] }), {
        status: 200,
      }),
    );
    const graph = await fetchConnectorLayerGraph("reticulum");
    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
  });

  it("only the reticulum layer resolves on web — others are empty", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const graph = await fetchConnectorLayerGraph("meshtastic");
    expect(graph.nodes).toHaveLength(0);
    // A non-reticulum web layer must not even reach the network.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
