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

export function PeersPanel() {
  const [pairOpen, setPairOpen] = useState(false);
  const beginPair = useProximityPairStore((s) => s.begin);

  async function onTapToPair() {
    setPairOpen(true);
    // Present our Ed25519-signed local card so the remote can verify us at
    // commit time. On a non-Tauri build this returns null and the sheet shows
    // the "needs a phone with Bluetooth" unsupported state.
    const local = (await fetchLocalPairingCard()) ?? {
      peerId: "",
      publicKeyHex: "",
      multiaddrs: [],
      signatureHex: "",
    };
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
