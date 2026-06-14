/**
 * Phase 8/9 follow-up — PURE voice-mesh signaling logic.
 *
 * This module is deliberately free of any browser-only globals
 * (`RTCPeerConnection`, `navigator`, `document`, `Audio`). Everything
 * here is a pure function over plain data so it can be unit-tested in a
 * vanilla node environment without a WebRTC stack or a libp2p node.
 *
 * It owns three concerns:
 *
 *   1. The wire envelope (`SignalingMessage`) — the JSON shape that
 *      mirrors the Rust `servitude::voice::SignalingMessage` enum. The
 *      browser and the native build MUST agree on this byte-for-byte
 *      or a browser↔native call will desync.
 *   2. Framing — `frameEnvelope` / `readEnvelope` implement the 4-byte
 *      big-endian length prefix the Rust `send_signaling` helper writes
 *      and reads. Symmetric with `federation.ts`.
 *   3. The connection-state mapping — `mapConnectionState` translates a
 *      DOM `RTCPeerConnectionState` into the small `MeshPeerState` enum
 *      the UI renders. This is the ONLY source of truth for "is this
 *      peer connected"; the orchestrator never invents a state, it
 *      mirrors what the real `RTCPeerConnection` reports.
 *
 * Keeping this logic pure is what lets the test suite assert the
 * encode→decode round-trip and the state machine WITHOUT mocking the
 * entire WebRTC API — the brittle-mock trap that
 * `CLAUDE.md`'s testing rules call out.
 */

/**
 * Wire envelope mirroring `servitude::voice::SignalingMessage`. The
 * serde tag is `type` and the values are snake_case — see
 * `src-tauri/src/servitude/voice/signaling.rs`. `request_id` correlates
 * an Offer with its matching Answer; both sides may have multiple calls
 * in flight simultaneously.
 *
 * The browser side carries `sdp_mid` / `sdp_mline_index` alongside the
 * raw `candidate` string for ICE candidates. The Rust wire form only
 * has `candidate`; the extra fields are optional and tolerated by
 * serde's `deny_unknown_fields`-free default, so a browser→native
 * candidate still decodes. A native→browser candidate arrives without
 * them, which the browser's `RTCIceCandidate({ candidate })` handles
 * (the mid/index are recoverable from the single m-line in a mono-audio
 * SDP).
 */
export type SignalingMessage =
  | { type: "offer"; sdp: string; request_id: number }
  | { type: "answer"; sdp: string; request_id: number }
  | {
      type: "ice_candidate";
      candidate: string;
      request_id: number;
      sdp_mid?: string | null;
      sdp_mline_index?: number | null;
    }
  | { type: "bye"; request_id: number };

/**
 * Maximum size of a single framed envelope. 1 MiB matches the Rust
 * `MAX_ENVELOPE_BYTES` cap — signaling messages are small (SDP blocks
 * are a few KB, ICE candidates a few hundred bytes). Anything over the
 * cap is a framing desync, not a legitimate message.
 */
export const MAX_ENVELOPE_BYTES = 1024 * 1024;

/**
 * The small per-peer call state the UI renders. This is a deliberately
 * narrower enum than the DOM's `RTCPeerConnectionState`; we fold
 * `new`/`connecting` into a single "connecting" bucket and treat
 * `disconnected`/`failed` as terminal-failure for UI purposes (the
 * orchestrator may still attempt an ICE restart, but from the user's
 * perspective the dot is red).
 *
 * Mirrors the Rust `PeerCallState` arms closely enough that a future
 * unified status surface can map between them 1:1.
 */
export type MeshPeerState =
  | "connecting"
  | "connected"
  | "closed"
  | "failed";

/**
 * Map a DOM `RTCPeerConnectionState` to the UI-facing `MeshPeerState`.
 *
 * This is the single point where "the browser says the connection is
 * X" becomes "the user sees Y". The orchestrator's
 * `onconnectionstatechange` handler calls exactly this — it NEVER sets
 * a state by hand, so the rendered status is always a faithful mirror
 * of the real PeerConnection.
 */
export function mapConnectionState(
  s: RTCPeerConnectionState,
): MeshPeerState {
  switch (s) {
    case "new":
    case "connecting":
      return "connecting";
    case "connected":
      return "connected";
    case "closed":
      return "closed";
    case "disconnected":
    case "failed":
      return "failed";
    default:
      // Exhaustiveness guard — if the DOM lib adds a new variant, we
      // treat it as connecting rather than silently dropping it.
      return "connecting";
  }
}

