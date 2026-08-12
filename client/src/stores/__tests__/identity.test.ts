import { beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted mocks for the SUT dependencies. `vi.hoisted` is required so
// the `vi.mock(...)` factories below — which are themselves hoisted to the
// top of the module by vitest — can reference the spies they install.
const { fetchPeerIdentityMock, fetchPeerSwarmStatusMock, isTauriMock } =
  vi.hoisted(() => ({
    fetchPeerIdentityMock: vi.fn(),
    fetchPeerSwarmStatusMock: vi.fn(),
    isTauriMock: vi.fn(),
  }));

vi.mock("../../api/peerIdentity", () => ({
  fetchPeerIdentity: fetchPeerIdentityMock,
}));

vi.mock("../../api/peerSwarm", () => ({
  fetchPeerSwarmStatus: fetchPeerSwarmStatusMock,
}));

vi.mock("../../api/servitude", () => ({
  isTauri: isTauriMock,
}));

import { useIdentityStore, IDENTITY_ERROR_NATIVE_ONLY } from "../identity";

describe("useIdentityStore", () => {
  beforeEach(() => {
    fetchPeerIdentityMock.mockReset();
    fetchPeerSwarmStatusMock.mockReset();
    isTauriMock.mockReset();
    // Reset store to its initial state between tests. Zustand stores hold
    // module-level state; without this reset, ordering between tests can
    // leak `error` / fingerprints from one case into the next.
    useIdentityStore.setState({
      ownerFingerprint: null,
      deviceFingerprint: null,
      publicKeyHex: null,
      isLoading: false,
      error: null,
      swarmPeerId: null,
      swarmMultiaddrs: [],
      swarmPeerCount: 0,
      swarmLastEvent: null,
      swarmLoading: false,
      swarmError: null,
    });
  });

  /**
   * Happy path: under Tauri, `load()` flips `isLoading` while the call is
   * in flight and populates BOTH fingerprints + publicKeyHex on success.
   * NUI-F29 — owner and device are distinct values here on purpose: a
   * restored install reports the original device's owner fingerprint and
   * its own device fingerprint, and the store must not conflate them. We
   * snapshot the `isLoading=true` state by inspecting it from inside the
   * fetch resolver — once the promise resolves, the final commit replaces
   * it with the loaded values.
   */
  it("load() success: transitions isLoading then commits identity", async () => {
    isTauriMock.mockReturnValue(true);

    let loadingObserved = false;
    fetchPeerIdentityMock.mockImplementation(async () => {
      // At this point, `load()` has set isLoading=true and not yet awaited
      // the return value, so the store should reflect the in-flight state.
      const snapshot = useIdentityStore.getState();
      loadingObserved =
        snapshot.isLoading === true &&
        snapshot.ownerFingerprint === null &&
        snapshot.deviceFingerprint === null &&
        snapshot.error === null;
      return {
        ownerFingerprint: "FNGRPRNT12345678",
        deviceFingerprint: "DVCPRNT87654321",
        publicKeyHex: "abcdef0011223344",
      };
    });

    await useIdentityStore.getState().load();

    expect(loadingObserved).toBe(true);
    const final = useIdentityStore.getState();
    expect(final.isLoading).toBe(false);
    expect(final.error).toBeNull();
    expect(final.ownerFingerprint).toBe("FNGRPRNT12345678");
    expect(final.deviceFingerprint).toBe("DVCPRNT87654321");
    expect(final.publicKeyHex).toBe("abcdef0011223344");
  });

  /**
   * Failure path: under Tauri, the API rejects (e.g. Stronghold unlock
   * failure). The store should record the message and clear the in-flight
   * flag without throwing — UI consumers read state, not the promise.
   */
  it("load() failure: captures error and clears isLoading", async () => {
    isTauriMock.mockReturnValue(true);
    fetchPeerIdentityMock.mockRejectedValueOnce(
      new Error("stronghold unlock failed"),
    );

    await useIdentityStore.getState().load();

    const final = useIdentityStore.getState();
    expect(final.isLoading).toBe(false);
    expect(final.error).toBe("stronghold unlock failed");
    expect(final.ownerFingerprint).toBeNull();
    expect(final.deviceFingerprint).toBeNull();
    expect(final.publicKeyHex).toBeNull();
  });

  /**
   * No-Tauri path: web build with no `__TAURI_INTERNALS__`. The store sets
   * `error: 'native-only'` and returns without throwing so the Profile tab
   * can switch to a placeholder rendering. The underlying API must NOT be
   * called — we never want to attempt an invoke against a missing runtime.
   */
  it("load() in a web build: sets native-only error and never calls the API", async () => {
    isTauriMock.mockReturnValue(false);

    await expect(useIdentityStore.getState().load()).resolves.toBeUndefined();

    const final = useIdentityStore.getState();
    expect(final.isLoading).toBe(false);
    expect(final.error).toBe(IDENTITY_ERROR_NATIVE_ONLY);
    expect(final.ownerFingerprint).toBeNull();
    expect(final.deviceFingerprint).toBeNull();
    expect(final.publicKeyHex).toBeNull();
    expect(fetchPeerIdentityMock).not.toHaveBeenCalled();
  });
});
