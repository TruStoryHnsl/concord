import { describe, it, expect, vi, beforeEach } from "vitest";

const startMock = vi.fn();
const confirmMock = vi.fn();
const cancelMock = vi.fn();
const commitMock = vi.fn();
vi.mock("../../api/proximityPair", () => ({
  startProximityPair: (...a: unknown[]) => startMock(...a),
  pollProximityPair: vi.fn().mockResolvedValue(null),
  confirmPairing: (...a: unknown[]) => confirmMock(...a),
  cancelPairing: (...a: unknown[]) => cancelMock(...a),
  commitPairedPeer: (...a: unknown[]) => commitMock(...a),
}));

import { useProximityPairStore } from "../proximityPair";

beforeEach(() => {
  useProximityPairStore.setState({ phase: "idle", code: null, error: null, remote: null });
  startMock.mockReset();
  confirmMock.mockReset();
  cancelMock.mockReset();
  commitMock.mockReset();
});

describe("proximityPair store", () => {
  it("begin() calls startProximityPair and reflects pushed states", async () => {
    startMock.mockImplementation(async (_p: unknown, cb: (s: unknown) => void) => {
      cb({ phase: "searching" });
      cb({ phase: "awaitingConfirm", code: "428913" });
      return {};
    });
    await useProximityPairStore.getState().begin({
      peerId: "self", publicKeyHex: "cc", multiaddrs: [], signatureHex: "dd",
    });
    const s = useProximityPairStore.getState();
    expect(s.phase).toBe("awaitingConfirm");
    expect(s.code).toBe("428913");
  });

  it("commits the remote card delivered by the paired event", async () => {
    commitMock.mockResolvedValue("remote-peer-id");
    startMock.mockImplementation(async (_p: unknown, cb: (s: unknown) => void) => {
      cb({
        phase: "paired",
        peerId: "remote-peer-id",
        publicKeyHex: "aa".repeat(32),
        multiaddrs: ["/ip4/10.0.0.2/tcp/4001"],
        signatureHex: "bb".repeat(64),
      });
      return {};
    });
    await useProximityPairStore.getState().begin({
      peerId: "self", publicKeyHex: "cc", multiaddrs: [], signatureHex: "dd",
    });
    // Let the async commit microtask settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(commitMock).toHaveBeenCalledTimes(1);
    expect(commitMock).toHaveBeenCalledWith({
      peerId: "remote-peer-id",
      publicKeyHex: "aa".repeat(32),
      multiaddrs: ["/ip4/10.0.0.2/tcp/4001"],
      signatureHex: "bb".repeat(64),
    });
    expect(useProximityPairStore.getState().phase).toBe("paired");
  });
});
