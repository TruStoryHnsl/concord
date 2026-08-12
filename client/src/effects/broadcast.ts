// Effects broadcast — encode/decode an effect trigger for the LiveKit
// data channel so peers in the same voice room SEE the visual too.
//
// The soundboard already broadcasts the *sound* by publishing a LiveKit
// audio track named "soundboard". For the *visual* we send a tiny,
// lossy-OK data packet (LiveKit `publishData` with `reliable: true` and a
// dedicated topic). Each receiver decodes it and fires the named effect
// locally via the effects store. We never send pixels — just the effect
// id + config diff, identical to what `EffectMetadata` already persists.

import type { LocalParticipant } from "livekit-client";
import type { EffectMetadata } from "./types";
import { parseEffectMetadata } from "./registry";

/** Reserved topic so receivers can filter effect packets from any other
 *  data-channel traffic the app may add later. */
export const EFFECTS_DATA_TOPIC = "concord.effect";

interface EffectPacket {
  /** packet schema marker */
  t: "fx";
  meta: EffectMetadata;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Serialise an effect trigger to bytes for `room.localParticipant
 * .publishData`. Returns null when there's no visual to broadcast (a
 * sound-only item needs no data packet — the audio track carries it).
 */
export function encodeEffectPacket(meta: EffectMetadata): Uint8Array | null {
  if (!meta.visualId) return null;
  const packet: EffectPacket = { t: "fx", meta };
  return encoder.encode(JSON.stringify(packet));
}

/**
 * Decode an inbound data packet into `EffectMetadata`, or null if it isn't
 * a valid effect packet. Defensive — never throws on malformed input.
 */
export function decodeEffectPacket(payload: Uint8Array): EffectMetadata | null {
  let text: string;
  try {
    text = decoder.decode(payload);
  } catch {
    return null;
  }
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof obj !== "object" || obj === null) return null;
  const record = obj as Record<string, unknown>;
  if (record.t !== "fx") return null;
  return parseEffectMetadata(record.meta);
}

/**
 * Publish an effect trigger to the voice room via the local participant.
 * Best-effort: if there's no participant or no visual, this is a no-op
 * (the local play already happened; broadcasting is the "everyone else
 * sees it" bonus). Reliable delivery so a dropped datagram doesn't eat
 * the effect. SoundboardPanel already has the `LocalParticipant` in hand,
 * so we take it directly rather than threading a Room through.
 */
export async function broadcastEffect(
  participant: LocalParticipant | null | undefined,
  meta: EffectMetadata,
): Promise<void> {
  if (!participant) return;
  const bytes = encodeEffectPacket(meta);
  if (!bytes) return;
  try {
    await participant.publishData(bytes, {
      reliable: true,
      topic: EFFECTS_DATA_TOPIC,
    });
  } catch (err) {
    // Non-fatal: the user still saw their own effect. Log for diagnostics.
    console.warn("Failed to broadcast effect:", err);
  }
}
