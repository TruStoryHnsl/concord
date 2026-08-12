/**
 * `joinVoiceSession` mesh-vs-LiveKit branch tests.
 *
 * Updated for the real-mesh-media rewrite. The mesh path now fetches
 * the voice token FIRST (the token endpoint is the source of truth for
 * the STUN/TURN servers the mesh PeerConnections need for NAT
 * traversal), then dispatches a real mesh-join. These tests pin the
 * native (Tauri) dispatch:
 *
 *   1. Selector returns `libp2p_mesh` → token fetched for ICE servers
 *      → `invoke("voice_mesh_join", { iceServers })` with the token's
 *      ICE servers flattened to URL strings → store connect() carries
 *      `transport: "libp2p_mesh"` and LiveKit is NOT joined.
 *   2. Mesh-join throws → LiveKit fallback (reuses the already-fetched
 *      token).
 *   3. Selector returns `livekit_sfu` → LiveKit directly, no mesh
 *      invoke.
 *
 * These run with `window.__TAURI_INTERNALS__` set so `isTauri()` picks
 * the native dispatch (the web dispatch drives the browser
 * RTCPeerConnection mesh, covered by `libp2p/__tests__/voiceMesh*`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("../../../api/voicePath", () => ({
  selectVoicePath: vi.fn(),
}));

const { getVoiceTokenMock } = vi.hoisted(() => ({
  getVoiceTokenMock: vi.fn(),
}));

vi.mock("../../../api/livekit", () => ({
  getVoiceToken: getVoiceTokenMock,
}));

vi.mock("../../../api/serverUrl", () => ({
  getHomeserverUrl: vi.fn(() => "http://example.test"),
}));

vi.mock("../../../voice/noiseGate", () => ({
  buildMicTrackConstraints: vi.fn(() => true),
}));

vi.mock("../../../stores/serverConfig", () => ({
  useServerConfigStore: {
    getState: () => ({ config: null }),
  },
}));

vi.mock("../../../stores/settings", () => ({
  useSettingsStore: {
    getState: () => ({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      preferredInputDeviceId: undefined,
      masterInputVolume: 1,
      inputNoiseGateEnabled: false,
      inputNoiseGateThresholdDb: -50,
    }),
  },
}));

const voiceStoreState = {
  beginConnectAttempt: vi.fn(() => true),
  setConnectionState: vi.fn(),
  connect: vi.fn(),
};

vi.mock("../../../stores/voice", () => ({
  useVoiceStore: {
    getState: () => voiceStoreState,
  },
}));

import * as voicePathApi from "../../../api/voicePath";
import { joinVoiceSession } from "../joinVoiceSession";

const selectVoicePathMock = vi.mocked(voicePathApi.selectVoicePath);

describe("joinVoiceSession mesh-mode branching", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    selectVoicePathMock.mockReset();
    getVoiceTokenMock.mockReset();
    voiceStoreState.beginConnectAttempt.mockReset();
    voiceStoreState.beginConnectAttempt.mockReturnValue(true);
    voiceStoreState.connect.mockReset();
    voiceStoreState.setConnectionState.mockReset();
    // Suppress getUserMedia path — joinVoiceSession only tries it
    // when mediaDevices exists.
    (globalThis as unknown as { navigator: { mediaDevices: unknown } }).navigator =
      {
        mediaDevices: undefined,
      } as unknown as Navigator;
    // Mark the runtime as Tauri so `isTauri()` (reads
    // `window.__TAURI_INTERNALS__`) routes the mesh-join to the native
    // `voice_mesh_join` command rather than the browser RTCPeerConnection
    // path. AudioContext is also stubbed since joinVoiceSession opens one
    // to resume autoplay.
    (globalThis as unknown as { window: unknown }).window = {
      __TAURI_INTERNALS__: {},
    };
    (globalThis as unknown as { AudioContext: unknown }).AudioContext =
      class {
        state = "running";
        resume = vi.fn().mockResolvedValue(undefined);
        close = vi.fn();
      };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as unknown as { window?: unknown }).window;
    delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
  });

  it("when selector returns libp2p_mesh, fetches token for ICE servers then invokes voice_mesh_join with them", async () => {
    selectVoicePathMock.mockResolvedValueOnce({
      path: "libp2p_mesh",
      reason: "all_native_under_cap",
    });
    // The token endpoint is the source of truth for STUN/TURN. The mesh
    // path must thread these into the native command (flattened to URL
    // strings) — the empty-iceServers bug this rewrite fixed.
    getVoiceTokenMock.mockResolvedValueOnce({
      token: "livekit-tok",
      livekit_url: "wss://lk.example/",
      ice_servers: [
        { urls: "stun:stun.example.org:3478" },
        { urls: ["turn:turn.example.org:3478"], username: "u", credential: "p" },
      ],
    });
    invokeMock.mockResolvedValueOnce(undefined);

    await joinVoiceSession({
      roomId: "!room:concord.test",
      channelName: "general voice",
      serverId: "server-1",
      accessToken: "access-token",
    });

    // Token IS fetched now (for ICE servers); mesh-join carries the
    // flattened STUN/TURN URLs, not an empty list.
    expect(getVoiceTokenMock).toHaveBeenCalled();
    expect(invokeMock).toHaveBeenCalledWith("voice_mesh_join", {
      roomId: "!room:concord.test",
      participants: [],
      iceServers: [
        "stun:stun.example.org:3478",
        "turn:turn.example.org:3478",
      ],
    });
    expect(voiceStoreState.connect).toHaveBeenCalled();
    const connectCall = voiceStoreState.connect.mock.calls[0]?.[0] as {
      transport?: string;
    };
    expect(connectCall.transport).toBe("libp2p_mesh");
    // LiveKit room is NOT joined — the LiveKit `connect()` would carry a
    // non-empty token; the mesh connect() passes token: "".
    expect(connectCall).toMatchObject({ token: "" });
  });

  it("when mesh-join throws, falls back to LiveKit", async () => {
    selectVoicePathMock.mockResolvedValueOnce({
      path: "libp2p_mesh",
      reason: "all_native_under_cap",
    });
    invokeMock.mockRejectedValueOnce(new Error("voice_mesh_join unregistered"));
    getVoiceTokenMock.mockResolvedValueOnce({
      token: "livekit-tok",
      livekit_url: "wss://lk.example/",
      ice_servers: [],
    });

    await joinVoiceSession({
      roomId: "!room:concord.test",
      channelName: "general voice",
      serverId: "server-1",
      accessToken: "access-token",
    });

    expect(invokeMock).toHaveBeenCalledWith("voice_mesh_join", expect.any(Object));
    expect(getVoiceTokenMock).toHaveBeenCalled();
    // The most recent connect() call carries LiveKit transport (the
    // first call's failure path threw before reaching connect).
    const allConnectCalls = voiceStoreState.connect.mock.calls;
    expect(allConnectCalls.length).toBeGreaterThan(0);
    const lastCall = allConnectCalls[allConnectCalls.length - 1]?.[0] as {
      transport?: string;
      token: string;
    };
    expect(lastCall.transport).toBeUndefined();
    expect(lastCall.token).toBe("livekit-tok");
  });

  it("when selector returns livekit_sfu, uses LiveKit directly", async () => {
    selectVoicePathMock.mockResolvedValueOnce({
      path: "livekit_sfu",
      reason: "above_cap_8",
    });
    getVoiceTokenMock.mockResolvedValueOnce({
      token: "livekit-tok",
      livekit_url: "wss://lk.example/",
      ice_servers: [],
    });

    await joinVoiceSession({
      roomId: "!room:concord.test",
      channelName: "general voice",
      serverId: "server-1",
      accessToken: "access-token",
    });

    expect(invokeMock).not.toHaveBeenCalled();
    expect(getVoiceTokenMock).toHaveBeenCalled();
  });
});
