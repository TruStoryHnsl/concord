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
  pollProximityPair,
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
    set({ phase: "searching", code: null, error: null });

    // Apply a state from either the desktop Channel or the iOS poll.
    let committed = false;
    let done = false;
    const apply = (s: ProximityPairState): boolean => {
      switch (s.phase) {
        case "idle":
          // Ignore — the iOS poll returns idle on non-pairing/desktop builds;
          // never let it clobber a real phase.
          return false;
        case "searching":
        case "connecting":
          set({ phase: s.phase });
          return false;
        case "awaitingConfirm":
          set({ phase: "awaitingConfirm", code: s.code });
          return false;
        case "paired": {
          if (!committed) {
            committed = true;
            const remote: LocalPairingPayload = {
              peerId: s.peerId,
              publicKeyHex: s.publicKeyHex,
              multiaddrs: s.multiaddrs,
              signatureHex: s.signatureHex,
            };
            void (async () => {
              try {
                await commitPairedPeer(remote);
                set({ phase: "paired", remote });
              } catch (e) {
                set({ phase: "error", error: `commit failed: ${String(e)}` });
              }
            })();
          }
          return true;
        }
        case "error":
          set({ phase: "error", error: s.message });
          return true;
        case "unsupported":
          set({ phase: "unsupported" });
          return true;
      }
    };

    try {
      await startProximityPair(local, (s) => {
        if (apply(s)) done = true;
      });
    } catch (e) {
      set({ phase: "error", error: `start failed: ${String(e)}` });
      return;
    }

    // The Swift→JS event push is unreliable on iOS (and the iPad reports a
    // desktop user-agent, so platform-sniffing is out) — poll the engine state
    // unconditionally. On desktop/web the poll returns idle/null and is ignored;
    // the mock there drives the UI via the Channel above.
    const timer = setInterval(async () => {
      if (done) {
        clearInterval(timer);
        return;
      }
      let s: ProximityPairState | null = null;
      try {
        s = await pollProximityPair();
      } catch {
        return;
      }
      if (!s) return;
      if (apply(s)) {
        done = true;
        clearInterval(timer);
      }
    }, 500);
  },

  confirm: async () => {
    await confirmPairing();
  },

  cancel: async () => {
    await cancelPairing();
    set({ phase: "idle", code: null, error: null, remote: null });
  },
}));
