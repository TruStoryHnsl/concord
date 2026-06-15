/**
 * Persistent server-configuration store (INS-027).
 *
 * The source of truth for which Concord instance the current client is
 * talking to. When empty, `getApiBase()` falls back to origin-based
 * resolution (the existing web-deployment behavior). When populated —
 * typically via the first-launch server-picker flow in
 * `ServerPickerScreen.tsx` — `getApiBase()` reads `config.api_base` so
 * every `apiFetch` call site automatically targets the selected host
 * without touching any of the 50+ call sites.
 *
 * Persistence strategy:
 *
 * - **Web build**: localStorage via Zustand's `persist` middleware. Same
 *   shape as `settings.ts`, same storage semantics. A fresh tab picks
 *   up the persisted config on hydration, which is what we want for
 *   native apps packaged as Tauri webview sessions.
 *
 * - **Tauri build**: the existing `serverUrl.ts` helpers already bridge
 *   to the Tauri `get_server_url` / `set_server_url` commands. This
 *   store mirrors the persisted value in-process (via the same
 *   localStorage shim that Tauri's webview exposes), so both the new
 *   serverConfig slice AND the legacy `serverUrl.ts` functions stay in
 *   sync. The legacy helpers remain the official read path for other
 *   parts of the code that branch on `isDesktopMode()` — we intentionally
 *   do NOT delete them in this task, to keep the INS-027 refactor
 *   strictly additive.
 *
 * Detection of the Tauri branch follows the same convention as
 * `serverUrl.ts`: `typeof window !== "undefined" && "__TAURI_INTERNALS__"
 * in window`. `__TAURI_INTERNALS__` is the canonical Tauri v2 global
 * (the `@tauri-apps/api` package itself reads from it); the legacy
 * `__TAURI__` key is only present when `app.withGlobalTauri: true` is
 * explicitly opted into in `tauri.conf.json`. This is checked lazily at
 * runtime rather than at module import so tests (which run in jsdom)
 * can stub it.
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { HomeserverConfig } from "../api/wellKnown";
// `serverUrl.ts` is safe to static-import in jsdom tests — it has its
// own `isTauri()` guard and only dynamic-imports `@tauri-apps/api/core`
// inside async functions. Using a static import here lets `vi.mock()`
// in tests intercept it cleanly; a dynamic `import()` would bypass
// the hoisted mock and give us the real function instead.
import { setServerUrl } from "../api/serverUrl";

/**
 * The Zustand state shape. `config` is the full HomeserverConfig
 * produced by `discoverHomeserver()`, or `null` when no server has
 * been picked yet (default for fresh native app launches and for the
 * web build where origin-based fallback takes over).
 */
export interface ServerConfigState {
  /**
   * The ACTIVE instance the client is talking to right now. In-session
   * only — NOT persisted. On boot it is restored from `bootHome` (below),
   * so a transient source-switch can never become the boot home. Drives
   * getApiBase() / getHomeserverUrl().
   */
  config: HomeserverConfig | null;
  /**
   * The BOOT HOME — the instance the app returns to on launch/reload.
   * Persisted. Set ONLY by a deliberate "this is my home" pick
   * (ServerPickerScreen), NOT by switchToSource. On native this is the
   * local instance; on web it stays null (origin is home). This is what
   * stops a linked foreign instance (set via switchToSource) from
   * persisting as the home and making local data inaccessible after a
   * reboot.
   */
  bootHome: HomeserverConfig | null;
  /**
   * Set the active instance. `opts.transient` (used by switchToSource)
   * means "session-only switch" — it updates `config` but NOT `bootHome`,
   * so it is forgotten on the next launch. A non-transient call (the
   * picker) ALSO updates `bootHome`.
   */
  setHomeserver: (config: HomeserverConfig, opts?: { transient?: boolean }) => void;
  clearHomeserver: () => void;
  /**
   * Convenience selector returning just the hostname (or null). Useful
   * for UI elements that want to display "connected to {host}" without
   * pulling the full config object into render state.
   */
  selectedHost: () => string | null;
}

/**
 * Storage key for both localStorage and the Tauri persistence bridge.
 * Keep in sync with any migration code that reads legacy keys — at
 * present there is no legacy slot to migrate from, this is a brand
 * new store.
 */
const STORAGE_KEY = "concord_server_config";

/**
 * Detect whether the current runtime is Tauri. Matches the convention
 * in `serverUrl.ts` — uses `__TAURI_INTERNALS__`, the canonical Tauri v2
 * global that `@tauri-apps/api` itself consults. The v1 `__TAURI__` key
 * is NOT present unless `app.withGlobalTauri: true` is opted into, which
 * this project does not set. Pulled out as a function so tests can mock
 * it via `vi.stubGlobal` without having to rewrite the module import
 * chain.
 */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const useServerConfigStore = create<ServerConfigState>()(
  persist(
    (set, get) => ({
      config: null,
      bootHome: null,

      setHomeserver: (config, opts) => {
        // A non-transient pick also becomes the boot home; a transient
        // switchToSource updates only the active config (forgotten on
        // next launch).
        set(opts?.transient ? { config } : { config, bootHome: config });
        // In-process only: update the legacy `_serverUrl` module var
        // so code paths that still read `getHomeserverUrl()` (some
        // Matrix SDK bootstrap paths) see the chosen host. Native
        // only — web mode reads `window.location.origin` instead of
        // `_serverUrl`, so the update would be a noop on the browser.
        //
        // Does NOT write to Tauri's plugin-store. See the comments
        // on `setServerUrl` in `serverUrl.ts` and on
        // `computeInitialServerConnected` in `serverPickerGate.ts`
        // for the full rationale — the TL;DR is that a persisted
        // `server_url` slot was what kept leaking the operator's
        // instance hostname between installs.
        if (isTauriRuntime()) {
          void setServerUrl(config.homeserver_url).catch(() => {
            /* non-fatal */
          });
        }
      },

      clearHomeserver: () => {
        set({ config: null });
        if (isTauriRuntime()) {
          void setServerUrl("").catch(() => {
            /* non-fatal */
          });
        }
      },

      selectedHost: () => {
        const cfg = get().config;
        return cfg ? cfg.host : null;
      },
    }),
    {
      name: STORAGE_KEY,
      // `createJSONStorage` with an explicit getter lets the persist
      // middleware gracefully no-op when localStorage isn't available
      // (e.g. SSR or locked-down iframe contexts) rather than throwing
      // at module load time.
      storage: createJSONStorage(() =>
        typeof window !== "undefined" && window.localStorage
          ? window.localStorage
          : {
              // In-memory shim so the middleware stays happy when no
              // localStorage exists. Reset per page load — acceptable
              // for the degenerate case.
              getItem: () => null,
              setItem: () => {},
              removeItem: () => {},
            },
      ),
      // Persist ONLY `bootHome`, never the in-session `config`. This is
      // the fix for "reboot adopted the linked foreign instance as home":
      // a switchToSource (transient) updates `config` but not `bootHome`,
      // so nothing about the switch survives a launch.
      partialize: (state) => ({ bootHome: state.bootHome }),
      // On launch, the active `config` starts equal to the boot home
      // (null on web → origin; the local instance on native). The last
      // transient switch is gone.
      onRehydrateStorage: () => (state) => {
        if (state) state.config = state.bootHome ?? null;
      },
    },
  ),
);
