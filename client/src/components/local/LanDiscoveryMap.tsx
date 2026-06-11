/**
 * LanDiscoveryMap — the LAN-peer map surface (Wave-0 W0.3 / Feature F1).
 *
 * Renders the local host at the center of a [`MeshCanvas`] with every
 * mDNS-discovered LAN peer as a hop=1 node around it. This is the "channel
 * pane" content for the `lan_map` pseudo-channel in the local source's
 * sidebar (see `LocalChannelSidebar`).
 *
 * Data flow (mirrors the rest of the LAN-peer surfaces):
 *   1. **Hydrate** on mount via the native `lan_peers_snapshot` command
 *      (`fetchLanPeersSnapshot`) — a one-shot enriched read that carries
 *      the known/paired badge + Identify vanity name.
 *   2. **Stay current** by subscribing to the push-side
 *      `peer_lan_discovered` event (`subscribeToLanPeers`). A new discovery
 *      triggers a cheap re-fetch of the enriched snapshot so badges stay
 *      accurate (the push event alone lacks them). Debounced so a burst of
 *      announcements coalesces into one snapshot read.
 *
 * Web build: the browser has no swarm, so this renders the same "web mode"
 * empty state the rest of the local surfaces use — there is nothing to map.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "../../api/servitude";
import {
  fetchLanPeersSnapshot,
  subscribeToLanPeers,
  vanityNameFromAgentVersion,
  type LanPeerSnapshot,
} from "../../api/lanPeers";
import { fetchPeerSwarmStatus } from "../../api/peerSwarm";
import { useInstanceNameStore } from "../../stores/instanceName";
import { MeshCanvas, type MeshNode } from "../mesh/MeshCanvas";
import { BringingUpSplash } from "../BringingUpSplash";

/** Shorten a base58 peer id for a node label fallback. */
function shortPeerId(peerId: string): string {
  return peerId.length > 10
    ? `${peerId.slice(0, 6)}…${peerId.slice(-4)}`
    : peerId;
}

/** Best display label for a LAN peer: vanity name if known, else short id. */
function peerLabel(p: LanPeerSnapshot): string {
  return vanityNameFromAgentVersion(p.agentVersion) ?? shortPeerId(p.peerId);
}

export function LanDiscoveryMap() {
  const isNative = isTauri();
  const instanceName = useInstanceNameStore((s) => s.name);

  const [peers, setPeers] = useState<LanPeerSnapshot[]>([]);
  const [ourPeerId, setOurPeerId] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);

  // Debounce timer for snapshot re-fetches driven by the event stream.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    try {
      const snap = await fetchLanPeersSnapshot();
      setPeers(snap);
    } catch (err) {
      // Non-fatal — keep whatever we last had. The command rejects only
      // on a hard IPC failure; an empty LAN is a successful empty array.
      console.warn("[LanDiscoveryMap] snapshot fetch failed:", err);
    } finally {
      setHydrated(true);
    }
  }, []);

  // Hydrate once: peer id (for the center node) + the initial snapshot.
  useEffect(() => {
    if (!isNative) {
      setHydrated(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const status = await fetchPeerSwarmStatus();
        if (!cancelled) setOurPeerId(status.ourPeerId);
      } catch {
        // Swarm not up yet — the host node still renders with the
        // instance name; peer id is cosmetic for the center node.
      }
      if (!cancelled) await refetch();
    })();
    return () => {
      cancelled = true;
    };
  }, [isNative, refetch]);

  // Keep current from the push event. We don't consume the event's payload
  // directly (it lacks badges); we use it as a signal to re-pull the
  // enriched snapshot, debounced so an announcement burst is one read.
  useEffect(() => {
    if (!isNative) return;
    const unsub = subscribeToLanPeers(() => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => {
        void refetch();
      }, 300);
    });
    return () => {
      unsub();
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    };
  }, [isNative, refetch]);

  // Build the node set: host at center (hop 0), peers at hop 1.
  const nodes = useMemo<MeshNode[]>(() => {
    const hostLabel = instanceName.trim() || "This device";
    const host: MeshNode = {
      id: ourPeerId || "__host__",
      label: hostLabel,
      hop: 0,
      kind: "host",
    };
    const peerNodes: MeshNode[] = peers.map((p) => ({
      id: p.peerId,
      label: peerLabel(p),
      hop: 1,
      kind: p.paired ? "paired" : p.known ? "known" : "unknown",
    }));
    return [host, ...peerNodes];
  }, [peers, ourPeerId, instanceName]);

  if (!isNative) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-2">
        <p className="text-sm text-on-surface-variant font-body">
          This device is in web mode
        </p>
        <p className="text-xs text-on-surface-variant/60 font-label max-w-xs">
          The LAN discovery map needs the native mesh, which lives on your
          desktop or mobile install. The browser can&apos;t see peers on
          your local network.
        </p>
      </div>
    );
  }

  if (!hydrated) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <BringingUpSplash size="compact" status="Scanning your LAN…" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="px-4 py-2 flex items-center gap-3 flex-shrink-0">
        <span className="text-xs text-on-surface-variant font-label">
          {peers.length === 0
            ? "No peers found on your LAN yet"
            : `${peers.length} peer${peers.length === 1 ? "" : "s"} on your LAN`}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <MeshCanvas nodes={nodes} />
      </div>
    </div>
  );
}
