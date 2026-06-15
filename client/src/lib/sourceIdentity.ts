/**
 * sourceIdentity — classify the "local instance" source.
 *
 * The "local instance" is the Concord instance the client is actually
 * running INSIDE — the one you cannot "close the connection" to, because
 * doing so would just log you out of your own library and delete its tile.
 * It differs fundamentally between the two runtimes:
 *
 *   - **Web / docker build:** the instance SERVING the page is local.
 *     There is exactly one such instance and it is a real `ConcordSource`
 *     whose host equals the page origin. Every OTHER source (a linked
 *     federated instance, a Matrix homeserver) is remote and removable.
 *
 *   - **Native (Tauri) build:** the local instance is the embedded
 *     **porch** — the device's own hosted instance. The porch is rendered
 *     from a SYNTHETIC, intrinsic Sources-rail tile (`LocalTile` in
 *     SourcesPanel.tsx), NOT from a `ConcordSource` row. It is reached by
 *     clicking that tile (`onLocalOpen`), never through `switchToSource`.
 *     Consequently EVERY `ConcordSource` on native represents a REMOTE
 *     instance the user linked (e.g. concorrd.com, a friend's porch, a
 *     Matrix server) and MUST be disconnectable.
 *
 * History — why this is deliberately NOT derived from the active config:
 * a previous version treated "the primary source whose host matches
 * `serverConfig.config.host`" as local. The moment a native user switched
 * to a linked instance, that instance BECAME the active config, so it read
 * as "local" and could no longer be disconnected — and `switchToSource`
 * mis-branched it, calling `clearHomeserver()` (origin fallback to a dead
 * `localhost` on native) instead of `setHomeserver()`, stranding the user
 * in a broken shell. The discriminator below is STABLE: the page origin
 * never changes within a web session, and native is always `false`. The
 * active instance is irrelevant to local-vs-remote identity.
 */
import type { ConcordSource } from "../stores/sources";
import { isTauriRuntime } from "../stores/serverConfig";

/**
 * Is this source the LOCAL instance — the one the app is running inside,
 * which must NEVER be removable/disconnectable?
 */
export function isLocalInstanceSource(
  source: Pick<ConcordSource, "host">,
): boolean {
  // NATIVE: the local instance is the synthetic porch tile, not a source.
  // No `ConcordSource` is ever the local instance, so every linked source
  // (concorrd.com, a peer's porch, a Matrix homeserver) is disconnectable.
  if (isTauriRuntime()) return false;

  // WEB: the instance serving this page is local. Stable across the
  // session — the origin can't change mid-session, so a linked source
  // (different host) can never be mistaken for the home instance.
  if (typeof window !== "undefined" && window.location?.hostname) {
    return source.host.toLowerCase() === window.location.hostname.toLowerCase();
  }
  return false;
}
