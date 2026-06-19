/**
 * Webview WebRTC voice+video mesh — the NATIVE p2p media plane.
 *
 * On native builds (iOS / desktop Tauri webview) the MEDIA plane runs here in
 * the webview's browser WebRTC stack (getUserMedia + RTCPeerConnection), while
 * SIGNALING rides the Rust libp2p swarm via a Tauri bridge:
 *
 *   - OUTBOUND: `invoke("voice_signal_send", { toPeerId, message })` — pushes a
 *     SignalingMessage onto the `/concord/voice-signaling/1.0.0` libp2p stream.
 *   - INBOUND:  the Tauri event `peer_swarm_event` with `kind:"voice_signaling"`
 *     carries `{ from, message_json }`; we JSON.parse and route to the matching
 *     RTCPeerConnection.
 *
 * This is the counterpart to `libp2p/voiceMesh.ts` (which signals over a
 * js-libp2p node in a real browser); here the libp2p node lives in Rust, so we
 * only own the WebRTC half and let the native swarm carry the bytes. Unlike the
 * audio-only `voiceMesh.ts`, this path also captures + renders VIDEO.
 *
 * A live libp2p connection to the peer must already exist (dial first via
 * `peer_dial`, or LAN mDNS auto-connect) — `voice_signal_send` opens a stream
 * on top of an existing connection, it does not dial.
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../api/servitude";
import { mapConnectionState, type MeshPeerState, type SignalingMessage } from "../libp2p/voiceSignaling";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

/** Per-peer view state the call UI renders. */
export interface CallPeerView {
  peerId: string;
  state: MeshPeerState;
  /** Inbound remote media (audio + optional video), or null until ontrack. */
  remoteStream: MediaStream | null;
}

interface WebviewCallState {
  /** True between startCall/first inbound offer and endCall. */
  callActive: boolean;
  /** Local capture (audio + optional video). */
  localStream: MediaStream | null;
  /** Whether the local call was started with video on. */
  videoEnabled: boolean;
  micEnabled: boolean;
  camEnabled: boolean;
  /** Remote peers keyed by base58 PeerId. */
  peers: Record<string, CallPeerView>;

  startCall: (remotePeerId: string, opts?: { video?: boolean }) => Promise<void>;
  endCall: () => Promise<void>;
  toggleMic: () => void;
  toggleCam: () => void;
  /** Install the inbound-signaling listener once (idempotent). */
  init: () => Promise<void>;
}

// ── Non-reactive internals ────────────────────────────────────────────────
// RTCPeerConnections are NOT stored in zustand (they're not serializable and
// mutate constantly); the store mirrors only the render-relevant projection.
const pcs = new Map<string, RTCPeerConnection>();
const requestIds = new Map<string, number>();
let reqCounter = 1;
let listenerInstalled = false;

/**
 * E2E test seam — gather per-peer WebRTC stats so the autonomous simulator
 * test can PROVE media actually flows (inbound frames/bytes), not merely that
 * a call was set up. Returns one entry per RTCPeerConnection.
 */
export async function e2eGatherCallStats(): Promise<
  Array<Record<string, unknown>>
> {
  const out: Array<Record<string, unknown>> = [];
  for (const [peerId, pc] of pcs.entries()) {
    const entry: Record<string, unknown> = {
      peerId,
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      inboundAudioBytes: 0,
      inboundVideoBytes: 0,
      inboundVideoFrames: 0,
      outboundAudioBytes: 0,
      outboundVideoBytes: 0,
    };
    try {
      const stats = await pc.getStats();
      stats.forEach((r) => {
        if (r.type === "inbound-rtp" && r.kind === "audio")
          entry.inboundAudioBytes = r.bytesReceived ?? 0;
        if (r.type === "inbound-rtp" && r.kind === "video") {
          entry.inboundVideoBytes = r.bytesReceived ?? 0;
          entry.inboundVideoFrames = r.framesDecoded ?? r.framesReceived ?? 0;
        }
        if (r.type === "outbound-rtp" && r.kind === "audio")
          entry.outboundAudioBytes = r.bytesSent ?? 0;
        if (r.type === "outbound-rtp" && r.kind === "video")
          entry.outboundVideoBytes = r.bytesSent ?? 0;
      });
    } catch (e) {
      entry.statsError = String(e);
    }
    out.push(entry);
  }
  return out;
}

