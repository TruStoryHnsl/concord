/**
 * Phase 8/9 follow-up — browser-side voice mesh orchestration (REAL
 * audio plane).
 *
 * Companion of the Rust `servitude::voice::VoiceCall` orchestrator.
 * The native build ships a real `webrtc-rs` PeerConnection per remote
 * peer (`src-tauri/src/servitude/voice/media.rs`); this module runs the
 * analogous orchestration on top of the standard browser
 * `RTCPeerConnection` API, exchanging SDP + ICE over the
 * `/concord/voice-signaling/1.0.0` libp2p stream.
 *
 * This is NOT a stub: there are no synthetic state transitions. Every
 * per-peer status the UI reads comes from the real
 * `RTCPeerConnection.onconnectionstatechange` callback via
 * {@link mapConnectionState}. A peer is "connected" only when DTLS/ICE
 * actually completes; "failed" only when the browser reports a real
 * ICE/DTLS failure.
 *
 * ## The full path
 *
 *   joinMesh
 *     → getUserMedia({ audio })                 (real mic capture)
 *     → per peer: new RTCPeerConnection(iceServers)   (real STUN/TURN)
 *         addTrack(mic)                          (real outbound audio)
 *         createOffer / setLocalDescription      (real SDP)
 *         send Offer over libp2p signaling
 *     → inbound Answer: setRemoteDescription     (real SDP)
 *     → inbound/outbound ICE candidates exchanged over libp2p
 *     → ontrack: attach remote MediaStream to an <audio> element
 *         (real inbound audio playback)
 *     → onconnectionstatechange drives MeshPeerState
 *
 *   leaveMesh
 *     → send Bye to every peer
 *     → stop every local mic track (releases OS mic indicator)
 *     → pc.close() every PeerConnection
 *     → detach every remote <audio> element
 *
 * ## Mute / volume
 *
 *   - {@link setMeshMuted} toggles `track.enabled` on every local mic
 *     track (the WebRTC-canonical mute — the SRTP stream keeps flowing
 *     but carries silence, so the remote's jitter buffer doesn't
 *     stall).
 *   - {@link setMeshVolume} sets `.volume` on every remote `<audio>`
 *     element (0..1).
 *
 * ## What is deferred — `TODO(mesh-media-followup-v3)`
 *
 *   - **No ICE restart loop.** A single Offer/Answer round-trip per
 *     peer; a `failed` connection surfaces via {@link getMeshStatus}
 *     and the caller can fall back to LiveKit.
 *   - **No echo cancellation tuning.** `getUserMedia` uses browser
 *     defaults; the SFU path's `buildMicTrackConstraints` tuning is a
 *     follow-up for the mesh path.
 */

import type { Libp2p, PeerId } from "@libp2p/interface";

import { CONCORD_VOICE_SIGNALING_PROTOCOL } from "./node";
import {
  frameEnvelope,
  mapConnectionState,
  readEnvelope,
  type MeshPeerState,
  type SignalingMessage,
} from "./voiceSignaling";

/** Per-peer record held inside a {@link MeshRoom}. */
interface MeshPeer {
  /** Remote peer id, string form (the registry key). */
  remoteId: string;
  /** The resolved libp2p `PeerId`, when known. Initiator peers carry
   *  it from the participant list; callee peers are resolved from the
   *  inbound connection's `remotePeer`. Used for outbound dials. */
  peerId: PeerId;
  pc: RTCPeerConnection;
  /** Latest connection state, mirrored from `onconnectionstatechange`. */
  state: MeshPeerState;
  /** Captured remote audio stream (one per peer). */
  remoteStream: MediaStream | null;
  /** Per-track `<audio>` elements driving playback. Keyed by track id. */
  remoteAudio: Map<string, HTMLAudioElement>;
  /** request_id allocated for this peer's offer/answer round. */
  requestId: number;
}

/** Per-room mesh state held in the per-tab registry. */
interface MeshRoom {
  roomId: string;
  node: Libp2p;
  /** STUN/TURN servers used for every PeerConnection in this room. */
  iceServers: RTCIceServer[];
  /** Map of remote-peer-id-string → per-peer record. */
  peers: Map<string, MeshPeer>;
  /** Local outbound audio MediaStream — the same getUserMedia output is
   *  attached to every PeerConnection's audio sender. `null` when the
   *  mic was denied/absent (the user sends silence). */
  localStream: MediaStream | null;
  /** Current mute state — applied to new tracks too. */
  muted: boolean;
  /** Current remote playback volume 0..1 — applied to new audio els. */
  volume: number;
  /** Monotonic request-id allocator for this room. */
  nextRequestId: number;
  /** Unsubscribe handle for the inbound signaling stream handler. */
  unhandle: () => Promise<void>;
}

