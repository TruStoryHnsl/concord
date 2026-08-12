/**
 * Hook: load + mutate the owner ("superuser") profile. OWNED by superuser-ux.
 *
 * Wraps the `social/superuser` api so the panel components don't each
 * re-implement load / claim / update plumbing. Exposes the loaded owner,
 * loading/error state, and the two mutators. All calls are native-only
 * (the Tauri commands require the local Stronghold); the caller is expected
 * to gate on `isTauri()` before mounting.
 */
import { useCallback, useEffect, useState } from "react";

import type { OwnerIdentity } from "../../../api/social/types";
import {
  ownerErrorMessage,
  socialOwnerClaim,
  socialOwnerGet,
  socialOwnerUpdate,
} from "../../../api/social/superuser";

export interface UseOwnerIdentity {
  /** The loaded owner profile; `null` until the first load resolves. */
  owner: OwnerIdentity | null;
  /** True while the initial load is in flight. */
  loading: boolean;
  /** Last load/mutation error message, or `null`. */
  error: string | null;
  /** True once an owner has been claimed (first-run complete). */
  claimed: boolean;
  /** Re-read the profile from the backend. */
  reload: () => Promise<void>;
  /** First-run claim. Resolves to the claimed profile. */
  claim: (args: {
    displayName: string;
    bio?: string;
    avatarRef?: string;
  }) => Promise<OwnerIdentity>;
  /** Update an already-claimed profile. Resolves to the updated profile. */
  update: (args: {
    displayName?: string;
    bio?: string;
    avatarRef?: string;
  }) => Promise<OwnerIdentity>;
}

export function useOwnerIdentity(): UseOwnerIdentity {
  const [owner, setOwner] = useState<OwnerIdentity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const next = await socialOwnerGet();
      setOwner(next);
      setError(null);
    } catch (err) {
      setError(ownerErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const claim = useCallback(
    async (args: { displayName: string; bio?: string; avatarRef?: string }) => {
      const next = await socialOwnerClaim(args);
      setOwner(next);
      setError(null);
      return next;
    },
    [],
  );

  const update = useCallback(
    async (args: { displayName?: string; bio?: string; avatarRef?: string }) => {
      const next = await socialOwnerUpdate(args);
      setOwner(next);
      setError(null);
      return next;
    },
    [],
  );

  return {
    owner,
    loading,
    error,
    claimed: owner?.claimed ?? false,
    reload,
    claim,
    update,
  };
}
