import { describe, expect, it } from "vitest";
import {
  decodeEffectPacket,
  encodeEffectPacket,
} from "../broadcast";
import type { EffectMetadata } from "../types";

describe("effect broadcast encode/decode", () => {
  it("round-trips a visual effect packet", () => {
    const meta: EffectMetadata = {
      visualId: "confetti",
      config: { count: 200 },
      version: 1,
    };
    const bytes = encodeEffectPacket(meta);
    expect(bytes).not.toBeNull();
    const decoded = decodeEffectPacket(bytes!);
    expect(decoded).toEqual(meta);
  });

  it("returns null when there is no visual to broadcast", () => {
    expect(encodeEffectPacket({ visualId: null })).toBeNull();
  });

  it("decode rejects non-effect / malformed payloads", () => {
    const enc = new TextEncoder();
    expect(decodeEffectPacket(enc.encode("garbage"))).toBeNull();
    expect(decodeEffectPacket(enc.encode(JSON.stringify({ t: "other" })))).toBeNull();
    // t:"fx" but missing meta → parseEffectMetadata(undefined) → null
    expect(decodeEffectPacket(enc.encode(JSON.stringify({ t: "fx" })))).toBeNull();
  });

  it("decode of a packet with a null-meta yields null", () => {
    const enc = new TextEncoder();
    const payload = enc.encode(JSON.stringify({ t: "fx", meta: null }));
    expect(decodeEffectPacket(payload)).toBeNull();
  });
});
