/**
 * Voice-mesh PURE signaling logic tests.
 *
 * These exercise the wire contract + framing + state mapping WITHOUT a
 * WebRTC stack or a libp2p node — the encode→decode round-trip and the
 * connection-state machine are pure data transforms, so the assertions
 * are over observable byte/object outputs, not mocked internals.
 *
 * The wire shape under test MUST match the Rust enum in
 * `src-tauri/src/servitude/voice/signaling.rs`:
 *
 *   #[serde(tag = "type", rename_all = "snake_case")]
 *   Offer { sdp, request_id } / Answer { sdp, request_id }
 *   IceCandidate { candidate, request_id } / Bye { request_id }
 *
 * A drift here is a browser↔native desync, so several cases pin the
 * exact JSON byte form (snake_case tag, `request_id` field name).
 */

import { describe, expect, it } from "vitest";
import {
  MAX_ENVELOPE_BYTES,
  frameEnvelope,
  mapConnectionState,
  parseSignalingMessage,
  readEnvelope,
  serializeSignalingMessage,
  type SignalingMessage,
} from "../voiceSignaling";

/** Decode the JSON a `serializeSignalingMessage` produced. */
function decodeJson(bytes: Uint8Array): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<
    string,
    unknown
  >;
}

describe("SignalingMessage wire shape (Rust contract)", () => {
  it("offer serializes with snake_case tag + request_id field", () => {
    const offer: SignalingMessage = {
      type: "offer",
      sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n",
      request_id: 42,
    };
    const json = decodeJson(serializeSignalingMessage(offer));
    expect(json.type).toBe("offer");
    expect(json.request_id).toBe(42);
    expect(json.sdp).toBe("v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n");
  });

  it("bye uses the snake_case `bye` tag and carries only request_id", () => {
    const json = decodeJson(
      serializeSignalingMessage({ type: "bye", request_id: 7 }),
    );
    expect(json.type).toBe("bye");
    expect(json.request_id).toBe(7);
    expect(json.sdp).toBeUndefined();
  });

  it("ice_candidate carries the candidate string + request_id", () => {
    const json = decodeJson(
      serializeSignalingMessage({
        type: "ice_candidate",
        candidate: "candidate:1 1 UDP 12345 1.2.3.4 4444 typ host",
        request_id: 3,
      }),
    );
    expect(json.type).toBe("ice_candidate");
    expect(json.candidate).toBe(
      "candidate:1 1 UDP 12345 1.2.3.4 4444 typ host",
    );
    expect(json.request_id).toBe(3);
  });
});

describe("encode → decode round-trips", () => {
  const cases: SignalingMessage[] = [
    { type: "offer", sdp: "v=0\r\noffer-sdp\r\n", request_id: 1 },
    { type: "answer", sdp: "v=0\r\nanswer-sdp\r\n", request_id: 2 },
    {
      type: "ice_candidate",
      candidate: "candidate:abc 1 UDP 1 1.1.1.1 1 typ host",
      request_id: 3,
      sdp_mid: "0",
      sdp_mline_index: 0,
    },
    { type: "bye", request_id: 4 },
  ];

  for (const original of cases) {
    it(`${original.type} survives serialize → parse`, () => {
      const parsed = parseSignalingMessage(
        serializeSignalingMessage(original),
      );
      expect(parsed).toEqual(original);
    });
  }

  it("ice_candidate without mid/index decodes with nulls (native→browser)", () => {
    // A native peer sends only `candidate` + `request_id`. The browser
    // parser must tolerate the missing optional fields and surface them
    // as null rather than throwing.
    const wire = new TextEncoder().encode(
      JSON.stringify({
        type: "ice_candidate",
        candidate: "candidate:x 1 UDP 1 2.2.2.2 2 typ srflx",
        request_id: 9,
      }),
    );
    const parsed = parseSignalingMessage(wire);
    expect(parsed).toEqual({
      type: "ice_candidate",
      candidate: "candidate:x 1 UDP 1 2.2.2.2 2 typ srflx",
      request_id: 9,
      sdp_mid: null,
      sdp_mline_index: null,
    });
  });
});

