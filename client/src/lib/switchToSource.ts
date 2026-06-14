/**
 * switchToSource — make a Sources-rail entry the ACTIVE instance.
 *
 * The app talks to exactly one homeserver at a time: `serverConfig.config`
 * drives `getApiBase()` (every Concord API call) and the Matrix client's
 * base URL. Selecting a source therefore means re-pointing the client at
 * that source's homeserver + signing in with that source's stored session,
 * then reloading so the Matrix client is recreated cleanly against the new
 * base URL (the same mechanism the "switch server" button uses).
 *
 * Before this existed, clicking a source tile did nothing of the sort —
 * the active homeserver stayed on the origin, so connecting to another
 * instance silently kept showing the local one ("opened its local server
 * instead of the concorrd.com one"). This wires the selection through.
 *
 * Session capture: switching away from the currently-active source first
 * stashes the live session token back onto that source record, so a later
 * switch BACK restores it instead of dumping the user on a logged-out
 * shell. The local-instance origin source is reached by clearing the
 * homeserver override (origin fallback) rather than setting one.
 */
import { useAuthStore } from "../stores/auth";
import { useServerConfigStore } from "../stores/serverConfig";
import { useSourcesStore } from "../stores/sources";
import { isLocalInstanceSource } from "./sourceIdentity";

export function switchToSource(sourceId: string): void {
  const sources = useSourcesStore.getState();
  const target = sources.sources.find((s) => s.id === sourceId);
  if (!target) return;

  // No-op if the target is already the active instance — avoid a pointless
  // full-page reload when the user clicks the source they're already on.
  const cfg = useServerConfigStore.getState().config;
  if (isLocalInstanceSource(target)) {
    if (!cfg) return; // origin fallback already active
  } else if (cfg && cfg.host.toLowerCase() === target.host.toLowerCase()) {
    return;
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
        deviceId: auth.deviceId ?? current.deviceId,
      });
    }
  }

  if (isLocalInstanceSource(target)) {
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

  // Adopt the target's stored session (if any) so the post-reload client
  // authenticates as the right account on the right homeserver.
  if (target.accessToken && target.userId) {
    useAuthStore.getState().login(
      target.accessToken,
      target.userId,
      target.deviceId ?? "",
    );
  }

  if (typeof window !== "undefined") {
    window.location.reload();
  }
}
