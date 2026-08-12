/**
 * First-run owner-claim flow. OWNED by superuser-ux.
 *
 * Shown when no owner has been claimed yet. Walks the device owner through
 * naming themselves and (optionally) adding a bio / avatar reference, then
 * claims the authoritative `OwnerIdentity` — binding the chosen display name
 * to the install's Ed25519 identity. After a successful claim the parent
 * swaps in the owner-controls view.
 */
import { useState } from "react";

import {
  isAlreadyClaimedError,
  ownerErrorMessage,
} from "../../../api/social/superuser";
import type { OwnerIdentity } from "../../../api/social/types";

const MAX_NAME = 128;
const MAX_BIO = 1024;

interface FirstRunClaimProps {
  /** Claim mutator from `useOwnerIdentity`. */
  onClaim: (args: {
    displayName: string;
    bio?: string;
    avatarRef?: string;
  }) => Promise<OwnerIdentity>;
  /** Called after a successful claim (or an already-claimed reconciliation). */
  onClaimed: (owner: OwnerIdentity) => void;
  /** Re-read the profile (used when the backend reports already-claimed). */
  onReload: () => Promise<void>;
}

export function FirstRunClaim({ onClaim, onClaimed, onReload }: FirstRunClaimProps) {
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarRef, setAvatarRef] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = displayName.trim();
  const canSubmit = trimmedName.length > 0 && trimmedName.length <= MAX_NAME && !pending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const owner = await onClaim({
        displayName: trimmedName,
        bio: bio.trim() || undefined,
        avatarRef: avatarRef.trim() || undefined,
      });
      onClaimed(owner);
    } catch (err) {
      // If the install was already claimed (e.g. a second window raced us),
      // reconcile to the existing profile rather than showing an error.
      if (isAlreadyClaimedError(err)) {
        await onReload();
        return;
      }
      setError(ownerErrorMessage(err));
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      className="max-w-md mx-auto space-y-6"
      data-testid="superuser-first-run"
    >
      <header className="space-y-2 text-center">
        <h2 className="text-2xl font-headline font-semibold text-on-surface">
          Set up your identity
        </h2>
        <p className="text-sm text-on-surface-variant">
          This device is yours. Claim the owner profile to name yourself on the
          peer-to-peer social graph. Your name is bound to this install's
          cryptographic identity — no account, no server.
        </p>
      </header>

      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <label
            htmlFor="superuser-display-name"
            className="text-sm font-medium text-on-surface"
          >
            Display name
          </label>
          <input
            id="superuser-display-name"
            type="text"
            autoFocus
            maxLength={MAX_NAME}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="e.g. Colton"
            className="w-full px-3 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="superuser-bio"
            className="text-sm font-medium text-on-surface"
          >
            Bio <span className="text-on-surface-variant">(optional)</span>
          </label>
          <textarea
            id="superuser-bio"
            rows={3}
            maxLength={MAX_BIO}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="A short line about you."
            className="w-full px-3 py-2 bg-surface-container border border-outline-variant rounded text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/30 resize-none"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="superuser-avatar"
            className="text-sm font-medium text-on-surface"
          >
            Avatar reference{" "}
            <span className="text-on-surface-variant">(optional)</span>
          </label>
          <input
            id="superuser-avatar"
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
            data-testid="superuser-claim-error"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full px-4 py-2 primary-glow hover:brightness-110 disabled:opacity-40 text-on-surface text-sm rounded-md transition-colors"
          data-testid="superuser-claim-submit"
        >
          {pending ? "Claiming…" : "Claim owner profile"}
        </button>
      </form>
    </div>
  );
}
