/**
 * switchToSource — make a Sources-rail entry the ACTIVE instance, in
 * place, with NO full-page reload.
 *
 * The app keeps exactly one LIVE Matrix client at a time:
 * `serverConfig.config` drives both `getApiBase()` (every Concord API
 * call) and — since the 2026-06-14 fix — `getHomeserverUrl()` (the
 * Matrix client's base URL). Selecting a source re-points both at that
 * source's instance and adopts that source's stored session, which
 * recreates the Matrix client against the correct homeserver. Because
 * `useMatrixSync` is keyed on `[client]` and `App`/`ChatLayout` reload
 * servers when the access token changes, the swap happens reactively —
 * the old `window.location.reload()` (which made selecting an instance
 * feel like being "transported between two separate services") is gone.
 *
 * The server RAIL aggregates servers from every connected source (see
 * `loadForeignServers` in the server store). This function is what makes
 * a foreign tile interactive: it brings that source's homeserver online
 * as the active one so its rooms/voice become usable, then the caller
 * selects the chosen server.
 *
 * Session capture: switching away from the currently-active source first
 * stashes the live session token back onto that source record, so a later
 * switch BACK restores it instead of dumping the user on a logged-out
 * shell. The local-instance origin source is reached by clearing the
 * homeserver override (origin fallback) rather than setting one.
 *
 * Return value lets the caller react to the one case this function
 * cannot resolve on its own — a foreign source with no stored session
 * (`"needs-auth"`), which should open that source's sign-in flow rather
 * than swap into a token/instance mismatch.
 */
import { useAuthStore } from "../stores/auth";
import { useServerConfigStore } from "../stores/serverConfig";
import { useServerStore } from "../stores/server";
import { useSourcesStore } from "../stores/sources";
import { isLocalInstanceSource } from "./sourceIdentity";

export type SwitchResult = "switched" | "noop" | "needs-auth" | "not-found";

/** Recover the live session's deviceId from the persisted concord_session
 *  blob — AuthState doesn't expose it directly. */
function readSessionDeviceId(): string | undefined {
  if (typeof window === "undefined" || !window.localStorage) return undefined;
  try {
    const raw = window.localStorage.getItem("concord_session");
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { deviceId?: string };
    return parsed.deviceId;
  } catch {
    return undefined;
  }
}

export function switchToSource(
  sourceId: string,
  /**
   * Optional server to select once the target instance's servers have
   * loaded. Used by the rail when a foreign server tile is clicked, so
   * the user lands on the exact server they picked instead of that
   * instance's default lobby. Selection is applied inside the single
   * post-swap `loadServers` continuation to avoid racing the auto-select.
   */
  selectServerId?: string,
): SwitchResult {
  const sources = useSourcesStore.getState();
  const target = sources.sources.find((s) => s.id === sourceId);
  if (!target) return "not-found";

  const cfg = useServerConfigStore.getState().config;
  const targetIsLocal = isLocalInstanceSource(target);

  // No-op if the target is already the active instance — avoid pointless
  // client teardown when the user clicks the source they're already on.
  if (targetIsLocal) {
    if (!cfg) return "noop";
  } else if (cfg && cfg.host.toLowerCase() === target.host.toLowerCase()) {
    return "noop";
  }

  // A non-local target needs its own session to switch into. Without a
  // token we can't authenticate against it — tell the caller to open the
  // sign-in flow rather than swap into a broken, mismatched state (the
  // old behaviour reloaded into a "Invalid or expired access token"
  // shell because the previous instance's token was carried over).
  if (!targetIsLocal && !(target.accessToken && target.userId)) {
    return "needs-auth";
  }

  // Stash the live session onto whichever source currently owns it, so
  // switching back later restores rather than strands it. Prefer the source
  // whose stored userId matches; otherwise, when the origin instance is
  // active (no homeserver override), attribute the session to the
  // local-instance source so a later switch back signs in correctly.
  const auth = useAuthStore.getState();
  if (auth.accessToken && auth.userId) {
    let current = sources.sources.find((s) => s.userId === auth.userId);
    if (!current && !cfg) {
      current = sources.sources.find((s) => isLocalInstanceSource(s));
    }
    if (current && current.id !== target.id) {
      sources.updateSource(current.id, {
        accessToken: auth.accessToken,
        userId: auth.userId,
        // deviceId isn't on AuthState; recover it from the persisted session.
        deviceId: readSessionDeviceId() ?? current.deviceId,
      });
    }
  }

  // Re-point homeserver + API base BEFORE recreating the client so
  // getHomeserverUrl() / getApiBase() resolve to the target instance.
  if (targetIsLocal) {
    // The instance serving this page — drop any homeserver override so
    // the origin-based fallback takes over.
    useServerConfigStore.getState().clearHomeserver();
  } else {
    useServerConfigStore.getState().setHomeserver({
      host: target.host,
      instance_name: target.instanceName,
      api_base: target.apiBase,
      homeserver_url: target.homeserverUrl,
    });
  }

  // Adopt the target's stored session. `login()` recreates the Matrix
  // client against the now-correct homeserver and resets server state;
  // `useMatrixSync` (keyed on `[client]`) tears down the old sync loop
  // and starts the new one. No page reload.
  if (target.accessToken && target.userId) {
    useAuthStore.getState().login(
      target.accessToken,
      target.userId,
      target.deviceId ?? "",
    );
  }

  // Refresh the active instance's servers + re-aggregate the foreign
  // tiles immediately, so the rail reflects the swap without waiting for
  // the App-level access-token effect to fire on the next tick.
  const token = useAuthStore.getState().accessToken;
  if (token) {
    void useServerStore
      .getState()
      .loadServers(token)
      .then(() => {
        if (!selectServerId) return;
        const st = useServerStore.getState();
        if (st.servers.some((s) => s.id === selectServerId)) {
          st.setActiveServer(selectServerId);
        }
      });
  }
  void useServerStore.getState().loadForeignServers();

  return "switched";
}
