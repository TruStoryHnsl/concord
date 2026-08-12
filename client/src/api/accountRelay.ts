/**
 * WS-5 — account-relay API wrapper (docker account-services center).
 *
 * Thin wrappers around the three `account_relay_*` Tauri commands registered
 * in `src-tauri/src/lib.rs`. The account relay is the docker instance a user
 * DESIGNATES to hold their encrypted account bundle (keychain rows sealed under
 * the superuser seed) so a newly-linked device can SIGN IN and pull it:
 *
 *   - account_relay_designate — remember a trusted docker instance's libp2p
 *     peer-id as this device's account-services center.
 *   - account_relay_upload    — upload this device's account bundle + the
 *     authorized-device set to the designated relay.
 *   - account_relay_signin    — on a newly-linked device, download + apply the
 *     account bundle from the relay.
 *
 * All three are native-only — they drive the local porch + libp2p runtime,
 * which a browser build doesn't host. Each throws a clear native-only error on
 * web (the account-services center is a native/desktop feature). The bundle
 * bytes are opaque to the relay; the keychain rows are AEAD-sealed under the
 * superuser seed, so the relay never sees plaintext credentials.
 */

import { isTauri } from "./servitude";

/** Designate a trusted docker instance (by libp2p peer-id) as this device's
 *  account-services center. Native-only. */
export async function accountRelayDesignate(relayPeerId: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("account_relay_designate is native-only");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke<void>("account_relay_designate", { relayPeerId });
}

/** Upload this device's account bundle to the designated relay. The bundle is
 *  the primary profile's AEAD-sealed keychain + the authorized-device set.
 *  Native-only. */
export async function accountRelayUpload(relayPeerId: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("account_relay_upload is native-only");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke<void>("account_relay_upload", { relayPeerId });
}

/** Sign in on a newly-linked device: download + apply the account bundle from
 *  the relay. The relay grants it only because this device's Noise-authenticated
 *  peer-id is in the authorized set an existing device registered after linking
 *  it. Native-only. */
export async function accountRelaySignin(relayPeerId: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("account_relay_signin is native-only");
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke<void>("account_relay_signin", { relayPeerId });
}
