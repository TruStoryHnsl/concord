import { create } from "zustand";
import type { MatrixClient } from "matrix-js-sdk";
import { createMatrixClient } from "../api/matrix";
import { useServerStore } from "./server";
import { useSourcesStore } from "./sources";

interface AuthState {
  client: MatrixClient | null;
  userId: string | null;
  accessToken: string | null;
  isLoggedIn: boolean;
  isLoading: boolean;
  /** True when the active session is an anonymous guest session. */
  isGuest: boolean;
  // Matrix client sync health. Mirrors the boolean returned by
  // `useMatrixSync()` so any component (e.g. ServerSidebar) can read
  // connection state without re-subscribing to ClientEvent.Sync and
  // duplicating that hook's federated-hydration side effects.
  syncing: boolean;

  login: (
    accessToken: string,
    userId: string,
    deviceId: string,
    opts?: { rebindSources?: boolean },
  ) => void;
  /** Log in as a guest (anonymous, read-mostly, ephemeral session). */
  loginGuest: (accessToken: string, userId: string, deviceId: string) => void;
  logout: () => void;
  restoreSession: () => boolean;
  setSyncing: (syncing: boolean) => void;
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
  isGuest: false,
  isLoading: true,
  syncing: false,

  setSyncing: (syncing) => set({ syncing }),

  login: (accessToken, userId, deviceId, opts) => {
    const client = createMatrixClient(accessToken, userId, deviceId);
    useServerStore.getState().resetState();
    // `bindToUser` scopes the persisted source set to a Concord user for
    // multi-account browser isolation — it DROPS sources owned by any
    // other user. That is correct for a real login-screen login, but
    // DESTRUCTIVE when merely switching the active instance: two
    // instances have different Matrix user IDs (@corr:dev vs
    // @corr:stable), so rebinding to the target's id would delete the
    // home instance's source tile (and vice-versa) — "clicking a tile
    // deletes the other". switchToSource passes rebindSources:false so
    // the multi-instance source set is preserved across switches.
    if (opts?.rebindSources !== false) {
      useSourcesStore.getState().bindToUser(userId);
    }
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ accessToken, userId, deviceId }),
    );
    set({ client, userId, accessToken, isLoggedIn: true, isGuest: false, isLoading: false });
  },

  loginGuest: (accessToken, userId, deviceId) => {
    const client = createMatrixClient(accessToken, userId, deviceId);
    useServerStore.getState().resetState();
    // Guest sessions are ephemeral — do NOT persist to localStorage.
    // Clearing the storage key ensures a real login prompt appears on
    // next app launch rather than restoring the stale guest session.
    localStorage.removeItem(STORAGE_KEY);
    set({ client, userId, accessToken, isLoggedIn: true, isGuest: true, isLoading: false });
  },

  logout: () => {
    const { client } = get();
    if (client) {
      client.stopClient();
    }
    useServerStore.getState().resetState();
    useSourcesStore.getState().bindToUser(null);
    localStorage.removeItem(STORAGE_KEY);
    set({
      client: null,
      userId: null,
      accessToken: null,
      isLoggedIn: false,
      isGuest: false,
      isLoading: false,
      syncing: false,
    });
  },

  restoreSession: () => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      // Only flip isLoading→false on the FIRST restore. Subsequent
      // calls (StrictMode double-mount, App effect re-fire) shouldn't
      // re-trigger any side effects.
      if (get().isLoading) {
        useServerStore.getState().resetState();
        set({ isLoading: false });
      }
      return false;
    }
    try {
      const { accessToken, userId, deviceId }: StoredSession =
        JSON.parse(stored);
      // Idempotent: if a client is already restored for this exact
      // session, do nothing. The previous behaviour created a fresh
      // MatrixClient on every call — visible in the console as
      // "Adding default global override push rule .msc3786 ..."
      // logged once per client instance. App.tsx's restoreSession
      // useEffect was firing 2x in dev (StrictMode) and on prop
      // changes, creating multiple clients per session.
      const existing = get();
      if (
        existing.client &&
        existing.accessToken === accessToken &&
        existing.userId === userId
      ) {
        if (existing.isLoading) set({ isLoading: false });
        return true;
      }
      const client = createMatrixClient(accessToken, userId, deviceId);
      useServerStore.getState().resetState();
      // Bind to the persisted HOME user, not the active session's user.
      // After switching the active instance, the persisted session is the
      // foreign instance's (e.g. @corr:stable) while the source set still
      // belongs to the home user (e.g. @corr:dev). Rebinding to the
      // foreign id here would drop the home source on every reload — the
      // same destructive filter that broke tile-switching. The home id is
      // already persisted as `boundUserId`; only fall back to the session
      // id when no source set has been bound yet (first launch).
      const boundUserId = useSourcesStore.getState().boundUserId;
      useSourcesStore.getState().bindToUser(boundUserId ?? userId);
      set({
        client,
        userId,
        accessToken,
        isLoggedIn: true,
        isLoading: false,
      });
      // Validate the restored token in the background. If the homeserver
      // rejects it (e.g. the instance was reset, or the session was revoked),
      // self-heal by logging out so a normal page load lands cleanly on the
      // login screen instead of hanging on "Connecting…" behind a dead token.
      // ONLY auth failures clear the session — a network error / server-down
      // leaves a valid session intact (the SDK retries sync).
      client
        .whoami()
        .catch((err: { errcode?: string; httpStatus?: number }) => {
          if (err?.errcode === "M_UNKNOWN_TOKEN" || err?.httpStatus === 401) {
            // Only if this is still the active session (avoid clobbering a
            // login that happened while whoami was in flight).
            if (get().accessToken === accessToken) {
              get().logout();
            }
          }
        });
      return true;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      useServerStore.getState().resetState();
      useSourcesStore.getState().bindToUser(null);
      set({ isLoading: false });
      return false;
    }
  },
}));
