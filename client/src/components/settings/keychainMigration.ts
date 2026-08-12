/**
 * One-time keychain migration — pure logic (no React).
 *
 * Split out from `KeychainMigrationPrompt.tsx` so the component file only
 * exports a component (react-refresh / fast-refresh requirement). This
 * module owns the gating predicate, the per-source migration plan, and the
 * localStorage flag.
 *
 * See `KeychainMigrationPrompt.tsx` for the surrounding UX contract.
 */

import { isTauri } from "../../api/servitude";
import { useSourcesStore, type ConcordSource } from "../../stores/sources";
import {
  userProfileList,
  userProfileKeychainList,
} from "../../api/userProfile";

/** localStorage flag — set once the prompt has been actioned (either way). */
export const KEYCHAIN_MIGRATED_FLAG = "concord_keychain_migrated";

/** The `keychainAdd` argument a saved source maps to, or `null` to skip. */
export interface SourceMigrationPlan {
  sourceKind: "matrix" | "concord";
  sourceHost: string;
  credentials: Record<string, unknown>;
  label?: string;
}

/**
 * Decide what (if anything) a saved source contributes to the keychain.
 *
 * - A source carrying a Matrix session (`accessToken` + `userId`) maps to a
 *   `matrix` keychain entry — the real credential worth protecting.
 * - Otherwise a source carrying a non-empty `inviteToken` maps to a
 *   `concord` entry (the invite that established the link).
 * - The local/embedded instance (`isLocal`) and bare token-less primary
 *   sources (`inviteToken === ""`, no access token) have no per-source
 *   credential to migrate and are skipped.
 */
export function planSourceMigration(
  source: ConcordSource,
): SourceMigrationPlan | null {
  // The device's own embedded instance has no transferable credential.
  if (source.isLocal) return null;

  if (source.accessToken && source.userId) {
    return {
      sourceKind: "matrix",
      sourceHost: source.host,
      credentials: {
        homeserver: source.homeserverUrl,
        user_id: source.userId,
        access_token: source.accessToken,
      },
      label: source.instanceName,
    };
  }

  const invite = source.inviteToken?.trim();
  if (invite) {
    return {
      sourceKind: "concord",
      sourceHost: source.host,
      credentials: {
        host: source.host,
        invite_token: invite,
      },
      label: source.instanceName,
    };
  }

  return null;
}

/** Identity of a stored credential: `${source_kind}:${source_host}`. Used to
 *  skip sources the keychain already holds so migration never duplicates. */
export function sourceKey(kind: string, host: string): string {
  return `${kind}:${host}`;
}

/**
 * The `${kind}:${host}` keys already present in the primary profile's
 * keychain. Post-Phase-2 logins persist credentials at login time, so without
 * this check the migration prompt would write a second entry for a source the
 * keychain already holds. Fail-open: returns an empty set on web or on any
 * lookup error (a rare duplicate is better than blocking the migration).
 */
export async function existingKeychainKeys(): Promise<Set<string>> {
  if (!isTauri()) return new Set();
  try {
    const primary = (await userProfileList()).find((p) => p.is_primary);
    if (!primary) return new Set();
    const entries = await userProfileKeychainList(primary.id);
    return new Set(entries.map((e) => sourceKey(e.source_kind, e.source_host)));
  } catch {
    return new Set();
  }
}

/** Read the saved sources that can be migrated into the keychain. */
export function migratableSources(): ConcordSource[] {
  return useSourcesStore
    .getState()
    .sources.filter((s) => planSourceMigration(s) !== null);
}

/**
 * Whether the prompt should be shown at all: native + not-yet-migrated +
 * at least one migratable saved source. The caller (App.tsx) uses this to
 * decide whether to mount the component.
 */
export function shouldShowKeychainMigration(): boolean {
  if (!isTauri()) return false;
  if (localStorage.getItem(KEYCHAIN_MIGRATED_FLAG)) return false;
  return migratableSources().length > 0;
}

/** Set the one-and-done flag. Swallows a locked-down localStorage. */
export function markKeychainMigrated(): void {
  try {
    localStorage.setItem(KEYCHAIN_MIGRATED_FLAG, String(Date.now()));
  } catch {
    // localStorage write can fail in locked-down environments; the worst
    // case is the prompt reappears next launch, which is acceptable.
  }
}
