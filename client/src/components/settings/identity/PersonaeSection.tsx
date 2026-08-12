/**
 * PersonaeSection — the personae half of the unified Identity tab.
 *
 * Merges what used to be two separate surfaces:
 *
 *   - UsersTab (settings key "users"): the porch user-profile CRUD —
 *     list/create/rename/promote/delete profiles, designate the default
 *     mesh persona. Native-only (Tauri IPC against the porch).
 *   - MeshPersonaeSection (formerly inside Connections): the docker
 *     portal's persona BINDINGS — `POST/DELETE /api/me/personas` claim
 *     and release, which scope the instance's mesh reads (relay
 *     mailbox, deposit receipts, reticulum history) to the account.
 *
 * Identity model (load-bearing):
 *
 *   - The SUPERUSER is the device-local root identity. It is never
 *     peer-facing, so the primary profile row shows a "Superuser" badge
 *     and offers NO per-connection establishment.
 *   - PERSONAE are the peer-facing identities derived from it. For each
 *     persona this section lists every existing connection (the core
 *     instance/portal, Matrix sources, Reticulum, P2P) with an honest
 *     established / not-established / not-applicable / not-yet-wired
 *     state. Only the portal claim/release is real plumbing today; the
 *     other rows state exactly what exists — no faked capability.
 *
 * Platform split:
 *
 *   - Native: full surface — profile CRUD + mesh announce + portal
 *     bindings.
 *   - Web: the porch doesn't exist in a browser, so the personae listed
 *     are the account's portal BINDINGS (the roamed footprint of the
 *     superuser that lives on the user's device), plus the claim-by-id
 *     form.
 *
 * data-testids: the `users-tab-*` ids are kept verbatim from UsersTab
 * and the `mesh-persona*` ids from MeshPersonaeSection so existing
 * tests and tooling keep working across the merge.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  userProfileList,
  userProfileCreate,
  userProfileRename,
  userProfileSetPrimary,
  userProfileDelete,
  personaSetDefault,
  personaClearDefault,
  personaPublicIdentity,
  type UserProfile,
  type Provenance,
  type PersonaIdentity,
} from "../../../api/userProfile";
import {
  claimPersona,
  listMyPersonas,
  releasePersona,
  type RemotePersonaBinding,
} from "../../../api/userSources";
import { getApiBase } from "../../../api/serverUrl";
import { useAuthStore } from "../../../stores/auth";
import { useVisibleSources, type ConcordSource } from "../../../stores/sources";
import { isTauri } from "../../../api/servitude";

/** Map provenance variant to a (label, Tailwind class tuple). */
const PROVENANCE_META: Record<
  Provenance,
  { label: string; className: string }
> = {
  local: {
    label: "Local",
    className:
      "bg-surface-container-high text-on-surface-variant border-outline-variant/30",
  },
  relay_restored: {
    label: "From relay",
    className: "bg-primary/15 text-primary border-primary/40",
  },
};

/** Maximum display-name length the backend accepts. Mirrors
 *  `MAX_DISPLAY_NAME_LEN` in `src-tauri/src/porch/users.rs`. */
const MAX_DISPLAY_NAME_LEN = 64;

/**
 * Whether a source row IS the account's portal (the core instance the
 * access token talks to). Mirrors the un-exported `isPrimarySource`
 * heuristic in `stores/sources.ts` plus the explicit `isLocal` flag:
 * the portal gets its own dedicated connection row, so these rows are
 * excluded from the per-source loop to avoid a duplicate.
 */
function isPortalSource(source: ConcordSource): boolean {
  if ((source.platform ?? "concord") !== "concord") return false;
  if (source.isLocal === true) return true;
  if (source.isLocal === false) return false;
  return source.inviteToken.trim() === "";
}

function sourceLabel(source: ConcordSource): string {
  return source.instanceName || source.host || source.platform || source.id;
}

/** Visual state of one persona-on-connection row. */
type RowState = "established" | "not-established" | "info" | "unwired";

const ROW_STATE_META: Record<RowState, { label: string; className: string }> = {
  established: {
    label: "Established",
    className: "bg-primary/15 text-primary border-primary/40",
  },
  "not-established": {
    label: "Not established",
    className:
      "bg-surface-container-high text-on-surface-variant border-outline-variant/30",
  },
  info: {
    label: "Account-based",
    className:
      "bg-surface-container-high text-on-surface-variant border-outline-variant/30",
  },
  unwired: {
    label: "Not yet wired",
    className:
      "bg-surface-container-high text-on-surface-variant/70 border-outline-variant/20 italic",
  },
};

