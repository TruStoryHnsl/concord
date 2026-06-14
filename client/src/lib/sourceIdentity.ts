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

export function isLocalInstanceSource(
  source: Pick<ConcordSource, "platform" | "inviteToken" | "host">,
): boolean {
  const isNativePrimary =
    (source.platform ?? "concord") === "concord" &&
    source.inviteToken.trim() === "";
  if (isNativePrimary) return true;
  if (typeof window !== "undefined" && window.location?.hostname) {
    return source.host.toLowerCase() === window.location.hostname.toLowerCase();
  }
  return false;
}