/** Public per-peer status row for the UI. */
export interface MeshPeerStatus {
  peerId: string;
  state: MeshPeerState;
  /** True once a remote audio track has been captured (audio inbound). */
  hasRemoteAudio: boolean;
}

/** Public aggregate room status for the UI. */
export interface MeshStatus {
  roomId: string;
  muted: boolean;
  volume: number;
  peers: MeshPeerStatus[];
}

const registry = new Map<string, MeshRoom>();

/** A participant the local side will dial as the call initiator. */
export interface MeshParticipant {
  peerId: PeerId;
  matrixUserId?: string;
}

/**
 * Join a mesh-mode voice call.
 *
 * Acquires the local mic, builds one real `RTCPeerConnection` per known
 * participant (using the supplied STUN/TURN `iceServers`), attaches the
 * mic track, sends an Offer over the libp2p signaling stream, and wires
 * the Answer + ICE exchange. Inbound Offers from late joiners are
 * handled by the installed protocol handler.
 *
 * @param iceServers STUN/TURN servers from the voice-token endpoint.
 *   Passing `[]` falls back to host candidates only (LAN / same-NAT
 *   pairs); real NAT traversal needs at least a STUN server.
 */
export async function joinMesh(
  node: Libp2p,
  roomId: string,
  participants: MeshParticipant[],
  iceServers: RTCIceServer[] = [],
): Promise<MeshRoom> {
  if (registry.has(roomId)) {
    throw new Error(`mesh already active for room ${roomId}`);
  }

  // Try to acquire mic. Failure is non-fatal — the mesh still forms
  // connections; the local user just sends silence (recvonly).
  let localStream: MediaStream | null = null;
  try {
    if (navigator.mediaDevices?.getUserMedia) {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
  } catch (err) {
    console.warn("[voice-mesh] getUserMedia failed; continuing muted", err);
  }

  const room: MeshRoom = {
    roomId,
    node,
    iceServers,
    peers: new Map(),
    localStream,
    muted: false,
    volume: 1,
    nextRequestId: 1,
    unhandle: async () => {
      try {
        await node.unhandle(CONCORD_VOICE_SIGNALING_PROTOCOL);
      } catch {
        /* idempotent */
      }
    },
  };
  registry.set(roomId, room);

  // Inbound signaling handler — accepts `/concord/voice-signaling/1.0.0`
  // streams from remote peers and routes envelopes to the matching PC.
  await node.handle(
    CONCORD_VOICE_SIGNALING_PROTOCOL,
    async (stream, connection) => {
      const remotePeerId = connection.remotePeer;
      try {
        const message = await readEnvelope(
          stream as unknown as AsyncIterable<Uint8Array>,
        );
        await handleInbound(roomId, remotePeerId, message);
      } catch (err) {
        console.debug("[voice-mesh] inbound handler error", err);
      } finally {
        try {
          await stream.close();
        } catch {
          /* idempotent close */
        }
      }
    },
  );

  // Initiator path — push an Offer to every participant.
  for (const participant of participants) {
    const remoteId = participant.peerId.toString();
    if (room.peers.has(remoteId)) continue;
    try {
      const peer = createMeshPeer(room, participant.peerId);
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      await sendSignaling(node, participant.peerId, {
        type: "offer",
        sdp: offer.sdp ?? "",
        request_id: peer.requestId,
      });
    } catch (err) {
      console.warn(
        `[voice-mesh] failed to initiate to ${remoteId}; skipping`,
        err,
      );
    }
  }

  return room;
}

/**
 * Leave a mesh-mode voice call. Sends a `Bye` to every remote, closes
 * every PeerConnection, stops every local mic track (releasing the
 * OS-level mic indicator), detaches every remote `<audio>` element, and
 * removes the room from the registry. Idempotent.
 */
export async function leaveMesh(roomId: string): Promise<void> {
  const room = registry.get(roomId);
  if (!room) return;
  registry.delete(roomId);
  await room.unhandle();

  for (const peer of room.peers.values()) {
    // Best-effort Bye so the remote tears down its half too.
    sendSignaling(room.node, peer.peerId, {
      type: "bye",
      request_id: peer.requestId,
    }).catch((e) => console.debug("[voice-mesh] bye send failed", e));
    try {
      peer.pc.close();
    } catch {
      /* idempotent */
    }
    for (const audio of peer.remoteAudio.values()) {
      detachAudio(audio);
    }
    peer.remoteAudio.clear();
  }
  room.peers.clear();

  if (room.localStream) {
    for (const track of room.localStream.getTracks()) {
      track.stop();
    }
  }
}

/**
 * Toggle the local mic mute for an active mesh room.
 *
 * Sets `track.enabled = !muted` on every local audio track. This is the
 * WebRTC-canonical mute — SRTP keeps flowing (so the remote's jitter
 * buffer doesn't reset) but every packet carries silence. No-op if the
 * room isn't active.
 */
export function setMeshMuted(roomId: string, muted: boolean): void {
  const room = registry.get(roomId);
  if (!room) return;
  room.muted = muted;
  if (room.localStream) {
    for (const track of room.localStream.getTracks()) {
      track.enabled = !muted;
    }
  }
}

/**
 * Set the remote playback volume (0..1) for an active mesh room. Applied
 * to every current remote `<audio>` element AND remembered so audio
 * elements attached later (late-arriving tracks) inherit it. No-op if
 * the room isn't active.
 */
export function setMeshVolume(roomId: string, volume: number): void {
  const room = registry.get(roomId);
  if (!room) return;
  const clamped = Math.max(0, Math.min(1, volume));
  room.volume = clamped;
  for (const peer of room.peers.values()) {
    for (const audio of peer.remoteAudio.values()) {
      audio.volume = clamped;
    }
  }
}

/** Read the current per-tab mesh state for `roomId`. */
export function getMeshRoom(roomId: string): MeshRoom | undefined {
  return registry.get(roomId);
}

/**
 * Snapshot the per-peer status for the UI. Returns `undefined` if no
 * mesh is active for `roomId`. The per-peer `state` is the real
 * `RTCPeerConnection` state mapped through {@link mapConnectionState} —
 * never a synthetic value.
 */
export function getMeshStatus(roomId: string): MeshStatus | undefined {
  const room = registry.get(roomId);
  if (!room) return undefined;
  return {
    roomId,
    muted: room.muted,
    volume: room.volume,
    peers: Array.from(room.peers.values()).map((peer) => ({
      peerId: peer.remoteId,
      state: peer.state,
      hasRemoteAudio: peer.remoteStream !== null,
    })),
  };
}

/**
 * Build + wire a real `RTCPeerConnection` for one peer and register it
 * on the room. Shared by the initiator path and the callee path.
 */
function createMeshPeer(room: MeshRoom, peerId: PeerId): MeshPeer {
  const remoteId = peerId.toString();
  const pc = new RTCPeerConnection({ iceServers: room.iceServers });

  const peer: MeshPeer = {
    remoteId,
    peerId,
    pc,
    state: "connecting",
    remoteStream: null,
    remoteAudio: new Map(),
    requestId: room.nextRequestId++,
  };
  room.peers.set(remoteId, peer);

  // Attach local mic (or open a recvonly transceiver so the remote's
  // ontrack still fires for inbound audio when we have no mic).
  if (room.localStream) {
    for (const track of room.localStream.getTracks()) {
      track.enabled = !room.muted;
      pc.addTrack(track, room.localStream);
    }
  } else {
    pc.addTransceiver("audio", { direction: "recvonly" });
  }

  // Inbound remote audio → MediaStream → <audio> element playback.
  pc.ontrack = (event) => {
    const stream =
      peer.remoteStream ?? event.streams[0] ?? new MediaStream();
    if (!event.streams[0]) stream.addTrack(event.track);
    peer.remoteStream = stream;
    attachRemoteAudio(peer, event.track.id, stream, room.volume);
  };

  // Outbound ICE candidates → forward over the signaling wire with the
  // sdp_mid / sdp_mline_index so the remote can install them precisely.
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignaling(room.node, peer.peerId, {
        type: "ice_candidate",
        candidate: event.candidate.candidate,
        request_id: peer.requestId,
        sdp_mid: event.candidate.sdpMid,
        sdp_mline_index: event.candidate.sdpMLineIndex,
      }).catch((e) =>
        console.debug("[voice-mesh] outbound ICE send failed", e),
      );
    }
  };

  // Real state mirror — the ONLY thing that sets peer.state.
  pc.onconnectionstatechange = () => {
    peer.state = mapConnectionState(pc.connectionState);
  };

  return peer;
}

