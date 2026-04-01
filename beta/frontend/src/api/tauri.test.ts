import { describe, it, expect } from "vitest";
import {
  getIdentity,
  getNodeStatus,
  getNearbyPeers,
  getServers,
  getVoiceState,
} from "./tauri";
import type {
  Identity,
  NodeStatus,
  PeerInfo,
  ServerPayload,
  VoiceState,
} from "./tauri";

// Running outside Tauri, so the mock layer is active.

describe("tauri mock layer", () => {
  it("getIdentity returns expected shape", async () => {
    const identity: Identity = await getIdentity();
    expect(identity).toHaveProperty("peerId");
    expect(identity).toHaveProperty("displayName");
    expect(typeof identity.peerId).toBe("string");
    expect(typeof identity.displayName).toBe("string");
  });

  it("getNodeStatus returns online status", async () => {
    const status: NodeStatus = await getNodeStatus();
    expect(status).toHaveProperty("isOnline");
    expect(status).toHaveProperty("connectedPeers");
    expect(status).toHaveProperty("peerId");
    expect(typeof status.isOnline).toBe("boolean");
    expect(typeof status.connectedPeers).toBe("number");
  });

  it("getNearbyPeers returns array of peers with required fields", async () => {
    const peers: PeerInfo[] = await getNearbyPeers();
    expect(Array.isArray(peers)).toBe(true);
    expect(peers.length).toBeGreaterThan(0);
    for (const peer of peers) {
      expect(peer).toHaveProperty("peerId");
      expect(peer).toHaveProperty("addresses");
      expect(typeof peer.peerId).toBe("string");
      expect(Array.isArray(peer.addresses)).toBe(true);
    }
  });

  it("getServers returns array of servers with channels", async () => {
    const servers: ServerPayload[] = await getServers();
    expect(Array.isArray(servers)).toBe(true);
    expect(servers.length).toBeGreaterThan(0);
    const first = servers[0]!;
    expect(first).toHaveProperty("id");
    expect(first).toHaveProperty("name");
    expect(first).toHaveProperty("ownerId");
    expect(first).toHaveProperty("visibility");
    expect(first).toHaveProperty("channels");
    expect(Array.isArray(first.channels)).toBe(true);
  });

  it("getVoiceState returns inactive state by default", async () => {
    const state: VoiceState = await getVoiceState();
    expect(state).toHaveProperty("isInVoice");
    expect(state).toHaveProperty("isMuted");
    expect(state).toHaveProperty("isDeafened");
    expect(state).toHaveProperty("participants");
    expect(state.isInVoice).toBe(false);
    expect(Array.isArray(state.participants)).toBe(true);
  });
});
