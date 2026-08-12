/**
 * Voice-mesh control-surface tests — the parts the rewrite added on top
 * of the original join/leave orchestration:
 *
 *   1. The supplied STUN/TURN `iceServers` reach every real
 *      `RTCPeerConnection` (NAT traversal config is actually applied,
 *      not dropped — the empty-`iceServers` bug this rewrite fixed).
 *   2. `getMeshStatus` reflects the REAL connection state — driven by
 *      the `onconnectionstatechange` callback, never a synthetic jump.
 *   3. `setMeshMuted` toggles `track.enabled` on every local mic track.
 *   4. `setMeshVolume` sets `.volume` on every remote `<audio>` element
 *      AND is inherited by tracks that arrive after the volume was set.
 *
 * RTCPeerConnection / getUserMedia / Audio are mocked so the
 * orchestration runs in jsdom; the assertions are over the observable
 * side effects (config passed to the PC, track.enabled flags, audio
 * element volume, status snapshot) rather than internal calls.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import {
  joinMesh,
  leaveMesh,
  getMeshStatus,
  setMeshMuted,
  setMeshVolume,
  getMeshRoom,
} from "../voiceMesh";

interface MockTrack {
  stop: ReturnType<typeof vi.fn>;
  kind: string;
  id: string;
  enabled: boolean;
}

function makeMockTrack(id: string): MockTrack {
  return { stop: vi.fn(), kind: "audio", id, enabled: true };
}

interface MockPC {
  config: RTCConfiguration | undefined;
  connectionState: RTCPeerConnectionState;
  addTrack: ReturnType<typeof vi.fn>;
  addTransceiver: ReturnType<typeof vi.fn>;
  createOffer: ReturnType<typeof vi.fn>;
  createAnswer: ReturnType<typeof vi.fn>;
  setLocalDescription: ReturnType<typeof vi.fn>;
  setRemoteDescription: ReturnType<typeof vi.fn>;
  addIceCandidate: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  ontrack: ((ev: RTCTrackEvent) => void) | null;
  onicecandidate: ((ev: RTCPeerConnectionIceEvent) => void) | null;
  onconnectionstatechange: (() => void) | null;
  /** Test helper: drive a real-ish state transition. */
  _setState(s: RTCPeerConnectionState): void;
}

function makeMockPC(config: RTCConfiguration | undefined): MockPC {
  const pc: MockPC = {
    config,
    connectionState: "new",
    addTrack: vi.fn(),
    addTransceiver: vi.fn(),
    createOffer: vi
      .fn()
      .mockResolvedValue({ type: "offer", sdp: "v=0\r\noffer\r\n" }),
    createAnswer: vi
      .fn()
      .mockResolvedValue({ type: "answer", sdp: "v=0\r\nanswer\r\n" }),
    setLocalDescription: vi.fn().mockResolvedValue(undefined),
    setRemoteDescription: vi.fn().mockResolvedValue(undefined),
    addIceCandidate: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    ontrack: null,
    onicecandidate: null,
    onconnectionstatechange: null,
    _setState(s) {
      pc.connectionState = s;
      pc.onconnectionstatechange?.();
    },
  };
  return pc;
}

function makeMockLibp2p() {
  const handle = vi.fn().mockResolvedValue(undefined);
  const unhandle = vi.fn().mockResolvedValue(undefined);
  const dialProtocol = vi.fn().mockResolvedValue({
    send: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  });
  return { handle, unhandle, dialProtocol } as unknown as import(
    "@libp2p/interface"
  ).Libp2p & {
    handle: typeof handle;
    unhandle: typeof unhandle;
    dialProtocol: typeof dialProtocol;
  };
}

function fakePeerId(id: string): import("@libp2p/interface").PeerId {
  return { toString: () => id } as unknown as import(
    "@libp2p/interface"
  ).PeerId;
}

