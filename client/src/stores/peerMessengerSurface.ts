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
  open: (tab?: PeerMessengerTab) => void;
  close: () => void;
  setTab: (tab: PeerMessengerTab) => void;
  openConversation: (peerId: string) => void;
}

export const usePeerMessengerSurfaceStore = create<PeerMessengerSurfaceState>(
  (set) => ({
    isOpen: false,
    tab: "messages",
    initialPeerId: null,
    open: (tab = "messages") => set({ isOpen: true, tab }),
    close: () => set({ isOpen: false, initialPeerId: null }),
    setTab: (tab) => set({ tab }),
    openConversation: (peerId) =>
      set({ isOpen: true, tab: "messages", initialPeerId: peerId }),
  }),
);