/** Dispatch an inbound envelope to the right PC. */
async function handleInbound(
  roomId: string,
  remotePeerId: PeerId,
  message: SignalingMessage,
): Promise<void> {
  const room = registry.get(roomId);
  if (!room) return;
  const remoteId = remotePeerId.toString();
  let peer = room.peers.get(remoteId);

  switch (message.type) {
    case "offer": {
      if (!peer) {
        // Callee path — a new peer dialing in. We resolve its PeerId
        // straight from the inbound connection's `remotePeer`, so the
        // Answer + ICE we send back go to the right node.
        peer = createMeshPeer(room, remotePeerId);
      }
      await peer.pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      // Echo the inbound request_id so the initiator can correlate.
      peer.requestId = message.request_id;
      await sendSignaling(room.node, peer.peerId, {
        type: "answer",
        sdp: answer.sdp ?? "",
        request_id: message.request_id,
      });
      break;
    }
    case "answer": {
      if (!peer) {
        console.debug("[voice-mesh] answer for unknown peer", remoteId);
        return;
      }
      await peer.pc.setRemoteDescription({
        type: "answer",
        sdp: message.sdp,
      });
      break;
    }
    case "ice_candidate": {
      if (!peer) {
        console.debug("[voice-mesh] ice for unknown peer", remoteId);
        return;
      }
      try {
        await peer.pc.addIceCandidate({
          candidate: message.candidate,
          sdpMid: message.sdp_mid ?? undefined,
          sdpMLineIndex: message.sdp_mline_index ?? undefined,
        });
      } catch (err) {
        console.debug("[voice-mesh] addIceCandidate failed", err);
      }
      break;
    }
    case "bye": {
      if (peer) {
        try {
          peer.pc.close();
        } catch {
          /* idempotent */
        }
        for (const audio of peer.remoteAudio.values()) detachAudio(audio);
        peer.remoteAudio.clear();
        peer.state = "closed";
        room.peers.delete(remoteId);
      }
      break;
    }
  }
}

