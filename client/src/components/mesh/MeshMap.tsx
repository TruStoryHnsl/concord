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
  fetchLocalSpring,
  subscribeToMeshGraph,
  maxHopDistance,
  EMPTY_MESH_GRAPH,
  EMPTY_LOCAL_SPRING,
  type MeshGraph,
  type LocalSpring,
  type SpringTier,
} from "../../api/meshGraph";
import { fetchPeerSwarmStatus } from "../../api/peerSwarm";
import {
  listConnectors,
  fetchConnectorLayerGraph,
} from "../../api/connectors";
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

  // Layer toggles. Concord on by default. External layers (F7) become
  // available once their connector is enabled in the Connectors settings;
  // `availableLayers` is driven by the connector registry below.
  const [enabledLayers, setEnabledLayers] = useState<Set<MeshLayerId>>(
    () => new Set<MeshLayerId>(["concord"]),
  );
  // Layers an enabled connector has registered (F7). Concord is always
  // available. Drives which LayerToggles are clickable.
  const [availableLayers, setAvailableLayers] = useState<Set<MeshLayerId>>(
    () => new Set<MeshLayerId>(["concord"]),
  );
  // The Meshtastic layer graph (W2.4) — populated when its connector is
  // enabled and the Meshtastic layer toggle is on.
  const [meshtasticGraph, setMeshtasticGraph] =
    useState<MeshGraph>(EMPTY_MESH_GRAPH);

  // W1.3 / F4b — local-spring (one-hop-up) governance. CONSERVATIVE
  // DEFAULT OFF: a fresh install does not surface friend-of-friend nodes.
  // The operator opts in here, choosing the minimum LAN-peer trust tier
  // whose remote neighbors get exposed.
  const [springEnabled, setSpringEnabled] = useState(false);
  const [springMinTier, setSpringMinTier] = useState<SpringTier>("friend");
  const [spring, setSpring] = useState<LocalSpring>(EMPTY_LOCAL_SPRING);

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

  // Re-pull the local-spring whenever governance changes OR the graph
  // moves. When disabled, the native command short-circuits to empty.
  const refetchSpring = useCallback(async () => {
    try {
      const s = await fetchLocalSpring(springEnabled, springMinTier);
      setSpring(s);
    } catch (err) {
      console.warn("[MeshMap] local-spring fetch failed:", err);
      setSpring(EMPTY_LOCAL_SPRING);
    }
  }, [springEnabled, springMinTier]);

  useEffect(() => {
    if (!isNative) return;
    void refetchSpring();
  }, [isNative, refetchSpring]);

  // Load the connector registry → which external-mesh layers are available
  // (a layer is available iff its connector is enabled). Concord is always
  // available.
  const refreshAvailableLayers = useCallback(async () => {
    if (!isNative) return;
    try {
      const connectors = await listConnectors();
      const avail = new Set<MeshLayerId>(["concord"]);
      for (const c of connectors) {
        if (c.enabled) avail.add(c.id);
      }
      setAvailableLayers(avail);
      // Drop any enabled layer that is no longer available (connector
      // disabled out from under us).
      setEnabledLayers((prev) => {
        const next = new Set<MeshLayerId>();
        for (const id of prev) if (avail.has(id)) next.add(id);
        next.add("concord");
        return next;
      });
    } catch (err) {
      console.warn("[MeshMap] connector list failed:", err);
    }
  }, [isNative]);

  useEffect(() => {
    void refreshAvailableLayers();
  }, [refreshAvailableLayers]);

  // Fetch the Meshtastic layer graph when its layer is enabled. Empty when
  // the layer is off (no fetch) — the canvas just shows the Concord layer.
  const meshtasticOn = enabledLayers.has("meshtastic");
  const refetchMeshtastic = useCallback(async () => {
    if (!isNative || !meshtasticOn) {
      setMeshtasticGraph(EMPTY_MESH_GRAPH);
      return;
    }
    try {
      setMeshtasticGraph(await fetchConnectorLayerGraph("meshtastic"));
    } catch (err) {
      console.warn("[MeshMap] meshtastic layer fetch failed:", err);
      setMeshtasticGraph(EMPTY_MESH_GRAPH);
    }
  }, [isNative, meshtasticOn]);

  useEffect(() => {
    void refetchMeshtastic();
  }, [refetchMeshtastic]);

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
        void refetchSpring();
      }, 300);
    });
    return () => {
      unsub();
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
    };
  }, [isNative, refetch, refetchSpring]);

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
  // W1.3 — reached-via lookup: for each one-hop-up node the spring
  // surfaced, the (short) LAN peer it's reached through. Empty unless
  // governance is enabled (the native command short-circuits to empty).
  const reachedViaByPeer = useMemo<Map<string, string>>(() => {
    const m = new Map<string, string>();
    for (const n of spring.nodes) {
      if (!m.has(n.peerId)) m.set(n.peerId, shortPeerId(n.reachedVia));
    }
    return m;
  }, [spring]);

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
      const reachedVia = reachedViaByPeer.get(n.peerId);
      const isOneHopUp = reachedVia != null;
      // A one-hop-up node the spring surfaced is shown even if it sits
      // beyond the slider window — exposing it IS the point of the
      // governance opt-in. Other nodes respect the hop-scale filter.
      if (hop > hopScale && !isOneHopUp) continue;
      out.push({
        id: n.peerId,
        label: isOneHopUp
          ? `${shortPeerId(n.peerId)} · via ${reachedVia}`
          : shortPeerId(n.peerId),
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

    // W2.4 — overlay the Meshtastic layer when enabled. Its node ids are
    // namespaced (`meshtastic:<num>`) so they never collide with Concord
    // base58 ids. Rendered as "known" nodes (no per-node trust on an open
    // mesh); the radio at hop 0 is the layer's center.
    if (meshtasticOn) {
      const seen = new Set(out.map((n) => n.id));
      for (const n of meshtasticGraph.nodes) {
        if (seen.has(n.peerId)) continue;
        const hop = n.hopDistance ?? 1;
        out.push({
          id: n.peerId,
          label: n.peerId.replace(/^meshtastic:/, "📡 "),
          hop,
          kind: "known",
        });
      }
    }
    return out;
  }, [
    graph,
    concordOn,
    hopScale,
    instanceName,
    localId,
    reachedViaByPeer,
    meshtasticOn,
    meshtasticGraph,
  ]);

  // Edges, filtered to those whose BOTH endpoints survived the node
  // filter. MeshCanvas uses {from,to}; our graph uses {a,b}.
  const edges = useMemo<MeshEdge[]>(() => {
    const visible = new Set(nodes.map((n) => n.id));
    const out: MeshEdge[] = [];
    if (concordOn) {
      for (const e of graph.edges) {
        if (visible.has(e.a) && visible.has(e.b)) out.push({ from: e.a, to: e.b });
      }
    }
    // W2.4 — Meshtastic layer edges (namespaced ids, no collision).
    if (meshtasticOn) {
      for (const e of meshtasticGraph.edges) {
        if (visible.has(e.a) && visible.has(e.b)) out.push({ from: e.a, to: e.b });
      }
    }
    return out;
  }, [graph, nodes, concordOn, meshtasticOn, meshtasticGraph]);

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
          <LayerToggles
            enabled={enabledLayers}
            onToggle={toggleLayer}
            availableOverride={availableLayers}
          />
          <span className="text-xs text-on-surface-variant font-label">
            {!concordOn
              ? "Concord layer off"
              : visiblePeerCount === 0
                ? "No mesh peers in range"
                : `${visiblePeerCount} node${visiblePeerCount === 1 ? "" : "s"} within ${hopScale} hop${hopScale === 1 ? "" : "s"}`}
          </span>
        </div>
        {/* W1.3 / F4b — one-hop-up (local-spring) governance. Off by
            default; opt-in exposes LAN peers' remote neighbors at/above
            the selected trust tier, each labeled "via <lan-peer>". */}
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 text-[10px] font-label uppercase tracking-widest text-on-surface-variant whitespace-nowrap cursor-pointer">
            <input
              type="checkbox"
              data-testid="mesh-spring-toggle"
              checked={springEnabled}
              onChange={(e) => setSpringEnabled(e.target.checked)}
              className="accent-primary"
            />
            One-hop-up
          </label>
          <select
            data-testid="mesh-spring-tier"
            value={springMinTier}
            disabled={!springEnabled}
            onChange={(e) => setSpringMinTier(e.target.value as SpringTier)}
            className="text-xs font-label bg-surface-variant/40 rounded px-2 py-1 text-on-surface disabled:opacity-40"
            aria-label="Minimum trust tier for one-hop-up exposure"
          >
            <option value="friend">Friends+</option>
            <option value="close_friend">Close friends+</option>
            <option value="supertrusted">Supertrusted only</option>
          </select>
          <span className="text-[10px] font-label text-on-surface-variant/60">
            {springEnabled
              ? `${spring.nodes.length} one-hop-up`
              : "friend-of-friend off"}
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
