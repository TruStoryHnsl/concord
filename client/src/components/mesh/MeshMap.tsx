/**
 * MeshMap — the N-hop mesh-topology map surface (Wave-1 W1.1 / Feature F2,
 * Concord layer).
 *
 * Renders the local host at the center of the shared [`MeshCanvas`] with
 * the assembled mesh graph laid out by hop ring. This is the chat-pane
 * content for the `mesh` pseudo-channel in the local source's sidebar (see
 * `LocalChannelSidebar`), mirroring how `LanDiscoveryMap` backs the
 * `lan_map` pseudo-channel.
 *
 * Controls:
 *   * **Hop-scale slider** — filters the graph to nodes within N hops of
 *     the local node. Drag it down to focus on the immediate neighborhood,
 *     up to reveal farther nodes. (The native side bounds the graph hard;
 *     this is a *view* filter on already-bounded data.)
 *   * **Layer toggles** — only the Concord layer is live in W1.1;
 *     external-mesh layers (Reticulum / Meshtastic / LoRa, F7) render
 *     disabled. Turning the Concord layer off blanks the map.
 *
 * Data flow (mirrors the LAN map):
 *   1. **Hydrate** on mount via `fetchMeshGraph` (one-shot snapshot).
 *   2. **Stay current** by subscribing to `mesh_graph_changed`; each
 *      notification triggers a debounced re-pull.
 *
 * Web build: no swarm, so this renders the shared "web mode" empty state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "../../api/servitude";
import {
  fetchMeshGraph,
  subscribeToMeshGraph,
  maxHopDistance,
  EMPTY_MESH_GRAPH,
  type MeshGraph,
} from "../../api/meshGraph";
import { fetchPeerSwarmStatus } from "../../api/peerSwarm";
import { useInstanceNameStore } from "../../stores/instanceName";
import {
  MeshCanvas,
  type MeshNode,
  type MeshEdge,
} from "./MeshCanvas";
import { LayerToggles, type MeshLayerId } from "./LayerToggles";
import { BringingUpSplash } from "../BringingUpSplash";

/** Shorten a base58 peer id for a node label. */
function shortPeerId(peerId: string): string {
  return peerId.length > 10
    ? `${peerId.slice(0, 6)}…${peerId.slice(-4)}`
    : peerId;
}

