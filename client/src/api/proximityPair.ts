/**
 * Proximity ("tap to pair") pairing API wrapper.
 *
 * Mirrors the peerStore.ts / lanPeers.ts patterns: explicit field copy
 * (never spread the wire payload — defence in depth), and `isTauri()`
 * guarding so a plain browser build degrades to an `unsupported` state
 * instead of throwing.
 *
 * Plugin command names are prefixed `plugin:proximity-pair|<cmd>` — the
 * Tauri v2 convention for commands registered by a named plugin.
 */
import { isTauri } from "./servitude";

export interface LocalPairingPayload {
  peerId: string;
  publicKeyHex: string;
  multiaddrs: string[];
  signatureHex: string;
}

export type ProximityPairState =
  | { phase: "idle" }
  | { phase: "searching" }
  | { phase: "connecting" }
  | { phase: "awaitingConfirm"; code: string }
  | {
      phase: "paired";
      peerId: string;
      publicKeyHex: string;
      multiaddrs: string[];
      signatureHex: string;
    }
  | { phase: "error"; stage: string; message: string }
  | { phase: "unsupported" };

/**
 * Fetch the local device's Ed25519-signed pairing card from the host. Must be
 * called before `startProximityPair` so the transport can hand the remote a
 * card it can verify (`verify_card_signature` gates the remote's commit).
 * Returns null on a non-Tauri build (no identity/swarm there).
 */
export async function fetchLocalPairingCard(): Promise<LocalPairingPayload | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<LocalPairingPayload>("proximity_pair_local_card");
}

export async function startProximityPair(
  payload: LocalPairingPayload,
  onState: (s: ProximityPairState) => void,
): Promise<unknown | null> {
  if (!isTauri()) {
    onState({ phase: "unsupported" });
    return null;
  }
  const { invoke, Channel, addPluginListener } = await import("@tauri-apps/api/core");
  // Register the plugin-event listener first, but never let it block the
  // command invoke (its await previously could stall the whole flow on iOS).
  addPluginListener("proximity-pair", "ppState", (s) =>
    onState(s as ProximityPairState),
  ).catch(() => {});
  // The Rust command reports its outcome over this Channel (reliable on every
  // platform); on desktop it also streams the mock states here.
  const channel = new Channel<ProximityPairState>();
  channel.onmessage = (s) => onState(s);
  await invoke("plugin:proximity-pair|proximity_pair_start", { payload, onState: channel });
  return channel;
}

/**
 * Poll the current pairing state. On iOS the Swift→JS event push is unreliable,
 * so the store polls this (Rust→Swift via run_mobile_plugin, which is reliable)
 * to drive the UI. Returns null on a non-Tauri build.
 */
export async function pollProximityPair(): Promise<ProximityPairState | null> {
  if (!isTauri()) return null;
  const { invoke } = await import("@tauri-apps/api/core");
  return await invoke<ProximityPairState>("plugin:proximity-pair|proximity_pair_poll");
}

export async function confirmPairing(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("plugin:proximity-pair|proximity_pair_confirm");
}

export async function cancelPairing(): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("plugin:proximity-pair|proximity_pair_cancel");
}

/**
 * Persist a confirmed remote into the peer store under the `proximity`
 * source. Calls the host `proximity_pair_commit` command (Stronghold lives
 * in the host app, not the plugin). Returns the resulting known-peer id.
 */
export async function commitPairedPeer(
  remote: LocalPairingPayload,
): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  const result = await invoke<{ peerId: string }>("proximity_pair_commit", {
    peerId: remote.peerId,
    publicKeyHex: remote.publicKeyHex,
    multiaddrs: remote.multiaddrs,
    source: "proximity",
    signatureHex: remote.signatureHex,
  });
  return result.peerId;
}
