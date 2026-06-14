/**
 * Hub credential-backup API wrapper.
 *
 * Thin wrappers around the three `hub_*` Tauri commands registered in
 * `src-tauri/src/lib.rs`:
 *
 *   - hub_status  — read whether this instance runs as a Hub.
 *   - hub_claim   — back up the local superuser keychain to a Hub:
 *                   build the passphrase-encrypted ciphertext locally and
 *                   return the opaque envelope (base64) the front-end
 *                   uploads to the Hub.
 *   - hub_restore — on a new device, decrypt a Hub ciphertext with the
 *                   master passphrase and overwrite the local porch DB.
 *
 * All three are native-only — the crypto runs against the local porch +
 * Stronghold, which a browser build doesn't host. Each wrapper throws a
 * clear native-only error on web, mirroring the LOCAL helpers in
 * `client/src/api/porch.ts`.
 *
 * Wire shapes mirror the Rust types in
 * `src-tauri/src/commands/hub.rs` and
 * `src-tauri/src/servitude/hub/mod.rs`.
 */

import { isTauri } from "./servitude";

/** Minimum master-passphrase length. Mirrors `MIN_PASSPHRASE_LEN` in
 *  `src-tauri/src/servitude/hub/mod.rs`. Enforced client-side so the
 *  user gets immediate validation instead of an IPC error after typing. */
export const MIN_PASSPHRASE_LEN = 12;

/** Hub-mode runtime config. Mirrors Rust's `HubConfig`
 *  (`serde rename_all = "camelCase"`). */
export interface HubConfig {
  /** Whether this instance runs as a Hub (docker `CONCORD_HUB=1`). */
  enabled: boolean;
  /** Whether a Hub defaults the libp2p connection gate enforce flag ON. */
  enforceGateDefault: boolean;
  /** Whether a Hub keeps the swarm always-scanning. */
  alwaysScan: boolean;
}

/** Result of a local claim-ciphertext build. Mirrors Rust's
 *  `HubClaimPayload` (`serde rename_all = "camelCase"`). The
 *  `ciphertextB64` is the opaque envelope to upload to the Hub — the Hub
 *  stores it verbatim and can never decrypt it. */
export interface HubClaimPayload {
  /** Base64 of the AEAD ciphertext envelope to upload to the Hub. */
  ciphertextB64: string;
  /** Byte length of the ciphertext. */
  sizeBytes: number;
  /** Hub peer-id this payload was sealed for. */
  hubPeerId: string;
}

/** Read this instance's Hub config. On web, returns a disabled config
 *  (a browser build is never a Hub). */
export async function hubStatus(): Promise<HubConfig> {
  if (!isTauri()) {
    return { enabled: false, enforceGateDefault: true, alwaysScan: true };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<HubConfig>("hub_status");
}

/** Back up the local superuser keychain to a Hub.
 *
 *  Builds the passphrase-encrypted ciphertext locally and returns the
 *  opaque envelope to upload to `hubPeerId`. The passphrase never leaves
 *  this device. Throws on the web build (native-only). */
export async function hubClaim(
  passphrase: string,
  hubPeerId: string,
): Promise<HubClaimPayload> {
  if (!isTauri()) {
    throw new Error("hub_claim is native-only");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<HubClaimPayload>("hub_claim", {
    passphrase,
    hubPeerId,
  });
}

/** Restore a superuser keychain on a new device.
 *
 *  DESTRUCTIVE: decrypts `ciphertextB64` with `passphrase` and overwrites
 *  the local porch DB. `expectedHubPeerId` binds the restore to the Hub
 *  the ciphertext was sealed for; pass an empty string to opt out (e.g. an
 *  offline restore from a saved package). Throws on the web build. */
export async function hubRestore(
  passphrase: string,
  ciphertextB64: string,
  expectedHubPeerId: string,
): Promise<void> {
  if (!isTauri()) {
    throw new Error("hub_restore is native-only");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke<void>("hub_restore", {
    passphrase,
    ciphertextB64,
    expectedHubPeerId,
  });
}
