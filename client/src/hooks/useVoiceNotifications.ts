import { useEffect, useRef } from "react";
import { Participant } from "livekit-client";

/** Frequency pairs: [first note, second note] */
const JOIN_NOTES = [440, 580]; // Rising — A4 → D5-ish
const LEAVE_NOTES = [480, 340]; // Falling

function playTone(frequencies: number[], volume: number) {
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    frequencies.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      const start = ctx.currentTime + i * 0.12;
      osc.start(start);
      osc.stop(start + 0.1);
    });

    gain.gain.setValueAtTime(volume * 0.3, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);

    // Clean up after sound finishes
    setTimeout(() => ctx.close(), 500);
  } catch {
    // AudioContext not available
  }
}

/**
 * Plays a sound when participants join or leave a voice channel.
 * Skips the initial participant list to avoid sounds on connect.
 */
export function useVoiceNotifications(
  participants: Participant[],
  localIdentity: string,
  volume: number,
) {
  const prevIdentities = useRef<Set<string> | null>(null);

  useEffect(() => {
    const currentIds = new Set(participants.map((p) => p.identity));

    // Skip first render (initial participant list on connect)
    if (prevIdentities.current === null) {
      prevIdentities.current = currentIds;
      return;
    }

    const prev = prevIdentities.current;

    // Detect joins (in current but not in previous, excluding self)
    for (const id of currentIds) {
      if (!prev.has(id) && id !== localIdentity) {
        playTone(JOIN_NOTES, volume);
        break; // One sound even if multiple join simultaneously
      }
    }

    // Detect leaves (in previous but not in current, excluding self)
    for (const id of prev) {
      if (!currentIds.has(id) && id !== localIdentity) {
        playTone(LEAVE_NOTES, volume);
        break;
      }
    }

    prevIdentities.current = currentIds;
  }, [participants, localIdentity, volume]);
}