function ConnectionRow({
  icon,
  name,
  detail,
  state,
  action,
}: {
  icon: string;
  name: string;
  detail: string;
  state: RowState;
  action?: { label: string; onClick: () => void; disabled?: boolean; danger?: boolean };
}) {
  const meta = ROW_STATE_META[state];
  return (
    <li
      className="flex items-start gap-2 py-1.5"
      data-testid="persona-connection-row"
      data-state={state}
    >
      <span className="material-symbols-outlined text-base text-on-surface-variant/70 mt-0.5 flex-shrink-0">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-on-surface truncate">{name}</span>
          <span
            className={`text-[0.65rem] px-1.5 py-0.5 rounded-full border font-label ${meta.className}`}
          >
            {meta.label}
          </span>
        </span>
        <span className="block text-xs text-on-surface-variant/80 leading-snug">
          {detail}
        </span>
      </span>
      {action && (
        <button
          type="button"
          disabled={action.disabled}
          onClick={action.onClick}
          className={`flex-shrink-0 px-2 py-1 text-xs rounded transition-colors disabled:opacity-40 ${
            action.danger
              ? "text-error hover:bg-error-container/40"
              : "text-primary hover:bg-primary/10"
          }`}
        >
          {action.label}
        </button>
      )}
    </li>
  );
}

/**
 * Per-connection establishment rows for ONE persona. Every existing
 * connection appears — the portal (real claim/release), the device
 * mesh (native), and each Matrix / Reticulum / P2P / foreign-Concord
 * source with its honest current capability.
 */
function PersonaConnections({
  personaId,
  personaLabel,
  sources,
  hasPortal,
  bound,
  busy,
  native,
  isDefaultPersona,
  onEstablish,
  onRelease,
}: {
  personaId: string;
  personaLabel: string;
  sources: ConcordSource[];
  hasPortal: boolean;
  bound: boolean;
  busy: boolean;
  native: boolean;
  isDefaultPersona: boolean;
  onEstablish: (personaId: string, label: string) => void;
  onRelease: (personaId: string) => void;
}) {
  const portalSource = sources.find(isPortalSource);
  const foreignSources = sources.filter((s) => !isPortalSource(s));

  return (
    <ul
      className="mt-1 ml-1 pl-3 border-l border-outline-variant/15 flex flex-col"
      data-testid="persona-connections"
      data-persona-id={personaId}
    >
      {hasPortal && (
        <ConnectionRow
          icon="hub"
          name={
            portalSource
              ? `${sourceLabel(portalSource)} (this instance)`
              : "This instance"
          }
          detail={
            bound
              ? "Bound to your account here — your relay mailbox, deposit receipts, and mesh history on this instance follow this persona."
              : "Not bound to your account on this instance. Establish it to scope this instance's mesh surface to you."
          }
          state={bound ? "established" : "not-established"}
          action={
            bound
              ? {
                  label: "Release",
                  onClick: () => onRelease(personaId),
                  disabled: busy,
                  danger: true,
                }
              : {
                  label: "Establish",
                  onClick: () => onEstablish(personaId, personaLabel),
                  disabled: busy,
                }
          }
        />
      )}

      {native && (
        <ConnectionRow
          icon="cell_tower"
          name="Reticulum mesh (this device)"
          detail={
            isDefaultPersona
              ? "Announcing on the mesh as this persona — peers see its fingerprint."
              : "Not announcing. Use “Set as mesh persona” on this row to announce as this persona."
          }
          state={isDefaultPersona ? "established" : "not-established"}
        />
      )}

      {foreignSources.map((source) => {
        const platform = source.platform ?? "concord";
        if (platform === "matrix") {
          return (
            <ConnectionRow
              key={source.id}
              icon="tag"
              name={`${sourceLabel(source)} (Matrix)`}
              detail="Signs in with its own Matrix account — Concord personae don't apply on this connection."
              state="info"
            />
          );
        }
        if (platform === "reticulum") {
          return (
            <ConnectionRow
              key={source.id}
              icon="sensors"
              name={`${sourceLabel(source)} (Reticulum)`}
              detail={
                native
                  ? "Reached over the mesh — the announcing persona above is what this peer sees."
                  : "Reticulum reads on the portal are scoped by the persona bindings on this instance."
              }
              state="info"
            />
          );
        }
        if (platform === "concord-p2p") {
          return (
            <ConnectionRow
              key={source.id}
              icon="devices"
              name={`${sourceLabel(source)} (P2P)`}
              detail="Pairs with your device peer identity — per-persona selection isn't wired yet."
              state="unwired"
            />
          );
        }
        // Foreign Concord instance.
        return (
          <ConnectionRow
            key={source.id}
            icon="dns"
            name={`${sourceLabel(source)} (Concord)`}
            detail="Persona establishment on remote Concord instances isn't wired yet — this connection uses its own account."
            state="unwired"
          />
        );
      })}
    </ul>
  );
}

