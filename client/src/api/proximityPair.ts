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
  | { phase: "paired"; peerId: string }
  | { phase: "error"; stage: string; message: string }
  | { phase: "unsupported" };

export async function startProximityPair(
  payload: LocalPairingPayload,
  onState: (s: ProximityPairState) => void,
): Promise<unknown | null> {
  if (!isTauri()) {
    onState({ phase: "unsupported" });
    return null;
  }
  const { invoke, Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<ProximityPairState>();
  channel.onmessage = (s) => onState(s);
  await invoke("plugin:proximity-pair|proximity_pair_start", { payload, onState: channel });
  return channel;
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
