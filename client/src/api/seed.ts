/**
 * API wrapper: **BIP39 recovery phrase** (seed export / import).
 *
 * Thin wrappers around the `seed_export_mnemonic` / `seed_import_mnemonic`
 * Tauri commands. The phrase IS the identity — this module never logs it,
 * never puts it in an error, and the UI must gate export behind an explicit
 * two-step confirmation before calling.
 *
 * Native-only: the seed lives in Stronghold, which a browser build does not
 * host. Callers should guard with `isTauri()`.
 */

import { invoke } from "@tauri-apps/api/core";
import type { PeerIdentityPublic } from "./peerIdentity";

/**
 * Export this install's seed as a 24-word BIP39 recovery phrase.
 *
 * The returned string is the identity. Callers MUST show a two-step
 * confirmation stating that anyone holding the phrase can sign as this
 * install and decrypt anything sealed to it, and MUST drop the string as
 * soon as the display surface has it.
 */
export function exportSeedMnemonic(): Promise<string> {
  return invoke<string>("seed_export_mnemonic");
}

/**
 * Restore this install's seed from a 24-word BIP39 recovery phrase.
 *
 * Refuses (rejects) when an owner has already been claimed on this install.
 * On success the install becomes a second device under the phrase's owner —
 * same owner fingerprint, NEW device peer id. Returns the post-restore
 * public identity.
 */
export function importSeedMnemonic(phrase: string): Promise<PeerIdentityPublic> {
  return invoke<PeerIdentityPublic>("seed_import_mnemonic", { phrase });
}

/** Human-readable error for a failed import. */
export function seedErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** True when the restore was refused because an owner is already claimed. */
export function isOwnerClaimedError(err: unknown): boolean {
  return seedErrorMessage(err).toLowerCase().includes("already has a claimed owner");
}
