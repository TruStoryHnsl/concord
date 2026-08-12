import {
  describe,
  expect,
  it,
  vi,
  beforeEach,
  afterEach,
} from "vitest";

// Hoist the Tauri-core invoke mock so it's installed before the SUT's
// dynamic import resolves (same pattern as hostingProfile.test.ts).
const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

// Stub only `isTauri` so each test pins the environment explicitly.
vi.mock("../servitude", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../servitude")>();
  return { ...actual, isTauri: vi.fn() };
});

import * as servitudeApi from "../servitude";
import {
  fetchMeshGraph,
  subscribeToMeshGraph,
  EMPTY_MESH_GRAPH,
} from "../meshGraph";

const isTauriMock = vi.mocked(servitudeApi.isTauri);

describe("meshGraph web bridge", () => {
  let fetchOriginal: typeof globalThis.fetch | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
    fetchMock = vi.fn();
    fetchOriginal = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
    vi.useRealTimers();
  });

  afterEach(() => {
    if (fetchOriginal) globalThis.fetch = fetchOriginal;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    else delete (globalThis as any).fetch;
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------
  // fetchMeshGraph — web path GETs the HTTP topology endpoint
  // -----------------------------------------------------------------

  it("web path GETs /api/mesh/topology and maps snake_case -> camelCase", async () => {
    isTauriMock.mockReturnValue(false);
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          nodes: [
            { peer_id: "hub.example.com", hop_distance: 0 },
            { peer_id: "matrix.org", hop_distance: 1 },
          ],
          edges: [{ a: "hub.example.com", b: "matrix.org" }],
          hub_enabled: true,
          relay: true,
          backup_blob_count: 3,
          source: "federation",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const graph = await fetchMeshGraph();

    // Hit the right endpoint, no Tauri command.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/mesh/topology");
    expect(invokeMock).not.toHaveBeenCalled();

    // Wire -> UI mapping: peer_id->peerId, hop_distance->hopDistance.
    // WS-8 (d2db221) added `viaWg` to every mapped node (defaulting to
    // false when the wire omits via_wg), so the strict shape now carries it.
    expect(graph.nodes).toEqual([
      { peerId: "hub.example.com", hopDistance: 0, viaWg: false },
      { peerId: "matrix.org", hopDistance: 1, viaWg: false },
    ]);
    expect(graph.edges).toEqual([{ a: "hub.example.com", b: "matrix.org" }]);

    // Hub role surfaced for the map banner.
    expect(graph.hub).toEqual({
      hubEnabled: true,
      relay: true,
      backupBlobCount: 3,
      source: "federation",
    });
  });

  it("web path returns the empty graph (graceful) on a non-2xx response", async () => {
    isTauriMock.mockReturnValue(false);
    fetchMock.mockResolvedValueOnce(new Response("nope", { status: 503 }));

    const graph = await fetchMeshGraph();
    // The map must NOT crash — it renders the empty state instead.
    expect(graph).toEqual(EMPTY_MESH_GRAPH);
  });

  it("web path returns the empty graph (graceful) when fetch throws", async () => {
    isTauriMock.mockReturnValue(false);
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const graph = await fetchMeshGraph();
    expect(graph).toEqual(EMPTY_MESH_GRAPH);
  });

  it("native path uses the mesh_graph_snapshot Tauri command, not HTTP", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValueOnce({
      nodes: [{ peer_id: "12D3KooWLocal", hop_distance: 0 }],
      edges: [],
    });

    const graph = await fetchMeshGraph();

    expect(invokeMock).toHaveBeenCalledWith("mesh_graph_snapshot");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(graph.nodes).toEqual([
      { peerId: "12D3KooWLocal", hopDistance: 0, viaWg: false },
    ]);
    // Native has no hub role attached.
    expect(graph.hub).toBeUndefined();
  });

  // -----------------------------------------------------------------
  // WS-8 — a WG-tunnel peer is mapped as a LAN-like node the map renders
  // (viaWg true), not dropped. This is the client half of the seam whose
  // Rust half is asserted in src-tauri/src/servitude/lan_map.rs.
  // -----------------------------------------------------------------
  it("native path maps via_wg=true onto the node so the map shows it 'via tunnel'", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValueOnce({
      nodes: [
        { peer_id: "12D3KooWLan", hop_distance: 1 },
        { peer_id: "12D3KooWTunnel", hop_distance: 1, via_wg: true },
      ],
      edges: [],
    });

    const graph = await fetchMeshGraph();

    const lan = graph.nodes.find((n) => n.peerId === "12D3KooWLan");
    const tunnel = graph.nodes.find((n) => n.peerId === "12D3KooWTunnel");
    // The genuine LAN peer is NOT flagged wg-local...
    expect(lan?.viaWg).toBe(false);
    // ...but the tunnel-reached peer IS, so MeshMap renders it as a
    // reachable "via tunnel" node at hop distance 1, not a distant island.
    expect(tunnel?.viaWg).toBe(true);
    expect(tunnel?.hopDistance).toBe(1);
  });

  // -----------------------------------------------------------------
  // subscribeToMeshGraph — web path polls; native wires the event
  // -----------------------------------------------------------------

  it("web subscription polls on an interval and the teardown stops it", () => {
    vi.useFakeTimers();
    isTauriMock.mockReturnValue(false);
    const onChanged = vi.fn();

    const teardown = subscribeToMeshGraph(onChanged);
    expect(onChanged).not.toHaveBeenCalled(); // not fired synchronously

    vi.advanceTimersByTime(5000);
    expect(onChanged).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10000);
    expect(onChanged).toHaveBeenCalledTimes(3);

    // Teardown stops the polling.
    teardown();
    vi.advanceTimersByTime(20000);
    expect(onChanged).toHaveBeenCalledTimes(3);
  });
});
