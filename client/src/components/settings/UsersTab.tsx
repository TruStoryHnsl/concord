/**
 * UsersTab — Phase 1 of the User Management subsystem.
 *
 * Surfaces the per-install user profiles managed by the porch's
 * `user_profiles` table. The tab is intentionally narrow in Phase 1:
 *
 *   - List every profile, primary first.
 *   - Provenance badge (`Local` muted gray, `From relay` primary-tinted)
 *     so the user can tell at a glance where each profile came from.
 *     Phase 1 only ever produces `local` profiles; the relay-restored
 *     variant lights up in Phase 3 but the badge rendering is wired
 *     here so the UI is ready.
 *   - Inline rename, promote-to-primary, delete-with-confirm, and a
 *     create-profile form at the bottom.
 *
 * What this tab does NOT do in Phase 1:
 *
 *   - Show or manage keychain entries owned by the profile. The
 *     keychain wrappers are exposed by `client/src/api/userProfile.ts`
 *     for Phase 2 to call into; the source-add UIs are where credential
 *     CRUD lives once wired.
 *   - Relay configuration. That's Phase 3.
 *
 * The component is pure Tauri-IPC + React state — no Zustand store yet.
 * If a future phase needs cross-component access (e.g. the source-add
 * UI needs to read "which profile is primary"), a thin store can be
 * extracted.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  userProfileList,
  userProfileCreate,
  userProfileRename,
  userProfileSetPrimary,
  userProfileDelete,
  type UserProfile,
  type Provenance,
} from "../../api/userProfile";
import { useAuthStore } from "../../stores/auth";
import { isTauri } from "../../api/servitude";
import { useSettingsStore } from "../../stores/settings";
import { SUPERUSER_BACKUP_ANCHOR_ID } from "./SuperuserBackupSection";

/** Map provenance variant to a (label, Tailwind class tuple). */
const PROVENANCE_META: Record<
  Provenance,
  { label: string; className: string }
> = {
  local: {
    label: "Local",
    // Muted gray badge — neutral provenance.
    className:
      "bg-surface-container-high text-on-surface-variant border-outline-variant/30",
  },
  relay_restored: {
    label: "From relay",
    // Primary-tinted badge — distinguishes relay-restored profiles
    // from local-only ones at a glance. Phase 3 lights this variant
    // up; Phase 1 renders the variant correctly when it appears.
    className: "bg-primary/15 text-primary border-primary/40",
  },
};

/** Maximum display-name length the backend accepts. Mirrors
 *  `MAX_DISPLAY_NAME_LEN` in `src-tauri/src/porch/users.rs`. Surfaced
 *  client-side as an HTML `maxLength` so users don't get a confusing
 *  IPC error mid-typing. */
const MAX_DISPLAY_NAME_LEN = 64;

export function UsersTab() {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The account you're signed in with. This IS your identity on this
  // instance — it's shown as a known user, not something you have to
  // "create". The localpart (before the homeserver) is the handle.
  const userId = useAuthStore((s) => s.userId);
  const loginHandle = userId ? userId.split(":")[0].replace("@", "") : null;
  const native = isTauri();

  /** Inline rename state. `null` means no row is being renamed. */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  /** Delete-confirmation state. `null` means no delete is pending
   *  confirmation; otherwise the id is the row awaiting confirm. */
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  /** Create-profile form state. */
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState("");

  const setSettingsTab = useSettingsStore((s) => s.setSettingsTab);

  /** Native: jump to the Profile tab's keychain-backup section. */
  const handleClaimSuperuser = useCallback(() => {
    if (typeof window !== "undefined") {
      window.location.hash = `#${SUPERUSER_BACKUP_ANCHOR_ID}`;
    }
    setSettingsTab("profile");
  }, [setSettingsTab]);

  const refresh = useCallback(async () => {
    setError(null);
    // The porch profile store is native-only. On web there are no local
    // profiles to manage — the identity banner above is the whole surface.
    if (!isTauri()) {
      setProfiles([]);
      setLoading(false);
      return;
    }
    try {
      const list = await userProfileList();
      setProfiles(list);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const onlyOneProfile = useMemo(() => profiles.length <= 1, [profiles.length]);

  if (loading) {
    return (
      <div className="p-4 text-on-surface-variant">Loading profiles…</div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-xl font-display font-semibold text-on-surface">
          Identity
        </h2>
        <p className="text-sm text-on-surface-variant max-w-prose">
          Your superuser is your root identity on this instance — it owns the
          keychain that syncs to your other devices. Additional identities let
          you keep separate sets of credentials.
        </p>
      </header>

      {loginHandle && (
        <div className="rounded-lg bg-surface-container-high border border-primary/30 px-3 py-3 flex items-center gap-3">
          <span className="material-symbols-outlined text-primary text-2xl">
            shield_person
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-on-surface">
              Signed in as {loginHandle}
            </div>
            <div className="text-xs text-on-surface-variant">
              {native
                ? "Claim this login as your superuser to make it your root identity across your devices."
                : "This is the account you're connected with on this instance."}
            </div>
          </div>
          {native && (
            <button
              type="button"
              onClick={handleClaimSuperuser}
              className="flex-shrink-0 px-3 py-1.5 text-sm rounded-lg bg-primary text-on-primary hover:opacity-90"
              data-testid="users-tab-claim-superuser"
            >
              Claim as superuser
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

      <ul
        className="flex flex-col gap-2"
        data-testid="users-tab-profile-list"
      >
        {profiles.map((profile) => {
          const meta = PROVENANCE_META[profile.provenance];
          const isRenaming = renamingId === profile.id;
          const isConfirmingDelete = pendingDeleteId === profile.id;

          return (
            <li
              key={profile.id}
              data-testid="users-tab-profile-row"
              data-profile-id={profile.id}
              className="flex items-center gap-3 rounded-xl border border-outline-variant/20 bg-surface-container-low px-3 py-2"
            >
              {/* Avatar — falls back to first letter when no URL is set. */}
              <div
                aria-hidden="true"
                className="flex-shrink-0 h-10 w-10 rounded-full bg-surface-container-high text-on-surface flex items-center justify-center overflow-hidden"
              >
                {profile.avatar_url ? (
                  // eslint-disable-next-line jsx-a11y/img-redundant-alt
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

                <span
                  data-testid="users-tab-provenance-badge"
                  data-provenance={profile.provenance}
                  className={`text-xs px-2 py-0.5 rounded-full border font-label ${meta.className}`}
                >
                  {meta.label}
                </span>
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
                      {profile.is_primary
                        ? "Delete primary?"
                        : "Delete?"}
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
            </li>
          );
        })}
      </ul>

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
    </div>
  );
}