describe("parseSignalingMessage validation", () => {
  function wire(obj: unknown): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(obj));
  }

  it("rejects an unknown type tag", () => {
    expect(() =>
      parseSignalingMessage(wire({ type: "renegotiate", request_id: 1 })),
    ).toThrow(/unknown voice signaling type/);
  });

  it("rejects a missing request_id", () => {
    expect(() =>
      parseSignalingMessage(wire({ type: "offer", sdp: "x" })),
    ).toThrow(/request_id/);
  });

  it("rejects an offer with no sdp", () => {
    expect(() =>
      parseSignalingMessage(wire({ type: "offer", request_id: 1 })),
    ).toThrow(/missing string sdp/);
  });

  it("rejects an ice_candidate with no candidate string", () => {
    expect(() =>
      parseSignalingMessage(wire({ type: "ice_candidate", request_id: 1 })),
    ).toThrow(/missing candidate/);
  });

  it("rejects a non-object envelope", () => {
    expect(() => parseSignalingMessage(wire(42))).toThrow(/not an object/);
  });
});

describe("framing (4-byte BE length prefix)", () => {
  it("frames with a big-endian length prefix matching the body size", () => {
    const message: SignalingMessage = {
      type: "offer",
      sdp: "abc",
      request_id: 1,
    };
    const body = serializeSignalingMessage(message);
    const framed = frameEnvelope(message);
    expect(framed.length).toBe(4 + body.length);
    const prefix = new DataView(
      framed.buffer,
      framed.byteOffset,
      4,
    ).getUint32(0, /* littleEndian */ false);
    expect(prefix).toBe(body.length);
    // Body after the prefix must be the exact serialized envelope.
    expect(Array.from(framed.slice(4))).toEqual(Array.from(body));
  });

  it("readEnvelope reverses frameEnvelope across split chunks", async () => {
    const message: SignalingMessage = {
      type: "answer",
      sdp: "v=0\r\nsplit-chunk-answer\r\n",
      request_id: 5,
    };
    const framed = frameEnvelope(message);
    // Hand the framed bytes to readEnvelope in 3 awkward chunks (split
    // mid-prefix and mid-body) to prove the reassembly handles real
    // libp2p stream fragmentation.
    const splits = [framed.slice(0, 2), framed.slice(2, 7), framed.slice(7)];
    async function* source() {
      for (const s of splits) yield s;
    }
    const parsed = await readEnvelope(source());
    expect(parsed).toEqual(message);
  });

  it("readEnvelope rejects an oversized length prefix", async () => {
    // A prefix claiming > 1 MiB is a framing desync, not a real message.
    const bogus = new Uint8Array(4);
    new DataView(bogus.buffer).setUint32(0, MAX_ENVELOPE_BYTES + 1, false);
    async function* source() {
      yield bogus;
    }
    await expect(readEnvelope(source())).rejects.toThrow(/too large/);
  });

  it("readEnvelope rejects a stream that closes before the prefix", async () => {
    async function* source() {
      yield new Uint8Array([0, 0]); // only 2 of 4 prefix bytes
    }
    await expect(readEnvelope(source())).rejects.toThrow(
      /closed before length prefix/,
    );
  });
});

describe("serialize size cap", () => {
  it("throws when the encoded envelope exceeds MAX_ENVELOPE_BYTES", () => {
    const huge = "x".repeat(MAX_ENVELOPE_BYTES + 1);
    expect(() =>
      serializeSignalingMessage({
        type: "offer",
        sdp: huge,
        request_id: 1,
      }),
    ).toThrow(/too large/);
  });
});

describe("mapConnectionState (real RTCPeerConnectionState → UI state)", () => {
  it("folds new + connecting into 'connecting'", () => {
    expect(mapConnectionState("new")).toBe("connecting");
    expect(mapConnectionState("connecting")).toBe("connecting");
  });

  it("maps connected → 'connected' (the only success state)", () => {
    expect(mapConnectionState("connected")).toBe("connected");
  });

  it("maps disconnected + failed → 'failed'", () => {
    expect(mapConnectionState("disconnected")).toBe("failed");
    expect(mapConnectionState("failed")).toBe("failed");
  });

  it("maps closed → 'closed'", () => {
    expect(mapConnectionState("closed")).toBe("closed");
  });
});
