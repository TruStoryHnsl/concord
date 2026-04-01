import { create } from "zustand";
import type { WebhostInfo } from "@/api/tauri";
import { startWebhost, stopWebhost, getWebhostStatus } from "@/api/tauri";

interface WebhostState {
  isRunning: boolean;
  info: WebhostInfo | null;
  starting: boolean;
  stopping: boolean;
  startServer: (port?: number) => Promise<void>;
  stopServer: () => Promise<void>;
  refreshStatus: () => Promise<void>;
}

export const useWebhostStore = create<WebhostState>((set) => ({
  isRunning: false,
  info: null,
  starting: false,
  stopping: false,

  startServer: async (port?: number) => {
    set({ starting: true });
    try {
      const info = await startWebhost(port);
      set({ isRunning: true, info, starting: false });
    } catch (err) {
      console.error("Failed to start webhost:", err);
      set({ starting: false });
    }
  },

  stopServer: async () => {
    set({ stopping: true });
    try {
      await stopWebhost();
      set({ isRunning: false, info: null, stopping: false });
    } catch (err) {
      console.error("Failed to stop webhost:", err);
      set({ stopping: false });
    }
  },

  refreshStatus: async () => {
    try {
      const info = await getWebhostStatus();
      set({ isRunning: info !== null, info });
    } catch (err) {
      console.warn("Failed to refresh webhost status:", err);
    }
  },
}));
