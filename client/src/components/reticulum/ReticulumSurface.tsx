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
import { useSourcesStore } from "../../stores/sources";
import { identiconDataUri } from "../mesh/identicon";
import { MeshMap } from "../mesh/MeshMap";
import { ReticulumInterfacesPanel } from "../settings/ReticulumInterfacesPanel";
import { ReticulumMessages } from "./ReticulumMessages";

const EMPTY_GRAPH: MeshGraph = { nodes: [], edges: [] };

function shortHash(hash: string): string {
  return hash.length > 10 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash;
}

function AnnouncesList() {
  const [graph, setGraph] = useState<MeshGraph>(EMPTY_GRAPH);
  const [loaded, setLoaded] = useState(false);
  const native = isTauri();

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

  if (!native) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-2">
          <span className="material-symbols-outlined text-4xl text-green-700">podcasts</span>
          <p className="text-sm text-on-surface">
            Announce ingestion runs in the native Concord app's embedded
            Reticulum stack.
          </p>
          <p className="text-xs text-on-surface-variant">
            This portal shows your mesh topology under Network; connect from
            a native install to see live announces here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4" data-testid="reticulum-announces">
      <h3 className="text-sm font-semibold text-on-surface mb-3">
        Announced destinations
      </h3>
      {announcePeers.length === 0 ? (
        <p className="text-xs text-on-surface-variant">
          {loaded
            ? "No announces heard yet. Announces propagate as peers speak on your configured interfaces."
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
            <div className="max-w-md space-y-2">
              <h3 className="text-sm font-semibold text-on-surface">Interfaces</h3>
              <p className="text-xs text-on-surface-variant">
                Interface configuration (TCP, UDP, I2P, RNode, serial) lives in
                the native Concord app, where the Reticulum stack runs. This
                portal relays your mesh presence — configure interfaces from a
                native install.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
