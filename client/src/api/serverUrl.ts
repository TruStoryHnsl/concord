/**
 * Server URL management for web and desktop (Tauri) modes.
 *
 * Web mode: uses relative URLs (same origin, proxied by Caddy)
 * Desktop mode: the zustand `serverConfig` store (`stores/serverConfig.ts`)
 * is the sole source of truth — see `getApiBase()` below.
 *
 * INS-027 note: this module keeps a legacy `_serverUrl` module var
 * around so `getHomeserverUrl()` (consumed by some Matrix SDK code
 * paths that haven't been migrated to the config store yet) can
 * return a usable value. That module var is now populated ONLY by
 * the in-session `setHomeserver` call — it is no longer read from
 * or written to Tauri's persistent plugin-store. The Tauri plugin
 * commands still exist for backward compatibility with any extension
 * that uses them directly, but this module refuses to touch them.
 *
 * Why: a persisted `server_url` slot in Tauri's `settings.json` was
 * the bug that kept leaking the operator's instance hostname between
 * installs and Syncthing-linked machines, silently skipping the
 * picker on every launch because `hasLegacyUrl` was true on the
 * picker gate. The persistent-store bridge is gone; the native app
 * always starts hollow on a fresh install. See the comment on
 * `computeInitialServerConnected` in `serverPickerGate.ts` for the
 * full rationale.
 */

import { useServerConfigStore } from "../stores/serverConfig";
import { useAuthStore } from "../stores/auth";
import { useSourcesStore } from "../stores/sources";

/**
 * When no homeserver override is active (`serverConfig.config === null`),
 * fall back to the source that owns the LIVE Matrix session.
 *
 * On native, `config` is routinely null after a boot session-restore
 * (`bootHome` is null), which made `getApiBase()` return the RELATIVE
 * `"/api"`. `new URL("/api")` throws WebKitGTK's "The string did not match
 * the expected pattern" — and ChatLayout's boot load fires four calls in one
 * `Promise.allSettled`, so the user saw four identical error toasts on every
 * launch. The active session's source carries a valid absolute
 * `api_base`/`homeserver_url`, so resolve through it.
 */
function activeSessionSourceBase(): {
  api_base?: string;
  homeserver_url?: string;
} | null {
  try {
    const userId = useAuthStore.getState().userId;
    if (!userId) return null;
    const src = useSourcesStore
      .getState()
      .sources.find((s) => s.userId === userId);
    if (!src) return null;
    return { api_base: src.apiBase, homeserver_url: src.homeserverUrl };
  } catch {
    return null;
  }
}

// Detect Tauri environment.
//
// Tauri v2 injects `window.__TAURI_INTERNALS__` — that's the canonical
// global the `@tauri-apps/api` package itself consults (`core.cjs` calls
// `window.__TAURI_INTERNALS__.invoke(...)`). The legacy `window.__TAURI__`
// from Tauri v1 is ONLY present when `app.withGlobalTauri: true` is
// explicitly opted into in `tauri.conf.json`, which this project does
// not set. Checking the v1 key here always returned `false` in the real
// native webview, causing `hasServerUrl()` to short-circuit `true` and
// bypass the first-launch server picker. Fixed per the INS-027 regression
// investigation on 2026-04-10.
const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// In-session cached server URL. Populated by `setServerUrl()` which
// the server picker calls on confirm. NOT restored from Tauri's
// plugin-store across app launches — that's the whole point.
let _serverUrl = "";

/**
 * Initialize the server URL. Previously read Tauri's plugin-store
 * `server_url` slot on startup; now a no-op on every platform
 * because a native app must always start hollow. The picker writes
 * the chosen host into `_serverUrl` via `setHomeserver` →
 * `setServerUrl` during the session, and the zustand persist
 * middleware takes care of cross-session persistence.
 */
export async function initServerUrl(): Promise<void> {
  // Intentional no-op. See module docstring.
}

