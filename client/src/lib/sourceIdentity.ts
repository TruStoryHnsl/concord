/**
 * sourceIdentity — classify the "local instance" source.
 *
 * The local-instance source is the Concord instance the client is
 * actually running against:
 *   - Web/docker: the instance serving the page (origin === source host).
 *   - Native primary: the picked instance, stored with an empty invite
 *     token and `platform === "concord"` (see isPrimarySource in
 *     stores/sources.ts).
 *
 * This source must NEVER be removable/disconnectable — you can't "close
 * the connection" to the instance you're inside; doing so just logs you
 * out of your own library and deletes its tile. The Sources rail hides
 * the destructive "Close connection" action for it, and disconnectSource
 * refuses to tear it down.
 */
import type { ConcordSource } from "../stores/sources";
import { useServerConfigStore } from "../stores/serverConfig";

/**
 * Is this source the LOCAL instance (the one the app is currently on /
 * cannot be disconnected)?
 *
 * IMPORTANT: an empty invite token marks a "primary" source, but once a
 * native app links a SECOND instance (e.g. concorrd.com) via the picker,
 * that foreign instance is ALSO a primary (empty invite token) — so
 * "empty invite token" alone is NOT a unique local-instance test. Treating
 * every primary as local made `switchToSource` mis-branch (clearHomeserver
 * instead of setHomeserver), which orphaned the API base and made a linked
 * foreign instance masquerade as the porch (hiding p2p + the mesh map).
 *
 * Correct discriminator: among primary sources, the LOCAL one is the one
 * that matches the ACTIVE instance —
 *   - if a homeserver override is active (`serverConfig.config`), the local
 *     source is the one whose host equals the active host;
 *   - otherwise (no override) the page origin is the local instance (web),
 *     and on native first-launch a lone primary is local.
 */
export function isLocalInstanceSource(
  source: Pick<ConcordSource, "platform" | "inviteToken" | "host">,
): boolean {
  const isPrimary =
    (source.platform ?? "concord") === "concord" &&
    source.inviteToken.trim() === "";
  if (!isPrimary) {
    // Non-primary: only "local" if it literally matches the page origin.
    if (typeof window !== "undefined" && window.location?.hostname) {
      return source.host.toLowerCase() === window.location.hostname.toLowerCase();
    }
    return false;
  }

  // Primary source: disambiguate against the active instance.
  let activeHost: string | null = null;
  try {
    activeHost = useServerConfigStore.getState().config?.host ?? null;
  } catch {
    // store not hydrated — fall through to origin/first-primary handling
  }
  if (activeHost) {
    return source.host.toLowerCase() === activeHost.toLowerCase();
  }
  // No active override: the local instance is the page origin (web). On
  // native first-launch (no origin host that matches a source), a lone
  // primary is the local instance.
  if (typeof window !== "undefined" && window.location?.hostname) {
    const origin = window.location.hostname.toLowerCase();
    // localhost/tauri origin won't match a real instance host — in that
    // (native) case a primary source is the local instance.
    if (origin === "localhost" || origin === "tauri.localhost" || origin.endsWith(".localhost")) {
      return true;
    }
    return source.host.toLowerCase() === origin;
  }
  return true;
}