describe("voice mesh control surface", () => {
  const ROOM = "ctrl-room";
  const pcInstances: MockPC[] = [];
  const audioInstances: Array<{
    pause: ReturnType<typeof vi.fn>;
    autoplay: boolean;
    volume: number;
    _srcObject: unknown;
    dataset: Record<string, string>;
  }> = [];
  const originalPC = globalThis.RTCPeerConnection;
  const originalMediaDevices = (globalThis.navigator as Navigator | undefined)
    ?.mediaDevices;
  const originalAudio = (globalThis as unknown as { Audio: unknown }).Audio;
  let mockTracks: MockTrack[];

  beforeEach(() => {
    pcInstances.length = 0;
    audioInstances.length = 0;
    mockTracks = [makeMockTrack("mic-a")];

    class PCStub {
      constructor(config?: RTCConfiguration) {
        const pc = makeMockPC(config);
        pcInstances.push(pc);
        return pc as unknown as PCStub;
      }
    }
    (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
      PCStub;

    (globalThis as unknown as { navigator: { mediaDevices: unknown } }).navigator =
      {
        ...globalThis.navigator,
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue({
            getTracks: () => mockTracks,
          } as unknown as MediaStream),
        },
      } as unknown as Navigator;

    class AudioStub {
      pause = vi.fn();
      autoplay = false;
      volume = 1;
      _srcObject: unknown = null;
      dataset: Record<string, string> = {};
      get srcObject(): unknown {
        return this._srcObject;
      }
      set srcObject(v: unknown) {
        this._srcObject = v;
      }
      constructor() {
        audioInstances.push(this);
      }
    }
    (globalThis as unknown as { Audio: unknown }).Audio = AudioStub;
  });

  afterEach(async () => {
    await leaveMesh(ROOM);
    (globalThis as unknown as { RTCPeerConnection: unknown }).RTCPeerConnection =
      originalPC;
    if (originalMediaDevices !== undefined) {
      (globalThis as unknown as { navigator: { mediaDevices: unknown } }).navigator =
        {
          ...globalThis.navigator,
          mediaDevices: originalMediaDevices,
        } as unknown as Navigator;
    }
    (globalThis as unknown as { Audio: unknown }).Audio = originalAudio;
  });

  it("threads the supplied iceServers into every RTCPeerConnection", async () => {
    const node = makeMockLibp2p();
    const iceServers: RTCIceServer[] = [
      { urls: "stun:stun.example.org:3478" },
      {
        urls: ["turn:turn.example.org:3478"],
        username: "u",
        credential: "p",
      },
    ];
    await joinMesh(
      node,
      ROOM,
      [{ peerId: fakePeerId("12D3KooWAlice") }],
      iceServers,
    );
    expect(pcInstances.length).toBe(1);
    expect(pcInstances[0].config?.iceServers).toEqual(iceServers);
  });

  it("getMeshStatus mirrors the REAL connection state, not a synthetic jump", async () => {
    const node = makeMockLibp2p();
    await joinMesh(node, ROOM, [{ peerId: fakePeerId("12D3KooWAlice") }], []);

    // Before any state event: connecting (initial).
    let status = getMeshStatus(ROOM);
    expect(status?.peers).toHaveLength(1);
    expect(status?.peers[0].state).toBe("connecting");

    // Drive the PC the way the browser would: connecting → connected.
    pcInstances[0]._setState("connecting");
    status = getMeshStatus(ROOM);
    expect(status?.peers[0].state).toBe("connecting");

    pcInstances[0]._setState("connected");
    status = getMeshStatus(ROOM);
    expect(status?.peers[0].state).toBe("connected");

    // A real ICE failure surfaces as 'failed' — no fake "stays connected".
    pcInstances[0]._setState("failed");
    status = getMeshStatus(ROOM);
    expect(status?.peers[0].state).toBe("failed");
  });

  it("setMeshMuted toggles track.enabled on every local mic track", async () => {
    mockTracks = [makeMockTrack("mic-a"), makeMockTrack("mic-b")];
    const node = makeMockLibp2p();
    await joinMesh(node, ROOM, [{ peerId: fakePeerId("12D3KooWAlice") }], []);

    // All tracks start enabled.
    for (const t of mockTracks) expect(t.enabled).toBe(true);

    setMeshMuted(ROOM, true);
    for (const t of mockTracks) expect(t.enabled).toBe(false);
    expect(getMeshStatus(ROOM)?.muted).toBe(true);

    setMeshMuted(ROOM, false);
    for (const t of mockTracks) expect(t.enabled).toBe(true);
    expect(getMeshStatus(ROOM)?.muted).toBe(false);
  });

  it("setMeshVolume sets .volume on remote audio + is inherited by later tracks", async () => {
    const node = makeMockLibp2p();
    await joinMesh(node, ROOM, [{ peerId: fakePeerId("12D3KooWAlice") }], []);
    const room = getMeshRoom(ROOM);
    expect(room).toBeDefined();

    // Set volume BEFORE any remote track arrives.
    setMeshVolume(ROOM, 0.25);
    expect(getMeshStatus(ROOM)?.volume).toBe(0.25);

    // Now fire ontrack — the freshly-attached <audio> must inherit 0.25.
    const pc = pcInstances[0];
    expect(pc.ontrack).not.toBeNull();
    const remoteTrack = {
      id: "remote-1",
      kind: "audio",
    } as unknown as MediaStreamTrack;
    const stream = {
      getTracks: () => [remoteTrack],
      addTrack: vi.fn(),
    } as unknown as MediaStream;
    pc.ontrack!({
      track: remoteTrack,
      streams: [stream],
    } as unknown as RTCTrackEvent);

    expect(audioInstances).toHaveLength(1);
    expect(audioInstances[0].volume).toBe(0.25);

    // A later setMeshVolume updates the existing element too.
    setMeshVolume(ROOM, 0.8);
    expect(audioInstances[0].volume).toBe(0.8);

    // Status reflects a remote audio track is now captured.
    expect(getMeshStatus(ROOM)?.peers[0].hasRemoteAudio).toBe(true);
  });

  it("setMeshMuted / setMeshVolume are no-ops on an unknown room", () => {
    expect(() => setMeshMuted("nope", true)).not.toThrow();
    expect(() => setMeshVolume("nope", 0.5)).not.toThrow();
    expect(getMeshStatus("nope")).toBeUndefined();
  });
});
