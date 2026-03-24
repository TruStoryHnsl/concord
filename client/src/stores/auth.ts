import { create } from "zustand";
import type { MatrixClient } from "matrix-js-sdk";
import { createMatrixClient } from "../api/matrix";

interface AuthState {
  client: MatrixClient | null;
  userId: string | null;
  accessToken: string | null;
  isLoggedIn: boolean;
  isLoading: boolean;

  login: (accessToken: string, userId: string, deviceId: string) => void;
  logout: () => void;
  restoreSession: () => boolean;
}

const STORAGE_KEY = "concord_session";

interface StoredSession {
  accessToken: string;
  userId: string;
  deviceId: string;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  client: null,
  userId: null,
  accessToken: null,
  isLoggedIn: false,
  isLoading: true,

  login: (accessToken, userId, deviceId) => {
    const client = createMatrixClient(accessToken, userId, deviceId);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ accessToken, userId, deviceId }),
    );
    set({ client, userId, accessToken, isLoggedIn: true, isLoading: false });
  },

  logout: () => {
    const { client } = get();
    if (client) {
      client.stopClient();
    }
    localStorage.removeItem(STORAGE_KEY);
    set({
      client: null,
      userId: null,
      accessToken: null,
      isLoggedIn: false,
      isLoading: false,
    });
  },

  restoreSession: () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      set({ isLoading: false });
      return false;
    }
    try {
      const { accessToken, userId, deviceId }: StoredSession =
        JSON.parse(stored);
      const client = createMatrixClient(accessToken, userId, deviceId);
      set({
        client,
        userId,
        accessToken,
        isLoggedIn: true,
        isLoading: false,
      });
      return true;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      set({ isLoading: false });
      return false;
    }
  },
}));