function nextRequestId(peerId: string): number {
  const id = reqCounter++;
  requestIds.set(peerId, id);
  return id;
}

/**
 * NON-TRICKLE ICE. The Rust `SignalingMessage::IceCandidate` carries only
 * `candidate` + `request_id` — no `sdp_mid`/`sdp_mline_index`. With audio+VIDEO
 * (multiple m-lines) a trickled candidate can't be placed on the remote, so we
 * gather fully and embed all candidates in the offer/answer SDP instead. Wait
 * for `iceGatheringState === "complete"` (bounded so a slow/again STUN can't
 * hang call setup — we send whatever's gathered after the timeout).
 */
function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 3000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    pc.addEventListener("icegatheringstatechange", onChange);
    setTimeout(finish, timeoutMs);
  });
}

async function sendSignal(toPeerId: string, message: SignalingMessage): Promise<void> {
  try {
    await invoke("voice_signal_send", { toPeerId, message });
  } catch (err) {
    console.warn("[webview-call] voice_signal_send failed", toPeerId, err);
  }
}

/** Acquire (or reuse) the shared local capture stream. */
async function ensureLocalStream(video: boolean): Promise<MediaStream | null> {
  const existing = useWebviewCall.getState().localStream;
  if (existing) return existing;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
    const { micEnabled, camEnabled } = useWebviewCall.getState();
    stream.getAudioTracks().forEach((t) => (t.enabled = micEnabled));
    stream.getVideoTracks().forEach((t) => (t.enabled = camEnabled));
    useWebviewCall.setState({ localStream: stream, videoEnabled: video });
    return stream;
  } catch (err) {
    console.warn("[webview-call] getUserMedia failed; continuing recvonly", err);
    return null;
  }
}

function upsertPeer(peerId: string, patch: Partial<CallPeerView>): void {
  useWebviewCall.setState((s) => {
    const prev = s.peers[peerId] ?? { peerId, state: "connecting", remoteStream: null };
    return { peers: { ...s.peers, [peerId]: { ...prev, ...patch } } };
  });
}

/** Build + wire an RTCPeerConnection for one remote peer. */
function createPeer(peerId: string, localStream: MediaStream | null): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pcs.set(peerId, pc);
  upsertPeer(peerId, { state: "connecting" });

  if (localStream && localStream.getTracks().length > 0) {
    for (const track of localStream.getTracks()) pc.addTrack(track, localStream);
  } else {
    // No local capture — still open transceivers so the remote's tracks arrive.
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.addTransceiver("video", { direction: "recvonly" });
  }

  pc.ontrack = (event) => {
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    upsertPeer(peerId, { remoteStream: stream });
  };

  // Non-trickle: candidates are embedded in the offer/answer SDP (see
  // waitForIceGathering), so we deliberately do NOT trickle them out here —
  // the Rust signaling enum can't carry the m-line association a trickled
  // candidate needs for a multi-m-line (audio+video) session.

  pc.onconnectionstatechange = () => {
    upsertPeer(peerId, { state: mapConnectionState(pc.connectionState) });
  };

  return pc;
}

function teardownPeer(peerId: string): void {
  const pc = pcs.get(peerId);
  if (pc) {
    try {
      pc.close();
    } catch {
      /* idempotent */
    }
    pcs.delete(peerId);
  }
  requestIds.delete(peerId);
  useWebviewCall.setState((s) => {
    const next = { ...s.peers };
    delete next[peerId];
    return { peers: next };
  });
}

