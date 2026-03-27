import { describe, it, expect, beforeEach } from "vitest";
import { useMeshStore } from "./mesh";

describe("useMeshStore", () => {
  beforeEach(() => {
    useMeshStore.setState({
      nearbyPeers: [],
      nodeStatus: null,
      tunnels: [],
    });
  });

  it("addPeer inserts a new peer", () => {
    const peer = {
      peerId: "12D3KooWPeer1",
      addresses: ["/ip4/192.168.1.10/udp/4001"],
      displayName: "Alice",
    };

    useMeshStore.getState().addPeer(peer);

    const state = useMeshStore.getState();
    expect(state.nearbyPeers).toHaveLength(1);
    expect(state.nearbyPeers[0]!.peerId).toBe("12D3KooWPeer1");
  });

  it("addPeer updates an existing peer by peerId", () => {
    const peer = {
      peerId: "12D3KooWPeer1",
      addresses: ["/ip4/192.168.1.10/udp/4001"],
      displayName: "Alice",
    };

    useMeshStore.getState().addPeer(peer);

    const updatedPeer = {
      ...peer,
      displayName: "Alice (updated)",
    };
    useMeshStore.getState().addPeer(updatedPeer);

    const state = useMeshStore.getState();
    expect(state.nearbyPeers).toHaveLength(1);
    expect(state.nearbyPeers[0]!.displayName).toBe("Alice (updated)");
  });

  it("removePeer filters out the peer by id", () => {
    useMeshStore.setState({
      nearbyPeers: [
        { peerId: "peer1", addresses: [] },
        { peerId: "peer2", addresses: [] },
      ],
    });

    useMeshStore.getState().removePeer("peer1");

    const state = useMeshStore.getState();
    expect(state.nearbyPeers).toHaveLength(1);
    expect(state.nearbyPeers[0]!.peerId).toBe("peer2");
  });

  it("addPeer handles null/undefined guard", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useMeshStore.getState().addPeer(null as any);
    expect(useMeshStore.getState().nearbyPeers).toHaveLength(0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    useMeshStore.getState().addPeer({} as any);
    expect(useMeshStore.getState().nearbyPeers).toHaveLength(0);
  });

  it("updateConnectionCount creates nodeStatus if null", () => {
    expect(useMeshStore.getState().nodeStatus).toBeNull();

    useMeshStore.getState().updateConnectionCount(5);

    const status = useMeshStore.getState().nodeStatus;
    expect(status).not.toBeNull();
    expect(status!.connectedPeers).toBe(5);
    expect(status!.isOnline).toBe(true);
  });

  it("updateConnectionCount updates existing nodeStatus", () => {
    useMeshStore.setState({
      nodeStatus: { isOnline: true, connectedPeers: 3, peerId: "myPeer" },
    });

    useMeshStore.getState().updateConnectionCount(10);

    const status = useMeshStore.getState().nodeStatus;
    expect(status!.connectedPeers).toBe(10);
    expect(status!.peerId).toBe("myPeer");
  });
});
