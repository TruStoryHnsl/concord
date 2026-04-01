import { create } from "zustand";

export interface NodeConfig {
  relayEnabled: boolean;
  maxConnections: number;
  bandwidth: "low" | "medium" | "high" | "unlimited";
}

interface SettingsState {
  theme: "dark" | "light" | "system";
  notifications: boolean;
  nodeConfig: NodeConfig;
  port: number;
  autoStart: boolean;
  backgroundOp: boolean;
  setTheme: (theme: "dark" | "light" | "system") => void;
  setNotifications: (enabled: boolean) => void;
  setNodeConfig: (config: Partial<NodeConfig>) => void;
  setPort: (port: number) => void;
  setAutoStart: (enabled: boolean) => void;
  setBackgroundOp: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: "dark",
  notifications: true,
  nodeConfig: {
    relayEnabled: true,
    maxConnections: 32,
    bandwidth: "unlimited",
  },
  port: 9090,
  autoStart: false,
  backgroundOp: true,

  setTheme: (theme) => set({ theme }),
  setNotifications: (notifications) => set({ notifications }),
  setNodeConfig: (config) =>
    set((state) => ({
      nodeConfig: { ...state.nodeConfig, ...config },
    })),
  setPort: (port) => set({ port }),
  setAutoStart: (autoStart) => set({ autoStart }),
  setBackgroundOp: (backgroundOp) => set({ backgroundOp }),
}));
