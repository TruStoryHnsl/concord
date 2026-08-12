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
 *     instance the user linked (e.g. linked.example.test, a friend's porch, a
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
 *
 * The authoritative signal is the explicit `isLocal` flag, set by the
 * boot/host creators (`migrateFromSession` / `ensurePrimarySource`) and
 * backfilled by sources-store migration v7. Foreign instances added via the
 * add-source flow set it `false`, so a token-less foreign login is never
 * mistaken for the home instance. The runtime heuristic below is only a
 * fallback for any record that predates the flag and somehow escaped the
 * migration.
 */
export function isLocalInstanceSource(
  source: Pick<ConcordSource, "host" | "isLocal">,
): boolean {
  if (source.isLocal === true) return true;
  if (source.isLocal === false) return false;

  // Fallback (unflagged legacy record): NATIVE has no local ConcordSource
  // (the porch tile is the local instance); WEB's local instance is the
  // origin-served one.
  if (isTauriRuntime()) return false;
  if (typeof window !== "undefined" && window.location?.hostname) {
    return source.host.toLowerCase() === window.location.hostname.toLowerCase();
  }
  return false;
}
