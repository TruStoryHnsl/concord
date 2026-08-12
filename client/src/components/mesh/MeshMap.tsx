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
 * Web / docker build: there is no local swarm, so `fetchMeshGraph` sources
 * the graph over HTTP from `GET /api/mesh/topology` (the docker node's
 * federation-derived topology + hub relay/backup role), and the
 * subscription polls that endpoint on a timer. The map renders the same
 * way as native — the docker hub at the center, its federated neighbors at
 * hop 1 — plus a hub-role banner. See `client/src/api/meshGraph.ts` and
 * `server/routers/mesh.py`.
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
import {
  toReticulumMeshNodes,
  toReticulumMeshEdges,
} from "./reticulumLayer";
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
  // The Reticulum layer graph (F7a) — live rnsd discovery, populated when its
  // connector is enabled and the Reticulum layer toggle is on.
  const [reticulumGraph, setReticulumGraph] =
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
    if (!isNative) {
      // Web/docker: the instance's own pillar node IS the reticulum
      // connector. When it reports running, the Reticulum layer is
      // available and fetchConnectorLayerGraph serves it from
      // /api/reticulum/mesh (identity + interfaces + announce table).
      try {
        const g = await fetchConnectorLayerGraph("reticulum");
        const avail = new Set<MeshLayerId>(["concord"]);
        if (g.nodes.length > 0) avail.add("reticulum");
        setAvailableLayers(avail);
        setEnabledLayers((prev) => {
          const next = new Set<MeshLayerId>(prev);
          if (avail.has("reticulum")) next.add("reticulum");
          next.add("concord");
          return next;
        });
      } catch {
        /* pillar off — concord layer only */
      }
      return;
    }
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

  // Fetch the Reticulum layer graph when its layer is enabled, and keep it
  // current: Reticulum discovery is live (rnsd's rnpath poll), so while the
  // layer is on we re-pull on a timer (the libp2p `mesh_graph_changed` push
  // event doesn't fire for Reticulum topology moves). Empty + no polling when
  // the layer is off — the canvas just shows the other layers.
  const reticulumOn = enabledLayers.has("reticulum");
  const refetchReticulum = useCallback(async () => {
    // Works on BOTH native (engine connector graph) and web (the
    // instance pillar's /api/reticulum/mesh) — the docker instance is a
    // real reticulum node, not a native-only feature.
    if (!reticulumOn) {
      setReticulumGraph(EMPTY_MESH_GRAPH);
      return;
    }
    try {
      setReticulumGraph(await fetchConnectorLayerGraph("reticulum"));
    } catch (err) {
      console.warn("[MeshMap] reticulum layer fetch failed:", err);
      setReticulumGraph(EMPTY_MESH_GRAPH);
    }
  }, [isNative, reticulumOn]);

  useEffect(() => {
    void refetchReticulum();
    if (!reticulumOn) return;
    const handle = setInterval(() => void refetchReticulum(), 5000);
    return () => clearInterval(handle);
  }, [refetchReticulum, isNative, reticulumOn]);

  // Hydrate once: local peer id (center node) + initial snapshot. Runs on
  // BOTH native and web. On native, the local peer id comes from the swarm
  // status command; on web there is no swarm, so the center node renders
  // from the server-assembled topology (its hop-0 node IS this instance)
  // and the instance-name label.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (isNative) {
        try {
          const status = await fetchPeerSwarmStatus();
          if (!cancelled) setOurPeerId(status.ourPeerId);
        } catch {
          // Swarm not up — center node still renders with the instance name.
        }
      }
      if (!cancelled) await refetch();
    })();
    return () => {
      cancelled = true;
    };
  }, [isNative, refetch]);

  // Keep current. Native: debounced re-pull on the `mesh_graph_changed`
  // push event. Web: the subscription polls the HTTP topology endpoint on
  // a timer (see `subscribeToMeshGraph`), firing the same re-pull. The
  // local-spring re-pull is native-only (no swarm on web).
  useEffect(() => {
    const unsub = subscribeToMeshGraph(() => {
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => {
        void refetch();
        if (isNative) void refetchSpring();
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
      // Spec B — a web-threaded peer the docker pillar relays. Rendered
      // distinctly (its own kind/color) and labeled "via pillar" so it
      // reads apart from a direct p2p neighbor.
      const isWebThreaded = n.kind === "web_threaded" || n.via === "pillar";
      // WS-8 — a peer reached LAN-like through a WireGuard tunnel. Shown as a
      // reachable "via tunnel" node (kind "known", never a distant island),
      // and always surfaced regardless of the hop-scale window since it's a
      // live tunnel-backed connection.
      const isViaWg = n.viaWg === true;
      // A one-hop-up node the spring surfaced is shown even if it sits
      // beyond the slider window — exposing it IS the point of the
      // governance opt-in. Other nodes respect the hop-scale filter.
      if (hop > hopScale && !isOneHopUp && !isViaWg) continue;
      out.push({
        id: n.peerId,
        label: isWebThreaded
          ? `${shortPeerId(n.peerId)} · via pillar`
          : isViaWg
            ? `${shortPeerId(n.peerId)} · via tunnel`
            : isOneHopUp
              ? `${shortPeerId(n.peerId)} · via ${reachedVia}`
              : shortPeerId(n.peerId),
        hop,
        // W1.1 has no per-node trust info in the topology graph itself
        // (that's F3's peer-store cross-ref, a follow-up). Web-threaded
        // pillar peers get the distinct `pillar` kind; everything else is
        // "known" for now (the kind contract is stable so a trust badge
        // can be layered in without a canvas change).
        kind: isWebThreaded ? "pillar" : "known",
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

    // F7a — overlay the Reticulum layer when enabled. Node ids are namespaced
    // (`reticulum:<hash>`) so they never collide with Concord base58 ids; the
    // raw hash is the identicon seed + short label. Each node carries its
    // Reticulum sub-kind (self / infrastructure / announce-peer / interface),
    // reachability, hop count and transport flag so MeshCanvas draws the
    // distinct treatment (identicon discs, transit squares, dashed offline).
    if (reticulumOn) {
      const seen = new Set(out.map((n) => n.id));
      for (const rn of toReticulumMeshNodes(reticulumGraph)) {
        if (seen.has(rn.id)) continue;
        out.push(rn);
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
    reticulumOn,
    reticulumGraph,
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
    // F7a — Reticulum layer edges. Endpoints are namespaced to match the
    // overlaid node ids; an edge to an offline node renders dashed (crosstalk
    // convention — MeshCanvas also dashes automatically when an endpoint node
    // is `offline`, this flag makes the intent explicit).
    if (reticulumOn) {
      const offlineIds = new Set(
        nodes.filter((n) => n.offline).map((n) => n.id),
      );
      for (const e of toReticulumMeshEdges(reticulumGraph, offlineIds)) {
        if (visible.has(e.from) && visible.has(e.to)) out.push(e);
      }
    }
    return out;
  }, [
    graph,
    nodes,
    concordOn,
    meshtasticOn,
    meshtasticGraph,
    reticulumOn,
    reticulumGraph,
  ]);

  const toggleLayer = useCallback((id: MeshLayerId) => {
    setEnabledLayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (!hydrated) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <BringingUpSplash size="compact" status="Mapping the mesh…" />
      </div>
    );
  }

  // Count of non-host nodes currently visible.
  const visiblePeerCount = nodes.filter((n) => n.kind !== "host").length;

  // F7a — Reticulum layer header stats (crosstalk's infra / people / iface
  // counts). Derived from the raw layer graph so they reflect the whole
  // discovered neighborhood, independent of the hop-scale view filter.
  const reticulumStats = {
    infrastructure: reticulumGraph.nodes.filter(
      (n) => n.nodeKind === "infrastructure",
    ).length,
    people: reticulumGraph.nodes.filter((n) => n.nodeKind === "announce-peer")
      .length,
    interfaces: reticulumGraph.nodes.filter((n) => n.nodeKind === "interface")
      .length,
    offline: reticulumGraph.nodes.filter(
      (n) => n.connectionState === "offline",
    ).length,
  };

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
        {/* F7a — Reticulum layer stats (infra / people / interfaces / offline),
            crosstalk's header vocabulary. Only shown when the Reticulum layer
            is on. */}
        {reticulumOn && (
          <div
            data-testid="mesh-reticulum-stats"
            className="flex items-center gap-2 flex-wrap text-[10px] font-label uppercase tracking-widest text-on-surface-variant"
          >
            <span className="px-2 py-0.5 rounded bg-surface-variant/40">
              {reticulumStats.infrastructure} infrastructure
            </span>
            <span className="px-2 py-0.5 rounded bg-surface-variant/40">
              {reticulumStats.people} people
            </span>
            <span className="px-2 py-0.5 rounded bg-surface-variant/40">
              {reticulumStats.interfaces} interface
              {reticulumStats.interfaces === 1 ? "" : "s"}
            </span>
            {reticulumStats.offline > 0 && (
              <span className="px-2 py-0.5 rounded bg-error/15 text-error">
                {reticulumStats.offline} offline
              </span>
            )}
          </div>
        )}
        {/* Web/docker hub-role banner. The browser sources the graph over
            HTTP from the docker node, which acts as the mesh's relay +
            encrypted-backup "big brother". Surface that role so the map
            explains why this node matters. Native installs are not hubs,
            so this is web-only and only shows when hub data is present. */}
        {!isNative && graph.hub && (
          <div
            data-testid="mesh-hub-banner"
            className="flex items-center gap-2 flex-wrap text-[10px] font-label uppercase tracking-widest"
          >
            <span
              className={
                graph.hub.relay
                  ? "px-2 py-0.5 rounded bg-primary/15 text-primary"
                  : "px-2 py-0.5 rounded bg-surface-variant/40 text-on-surface-variant/60"
              }
            >
              {graph.hub.relay ? "Relay active" : "Relay off"}
            </span>
            <span className="px-2 py-0.5 rounded bg-surface-variant/40 text-on-surface-variant">
              {graph.hub.backupBlobCount} encrypted backup
              {graph.hub.backupBlobCount === 1 ? "" : "s"}
            </span>
            <span className="text-on-surface-variant/40 normal-case tracking-normal">
              topology via {graph.hub.source === "rust_snapshot" ? "swarm" : "federation"}
            </span>
          </div>
        )}
        {/* W1.3 / F4b — one-hop-up (local-spring) governance. Off by
            default; opt-in exposes LAN peers' remote neighbors at/above
            the selected trust tier, each labeled "via <lan-peer>". Native
            only — depends on the local swarm + LAN peer-store, which the
            browser has no access to. */}
        {isNative && (
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
        )}
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