async function handleInbound(from: string, message: SignalingMessage): Promise<void> {
  switch (message.type) {
    case "offer": {
      // Callee path (or glare) — ensure we have media + a PC, then answer.
      // Auto-answer with the same media kind the caller offered (sniff for a
      // video m-line in the SDP).
      const wantsVideo = /\r?\nm=video /.test(message.sdp);
      const localStream = await ensureLocalStream(wantsVideo);
      let pc = pcs.get(from);
      if (!pc) pc = createPeer(from, localStream);
      requestIds.set(from, message.request_id);
      await pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      // Mirror the caller's media kind so the callee's local preview + camera
      // toggle reflect what was actually captured.
      useWebviewCall.setState({
        callActive: true,
        videoEnabled: wantsVideo,
        camEnabled: wantsVideo,
      });
      // Non-trickle: send the answer only after ICE gathering embeds all
      // candidates into the SDP.
      await waitForIceGathering(pc);
      await sendSignal(from, {
        type: "answer",
        sdp: pc.localDescription?.sdp ?? answer.sdp ?? "",
        request_id: message.request_id,
      });
      break;
    }
    case "answer": {
      const pc = pcs.get(from);
      if (!pc) {
        console.debug("[webview-call] answer for unknown peer", from);
        return;
      }
      await pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
      break;
    }
    case "ice_candidate": {
      const pc = pcs.get(from);
      if (!pc) return;
      try {
        await pc.addIceCandidate({
          candidate: message.candidate,
          sdpMid: message.sdp_mid ?? undefined,
          sdpMLineIndex: message.sdp_mline_index ?? undefined,
        });
      } catch (err) {
        console.debug("[webview-call] addIceCandidate failed", err);
      }
      break;
    }
    case "bye": {
      teardownPeer(from);
      if (pcs.size === 0) void useWebviewCall.getState().endCall();
      break;
    }
  }
}

export const useWebviewCall = create<WebviewCallState>()((set, get) => ({
  callActive: false,
  localStream: null,
  videoEnabled: false,
  micEnabled: true,
  camEnabled: true,
  peers: {},

  init: async () => {
    if (listenerInstalled) return;
    // The webview WebRTC mesh signals over Tauri events (the libp2p bridge),
    // so it only runs in the native webview. In web/test there is no Tauri
    // runtime — web voice uses the SFU path — and calling `listen()` would
    // throw on the missing `__TAURI_INTERNALS__.transformCallback`. No-op.
    if (!isTauri()) return;
    listenerInstalled = true;
    try {
      await listen<{ kind?: string; from?: string; message_json?: string }>(
        "peer_swarm_event",
        (event) => {
          const p = event.payload;
          if (!p || p.kind !== "voice_signaling" || !p.from || !p.message_json) return;
          let message: SignalingMessage;
          try {
            message = JSON.parse(p.message_json) as SignalingMessage;
          } catch (err) {
            console.debug("[webview-call] bad voice_signaling payload", err);
            return;
          }
          void handleInbound(p.from, message);
        },
      );
    } catch (err) {
      // The Tauri event bus wasn't available (e.g. an incomplete runtime in
      // tests, or a transient init race). Don't let it become an unhandled
      // rejection that poisons the caller — reset so a later call can retry.
      listenerInstalled = false;
      console.debug("[webview-call] peer_swarm_event listen failed", err);
    }
  },

  startCall: async (remotePeerId, opts) => {
    const video = opts?.video ?? true;
    await get().init();
    set({ callActive: true, videoEnabled: video, micEnabled: true, camEnabled: video });
    const localStream = await ensureLocalStream(video);
    const pc = pcs.get(remotePeerId) ?? createPeer(remotePeerId, localStream);
    const requestId = nextRequestId(remotePeerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // Non-trickle: send the offer only after ICE gathering embeds all
    // candidates into the SDP (the Rust signaling enum can't carry trickled
    // candidates' m-line association for audio+video).
    await waitForIceGathering(pc);
    await sendSignal(remotePeerId, {
      type: "offer",
      sdp: pc.localDescription?.sdp ?? offer.sdp ?? "",
      request_id: requestId,
    });
  },

  endCall: async () => {
    for (const peerId of Array.from(pcs.keys())) {
      void sendSignal(peerId, { type: "bye", request_id: requestIds.get(peerId) ?? 0 });
      teardownPeer(peerId);
    }
    const stream = get().localStream;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    set({ callActive: false, localStream: null, peers: {}, videoEnabled: false });
  },

  toggleMic: () => {
    const { localStream, micEnabled } = get();
    const next = !micEnabled;
    localStream?.getAudioTracks().forEach((t) => (t.enabled = next));
    set({ micEnabled: next });
  },

  toggleCam: () => {
    const { localStream, camEnabled } = get();
    const next = !camEnabled;
    localStream?.getVideoTracks().forEach((t) => (t.enabled = next));
    set({ camEnabled: next });
  },
}));
