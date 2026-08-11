/**
 * reticulumSurface — which Reticulum source (if any) owns the main pane.
 *
 * Reticulum is a SOURCE, but not a Discord-shaped one: it has no
 * servers/channels/messages, so clicking its rail tile must NOT route
 * through `switchToSource` (no Matrix session exists or ever will) or
 * render the channel-column chat panes. Instead it opens the dedicated
 * Reticulum surface (`components/reticulum/ReticulumSurface.tsx`) whose
 * shape follows the Reticulum framework itself: network topology,
 * announces, interfaces.
 *
 * Mutually exclusive with the server/DM/local surfaces — ChatLayout
 * closes this surface whenever one of those activates, and opening this
 * surface clears those (at the click site).
 */

import { create } from "zustand";

export type ReticulumTab = "network" | "announces" | "interfaces";

interface ReticulumSurfaceState {
  /** The `ConcordSource.id` of the reticulum source being viewed, or
   *  null when the surface is closed. */
  sourceId: string | null;
  tab: ReticulumTab;
  open: (sourceId: string) => void;
  close: () => void;
  setTab: (tab: ReticulumTab) => void;
}

export const useReticulumSurfaceStore = create<ReticulumSurfaceState>((set) => ({
  sourceId: null,
  tab: "network",
  open: (sourceId) => set({ sourceId, tab: "network" }),
  close: () => set({ sourceId: null }),
  setTab: (tab) => set({ tab }),
}));
