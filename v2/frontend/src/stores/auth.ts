import { create } from "zustand";
import { getIdentity } from "@/api/tauri";

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
  isAuthenticated: boolean;
  login: (user: User) => void;
  logout: () => void;
  initIdentity: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  currentUser: null,
  peerId: null,
  displayName: null,
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
      isAuthenticated: false,
    }),

  initIdentity: async () => {
    try {
      const identity = await getIdentity();
      set({
        peerId: identity.peerId,
        displayName: identity.displayName,
        isAuthenticated: true,
        currentUser: {
          id: identity.peerId,
          username: identity.displayName,
          displayName: identity.displayName,
        },
      });
    } catch (err) {
      console.warn("Failed to get identity from backend:", err);
    }
  },
}));