export function MeshMap() {
  const isNative = isTauri();
  const instanceName = useInstanceNameStore((s) => s.name);

  const [graph, setGraph] = useState<MeshGraph>(EMPTY_MESH_GRAPH);
  const [ourPeerId, setOurPeerId] = useState<string>("");
  const [hydrated, setHydrated] = useState(false);

  // Hop-scale filter: show nodes within this many hops. Starts at the
  // graph's max so the full neighborhood is visible; the user dials it
  // down to focus closer.
  const [hopScale, setHopScale] = useState(1);
  const userAdjustedHop = useRef(false);

  // Layer toggles. Concord on by default; external layers are disabled
  // placeholders (F7), so toggling them is a no-op until then.
  const [enabledLayers, setEnabledLayers] = useState<Set<MeshLayerId>>(
    () => new Set<MeshLayerId>(["concord"]),
  );

  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    try {
      const g = await fetchMeshGraph();
      setGraph(g);
      // Track the graph's max hop so the slider ceiling follows the data.
      // Only auto-raise the current scale to the new max if the user
      // hasn't manually dialed it — respect an explicit narrow view.
      if (!userAdjustedHop.current) {
        setHopScale(maxHopDistance(g));
      }
    } catch (err) {
      console.warn("[MeshMap] snapshot fetch failed:", err);
    } finally {
      setHydrated(true);
    }
  }, []);

  // Hydrate once: local peer id (center node) + initial snapshot.
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
        // Swarm not up — center node still renders with the instance name.
      }
      if (!cancelled) await refetch();
    })();
    return () => {
      cancelled = true;
    };
  }, [isNative, refetch]);

  // Keep current from the push event, debounced.
  useEffect(() => {
    if (!isNative) return;
    const unsub = subscribeToMeshGraph(() => {
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

  const concordOn = enabledLayers.has("concord");
  const graphMaxHop = useMemo(() => maxHopDistance(graph), [graph]);

  // The id the Rust side uses for the local node (its base58 peer id);
  // fall back to a stable sentinel so the host node renders pre-swarm.
  const localId = ourPeerId || "__host__";

  // Build the canvas node set, filtered by the hop-scale slider + the
  // Concord layer toggle. The local node is always shown (it IS the
  // viewer). Unreachable nodes (hopDistance == null) are hidden — they're
  // adversarial-island artifacts, not part of the operator's reachable
  // mesh.
  const nodes = useMemo<MeshNode[]>(() => {
    if (!concordOn) return [];
    const hostLabel = instanceName.trim() || "This device";
    const out: MeshNode[] = [];
    for (const n of graph.nodes) {
      const hop = n.hopDistance;
      const isLocal = n.peerId === localId || hop === 0;
      if (isLocal) {
        out.push({ id: n.peerId, label: hostLabel, hop: 0, kind: "host" });
        continue;
      }
      if (hop == null) continue; // unreachable island — drop
      if (hop > hopScale) continue; // beyond the slider window
      out.push({
        id: n.peerId,
        label: shortPeerId(n.peerId),
        hop,
        // W1.1 has no per-node trust info in the topology graph itself
        // (that's F3's peer-store cross-ref, a follow-up). Render every
        // non-host node as "known" for now; the kind contract is stable
        // so the trust badge can be layered in without a canvas change.
        kind: "known",
      });
    }
    // Guarantee a host node even if the snapshot is empty (pre-swarm).
    if (!out.some((n) => n.kind === "host")) {
      out.unshift({ id: localId, label: hostLabel, hop: 0, kind: "host" });
    }
    return out;
  }, [graph, concordOn, hopScale, instanceName, localId]);

  // Edges, filtered to those whose BOTH endpoints survived the node
  // filter. MeshCanvas uses {from,to}; our graph uses {a,b}.
  const edges = useMemo<MeshEdge[]>(() => {
    if (!concordOn) return [];
    const visible = new Set(nodes.map((n) => n.id));
    return graph.edges
      .filter((e) => visible.has(e.a) && visible.has(e.b))
      .map((e) => ({ from: e.a, to: e.b }));
  }, [graph, nodes, concordOn]);

  const toggleLayer = useCallback((id: MeshLayerId) => {
    setEnabledLayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (!isNative) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-2">
        <p className="text-sm text-on-surface-variant font-body">
          This device is in web mode
        </p>
        <p className="text-xs text-on-surface-variant/60 font-label max-w-xs">
          The mesh map needs the native swarm, which lives on your desktop
          or mobile install. The browser can&apos;t see the mesh topology.
        </p>
      </div>
    );
  }

  if (!hydrated) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <BringingUpSplash size="compact" status="Mapping the mesh…" />
      </div>
    );
  }

  // Count of non-host nodes currently visible.
  const visiblePeerCount = nodes.filter((n) => n.kind !== "host").length;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Controls row: layer toggles + hop slider + count. */}
      <div className="px-4 py-2 flex flex-col gap-2 flex-shrink-0 border-b border-outline-variant/40">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <LayerToggles enabled={enabledLayers} onToggle={toggleLayer} />
          <span className="text-xs text-on-surface-variant font-label">
            {!concordOn
              ? "Concord layer off"
              : visiblePeerCount === 0
                ? "No mesh peers in range"
                : `${visiblePeerCount} node${visiblePeerCount === 1 ? "" : "s"} within ${hopScale} hop${hopScale === 1 ? "" : "s"}`}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <label
            htmlFor="mesh-hop-slider"
            className="text-[10px] font-label uppercase tracking-widest text-on-surface-variant whitespace-nowrap"
          >
            Hops
          </label>
          <input
            id="mesh-hop-slider"
            data-testid="mesh-hop-slider"
            type="range"
            min={1}
            max={Math.max(1, graphMaxHop)}
            step={1}
            value={Math.min(hopScale, Math.max(1, graphMaxHop))}
            disabled={!concordOn || graphMaxHop <= 1}
            onChange={(e) => {
              userAdjustedHop.current = true;
              setHopScale(Number(e.target.value));
            }}
            className="flex-1 accent-primary disabled:opacity-40"
          />
          <span className="text-xs text-on-surface font-label w-6 text-right tabular-nums">
            {hopScale}
          </span>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <MeshCanvas nodes={nodes} edges={edges} />
      </div>
    </div>
  );
}
