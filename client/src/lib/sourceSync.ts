/**
 * sourceSync — reconciles the client's local source catalogue with the
 * core instance's per-user catalogue (`/api/me/sources`).
 *
 * The core instance is every account's PORTAL: the one default
 * connection all users share. Each account's outward connections
 * (federated Matrix homeservers, Reticulum peers, other Concord
 * instances) live server-side as descriptors so the rail follows the
 * user across browsers/devices — but credentials (remote access
 * tokens) never leave this client.
 *
 * Lifecycle:
 *  - `bindPortal` is called at login/restore with the core instance's
 *    apiBase + session token; it kicks off a bidirectional reconcile
 *    (pull remote rows into the local store, push local-only rows up).
 *  - `pushSourceToPortal` / `removeSourceFromPortal` are fire-and-forget
 *    hooks invoked by the sources store on add/remove.
 *  - `clearPortal` on logout.
 *
 * Everything here is best-effort: the portal catalogue is a durability
 * layer, not a gate — a dead network must never break local source
 * management.
 */

import {
  deleteMySource,
  listMySources,
  upsertMySource,
  type RemoteUserSource,
  type UserSourceKind,
} from "../api/userSources";
import type { ConcordSource } from "../stores/sources";
import { useSourcesStore } from "../stores/sources";

export interface PortalBinding {
  apiBase: string;
  accessToken: string;
  userId: string;
}

let portal: PortalBinding | null = null;

/**
 * The current portal binding (the core docker instance's apiBase + session
 * token), or `null` when no portal is bound (logged out / native-only).
 * Read-only peek for consumers that want to ask the portal for its wider
 * view — e.g. the mesh map overlaying the pillar's Reticulum announces onto
 * the native layer. Never mutate the returned object.
 */
export function getPortalBinding(): PortalBinding | null {
  return portal;
}

/** True while a pull-merge is applying remote rows — suppresses the
 *  store's add→push echo. */
let applyingRemote = false;

const SYNCABLE_KINDS = new Set<UserSourceKind>([
  "matrix",
  "reticulum",
  "concord",
  "concord-p2p",
]);

function sourceKind(source: ConcordSource): UserSourceKind {
  return (source.platform ?? "concord") as UserSourceKind;
}

/** Local rows that belong in the portal catalogue: the bound user's own
 *  non-primary, non-local rows. */
function isSyncable(source: ConcordSource): boolean {
  if (source.isLocal) return false;
  if (source.ownerUserId == null) return false;
  return SYNCABLE_KINDS.has(sourceKind(source));
}

function sameRemote(source: ConcordSource, remote: RemoteUserSource): boolean {
  return (
    sourceKind(source) === remote.kind &&
    source.host.trim().toLowerCase() === remote.host.trim().toLowerCase()
  );
}

export function bindPortal(binding: PortalBinding): void {
  portal = binding;
  void reconcile().catch((err) => {
    console.warn("[sourceSync] reconcile failed (non-fatal):", err);
  });
}

export function clearPortal(): void {
  portal = null;
}

async function reconcile(): Promise<void> {
  if (!portal) return;
  const { apiBase, accessToken, userId } = portal;
  const remote = await listMySources(apiBase, accessToken);
  const store = useSourcesStore.getState();

  // Pull: materialize remote descriptors that have no local row. New rows
  // arrive disconnected (no credentials are stored server-side); the user
  // re-authenticates per source when they open it.
  applyingRemote = true;
  try {
    for (const r of remote) {
      const exists = store.sources.some(
        (s) => (s.ownerUserId ?? null) === userId && sameRemote(s, r),
      );
      if (exists) continue;
      useSourcesStore.setState((state) => ({
        sources: [
          ...state.sources,
          {
            id: `src_${r.id}`,
            host: r.host,
            instanceName: r.display_name ?? undefined,
            inviteToken: "",
            apiBase: r.api_base ?? "",
            homeserverUrl: r.homeserver_url ?? "",
            status: "disconnected",
            enabled: true,
            platform: r.kind,
            ownerUserId: userId,
            isLocal: false,
            addedAt: r.created_at || new Date().toISOString(),
          } satisfies ConcordSource,
        ],
      }));
    }
  } finally {
    applyingRemote = false;
  }

  // Push: local rows of this user the portal doesn't know yet.
  const current = useSourcesStore.getState().sources;
  for (const s of current) {
    if ((s.ownerUserId ?? null) !== userId || !isSyncable(s)) continue;
    if (remote.some((r) => sameRemote(s, r))) continue;
    try {
      await upsertMySource(apiBase, accessToken, {
        kind: sourceKind(s),
        host: s.host,
        display_name: s.instanceName ?? null,
        api_base: s.apiBase || null,
        homeserver_url: s.homeserverUrl || null,
      });
    } catch (err) {
      console.warn("[sourceSync] push failed (non-fatal):", err);
    }
  }
}

export function pushSourceToPortal(source: ConcordSource): void {
  if (applyingRemote || !portal || !isSyncable(source)) return;
  if ((source.ownerUserId ?? null) !== portal.userId) return;
  const { apiBase, accessToken } = portal;
  void upsertMySource(apiBase, accessToken, {
    kind: sourceKind(source),
    host: source.host,
    display_name: source.instanceName ?? null,
    api_base: source.apiBase || null,
    homeserver_url: source.homeserverUrl || null,
  }).catch((err) => {
    console.warn("[sourceSync] push failed (non-fatal):", err);
  });
}

export function removeSourceFromPortal(source: ConcordSource): void {
  if (!portal || !isSyncable(source)) return;
  if ((source.ownerUserId ?? null) !== portal.userId) return;
  const { apiBase, accessToken } = portal;
  void listMySources(apiBase, accessToken)
    .then(async (remote) => {
      const match = remote.find((r) => sameRemote(source, r));
      if (match) await deleteMySource(apiBase, accessToken, match.id);
    })
    .catch((err) => {
      console.warn("[sourceSync] delete failed (non-fatal):", err);
    });
}
