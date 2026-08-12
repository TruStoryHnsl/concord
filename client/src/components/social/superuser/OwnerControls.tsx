/**
 * Owner-controls editor. OWNED by superuser-ux.
 *
 * Shown once an owner has been claimed. Lets the device owner edit their
 * display name / bio / avatar reference and surfaces the immutable
 * owner-id (the install's Ed25519 public key) plus the claim date. This is
 * the steady-state "manage your identity on the social graph" surface; the
 * per-feature graph controls (peers / inboxes / devices) live in their own
 * panels.
 */
import { useEffect, useMemo, useState } from "react";

import { ownerErrorMessage } from "../../../api/social/superuser";
import type { OwnerIdentity } from "../../../api/social/types";

const MAX_NAME = 128;
const MAX_BIO = 1024;

interface OwnerControlsProps {
  owner: OwnerIdentity;
  onUpdate: (args: {
    displayName?: string;
    bio?: string;
    avatarRef?: string;
  }) => Promise<OwnerIdentity>;
  /** Optional toast hook so saves can surface success outside the panel. */
  onToast?: (message: string, type?: "success" | "error" | "info") => void;
}

/** Short, copy-paste-friendly rendering of the 64-hex owner id. */
function shortOwnerId(ownerId: string): string {
  if (ownerId.length <= 16) return ownerId;
  return `${ownerId.slice(0, 8)}…${ownerId.slice(-8)}`;
}

export function OwnerControls({ owner, onUpdate, onToast }: OwnerControlsProps) {
  const [displayName, setDisplayName] = useState(owner.displayName);
  const [bio, setBio] = useState(owner.bio ?? "");
  const [avatarRef, setAvatarRef] = useState(owner.avatarRef ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-sync local form state if the owner prop changes underneath us
  // (e.g. a reload elsewhere).
  useEffect(() => {
    setDisplayName(owner.displayName);
    setBio(owner.bio ?? "");
    setAvatarRef(owner.avatarRef ?? "");
  }, [owner]);

  const dirty = useMemo(() => {
    return (
      displayName.trim() !== owner.displayName ||
      bio.trim() !== (owner.bio ?? "") ||
      avatarRef.trim() !== (owner.avatarRef ?? "")
    );
  }, [displayName, bio, avatarRef, owner]);

  const nameValid = displayName.trim().length > 0 && displayName.trim().length <= MAX_NAME;
  const canSave = dirty && nameValid && !saving;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      await onUpdate({
        // Only send changed fields. Empty bio/avatar clears them
        // (Some("") → None server-side).
        displayName:
          displayName.trim() !== owner.displayName ? displayName.trim() : undefined,
        bio: bio.trim() !== (owner.bio ?? "") ? bio.trim() : undefined,
        avatarRef:
          avatarRef.trim() !== (owner.avatarRef ?? "") ? avatarRef.trim() : undefined,
      });
      onToast?.("Owner profile updated", "success");
    } catch (err) {
      const msg = ownerErrorMessage(err);
      setError(msg);
      onToast?.(msg, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="superuser-owner-controls">
      <header className="space-y-1">
        <h3 className="text-xl font-headline font-semibold text-on-surface">
          Your owner profile
        </h3>
        <p className="text-sm text-on-surface-variant">
          You are the owner ("superuser") of this device. This profile is how
          you appear on the peer-to-peer social graph.
        </p>
      </header>

      <form className="space-y-4" onSubmit={handleSave}>
        <div className="space-y-2">
          <label
            htmlFor="owner-display-name"
            className="text-sm font-medium text-on-surface"
          >
            Display name
          </label>
          <input
            id="owner-display-name"
            type="text"
            maxLength={MAX_NAME}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full px-3 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="owner-bio" className="text-sm font-medium text-on-surface">
            Bio
          </label>
          <textarea
            id="owner-bio"
            rows={3}
            maxLength={MAX_BIO}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="A short line about you."
            className="w-full px-3 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="owner-avatar" className="text-sm font-medium text-on-surface">
            Avatar reference
          </label>
          <input
            id="owner-avatar"
            type="text"
            value={avatarRef}
            onChange={(e) => setAvatarRef(e.target.value)}
            placeholder="https://… or mxc://…"
            className="w-full px-3 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>

        {error && (
          <p
            className="text-sm text-error"
            role="alert"
            data-testid="superuser-update-error"
          >
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={!canSave}
            className="px-4 py-2 primary-glow hover:brightness-110 disabled:opacity-40 text-on-surface text-sm rounded-md transition-colors"
            data-testid="superuser-update-submit"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          {dirty && !saving && (
            <span className="text-xs text-on-surface-variant">Unsaved changes</span>
          )}
        </div>
      </form>

      {/* Immutable identity facts — the owner id + claim date. */}
      <dl className="border-t border-outline-variant/20 pt-4 space-y-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-on-surface-variant">Owner id</dt>
          <dd
            className="font-mono text-xs text-on-surface truncate"
            title={owner.ownerId}
            data-testid="superuser-owner-id"
          >
            {owner.ownerId ? shortOwnerId(owner.ownerId) : "—"}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-on-surface-variant">Claimed</dt>
          <dd className="text-xs text-on-surface">
            {owner.claimedAt
              ? new Date(owner.claimedAt).toLocaleString()
              : "—"}
          </dd>
        </div>
      </dl>
    </div>
  );
}
