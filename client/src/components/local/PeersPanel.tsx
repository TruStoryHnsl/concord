/**
 * PeersPanel — the local source's `peers` pseudo-channel.
 *
 * The reachable, on-mobile entry point for initiating a peer connection.
 * Mirrors how `mesh` / `lan_map` render as special chat-pane surfaces in the
 * local source. Pairing UI previously lived ONLY in Settings → Connections,
 * gated behind a Matrix accessToken, so a native install on the local porch
 * had no way to start a pairing — this surfaces it directly.
 *
 * Renders:
 *   - a "Pair a device" button that fetches this device's signed local card
 *     and starts the proximity (BLE) pairing flow, then the `TapToPairSheet`
 *     overlay drives confirm/cancel + shows the SAS code;
 *   - the `KnownPeersList` with Connect / Call so a freshly-paired peer can
 *     be dialed without leaving this view.
 */
import { useState } from "react";
import { KnownPeersList } from "../peers/KnownPeersList";
import { TapToPairSheet } from "../peers/TapToPairSheet";
import { useProximityPairStore } from "../../stores/proximityPair";
import { fetchLocalPairingCard } from "../../api/proximityPair";
import { servitudeStart, isTauri } from "../../api/servitude";
import { fetchPeerSwarmStatus } from "../../api/peerSwarm";

/**
 * Pairing needs a running P2P swarm (for our peer id + dial-back multiaddrs).
 * On the local porch the swarm isn't started until the user hosts, so start it
 * here and wait for it to bind a peer id before building the pairing card.
 */
async function ensureSwarmReady(): Promise<void> {
  if (!isTauri()) return;
  // Start the swarm if it isn't already — idempotent (the backend errors
  // "already running" when it is, which is success for our purposes).
  try {
    await servitudeStart();
  } catch (e) {
    if (!/already running/i.test(String(e))) throw e;
  }
  // Require a peer id (needed to build the card). Prefer also having a listen
  // multiaddr (for dial-back), but don't BLOCK pairing if the swarm hasn't bound
  // one — that only affects Connect/Call, not the BLE handshake itself.
  let peerSinceTick = -1;
  for (let i = 0; i < 60; i++) {
    let s: { ourPeerId: string; ourMultiaddrs: string[] } | null = null;
    try {
      s = await fetchPeerSwarmStatus();
    } catch {
      /* keep polling */
    }
    if (s?.ourPeerId) {
      if (s.ourMultiaddrs.length > 0) return; // ideal: have a dial-back address
      if (peerSinceTick < 0) peerSinceTick = i;
      if (i - peerSinceTick >= 10) return; // ~5s grace for an addr, then proceed
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("swarm did not start in time");
}

export function PeersPanel() {
  const [pairOpen, setPairOpen] = useState(false);
  const beginPair = useProximityPairStore((s) => s.begin);

  async function onTapToPair() {
    setPairOpen(true);
    // Show progress while the swarm spins up (can take a few seconds).
    useProximityPairStore.setState({ phase: "searching", error: null });
    let local;
    try {
      await ensureSwarmReady();
      local = (await fetchLocalPairingCard()) ?? {
        peerId: "",
        publicKeyHex: "",
        multiaddrs: [],
        signatureHex: "",
      };
    } catch (e) {
      useProximityPairStore.setState({
        phase: "error",
        error: `setup failed: ${String(e)}`,
      });
      return;
    }
    await beginPair(local);
  }

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="peers-panel">
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-shrink-0 border-b border-outline-variant/40">
        <div>
          <h3 className="text-sm font-medium text-on-surface">Peers</h3>
          <p className="text-xs text-on-surface-variant">
            Pair another device nearby, then connect or call.
          </p>
        </div>
        <button
          type="button"
          onClick={onTapToPair}
          data-testid="peers-panel-tap-to-pair"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-on-primary hover:bg-primary/90"
        >
          <span className="material-symbols-rounded text-base">bluetooth_searching</span>
          Pair a device
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4">
        <KnownPeersList />
      </div>

      <TapToPairSheet open={pairOpen} onClose={() => setPairOpen(false)} />
    </div>
  );
}
