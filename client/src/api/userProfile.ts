/**
 * User Management Phase 1 — API wrapper.
 *
 * Thin wrappers around the eight `user_profile_*` Tauri commands exposed
 * by `src-tauri/src/lib.rs`. All commands are native-only — the web
 * build doesn't host a porch, so the wrappers return a `not_supported`
 * sentinel (an empty list / a typed error) instead of dispatching.
 *
 * Wire shapes mirror the Rust types in `src-tauri/src/porch/users.rs`:
 *   - `UserProfile`
 *   - `Provenance` (`local` | `relay_restored`)
 *   - `KeychainEntry`
 *   - `SourceKind` (`concord` | `matrix` | `p2p_peer`)
 *
 * Phase 1 deliberately does NOT ship wrappers for `add_keychain_entry`
 * or `decrypt_credentials` — those are the seams Phase 2's source-add
 * flows wire into. The Rust-side primitives exist (and the integration
 * test exercises them); the IPC surface is held back until Phase 2 to
 * keep credential write-paths intentional.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./servitude";

/** Where a profile originated. */
export type Provenance = "local" | "relay_restored";

/** What kind of source a keychain entry authenticates to. */
export type SourceKind = "concord" | "matrix" | "p2p_peer";

/** One user profile. Mirrors the Rust `UserProfile` shape. */
export interface UserProfile {
  /** ULID. */
  id: string;
  /** User-visible display name (validated non-empty, <= 64 chars). */
  display_name: string;
  /** Optional avatar URL (mxc:// or http(s)). */
  avatar_url: string | null;
  /** Exactly one profile per install carries `true` at a time. */
  is_primary: boolean;
  /** Where this profile came from. */
  provenance: Provenance;
  /** WS-1 — Personae Closet: exactly one NON-primary profile carries `true`
   *  at a time — the DEFAULT PERSONA whose Ed25519 key may appear on public
   *  mesh lines. The superuser (primary) never carries this. When a default
   *  is set, the node announces on the mesh; when none is set, it stays dark. */
  is_default_persona: boolean;
  /** Unix milliseconds — when the profile was created on this install. */
  created_at: number;
}

/** WS-1 — a persona's PUBLIC mesh identity. Carries NO private-key material:
 *  the persona signing key is HKDF-derived from the superuser seed on demand
 *  and never persisted or surfaced. Mirrors the Rust `PersonaIdentity`. */
export interface PersonaIdentity {
  /** ULID of the owning profile (the persona) — the salt that derived the key. */
  persona_id: string;
  /** User-visible display name of the persona. */
  display_name: string;
  /** 32-byte Ed25519 public key of the persona signing key (byte array). */
  public_key: number[];
  /** Deterministic short fingerprint of `public_key`. This is what a peer
   *  sees for this node on its mesh map. */
  fingerprint: string;
}

/** One keychain entry's metadata. Ciphertext + nonce NEVER leave the
 *  porch — only the metadata is surfaced to the renderer. Decryption
 *  is a separate Rust-side call wired in Phase 2. */
export interface KeychainEntry {
  /** ULID. */
  id: string;
  /** FK to `UserProfile.id`. */
  profile_id: string;
  source_kind: SourceKind;
  /** e.g. `matrix.org`. */
  source_host: string;
  /** User-supplied nickname for the login. */
  label: string | null;
  /** Unix milliseconds — when the entry was added. */
  created_at: number;
  /** Unix milliseconds — when the entry was last decrypted, or `null`. */
  last_used_at: number | null;
}

/** List every non-tombstoned profile on this install, primary first.
 *  The web build returns an empty list. */
export async function userProfileList(): Promise<UserProfile[]> {
  if (!isTauri()) return [];
  return await invoke<UserProfile[]>("user_profile_list");
}

/** Create a new profile. The new row is NOT primary — promote
 *  explicitly via {@link userProfileSetPrimary}. Native only. */
export async function userProfileCreate(
  displayName: string,
): Promise<UserProfile> {
  if (!isTauri()) {
    throw new Error("user_profile_create is native-only");
  }
  return await invoke<UserProfile>("user_profile_create", {
    displayName,
  });
}