/**
 * Set the in-session server URL. Called by `setHomeserver` in the
 * `serverConfig` store when the picker confirms. Does NOT persist
 * to Tauri's plugin-store — the zustand persist middleware is the
 * only persistence layer.
 */
export async function setServerUrl(url: string): Promise<void> {
  _serverUrl = url.replace(/\/$/, "");
}

/**
 * Get the current server base URL.
 * Returns "" in web mode (use relative URLs).
 * Returns "https://server.example.com" in desktop mode.
 */
export function getServerUrl(): string {
  return _serverUrl;
}

/**
 * Get the API base URL for Concord API calls.
 *
 * Resolution order (INS-027):
 *   1. `serverConfig` Zustand store — source of truth for native
 *      apps that have been through the first-launch server picker.
 *      Returns the `api_base` discovered via `.well-known/concord/client`.
 *   2. Legacy `_serverUrl` module-var — set by `initServerUrl()` /
 *      `setServerUrl()` from the Tauri-side plugin-store. Still used
 *      by pre-INS-027 Tauri builds and by code paths that call
 *      `setServerUrl()` directly.
 *   3. Origin fallback — returns `/api` so the browser build keeps
 *      working without any config at all (Caddy on the same origin
 *      proxies `/api/*` to `concord-api`).
 *
 * The signature is synchronous and unchanged from its pre-INS-027
 * version. The ~50 `apiFetch` call sites across the client continue
 * to work without modification — the resolution is entirely internal.
 */
export function getApiBase(): string {
  // Read from the INS-027 store first. Dynamic state access (not a
  // subscription) keeps this function side-effect-free and callable
  // from non-React contexts.
  try {
    const cfg = useServerConfigStore.getState().config;
    if (cfg?.api_base) {
      return cfg.api_base;
    }
  } catch {
    // Store hasn't hydrated yet (unlikely in practice; persist
    // middleware hydrates synchronously from localStorage). Fall
    // through to the legacy path.
  }
  // No active override → use the live session's source (absolute base)
  // before falling back to legacy/relative, so we never hand a relative
  // "/api" to `new URL()` (the WebKit "did not match the expected pattern"
  // toast storm).
  const sess = activeSessionSourceBase();
  if (sess?.api_base) return sess.api_base;
  return _serverUrl ? `${_serverUrl}/api` : "/api";
}

/**
 * Get the homeserver URL for the Matrix client.
 *
 * Resolution order — symmetric with `getApiBase()` above:
 *   1. `serverConfig` Zustand store `homeserver_url`. This is the
 *      ACTIVE source's Matrix base. Without this, the web build pinned
 *      every Matrix client to `window.location.origin` regardless of
 *      which source was selected, so switching to another instance
 *      kept the client on the origin homeserver while the API base
 *      pointed at the new instance — the mismatch surfaced as
 *      "Invalid or expired access token" the moment a foreign token
 *      was used against the origin homeserver. Making the client
 *      follow the active source is what lets the rail hot-swap between
 *      instances (web AND native) without a full page reload.
 *   2. Legacy `_serverUrl` module var (Tauri / direct `setServerUrl`).
 *   3. Origin fallback — the plain single-instance web deployment with
 *      no source selected (`config === null`) keeps talking to its own
 *      origin exactly as before.
 */
export function getHomeserverUrl(): string {
  try {
    const cfg = useServerConfigStore.getState().config;
    if (cfg?.homeserver_url) {
      return cfg.homeserver_url.replace(/\/$/, "");
    }
  } catch {
    // Store not hydrated yet — fall through to legacy / origin.
  }
  const sess = activeSessionSourceBase();
  if (sess?.homeserver_url) return sess.homeserver_url.replace(/\/$/, "");
  return _serverUrl || window.location.origin;
}

/**
 * Whether we're running in Tauri desktop mode.
 */
export function isDesktopMode(): boolean {
  return isTauri;
}

/**
 * Whether a server URL has been configured (always true in web mode).
 */
export function hasServerUrl(): boolean {
  return !isTauri || _serverUrl.length > 0;
}