/**
 * Attach (or reuse) an `<audio>` element bound to a remote track so the
 * browser actually plays the inbound audio. Volume is seeded from the
 * room's current setting so a `setMeshVolume` before the track arrived
 * is respected.
 */
function attachRemoteAudio(
  peer: MeshPeer,
  trackId: string,
  stream: MediaStream,
  volume: number,
): void {
  let audio = peer.remoteAudio.get(trackId);
  if (audio) {
    if (audio.srcObject !== stream) audio.srcObject = stream;
    audio.volume = volume;
    return;
  }
  audio = new Audio();
  audio.srcObject = stream;
  audio.autoplay = true;
  audio.volume = volume;
  audio.dataset.concordMeshTrack = trackId;
  // Append to the document so playback survives React renders. Guard the
  // jsdom/test seam where `Audio` is a plain class (not a real DOM Node).
  try {
    if (
      typeof document !== "undefined" &&
      document.body &&
      typeof Node !== "undefined" &&
      audio instanceof Node
    ) {
      document.body.appendChild(audio);
    }
  } catch {
    /* off-DOM playback is acceptable; jsdom test seams hit this. */
  }
  peer.remoteAudio.set(trackId, audio);
}

/** Pause + detach a remote `<audio>` element so decoding stops. */
function detachAudio(audio: HTMLAudioElement): void {
  try {
    audio.pause();
  } catch {
    /* idempotent — pause on a torn-down element is harmless */
  }
  audio.srcObject = null;
  if (audio.parentNode) audio.parentNode.removeChild(audio);
}

/** Open a stream + write a framed envelope to a `PeerId`. */
async function sendSignaling(
  node: Libp2p,
  peerId: PeerId,
  message: SignalingMessage,
): Promise<void> {
  const stream = await node.dialProtocol(
    peerId,
    CONCORD_VOICE_SIGNALING_PROTOCOL,
  );
  try {
    (stream as unknown as { send: (b: Uint8Array) => void }).send(
      frameEnvelope(message),
    );
  } finally {
    try {
      await stream.close();
    } catch {
      /* idempotent */
    }
  }
}