/**
 * Serialize a `SignalingMessage` to its JSON wire bytes. Throws if the
 * encoded form exceeds {@link MAX_ENVELOPE_BYTES} — a message that big
 * is a bug (no legitimate SDP or candidate approaches 1 MiB), and
 * sending it would just desync the remote's framer.
 */
export function serializeSignalingMessage(
  message: SignalingMessage,
): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(message));
  if (body.length > MAX_ENVELOPE_BYTES) {
    throw new Error(
      `voice signaling envelope too large: ${body.length} > ${MAX_ENVELOPE_BYTES}`,
    );
  }
  return body;
}

/**
 * Parse JSON wire bytes back into a `SignalingMessage`, validating the
 * tag + required fields. Throws on a malformed envelope rather than
 * returning a half-formed object — the caller must treat a parse
 * failure as "drop this stream", not "process a partial message".
 */
export function parseSignalingMessage(bytes: Uint8Array): SignalingMessage {
  const text = new TextDecoder().decode(bytes);
  const raw: unknown = JSON.parse(text);
  if (typeof raw !== "object" || raw === null) {
    throw new Error("voice signaling envelope is not an object");
  }
  const obj = raw as Record<string, unknown>;
  const type = obj.type;
  const requestId = obj.request_id;
  if (typeof requestId !== "number" || !Number.isFinite(requestId)) {
    throw new Error("voice signaling envelope missing numeric request_id");
  }
  switch (type) {
    case "offer":
    case "answer": {
      if (typeof obj.sdp !== "string") {
        throw new Error(`voice signaling ${type} missing string sdp`);
      }
      return { type, sdp: obj.sdp, request_id: requestId };
    }
    case "ice_candidate": {
      if (typeof obj.candidate !== "string") {
        throw new Error("voice signaling ice_candidate missing candidate");
      }
      return {
        type: "ice_candidate",
        candidate: obj.candidate,
        request_id: requestId,
        sdp_mid:
          typeof obj.sdp_mid === "string" ? obj.sdp_mid : null,
        sdp_mline_index:
          typeof obj.sdp_mline_index === "number"
            ? obj.sdp_mline_index
            : null,
      };
    }
    case "bye":
      return { type: "bye", request_id: requestId };
    default:
      throw new Error(`unknown voice signaling type: ${String(type)}`);
  }
}

/**
 * Frame a message into the 4-byte big-endian length prefix + JSON body
 * the Rust `send_signaling` helper expects. Returns the bytes ready to
 * hand to a libp2p stream's `send`.
 */
export function frameEnvelope(message: SignalingMessage): Uint8Array {
  const body = serializeSignalingMessage(message);
  const out = new Uint8Array(4 + body.length);
  const view = new DataView(out.buffer, out.byteOffset, 4);
  view.setUint32(0, body.length, /* littleEndian */ false);
  out.set(body, 4);
  return out;
}

/**
 * Read a single 4-byte BE length-prefixed envelope from a libp2p
 * `MessageStream`-like async source and decode it. Mirrors the framing
 * in `federation.ts`.
 *
 * The chunk type is intentionally `Uint8Array | { subarray(): Uint8Array }`
 * so this module stays free of the `uint8arraylist` import — the only
 * shape we need from a `Uint8ArrayList` is its `subarray()` accessor.
 */
export async function readEnvelope(
  source: AsyncIterable<Uint8Array | { subarray(): Uint8Array }>,
): Promise<SignalingMessage> {
  const collected: number[] = [];
  let len: number | null = null;
  for await (const chunk of source) {
    const bytes = chunkToUint8Array(chunk);
    for (let i = 0; i < bytes.length; i++) collected.push(bytes[i]);
    if (len === null && collected.length >= 4) {
      const lenView = new DataView(
        Uint8Array.from(collected.slice(0, 4)).buffer,
      );
      len = lenView.getUint32(0, /* littleEndian */ false);
      if (len > MAX_ENVELOPE_BYTES) {
        throw new Error(
          `voice signaling envelope too large: ${len} > ${MAX_ENVELOPE_BYTES}`,
        );
      }
    }
    if (len !== null && collected.length >= 4 + len) {
      return parseSignalingMessage(
        Uint8Array.from(collected.slice(4, 4 + len)),
      );
    }
  }
  if (len === null) {
    throw new Error("stream closed before length prefix");
  }
  throw new Error("stream closed mid-body");
}

function chunkToUint8Array(
  chunk: Uint8Array | { subarray(): Uint8Array },
): Uint8Array {
  if (chunk instanceof Uint8Array) return chunk;
  return chunk.subarray();
}
