/**
 * Drives the Tap-to-pair sheet. Thin state machine over the proximityPair
 * API: it owns the current phase, the SAS code to show, and the
 * remote payload captured so it can be committed on `paired`.
 *
 * Design note: the `paired` event now carries the full remote card
 * (`{peerId, publicKeyHex, multiaddrs, signatureHex}`); the handler builds the
 * card from the event and commits exactly that, then stashes it in `remote`
 * for reference. No pre-seeding required.
 */
import { create } from "zustand";
import {
  startProximityPair,
  confirmPairing,
  cancelPairing,
  commitPairedPeer,
  type LocalPairingPayload,
  type ProximityPairState,
} from "../api/proximityPair";

type Phase =
  | "idle"
  | "searching"
  | "connecting"
  | "awaitingConfirm"
  | "paired"
  | "error"
  | "unsupported";

interface ProximityPairStore {
  phase: Phase;
  code: string | null;
  error: string | null;
  remote: LocalPairingPayload | null;
  begin: (local: LocalPairingPayload) => Promise<void>;
  confirm: () => Promise<void>;
  cancel: () => Promise<void>;
}

export const useProximityPairStore = create<ProximityPairStore>((set) => ({
  phase: "idle",
  code: null,
  error: null,
  remote: null,

  begin: async (local) => {
    // Reset phase/code/error but leave remote untouched so a pre-seeded
    // remote (or one captured from a future awaitingConfirm payload) is
    // still available when the `paired` callback fires.
    set({ phase: "searching", code: null, error: null });
    await startProximityPair(local, (s: ProximityPairState) => {
      switch (s.phase) {
        case "searching":
        case "connecting":
        case "idle":
          set({ phase: s.phase });
          break;
        case "awaitingConfirm":
          set({ phase: "awaitingConfirm", code: s.code });
          break;
        case "paired": {
          // The remote card is delivered by the paired event itself (the
          // transport — mock or BLE — fills it in), so commit exactly that.
          const remote: LocalPairingPayload = {
            peerId: s.peerId,
            publicKeyHex: s.publicKeyHex,
            multiaddrs: s.multiaddrs,
            signatureHex: s.signatureHex,
          };
          void (async () => {
            await commitPairedPeer(remote);
            set({ phase: "paired", remote });
          })();
          break;
        }
        case "error":
          set({ phase: "error", error: s.message });
          break;
        case "unsupported":
          set({ phase: "unsupported" });
          break;
      }
    });
  },

  confirm: async () => {
    await confirmPairing();
  },

  cancel: async () => {
    await cancelPairing();
    set({ phase: "idle", code: null, error: null, remote: null });
  },
}));
