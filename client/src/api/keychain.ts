/**
 * Keychain write/read API wrapper (Phase-2 source routing).
 *
 * Thin wrappers around the two native `user_profile_keychain_*` Tauri
 * commands wired in Phase 2:
 *   - `user_profile_keychain_add`     → persist a source's credentials,
 *     encrypted under the porch Stronghold seed, into a profile's keychain.
 *   - `user_profile_keychain_decrypt` → recover the plaintext credentials
 *     for a previously-stored entry.
 *
 * Both are **native-only**. The web build hosts no porch and has no
 * Stronghold, so there is nothing to write to — the wrappers no-op (return
 * `null`) under `isTauri()`. Call sites treat the keychain save as a
 * best-effort side effect: a `null` return (web) or a thrown error
 * (native failure) must never block the user's login / pairing flow.
 *
 * Wire shapes mirror the Rust command contract in
 * `src-tauri/src/commands/user_profile.rs` and the `KeychainEntry` /
 * `PlaintextCredentials` types in `src-tauri/src/porch/users.rs`:
 *
 *   - `source_kind: "matrix"`   → credentials `{ homeserver, user_id, access_token }`
 *   - `source_kind: "concord"`  → credentials `{ host, invite_token }`
 *   - `source_kind: "p2p_peer"` → credentials `{ peer_id, addrs }`
 *
 * The porch stores `credentials` opaquely (an encrypted blob), so the JSON
 * shape is a client/UI contract — it is not validated Rust-side beyond the
 * `source_kind` enum.
 *
 * When `profileId` is omitted the command targets the primary (superuser)
 * profile.
 */

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./servitude";
import type { KeychainEntry, SourceKind } from "./userProfile";

/** Re-export so call sites can import the metadata type from one place. */
export type { KeychainEntry, SourceKind } from "./userProfile";

/** Arguments for {@link keychainAdd}. */
export interface KeychainAddArgs {
  /** What kind of source these credentials authenticate to. */
  sourceKind: SourceKind;
  /** Stable host identifier — `matrix.org`, the concord host, or a peer-id. */
  sourceHost: string;
  /** Per-kind credential JSON (see module docstring for the shapes). */
  credentials: Record<string, unknown>;
  /** Optional user-supplied nickname for the login. */
  label?: string;
  /** Target profile. Omit to target the primary profile. */
  profileId?: string;
}

/** Plaintext credentials handed back by {@link keychainDecrypt}.
 *
 *  The Rust `PlaintextCredentials` is a newtype tuple struct
 *  (`PlaintextCredentials(serde_json::Value)`) — it serializes as the bare
 *  decrypted credential JSON, NOT an envelope with `source_kind` /
 *  `source_host`. So this is just the per-kind object that was stored,
 *  e.g. `{ homeserver, user_id, access_token }` for a matrix entry. */
export type PlaintextCredentials = Record<string, unknown>;

/** Arguments for {@link keychainDecrypt}. */
export interface KeychainDecryptArgs {
  /** The `KeychainEntry.id` to decrypt. */
  entryId: string;
  /** Optional profile context (accepted for symmetry; the entry is keyed
   *  by `entryId`). Omit to default to primary. */
  profileId?: string;
}

/**
 * Persist a source's credentials into a profile's keychain.
 *
 * **Native only.** On the web build this is a no-op returning `null`. On
 * native it invokes `user_profile_keychain_add` and resolves to the new
 * {@link KeychainEntry} metadata (ciphertext never crosses the IPC
 * boundary). Throws only if the native command rejects (no porch / no
 * Stronghold / unknown `sourceKind`) — callers wiring this into a login or
 * pairing success path MUST treat a throw as non-fatal (log, don't block).
 */
export async function keychainAdd(
  args: KeychainAddArgs,
): Promise<KeychainEntry | null> {
  if (!isTauri()) return null;
  return await invoke<KeychainEntry>("user_profile_keychain_add", {
    sourceKind: args.sourceKind,
    sourceHost: args.sourceHost,
    label: args.label ?? null,
    credentials: args.credentials,
    profileId: args.profileId ?? null,
  });
}

/**
 * Decrypt a previously-stored keychain entry.
 *
 * **Native only.** Returns `null` on the web build. On native it invokes
 * `user_profile_keychain_decrypt` and resolves to the plaintext
 * credentials (and stamps `last_used_at` Rust-side). Throws if the entry
 * is missing or the Stronghold can't be opened.
 */
export async function keychainDecrypt(
  args: KeychainDecryptArgs,
): Promise<PlaintextCredentials | null> {
  if (!isTauri()) return null;
  return await invoke<PlaintextCredentials>("user_profile_keychain_decrypt", {
    entryId: args.entryId,
    profileId: args.profileId ?? null,
  });
}
