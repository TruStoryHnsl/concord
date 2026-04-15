/**
 * pure.js — Side-effect-free utility functions extracted from index.js.
 *
 * No external imports. Safe to import in unit tests without loading native
 * bindings or starting any network connections.
 *
 * AudioFrame is passed in as a constructor parameter so this module stays
 * dep-free; tests provide a stub, production code passes the real class.
 */

// ---------------------------------------------------------------------------
// Constants (mirrored from index.js; kept in sync manually)
// ---------------------------------------------------------------------------
export const SAMPLE_RATE = 48000;
export const CHANNELS = 2;
export const FRAME_MS = 20;
export const SAMPLES_PER_CHANNEL = (SAMPLE_RATE / 1000) * FRAME_MS;
export const PCM_BYTES_PER_FRAME = SAMPLES_PER_CHANNEL * CHANNELS * 2;

export const DISCORD_VOICE_IDENTITY_PREFIX = "discord-voice:";
export const DISCORD_USER_IDENTITY_PREFIX = "discord-user:";
export const DISCORD_VIDEO_IDENTITY_PREFIX = "discord-video:";

// TrackSource enum values (numeric mirrors of @livekit/rtc-node TrackSource)
export const TrackSourceValues = {
  SOURCE_UNKNOWN: 0,
  SOURCE_CAMERA: 1,
  SOURCE_MICROPHONE: 2,
  SOURCE_SCREEN_SHARE: 3,
  SOURCE_SCREEN_SHARE_AUDIO: 4,
};

// ---------------------------------------------------------------------------
// Structured logger with redaction
// ---------------------------------------------------------------------------

const DISCORD_TOKEN_RE = /[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/g;
const MATRIX_MXID_RE = /@[^@\s:]+:[^\s"]+/g;

export function redact(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(DISCORD_TOKEN_RE, "[REDACTED_TOKEN]")
    .replace(MATRIX_MXID_RE, "[REDACTED_MXID]");
}

export function redactDeep(value) {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out;
  }
  return value;
}

export function structuredLog(level, event, ...fields) {
  const entry = { ts: new Date().toISOString(), level, event: redact(String(event)) };
  for (const field of fields) {
    if (field !== null && typeof field === "object" && !Array.isArray(field)) {
      for (const [k, v] of Object.entries(field)) entry[k] = redactDeep(v);
    } else if (field instanceof Error) {
      entry.detail = redact(field.message);
    } else if (field !== undefined) {
      entry.detail = redact(String(field));
    }
  }
  console.log(JSON.stringify(entry));
}

// ---------------------------------------------------------------------------
// Audio frame helpers (AudioFrameClass injected so tests can stub it)
// ---------------------------------------------------------------------------

/**
 * @param {object} frame — AudioFrame instance with { data: Int16Array }
 * @returns {Buffer}
 */
export function audioFrameToBuffer(frame) {
  return Buffer.from(
    new Uint8Array(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength),
  );
}

/**
 * @param {Buffer} buffer
 * @param {new (data: Int16Array, sampleRate: number, channels: number, samplesPerChannel: number) => object} AudioFrameClass
 * @returns {object} AudioFrame instance
 */
export function bufferToAudioFrame(buffer, AudioFrameClass) {
  const usableBytes = buffer.byteLength - (buffer.byteLength % (CHANNELS * 2));
  const view = new Int16Array(buffer.buffer, buffer.byteOffset, usableBytes / 2);
  const copy = Int16Array.from(view);
  return new AudioFrameClass(copy, SAMPLE_RATE, CHANNELS, copy.length / CHANNELS);
}

/**
 * Async generator: yields fixed-size AudioFrame objects from a readable stream.
 * @param {AsyncIterable<Buffer>} readable
 * @param {new (...args: any[]) => object} AudioFrameClass
 */
export async function* pcmFrames(readable, AudioFrameClass) {
  let carry = Buffer.alloc(0);
  for await (const chunk of readable) {
    carry = carry.length ? Buffer.concat([carry, chunk]) : chunk;
    while (carry.length >= PCM_BYTES_PER_FRAME) {
      const frame = carry.subarray(0, PCM_BYTES_PER_FRAME);
      carry = carry.subarray(PCM_BYTES_PER_FRAME);
      yield bufferToAudioFrame(frame, AudioFrameClass);
    }
  }
}

// ---------------------------------------------------------------------------
// Video projection policy (INS-035 W3)
// ---------------------------------------------------------------------------

/**
 * Select the best LiveKit video track to relay outbound to Discord.
 *
 * Priority:
 *   1. First screen-share track (SOURCE_SCREEN_SHARE) across all non-bridge participants.
 *   2. Camera track (SOURCE_CAMERA) of activeSpeakerId, if present.
 *   3. null.
 *
 * @param {Iterable<{identity: string, trackPublications: Map<string, {track: {source: number}|null}>}>} participants
 * @param {string|null} activeSpeakerId
 * @param {number} SOURCE_SCREEN_SHARE — numeric value from TrackSource enum
 * @param {number} SOURCE_CAMERA — numeric value from TrackSource enum
 * @returns {{ track: object, source: number } | null}
 */
export function selectVideoSource(participants, activeSpeakerId, SOURCE_SCREEN_SHARE, SOURCE_CAMERA) {
  let activeSpeakerCameraTrack = null;

  for (const participant of participants) {
    if (
      participant.identity.startsWith(DISCORD_VOICE_IDENTITY_PREFIX) ||
      participant.identity.startsWith(DISCORD_USER_IDENTITY_PREFIX) ||
      participant.identity.startsWith(DISCORD_VIDEO_IDENTITY_PREFIX)
    ) {
      continue;
    }

    for (const [, publication] of participant.trackPublications) {
      const track = publication.track;
      if (!track) continue;

      if (track.source === SOURCE_SCREEN_SHARE) {
        return { track, source: SOURCE_SCREEN_SHARE };
      }

      if (
        track.source === SOURCE_CAMERA &&
        participant.identity === activeSpeakerId &&
        activeSpeakerCameraTrack === null
      ) {
        activeSpeakerCameraTrack = { track, source: SOURCE_CAMERA };
      }
    }
  }

  return activeSpeakerCameraTrack;
}
