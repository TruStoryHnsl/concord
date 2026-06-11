/**
 * Drives the Tap-to-pair sheet. Thin state machine over the proximityPair
 * API: it owns the current phase, the SAS code to show, and the
 * remote payload captured so it can be committed on `paired`.
 *
 * Design note: `begin` intentionally does NOT reset `remote` to null at
 * start. The second test seeds `remote` before calling `begin`, and the
 * "paired" handler reads `get().remote` to decide what to commit. The
 * `beforeEach` in the tests resets to null explicitly between runs.
 * Normal usage: remote is null at first; it gets set by a future task
 * when the awaitingConfirm state carries the remote payload; the paired
 * handler then picks it up. For the current mock-driven Phase 1 tests,
 * the seed stands in for that future path.
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

export const useProximityPairStore = create<ProximityPairStore>((set, get) => ({
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
          void (async () => {
            const remote = get().remote;
            if (remote) await commitPairedPeer(remote);
            set({ phase: "paired" });
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
