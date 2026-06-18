/**
 * LocalChannelSidebar — channel column for the active LOCAL server
 * (porch OR home, see the 2026-06-01 CONSOLIDATED ARCHITECTURE filing
 * in `instructions_inbox.md`).
 *
 * Both tiles read from the same `porchStore` (backed by the persistent
 * porch SQLite), but the rendered channel list is FILTERED by the
 * active local server's `server_id` (schema v12): the porch tile shows
 * only `server_id === "porch"` channels, the home tile only
 * `server_id === "home"`. Switching the active tile re-selects that
 * server's first channel so the chat pane changes — this is the
 * user-visible fix for "porch and home show the same channels."
 *
 * The server-name header reflects the currently-active local server:
 *   - `active === "home"` → `useHomeServerNameStore.name` (default "home")
 *   - `active === "porch"` → literal "porch" (porch is not renamable)
 */

import { memo, useEffect, useMemo } from "react";
import { channelsForServer, usePorchStore } from "../../stores/porchStore";
import { useHomeServerNameStore } from "../../stores/homeServerName";
import { useLocalServerSelectionStore } from "../../stores/localServerSelection";
import { isTauri } from "../../api/servitude";
import { BringingUpSplash } from "../BringingUpSplash";

interface LocalChannelSidebarProps {
  mobile?: boolean;
  onChannelSelect?: () => void;
}

