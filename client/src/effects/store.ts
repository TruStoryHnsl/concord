// Effects event bus (zustand).
//
// Decouples the *trigger* (a button in the Effects panel, a hotkey, or an
// inbound LiveKit broadcast from a peer) from the *renderer* (the single
// <EffectsOverlay/> mounted at the app root). Anyone can call
// `fireEffect(meta)` to enqueue a visual; the overlay drains the queue on
// each render and starts the corresponding canvas renderer.
//
// We use a monotonically-incrementing queue rather than a single "current
// effect" slot so two effects fired in quick succession both play
// (stacked on the same canvas) instead of clobbering each other.

import { create } from "zustand";
import type { EffectMetadata } from "./types";

export interface FireOptions {
  /**
   * Who fired it — "local" for self-fired, otherwise a peer identity.
   * The overlay uses this only for optional attribution; the network
   * echo guard lives at the broadcast layer, not here.
   */
  origin?: string;
  /**
   * Optional sound to play locally alongside the visual. Used by the
   * authoring *live preview* (where the soundboard's own playback chain
   * isn't involved) so the author hears the paired clip while tuning.
   * The normal fire-from-panel path leaves this undefined because
   * SoundboardPanel.playClip already plays + broadcasts the audio.
   */
  soundUrl?: string;
}

export interface QueuedEffect {
  /** Unique id so the overlay can dedupe/track what it has consumed. */
  seq: number;
  meta: EffectMetadata;
  origin: string;
  soundUrl?: string;
}

interface EffectsState {
  queue: QueuedEffect[];
  nextSeq: number;
  /** Enqueue an effect for the overlay to render. Returns its seq. */
  fire: (meta: EffectMetadata, opts?: FireOptions) => number;
  /** Remove a consumed effect from the queue by seq. */
  consume: (seq: number) => void;
}

export const useEffectsStore = create<EffectsState>((set, get) => ({
  queue: [],
  nextSeq: 1,
  fire: (meta, opts) => {
    const seq = get().nextSeq;
    set((s) => ({
      queue: [
        ...s.queue,
        { seq, meta, origin: opts?.origin ?? "local", soundUrl: opts?.soundUrl },
      ],
      nextSeq: s.nextSeq + 1,
    }));
    return seq;
  },
  consume: (seq) =>
    set((s) => ({ queue: s.queue.filter((q) => q.seq !== seq) })),
}));

/**
 * Imperative convenience for non-React callers (the broadcast receiver,
 * hotkey handlers). Mirrors `useEffectsStore.getState().fire`.
 */
export function fireEffect(meta: EffectMetadata, opts?: FireOptions): number {
  return useEffectsStore.getState().fire(meta, opts);
}
