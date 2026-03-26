import { create } from "zustand";
import { getIdentity } from "@/api/tauri";
import type { AliasPayload } from "@/api/tauri";

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
}

interface AuthState {
  currentUser: User | null;
  peerId: string | null;
  displayName: string | null;
  activeAlias: AliasPayload | null;
  isAuthenticated: boolean;
  login: (user: User) => void;
  logout: () => void;
  setActiveAlias: (alias: AliasPayload | null) => void;
  initIdentity: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  currentUser: null,
  peerId: null,
  displayName: null,
  activeAlias: null,
  isAuthenticated: false,

  login: (user) =>
    set({
      currentUser: user,
      isAuthenticated: true,
    }),

  logout: () =>
    set({
      currentUser: null,
      peerId: null,
      displayName: null,
      activeAlias: null,
      isAuthenticated: false,
    }),

  setActiveAlias: (alias) =>
    set({ activeAlias: alias }),

  initIdentity: async () => {
    try {
      const identity = await getIdentity();
      const aliasName = identity.activeAlias?.displayName ?? identity.displayName;
      set({
        peerId: identity.peerId,
        displayName: identity.displayName,
        activeAlias: identity.activeAlias ?? null,
        isAuthenticated: true,
        currentUser: {
          id: identity.peerId,
          username: aliasName,
          displayName: aliasName,
        },
      });
    } catch (err) {
      console.warn("Failed to get identity from backend:", err);
    }
  },
}));