export const LocalChannelSidebar = memo(function LocalChannelSidebar({
  mobile: _mobile,
  onChannelSelect,
}: LocalChannelSidebarProps) {
  // NOTE: `porchStore` is the persistent home-server's backing store
  // today — the variable name is keep-as-is because the module
  // rename is a follow-up PR.
  const channels = usePorchStore((s) => s.channels);
  const selectedChannelId = usePorchStore((s) => s.selectedChannelId);
  const isLoaded = usePorchStore((s) => s.isLoaded);
  const error = usePorchStore((s) => s.error);
  const loadChannels = usePorchStore((s) => s.loadChannels);
  const selectChannel = usePorchStore((s) => s.selectChannel);

  const active = useLocalServerSelectionStore((s) => s.active);
  const lanMapOpen = useLocalServerSelectionStore((s) => s.lanMapOpen);
  const setLanMapOpen = useLocalServerSelectionStore((s) => s.setLanMapOpen);
  const meshMapOpen = useLocalServerSelectionStore((s) => s.meshMapOpen);
  const setMeshMapOpen = useLocalServerSelectionStore((s) => s.setMeshMapOpen);
  const peersOpen = useLocalServerSelectionStore((s) => s.peersOpen);
  const setPeersOpen = useLocalServerSelectionStore((s) => s.setPeersOpen);
  const homeName = useHomeServerNameStore((s) => s.name);

  // Lazy-load on mount. `loadChannels` is idempotent — re-calling it
  // refreshes the list without resetting the selection.
  useEffect(() => {
    if (!isLoaded) {
      void loadChannels();
    }
  }, [isLoaded, loadChannels]);

  // Channels for the active local server only. Schema v12 stamps every
  // channel with a `server_id` ("porch" | "home"); this is the core
  // filter that makes the two tiles show DIFFERENT channels.
  const visibleChannels = useMemo(
    () => channelsForServer(channels, active),
    [channels, active],
  );

  // When the active server tile changes (or the channel list first
  // loads), make sure the selected channel belongs to the active
  // server — otherwise the chat pane would keep showing the previous
  // server's channel after a tile switch. Select the active server's
  // first channel; if it has none, leave the selection alone.
  useEffect(() => {
    if (!isLoaded || lanMapOpen || meshMapOpen || peersOpen) return;
    const selectionIsForActive = visibleChannels.some(
      (c) => c.id === selectedChannelId,
    );
    if (selectionIsForActive) return;
    const first = visibleChannels[0]?.id;
    if (first) {
      void selectChannel(first);
    }
  }, [
    isLoaded,
    active,
    visibleChannels,
    selectedChannelId,
    lanMapOpen,
    meshMapOpen,
    peersOpen,
    selectChannel,
  ]);

  const serverLabel =
    active === "home" ? homeName.trim() || "home" : "porch";

  // Loading status string matches the active server so the user
  // sees consistent vocabulary in BringingUpSplash.
  const loadingStatus =
    active === "home" ? "Loading home…" : "Loading porch…";

  return (
    <div className="w-full h-full flex flex-col min-h-0 bg-surface-container-low">
      {/* Server header — mirrors ChannelSidebar's `p-3 flex items-center
          justify-between` row. Settings/invite affordances are intentionally
          omitted in this PR; per-channel admin lives in the per-feature
          surfaces under client/src/components/porch/. */}
      <div className="p-3 flex items-center justify-between relative">
        <span
          data-testid="local-channel-sidebar-server-header"
          data-server-key={active}
          className="min-w-0 text-left text-sm font-headline font-semibold text-on-surface truncate"
          title={serverLabel}
        >
          {serverLabel}
        </span>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto p-2">
        {!isTauri() ? (
          <div className="px-3 py-6 text-center">
            <p className="text-sm text-on-surface-variant font-body">
              This device is in web mode
            </p>
            <p className="mt-2 text-xs text-on-surface-variant/60 font-label">
              The local {serverLabel} server lives on your desktop install.
            </p>
          </div>
        ) : !isLoaded ? (
          <div className="flex justify-center py-6">
            <BringingUpSplash size="compact" status={loadingStatus} />
          </div>
        ) : error && error !== "native_only" ? (
          <div className="px-3 py-6 text-center">
            <p className="text-sm text-error font-body">{error}</p>
            <button
              type="button"
              onClick={() => void loadChannels()}
              className="mt-3 px-3 py-1.5 rounded-lg bg-surface-container-high hover:bg-surface-container-highest text-xs text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            {/* W0.3 / F1 — Mesh section. The LAN discovery map is a
                cross-server special surface (not a porch channel), so it
                lives in its own section above Text Channels, mirroring how
                app/special channels appear elsewhere. Selecting it opens
                LanDiscoveryMap in the chat pane; selecting a real channel
                below clears it. */}
            <div className="mb-3">
              <div className="flex items-center justify-between px-2 mb-1">
                <h3 className="text-[10px] font-label font-medium text-on-surface-variant uppercase tracking-widest">
                  Mesh
                </h3>
              </div>
              <div className="group flex items-center gap-0.5">
                <button
                  type="button"
                  data-testid="local-channel-row-lan_map"
                  data-channel-kind="lan_map"
                  onClick={() => {
                    setLanMapOpen(true);
                    onChannelSelect?.();
                  }}
                  className={`flex-1 min-w-0 text-left px-3 py-2 rounded-xl text-sm transition-all flex items-center gap-2 font-body ${
                    lanMapOpen
                      ? "bg-surface-container-highest text-on-surface"
                      : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  }`}
                >
                  <span className="material-symbols-outlined flex-shrink-0 text-on-surface-variant" style={{ fontSize: "18px" }}>
                    wifi_tethering
                  </span>
                  <span className="min-w-0 truncate flex-1">LAN map</span>
                </button>
              </div>
              {/* W1.1 / F2 — Mesh map (N-hop topology). Sibling of the LAN
                  map row; selecting it opens MeshMap in the chat pane. The
                  store makes the two surfaces mutually exclusive. */}
              <div className="group flex items-center gap-0.5">
                <button
                  type="button"
                  data-testid="local-channel-row-mesh"
                  data-channel-kind="mesh"
                  onClick={() => {
                    setMeshMapOpen(true);
                    onChannelSelect?.();
                  }}
                  className={`flex-1 min-w-0 text-left px-3 py-2 rounded-xl text-sm transition-all flex items-center gap-2 font-body ${
                    meshMapOpen
                      ? "bg-surface-container-highest text-on-surface"
                      : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  }`}
                >
                  <span className="material-symbols-outlined flex-shrink-0 text-on-surface-variant" style={{ fontSize: "18px" }}>
                    hub
                  </span>
                  <span className="min-w-0 truncate flex-1">Mesh map</span>
                </button>
              </div>
              {/* Peers — the reachable tap-to-pair + known-peers surface.
                  Sibling of the mesh / LAN rows; mutually exclusive via the
                  store. This is the entry point for starting a connection. */}
              <div className="group flex items-center gap-0.5">
                <button
                  type="button"
                  data-testid="local-channel-row-peers"
                  data-channel-kind="peers"
                  onClick={() => {
                    setPeersOpen(true);
                    onChannelSelect?.();
                  }}
                  className={`flex-1 min-w-0 text-left px-3 py-2 rounded-xl text-sm transition-all flex items-center gap-2 font-body ${
                    peersOpen
                      ? "bg-surface-container-highest text-on-surface"
                      : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                  }`}
                >
                  <span className="material-symbols-outlined flex-shrink-0 text-on-surface-variant" style={{ fontSize: "18px" }}>
                    group
                  </span>
                  <span className="min-w-0 truncate flex-1">Peers</span>
                </button>
              </div>
            </div>

            <div className="mb-3">
              <div className="flex items-center justify-between px-2 mb-1">
                <h3 className="text-[10px] font-label font-medium text-on-surface-variant uppercase tracking-widest">
                  Text Channels
                </h3>
              </div>
              {visibleChannels.map((ch) => {
                const isActive =
                  !lanMapOpen && !meshMapOpen && !peersOpen && selectedChannelId === ch.id;
                return (
                  <div key={ch.id} className="group flex items-center gap-0.5">
                    <button
                      type="button"
                      data-testid={`local-channel-row-${ch.id}`}
                      onClick={() => {
                        setLanMapOpen(false);
                        setMeshMapOpen(false);
                        setPeersOpen(false);
                        void selectChannel(ch.id);
                        onChannelSelect?.();
                      }}
                      className={`flex-1 min-w-0 text-left px-3 py-2 rounded-xl text-sm transition-all flex items-center gap-2 font-body ${
                        isActive
                          ? "bg-surface-container-highest text-on-surface"
                          : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                      }`}
                    >
                      <span className="text-on-surface-variant flex-shrink-0">#</span>
                      <span className="min-w-0 truncate flex-1">{ch.name}</span>
                    </button>
                  </div>
                );
              })}
              {visibleChannels.length === 0 && (
                <p className="px-3 py-4 text-xs text-on-surface-variant/70 font-label text-center">
                  No channels yet
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
});
