/**
 * ReticulumSurface — the main-pane surface for a Reticulum source.
 *
 * Reticulum is not a Discord-shaped network: there are no servers,
 * channels, or member lists. This surface follows the Reticulum
 * framework's own concepts instead:
 *
 *   - **Network** — the announce/discovery topology, rendered through the
 *     shared MeshMap (native: the live rnsd discovery graph via the
 *     reticulum connector layer; web/docker: the pillar-relayed topology
 *     from `/api/mesh/topology`, which is scoped to the viewing account).
 *   - **Announces** — the identity-bearing announce peers currently known,
 *     with identicons, interface, hops, and reachability.
 *   - **Interfaces** — the rnsd interface configuration (TCP / UDP / I2P /
 *     RNode / serial …), reusing the settings panel.
 *
 * Which section renders is driven by `useReticulumSurfaceStore.tab`
 * (the ReticulumSidebar is the navigation for it).
 */

import { useCallback, useEffect, useState } from "react";
import { isTauri } from "../../api/servitude";
import { fetchConnectorLayerGraph } from "../../api/connectors";
import type { MeshGraph } from "../../api/meshGraph";
import { useReticulumSurfaceStore } from "../../stores/reticulumSurface";
import { usePeerMessengerSurfaceStore } from "../../stores/peerMessengerSurface";
import { useSourcesStore } from "../../stores/sources";
import { identiconDataUri } from "../mesh/identicon";
import { MeshMap } from "../mesh/MeshMap";
import { ReticulumInterfacesPanel } from "../settings/ReticulumInterfacesPanel";
import { ReticulumInstanceInterfaces } from "./ReticulumInstanceInterfaces";
import { ReticulumMessages } from "./ReticulumMessages";

const EMPTY_GRAPH: MeshGraph = { nodes: [], edges: [] };

function shortHash(hash: string): string {
  return hash.length > 10 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
}

function AnnouncesList() {
  const [graph, setGraph] = useState<MeshGraph>(EMPTY_GRAPH);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const g = await fetchConnectorLayerGraph("reticulum");
      setGraph(g);
    } catch (err) {
      console.warn("[ReticulumSurface] announce graph fetch failed:", err);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const announcePeers = graph.nodes.filter(
    (n) => (n.nodeKind ?? "announce-peer") === "announce-peer",
  );

  // Web: announces come live from this instance's pillar node
  // (`/api/reticulum/mesh`, folded into the reticulum layer graph).
  // Native: the embedded rnsd stack. Either way the rows are actionable.
  return (
    <div className="flex-1 overflow-y-auto p-4" data-testid="reticulum-announces">
      <h3 className="text-sm font-semibold text-on-surface mb-3">
        Announced destinations
      </h3>
      {announcePeers.length === 0 ? (
        <p className="text-xs text-on-surface-variant">
          {loaded
            ? "No announces heard yet. Announces propagate as peers speak on the pillar's configured interfaces."
            : "Listening…"}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {announcePeers.map((n) => (
            <li
              key={n.peerId}
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-container"
            >
              <img
                src={identiconDataUri(n.peerId)}
                alt=""
                className="w-8 h-8 rounded-md flex-shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-on-surface font-mono truncate">
                  {shortHash(n.peerId)}
                </div>
                <div className="text-[11px] text-on-surface-variant">
                  {n.interfaceType ?? "unknown interface"}
                  {typeof (n.hopCount ?? n.hopDistance) === "number" &&
                    ` · ${n.hopCount ?? n.hopDistance} hop${(n.hopCount ?? n.hopDistance) === 1 ? "" : "s"}`}
                  {n.transport && " · transport node"}
                </div>
              </div>
              {/* crosstalk-guided discovery→conversation: a discovered
                  announce-peer is actionable on BOTH builds — open its 1:1
                  conversation in the peer messenger (reticulum-keyed inbox).
                  Native: the send path rides the servitude link bridge.
                  Web: the D1 store + the pillar transport
                  (`/api/me/conversations/*`). */}
              <button
                type="button"
                title="Message this peer"
                data-testid={`announce-message-${n.peerId}`}
                onClick={() => {
                  useReticulumSurfaceStore.getState().close();
                  usePeerMessengerSurfaceStore
                    .getState()
                    .openConversation(`reticulum:${n.peerId}`);
                }}
                className="btn-press flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-lg">forum</span>
              </button>
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  n.connectionState === "offline"
                    ? "bg-on-surface-variant/40"
                    : "bg-green-500"
                }`}
                aria-label={n.connectionState === "offline" ? "Offline" : "Online"}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReticulumSurface() {
  const sourceId = useReticulumSurfaceStore((s) => s.sourceId);
  const tab = useReticulumSurfaceStore((s) => s.tab);
  const source = useSourcesStore((s) =>
    sourceId ? s.sources.find((x) => x.id === sourceId) : undefined,
  );

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="reticulum-surface">
      {/* Header — reticulum-framework identity, not a channel header. */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-outline-variant/20 flex-shrink-0">
        <span className="material-symbols-outlined text-green-700">hub</span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-on-surface truncate">
            {source?.instanceName || "Reticulum"}
          </div>
          <div className="text-[11px] text-on-surface-variant font-mono truncate">
            {source?.host ? shortHash(source.host) : "mesh network"}
          </div>
        </div>
      </div>

      {tab === "network" && (
        <div className="flex-1 min-h-0 flex flex-col">
          <MeshMap />
        </div>
      )}
      {tab === "messages" && <ReticulumMessages />}
      {tab === "announces" && <AnnouncesList />}
      {tab === "interfaces" && (
        <div className="flex-1 overflow-y-auto p-4">
          {isTauri() ? (
            <ReticulumInterfacesPanel />
          ) : (
            <ReticulumInstanceInterfaces />
          )}
        </div>
      )}
    </div>
  );
}
