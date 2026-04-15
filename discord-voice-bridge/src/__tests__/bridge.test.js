/**
 * bridge.test.js — Unit tests for Discord voice bridge pure functions (INS-035 W5).
 *
 * Imports from ../pure.js only — no native bindings, no network, no server.
 */
import { describe, it, expect } from "@jest/globals";
import {
  bufferToAudioFrame,
  audioFrameToBuffer,
  pcmFrames,
  selectVideoSource,
  redact,
  structuredLog,
  PCM_BYTES_PER_FRAME,
  CHANNELS,
  SAMPLE_RATE,
  SAMPLES_PER_CHANNEL,
  TrackSourceValues,
} from "../pure.js";

// ---------------------------------------------------------------------------
// Minimal AudioFrame stub (mirrors @livekit/rtc-node AudioFrame interface)
// ---------------------------------------------------------------------------
class StubAudioFrame {
  constructor(data, sampleRate, channels, samplesPerChannel) {
    this.data = data;
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.samplesPerChannel = samplesPerChannel;
  }
}

// ---------------------------------------------------------------------------
// Test: audioFrameToBuffer round-trip
// ---------------------------------------------------------------------------
describe("audioFrameToBuffer", () => {
  it("converts an AudioFrame to a Buffer of correct byte length", () => {
    const samples = new Int16Array(SAMPLES_PER_CHANNEL * CHANNELS);
    samples.fill(0x1234);
    const frame = new StubAudioFrame(samples, SAMPLE_RATE, CHANNELS, SAMPLES_PER_CHANNEL);

    const buf = audioFrameToBuffer(frame);

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.byteLength).toBe(samples.byteLength);
  });

  it("preserves PCM sample values", () => {
    const samples = new Int16Array([100, 200, 300, 400]);
    const frame = new StubAudioFrame(samples, SAMPLE_RATE, CHANNELS, 2);

    const buf = audioFrameToBuffer(frame);
    const view = new Int16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2);

    expect(view[0]).toBe(100);
    expect(view[3]).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Test: bufferToAudioFrame round-trip
// ---------------------------------------------------------------------------
describe("bufferToAudioFrame", () => {
  it("returns an AudioFrame with correct samplesPerChannel", () => {
    const buf = Buffer.alloc(PCM_BYTES_PER_FRAME);
    const frame = bufferToAudioFrame(buf, StubAudioFrame);

    expect(frame.sampleRate).toBe(SAMPLE_RATE);
    expect(frame.channels).toBe(CHANNELS);
    expect(frame.samplesPerChannel).toBe(SAMPLES_PER_CHANNEL);
  });

  it("round-trips: buffer → frame → buffer preserves bytes", () => {
    const original = Buffer.allocUnsafe(PCM_BYTES_PER_FRAME);
    for (let i = 0; i < original.length; i++) original[i] = (i * 7) & 0xff;

    const frame = bufferToAudioFrame(original, StubAudioFrame);
    const restored = audioFrameToBuffer(frame);

    expect(restored).toEqual(original);
  });

  it("truncates unaligned trailing bytes", () => {
    // 1 extra byte — should be silently dropped.
    const buf = Buffer.alloc(PCM_BYTES_PER_FRAME + 1);
    const frame = bufferToAudioFrame(buf, StubAudioFrame);
    expect(frame.samplesPerChannel).toBe(SAMPLES_PER_CHANNEL);
  });
});

// ---------------------------------------------------------------------------
// Test: pcmFrames chunking
// ---------------------------------------------------------------------------
describe("pcmFrames", () => {
  /**
   * Creates an async iterable from a list of Buffers.
   */
  async function* makeReadable(chunks) {
    for (const chunk of chunks) yield chunk;
  }

  it("yields exactly 3 frames from 3x PCM_BYTES_PER_FRAME bytes", async () => {
    const data = Buffer.alloc(PCM_BYTES_PER_FRAME * 3);
    const gen = pcmFrames(makeReadable([data]), StubAudioFrame);

    let count = 0;
    for await (const _frame of gen) count++;

    expect(count).toBe(3);
  });

  it("yields 2 frames and discards remainder from 2.5x PCM_BYTES_PER_FRAME", async () => {
    const data = Buffer.alloc(Math.floor(PCM_BYTES_PER_FRAME * 2.5));
    const gen = pcmFrames(makeReadable([data]), StubAudioFrame);

    let count = 0;
    for await (const _frame of gen) count++;

    expect(count).toBe(2);
  });

  it("handles chunks arriving smaller than a single frame", async () => {
    // Feed data in 4-byte chunks.
    const total = PCM_BYTES_PER_FRAME * 2;
    const chunks = [];
    for (let i = 0; i < total; i += 4) {
      chunks.push(Buffer.alloc(Math.min(4, total - i)));
    }

    const gen = pcmFrames(makeReadable(chunks), StubAudioFrame);
    let count = 0;
    for await (const _frame of gen) count++;

    expect(count).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Test: selectVideoSource — projection policy
// ---------------------------------------------------------------------------
const SS = TrackSourceValues.SOURCE_SCREEN_SHARE;
const CAM = TrackSourceValues.SOURCE_CAMERA;

function makeParticipant(identity, tracks) {
  // tracks: array of { source: number } (or null for unpublished)
  const trackPublications = new Map(
    tracks.map((t, i) => [
      `pub-${i}`,
      { track: t ? { source: t.source } : null },
    ]),
  );
  return { identity, trackPublications };
}

describe("selectVideoSource", () => {
  it("returns screen-share when both screen-share and camera are present", () => {
    const participants = [
      makeParticipant("user-a", [{ source: CAM }]),
      makeParticipant("user-b", [{ source: SS }]),
    ];
    const result = selectVideoSource(participants, "user-a", SS, CAM);
    expect(result).not.toBeNull();
    expect(result.source).toBe(SS);
  });

  it("screen-share wins over active-speaker camera", () => {
    const participants = [
      makeParticipant("active-user", [{ source: CAM }]),
      makeParticipant("other-user", [{ source: SS }]),
    ];
    const result = selectVideoSource(participants, "active-user", SS, CAM);
    expect(result.source).toBe(SS);
  });

  it("returns active-speaker camera when no screen-share exists", () => {
    const participants = [
      makeParticipant("user-a", [{ source: CAM }]),
      makeParticipant("user-b", [{ source: CAM }]),
    ];
    const result = selectVideoSource(participants, "user-a", SS, CAM);
    expect(result).not.toBeNull();
    expect(result.source).toBe(CAM);
    expect(result.track.source).toBe(CAM);
  });

  it("returns null when no tracks are published", () => {
    const participants = [
      makeParticipant("user-a", []),
      makeParticipant("user-b", [null]),
    ];
    const result = selectVideoSource(participants, "user-a", SS, CAM);
    expect(result).toBeNull();
  });

  it("returns null when activeSpeakerId is null and no screen-share", () => {
    const participants = [
      makeParticipant("user-a", [{ source: CAM }]),
    ];
    const result = selectVideoSource(participants, null, SS, CAM);
    expect(result).toBeNull();
  });

  it("skips bridge participants (discord-voice: prefix)", () => {
    const participants = [
      makeParticipant("discord-voice:guild:channel", [{ source: SS }]),
      makeParticipant("user-a", [{ source: CAM }]),
    ];
    const result = selectVideoSource(participants, "user-a", SS, CAM);
    // The screen-share is from a bridge participant — should be skipped.
    // Falls back to active-speaker camera.
    expect(result).not.toBeNull();
    expect(result.source).toBe(CAM);
  });

  it("skips discord-user: prefixed synthetic participants", () => {
    const participants = [
      makeParticipant("discord-user:guild:123", [{ source: SS }]),
    ];
    const result = selectVideoSource(participants, null, SS, CAM);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Test: redact — token and MXID redaction
// ---------------------------------------------------------------------------
describe("redact", () => {
  it("redacts a Discord bot token pattern", () => {
    // 24-char base64url + "." + 6-char + "." + 27+-char (matches real token format)
    const token = "EXAMPLE_FAKE_TOKEN_NOPE_X.FAKE12.do_not_use_test_fixture_only_xx";
    const output = redact(`logged token: ${token}`);
    expect(output).not.toContain(token);
    expect(output).toContain("[REDACTED_TOKEN]");
  });

  it("redacts a Matrix user ID", () => {
    const mxid = "@alice:example.com";
    const output = redact(`user ${mxid} connected`);
    expect(output).not.toContain(mxid);
    expect(output).toContain("[REDACTED_MXID]");
  });

  it("leaves unrelated strings unchanged", () => {
    const safe = "bridge started on port 3098";
    expect(redact(safe)).toBe(safe);
  });

  it("handles non-string values by returning them as-is", () => {
    expect(redact(42)).toBe(42);
    expect(redact(null)).toBe(null);
  });
});
