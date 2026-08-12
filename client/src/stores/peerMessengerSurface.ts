/**
 * peerMessengerSurface — the p2p peer messenger as a PRIMARY surface.
 *
 * The per-peer inboxes (message history) and the known-peers registry
 * are the core of the p2p messenger — they were originally mounted only
 * as native Settings tabs, which buried the product's primary UI inside
 * a settings menu. This store drives their promotion into the main
 * shell: a rail tile opens the full-pane messenger surface
 * (`components/social/PeerMessengerSurface.tsx`), mutually exclusive
 * with the server/DM/local/reticulum surfaces exactly like the
 * reticulum surface store.
 */

import { create } from "zustand";

export type PeerMessengerTab = "messages" | "peers";

interface PeerMessengerSurfaceState {
  isOpen: boolean;
  tab: PeerMessengerTab;
  /** Peer id to open a conversation with when the Messages tab mounts. */
  initialPeerId: string | null;
  /** Recipient persona for the opened conversation, when known (e.g. from
   *  an announce). The web composer needs it to send over the mesh — a
   *  reticulum destination hash alone is not addressable without it. */
  initialPersonaId: string | null;
  open: (tab?: PeerMessengerTab) => void;
  close: () => void;
  setTab: (tab: PeerMessengerTab) => void;
  openConversation: (peerId: string, opts?: { personaId?: string | null }) => void;
}

export const usePeerMessengerSurfaceStore = create<PeerMessengerSurfaceState>(
  (set) => ({
    isOpen: false,
    tab: "messages",
    initialPeerId: null,
    initialPersonaId: null,
    open: (tab = "messages") => set({ isOpen: true, tab }),
    close: () => set({ isOpen: false, initialPeerId: null, initialPersonaId: null }),
    setTab: (tab) => set({ tab }),
    openConversation: (peerId, opts) =>
      set({
        isOpen: true,
        tab: "messages",
        initialPeerId: peerId,
        initialPersonaId: opts?.personaId ?? null,
      }),
  }),
);
