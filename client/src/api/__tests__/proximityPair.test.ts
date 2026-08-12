import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
const addPluginListenerMock = vi.fn();
class FakeChannel<T> {
  onmessage: ((m: T) => void) | null = null;
}
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  Channel: FakeChannel,
  addPluginListener: (...args: unknown[]) => addPluginListenerMock(...args),
}));
vi.mock("../servitude", () => ({ isTauri: () => true }));

import {
  startProximityPair,
  confirmPairing,
  cancelPairing,
  commitPairedPeer,
} from "../proximityPair";

beforeEach(() => {
  invokeMock.mockReset();
  addPluginListenerMock.mockReset();
  addPluginListenerMock.mockResolvedValue({ unregister: () => {} });
});

describe("proximityPair API", () => {
  it("startProximityPair invokes the command and streams states to the callback", async () => {
    invokeMock.mockResolvedValue(undefined);
    const states: unknown[] = [];
    const channel = await startProximityPair(
      { peerId: "self", publicKeyHex: "cc", multiaddrs: [], signatureHex: "dd" },
      (s) => states.push(s),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "plugin:proximity-pair|proximity_pair_start",
      expect.objectContaining({ payload: expect.any(Object), onState: channel }),
    );
    (channel as unknown as FakeChannel<unknown>).onmessage?.({ phase: "searching" });
    expect(states).toEqual([{ phase: "searching" }]);
  });

  it("registers an iOS plugin listener that routes ppState events to the callback", async () => {
    invokeMock.mockResolvedValue(undefined);
    let pluginHandler: ((s: unknown) => void) | undefined;
    addPluginListenerMock.mockImplementation(async (_plugin, _event, handler) => {
      pluginHandler = handler;
      return { unregister: () => {} };
    });
    const states: unknown[] = [];
    await startProximityPair(
      { peerId: "self", publicKeyHex: "cc", multiaddrs: [], signatureHex: "dd" },
      (s) => states.push(s),
    );
    expect(addPluginListenerMock).toHaveBeenCalledWith(
      "proximity-pair",
      "ppState",
      expect.any(Function),
    );
    // Simulate the Swift engine emitting a state.
    pluginHandler?.({ phase: "awaitingConfirm", code: "880938" });
    expect(states).toEqual([{ phase: "awaitingConfirm", code: "880938" }]);
  });

  it("confirmPairing and cancelPairing call their commands", async () => {
    invokeMock.mockResolvedValue(undefined);
    await confirmPairing();
    expect(invokeMock).toHaveBeenCalledWith("plugin:proximity-pair|proximity_pair_confirm");
    await cancelPairing();
    expect(invokeMock).toHaveBeenCalledWith("plugin:proximity-pair|proximity_pair_cancel");
  });

  it("commitPairedPeer sends flat camelCase args and returns the peer id", async () => {
    invokeMock.mockResolvedValue({ peerId: "remote-id" });
    const id = await commitPairedPeer({
      peerId: "remote-id",
      publicKeyHex: "ab",
      multiaddrs: ["/ip4/1.2.3.4/tcp/4001"],
      signatureHex: "cd",
    });
    expect(id).toBe("remote-id");
    expect(invokeMock).toHaveBeenCalledWith("proximity_pair_commit", {
      peerId: "remote-id",
      publicKeyHex: "ab",
      multiaddrs: ["/ip4/1.2.3.4/tcp/4001"],
      source: "proximity",
      signatureHex: "cd",
    });
  });
});