/** Rename a profile. Native only. */
export async function userProfileRename(
  id: string,
  displayName: string,
): Promise<UserProfile> {
  if (!isTauri()) {
    throw new Error("user_profile_rename is native-only");
  }
  return await invoke<UserProfile>("user_profile_rename", {
    id,
    displayName,
  });
}

/** Promote a profile to primary, demoting whichever profile was
 *  previously primary inside the same transaction. Native only. */
export async function userProfileSetPrimary(
  id: string,
): Promise<UserProfile> {
  if (!isTauri()) {
    throw new Error("user_profile_set_primary is native-only");
  }
  return await invoke<UserProfile>("user_profile_set_primary", { id });
}

/** Set (or clear, when `null`) the avatar URL on a profile. Native only. */
export async function userProfileSetAvatar(
  id: string,
  avatarUrl: string | null,
): Promise<UserProfile> {
  if (!isTauri()) {
    throw new Error("user_profile_set_avatar is native-only");
  }
  return await invoke<UserProfile>("user_profile_set_avatar", {
    id,
    avatarUrl,
  });
}

/** Delete a profile. The porch's `ON DELETE CASCADE` drops every
 *  keychain entry the profile owned. Pass `confirmPrimaryDemotion: true`
 *  to delete the currently-primary profile. The backend refuses to
 *  delete the LAST profile in any case. Native only. */
export async function userProfileDelete(
  id: string,
  confirmPrimaryDemotion: boolean = false,
): Promise<void> {
  if (!isTauri()) {
    throw new Error("user_profile_delete is native-only");
  }
  await invoke<void>("user_profile_delete", {
    id,
    confirmPrimaryDemotion,
  });
}

/** List the keychain entries owned by a profile. Returns metadata only;
 *  credential ciphertext / nonce never cross the IPC boundary. The
 *  web build returns an empty list. */
export async function userProfileKeychainList(
  profileId: string,
): Promise<KeychainEntry[]> {
  if (!isTauri()) return [];
  return await invoke<KeychainEntry[]>("user_profile_keychain_list", {
    profileId,
  });
}

/** Remove a keychain entry by id. Native only. */
export async function userProfileKeychainRemove(entryId: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("user_profile_keychain_remove is native-only");
  }
  await invoke<void>("user_profile_keychain_remove", { entryId });
}

// ---------------------------------------------------------------------------
// WS-1 — Persona activation (mesh unlock).
//
// Designating a DEFAULT persona is what flips this node from silent /
// receive-only to ANNOUNCING on the public mesh. A persona is a non-primary
// profile; the superuser (primary) can never be a persona.
// ---------------------------------------------------------------------------

/** Designate a non-primary profile as the DEFAULT persona — the identity this
 *  node announces on the public mesh. Clears any previous default. Once set,
 *  a second instance can observe this node on its mesh map. Native only. */
export async function personaSetDefault(personaId: string): Promise<UserProfile> {
  if (!isTauri()) {
    throw new Error("persona_set_default is native-only");
  }
  return await invoke<UserProfile>("persona_set_default", { personaId });
}

/** Clear the default persona — the node goes dark on the public mesh again.
 *  Native only. */
export async function personaClearDefault(): Promise<void> {
  if (!isTauri()) {
    throw new Error("persona_clear_default is native-only");
  }
  await invoke<void>("persona_clear_default");
}

/** Read the current default persona's profile, or `null` if none is set (node
 *  is dark on the mesh). Web returns `null`. */
export async function personaDefaultGet(): Promise<UserProfile | null> {
  if (!isTauri()) return null;
  return await invoke<UserProfile | null>("persona_default_get");
}

/** Read the PUBLIC identity (public key + fingerprint) this node announces on
 *  the mesh — the default persona's public bytes — or `null` when none is set.
 *  Never returns private-key material or the superuser. Web returns `null`. */
export async function personaPublicIdentity(): Promise<PersonaIdentity | null> {
  if (!isTauri()) return null;
  return await invoke<PersonaIdentity | null>("persona_public_identity");
}