export function PersonaeSection() {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const accessToken = useAuthStore((s) => s.accessToken);
  const native = isTauri();
  const sources = useVisibleSources();

  /** Portal persona bindings (`/api/me/personas`). Both builds. */
  const [bindings, setBindings] = useState<RemotePersonaBinding[]>([]);
  const [bindingsLoading, setBindingsLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  /** Claim-by-id form (personae known on another device / instance). */
  const [claimId, setClaimId] = useState("");
  const [claimLabel, setClaimLabel] = useState("");

  /** Inline rename state. `null` means no row is being renamed. */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  /** Delete-confirmation state. */
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  /** Create-profile form state. */
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState("");

  /** WS-1 — the PUBLIC identity this node announces on the mesh. */
  const [meshIdentity, setMeshIdentity] = useState<PersonaIdentity | null>(null);

  const refreshBindings = useCallback(async () => {
    if (!accessToken) return;
    setBindingsLoading(true);
    try {
      const rows = await listMyPersonas(getApiBase(), accessToken);
      setBindings(Array.isArray(rows) ? rows : []);
    } catch {
      // Portal unreachable — keep whatever we last showed.
    } finally {
      setBindingsLoading(false);
    }
  }, [accessToken]);

  const refresh = useCallback(async () => {
    setError(null);
    // The porch profile store is native-only. On web the personae shown
    // are the account's portal bindings (fetched separately below).
    if (!isTauri()) {
      setProfiles([]);
      setLoading(false);
      return;
    }
    try {
      const list = await userProfileList();
      setProfiles(list);
      try {
        setMeshIdentity(await personaPublicIdentity());
      } catch {
        setMeshIdentity(null);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    void refreshBindings();
  }, [refreshBindings]);

  const boundIds = useMemo(
    () => new Set(bindings.map((b) => b.persona_id)),
    [bindings],
  );

  const handleEstablish = useCallback(
    async (personaId: string, label: string) => {
      if (!accessToken) return;
      setBusy(true);
      setError(null);
      try {
        await claimPersona(getApiBase(), accessToken, {
          persona_id: personaId,
          label: label || undefined,
        });
        await refreshBindings();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(
          /409|bound|conflict/i.test(msg)
            ? "That persona is already connected to a different account."
            : `Claim failed: ${msg}`,
        );
      } finally {
        setBusy(false);
      }
    },
    [accessToken, refreshBindings],
  );

  const handleRelease = useCallback(
    async (personaId: string) => {
      if (!accessToken) return;
      setBusy(true);
      setError(null);
      try {
        await releasePersona(getApiBase(), accessToken, personaId);
        await refreshBindings();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [accessToken, refreshBindings],
  );

  const handleClaimById = useCallback(async () => {
    const id = claimId.trim();
    if (!id) return;
    await handleEstablish(id, claimLabel.trim());
    setClaimId("");
    setClaimLabel("");
  }, [claimId, claimLabel, handleEstablish]);

  const handleCreate = useCallback(async () => {
    const name = createDraft.trim();
    if (!name) return;
    try {
      await userProfileCreate(name);
      setCreateDraft("");
      setCreating(false);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [createDraft, refresh]);

  const handleRenameSubmit = useCallback(
    async (id: string) => {
      const name = renameDraft.trim();
      if (!name) {
        setRenamingId(null);
        return;
      }
      try {
        await userProfileRename(id, name);
        setRenamingId(null);
        setRenameDraft("");
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [renameDraft, refresh],
  );

  const handlePromote = useCallback(
    async (id: string) => {
      try {
        await userProfileSetPrimary(id);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  const handleDeleteConfirm = useCallback(
    async (profile: UserProfile) => {
      try {
        await userProfileDelete(profile.id, profile.is_primary);
        setPendingDeleteId(null);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  /** WS-1 — designate/clear the default (mesh-announcing) persona. */
  const handleSetDefaultPersona = useCallback(
    async (id: string) => {
      try {
        await personaSetDefault(id);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  const handleClearDefaultPersona = useCallback(async () => {
    try {
      await personaClearDefault();
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [refresh]);

  const onlyOneProfile = useMemo(() => profiles.length <= 1, [profiles.length]);

  /** Web: bindings not represented by a native profile — on the web
   *  build that's ALL of them, and they're the personae we can show. */
  const nativeProfileIds = useMemo(
    () => new Set(profiles.map((p) => p.id)),
    [profiles],
  );
  const foreignBindings = useMemo(
    () => bindings.filter((b) => !nativeProfileIds.has(b.persona_id)),
    [bindings, nativeProfileIds],
  );

  if (loading) {
    return <div className="p-4 text-on-surface-variant">Loading personae…</div>;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-on-surface-variant max-w-prose">
        Personae are the identities other people see — derived from your
        superuser, never the superuser itself. Each persona shows where it
        is established across your existing connections.
      </p>

      {native && (
        <div
          data-testid="users-tab-mesh-status"
          data-announcing={meshIdentity ? "true" : "false"}
          className={`rounded-lg px-3 py-3 flex items-center gap-3 border ${
            meshIdentity
              ? "bg-primary/10 border-primary/40"
              : "bg-surface-container-high border-outline-variant/30"
          }`}
        >
          <span
            className={`material-symbols-outlined text-2xl ${
              meshIdentity ? "text-primary" : "text-on-surface-variant"
            }`}
          >
            {meshIdentity ? "cell_tower" : "cloud_off"}
          </span>
          <div className="min-w-0 flex-1">
            {meshIdentity ? (
              <>
                <div className="text-sm font-medium text-on-surface">
                  Announcing on the mesh as {meshIdentity.display_name}
                </div>
                <div
                  className="text-xs text-on-surface-variant font-mono truncate"
                  data-testid="users-tab-mesh-fingerprint"
                >
                  Persona fingerprint: {meshIdentity.fingerprint}
                </div>
              </>
            ) : (
              <>
                <div className="text-sm font-medium text-on-surface">
                  Dark on the mesh
                </div>
                <div className="text-xs text-on-surface-variant">
                  No default persona set. Designate one below to become visible
                  to other instances on the mesh.
                </div>
              </>
            )}
          </div>
          {meshIdentity && (
            <button
              type="button"
              onClick={() => void handleClearDefaultPersona()}
              data-testid="users-tab-clear-default-persona"
              className="flex-shrink-0 px-3 py-1.5 text-sm rounded-lg text-on-surface-variant hover:bg-surface-container-high"
            >
              Go dark
            </button>
          )}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-lg bg-error-container text-on-error-container px-3 py-2 text-sm"
        >
          {error}
        </div>
      )}

      {/* Native: porch profiles — the superuser + this device's personae. */}
      {native && (
        <ul className="flex flex-col gap-2" data-testid="users-tab-profile-list">
          {profiles.map((profile) => {
            const meta = PROVENANCE_META[profile.provenance];
            const isRenaming = renamingId === profile.id;
            const isConfirmingDelete = pendingDeleteId === profile.id;

            return (
              <li
                key={profile.id}
                data-testid="users-tab-profile-row"
                data-profile-id={profile.id}
                className="flex flex-col rounded-xl border border-outline-variant/20 bg-surface-container-low px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  {/* Avatar — falls back to first letter when no URL is set. */}
                  <div
                    aria-hidden="true"
                    className="flex-shrink-0 h-10 w-10 rounded-full bg-surface-container-high text-on-surface flex items-center justify-center overflow-hidden"
                  >
                    {profile.avatar_url ? (
                      <img
                        src={profile.avatar_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="text-base font-display">
                        {(profile.display_name[0] ?? "?").toUpperCase()}
                      </span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    {isRenaming ? (
                      <input
                        type="text"
                        value={renameDraft}
                        maxLength={MAX_DISPLAY_NAME_LEN}
                        autoFocus
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            void handleRenameSubmit(profile.id);
                          } else if (e.key === "Escape") {
                            setRenamingId(null);
                            setRenameDraft("");
                          }
                        }}
                        aria-label="Rename profile"
                        data-testid="users-tab-rename-input"
                        className="bg-surface-container text-on-surface rounded px-2 py-1 text-sm flex-1 min-w-[8rem] focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    ) : (
                      <span className="text-on-surface font-label truncate">
                        {profile.display_name}
                      </span>
                    )}

                    {profile.is_primary && (
                      <span
                        aria-label="Primary profile"
                        title="Primary profile"
                        data-testid="users-tab-primary-marker"
                        className="material-symbols-outlined text-amber-400 text-base"
                        style={{
                          fontVariationSettings:
                            '"FILL" 1, "wght" 500, "GRAD" 0, "opsz" 24',
                        }}
                      >
                        star
                      </span>
                    )}

                    {profile.is_primary && (
                      <span
                        data-testid="users-tab-superuser-badge"
                        title="Device-local root identity — never shown to peers"
                        className="text-xs px-2 py-0.5 rounded-full border font-label bg-amber-400/10 text-amber-400 border-amber-400/40"
                      >
                        Superuser
                      </span>
                    )}

                    <span
                      data-testid="users-tab-provenance-badge"
                      data-provenance={profile.provenance}
                      className={`text-xs px-2 py-0.5 rounded-full border font-label ${meta.className}`}
                    >
                      {meta.label}
                    </span>

                    {profile.is_default_persona && (
                      <span
                        data-testid="users-tab-default-persona-badge"
                        title="Announced on the mesh"
                        className="text-xs px-2 py-0.5 rounded-full border font-label bg-primary/15 text-primary border-primary/40 inline-flex items-center gap-1"
                      >
                        <span className="material-symbols-outlined text-sm">
                          cell_tower
                        </span>
                        Mesh persona
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isRenaming ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void handleRenameSubmit(profile.id)}
                          data-testid="users-tab-rename-save"
                          className="px-2 py-1 text-sm rounded bg-primary text-on-primary hover:opacity-90"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingId(null);
                            setRenameDraft("");
                          }}
                          className="px-2 py-1 text-sm rounded text-on-surface-variant hover:bg-surface-container-high"
                        >
                          Cancel
                        </button>
                      </>
                    ) : isConfirmingDelete ? (
                      <>
                        <span className="text-xs text-on-surface-variant">
                          {profile.is_primary ? "Delete primary?" : "Delete?"}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleDeleteConfirm(profile)}
                          data-testid="users-tab-delete-confirm"
                          className="px-2 py-1 text-sm rounded bg-error text-on-error hover:opacity-90"
                        >
                          Yes, delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(null)}
                          className="px-2 py-1 text-sm rounded text-on-surface-variant hover:bg-surface-container-high"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        {!profile.is_primary && !profile.is_default_persona && (
                          <button
                            type="button"
                            onClick={() =>
                              void handleSetDefaultPersona(profile.id)
                            }
                            data-testid="users-tab-set-default-persona"
                            title="Announce this identity on the mesh"
                            className="px-2 py-1 text-sm rounded text-on-surface-variant hover:bg-surface-container-high"
                          >
                            Set as mesh persona
                          </button>
                        )}
                        {!profile.is_primary && (
                          <button
                            type="button"
                            onClick={() => void handlePromote(profile.id)}
                            data-testid="users-tab-promote"
                            title="Make this the primary profile"
                            className="px-2 py-1 text-sm rounded text-on-surface-variant hover:bg-surface-container-high"
                          >
                            Make primary
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setRenameDraft(profile.display_name);
                            setRenamingId(profile.id);
                          }}
                          data-testid="users-tab-rename-start"
                          className="px-2 py-1 text-sm rounded text-on-surface-variant hover:bg-surface-container-high"
                        >
                          Rename
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(profile.id)}
                          disabled={onlyOneProfile}
                          data-testid="users-tab-delete-start"
                          title={
                            onlyOneProfile
                              ? "Can't delete the only profile"
                              : undefined
                          }
                          className="px-2 py-1 text-sm rounded text-error hover:bg-error-container/40 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                        >
                          Delete
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Per-connection establishment. The superuser row gets an
                    honest note instead — it is never peer-facing. */}
                {profile.is_primary ? (
                  <p className="mt-1 ml-1 pl-3 border-l border-outline-variant/15 text-xs text-on-surface-variant/70 py-1">
                    Your superuser is this device's root identity. It never
                    faces peers, so it isn't established on any connection —
                    personae below are.
                  </p>
                ) : (
                  <PersonaConnections
                    personaId={profile.id}
                    personaLabel={profile.display_name}
                    sources={sources}
                    hasPortal={!!accessToken}
                    bound={boundIds.has(profile.id)}
                    busy={busy || bindingsLoading}
                    native={native}
                    isDefaultPersona={profile.is_default_persona}
                    onEstablish={(id, label) => void handleEstablish(id, label)}
                    onRelease={(id) => void handleRelease(id)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Bindings with no local profile — on web that's every persona
          this account has claimed; on native it's personae claimed from
          another device. Shown so the account's full roamed footprint is
          always visible. */}
      {foreignBindings.length > 0 && (
        <div className="flex flex-col gap-2">
          {native && (
            <h5 className="text-xs font-medium text-on-surface-variant uppercase tracking-wider">
              Personae bound to this account from other devices
            </h5>
          )}
          <ul className="flex flex-col gap-2" data-testid="mesh-personae-list">
            {foreignBindings.map((b) => (
              <li
                key={b.persona_id}
                className="flex flex-col rounded-xl border border-outline-variant/20 bg-surface-container-low px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-primary text-xl">
                    fingerprint
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-on-surface font-label">
                      {b.label || b.persona_id}
                    </span>
                    <span className="block truncate font-mono text-xs text-on-surface-variant">
                      {b.persona_id}
                    </span>
                  </span>
                </div>
                <PersonaConnections
                  personaId={b.persona_id}
                  personaLabel={b.label ?? ""}
                  sources={sources}
                  hasPortal={!!accessToken}
                  bound
                  busy={busy || bindingsLoading}
                  native={native}
                  isDefaultPersona={false}
                  onEstablish={(id, label) => void handleEstablish(id, label)}
                  onRelease={(id) => void handleRelease(id)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {!native && accessToken && bindings.length === 0 && !bindingsLoading && (
        <p className="text-sm text-on-surface-variant italic">
          No personae are bound to this account yet. Your superuser lives in
          the desktop app — establish one of its personae here by id below.
        </p>
      )}

      {/* Native: create a new persona (porch profile). */}
      {native && (
        <div className="pt-2 border-t border-outline-variant/20">
          {creating ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={createDraft}
                maxLength={MAX_DISPLAY_NAME_LEN}
                autoFocus
                onChange={(e) => setCreateDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleCreate();
                  } else if (e.key === "Escape") {
                    setCreating(false);
                    setCreateDraft("");
                  }
                }}
                placeholder="Identity name"
                aria-label="Identity name"
                data-testid="users-tab-create-input"
                className="bg-surface-container text-on-surface rounded px-2 py-1 text-sm flex-1 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <button
                type="button"
                onClick={() => void handleCreate()}
                data-testid="users-tab-create-save"
                disabled={createDraft.trim().length === 0}
                className="px-3 py-1 text-sm rounded bg-primary text-on-primary hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setCreateDraft("");
                }}
                className="px-3 py-1 text-sm rounded text-on-surface-variant hover:bg-surface-container-high"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              data-testid="users-tab-create-start"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-high text-on-surface hover:opacity-90"
            >
              <span className="material-symbols-outlined text-base">add</span>
              Add identity
            </button>
          )}
        </div>
      )}

      {/* Claim-by-id — establish a persona on this instance by its id
          (e.g. one derived on another device). Real portal plumbing. */}
      {accessToken && (
        <div className="pt-2 border-t border-outline-variant/20 space-y-2">
          <h5 className="text-xs font-medium text-on-surface-variant uppercase tracking-wider">
            Establish a persona by id
          </h5>
          <p className="text-xs text-on-surface-variant">
            Bind a persona to your account on this instance by its id. One
            persona belongs to one account; the first claim wins.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={claimId}
              onChange={(e) => setClaimId(e.target.value)}
              placeholder="persona id"
              className="flex-1 rounded-lg bg-surface-container px-3 py-2 font-mono text-sm text-on-surface placeholder:text-on-surface-variant/60 outline-none focus:ring-1 focus:ring-primary"
              data-testid="mesh-persona-id-input"
            />
            <input
              value={claimLabel}
              onChange={(e) => setClaimLabel(e.target.value)}
              placeholder="label (optional)"
              className="flex-1 rounded-lg bg-surface-container px-3 py-2 text-sm text-on-surface placeholder:text-on-surface-variant/60 outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              disabled={busy || !claimId.trim()}
              onClick={() => void handleClaimById()}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50"
              data-testid="mesh-persona-claim"
            >
              Connect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
