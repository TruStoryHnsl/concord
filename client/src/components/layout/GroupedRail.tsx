import { memo, useMemo, useState, useEffect, Fragment } from "react";
import { useServerStore } from "../../stores/server";
import { useSourcesStore, useVisibleSources, type ConcordSource } from "../../stores/sources";
import { useAuthStore } from "../../stores/auth";
import { useDMStore } from "../../stores/dm";
import { usePeerStore } from "../../stores/peerStore";
import { useHomeServerNameStore } from "../../stores/homeServerName";
import { useLocalServerSelectionStore } from "../../stores/localServerSelection";
import { useReticulumSurfaceStore } from "../../stores/reticulumSurface";
import { usePeerMessengerSurfaceStore } from "../../stores/peerMessengerSurface";
import { useUnreadCounts, useHighlightCounts } from "../../hooks/useUnreadCounts";
import { useVoiceParticipants } from "../../hooks/useVoiceParticipants";
import { switchToSource } from "../../lib/switchToSource";
import { isLocalInstanceSource } from "../../lib/sourceIdentity";
import { inferSourceBrand, SourceBrandIcon } from "../sources/sourceBrand";
import { isTauri } from "../../api/servitude";
import type { Server } from "../../api/concord";
import { NewServerModal } from "../server/NewServerModal";

/**
 * GroupedRail — the unified Sources + Servers navigation rail.
 *
 * One coordinated column where a source tile sits vertically CENTERED
 * against the group of servers it owns, dividers separate groups, the DM
 * tile is pinned at the top, and "add" sits at the bottom. This is the
 * "source-behind-servers" stacked layout — AND it keeps the local mesh UI
 * intact: the FIRST group is the device's local mesh (a home anchor tile →
 * the porch + home local servers). Selecting a local server activates the
 * porch/home surface (its channels + the LAN/mesh maps live in the channel
 * column, unchanged). Selecting a foreign server hot-swaps to its source.
 *
 * Group order follows the Sources order, and the active instance's group is
 * NOT hoisted — switching sources never reorders the rail.
 */

function ServerGlyph({
  server,
  active,
  size,
}: {
  server: Pick<Server, "name" | "abbreviation" | "icon_url">;
  active: boolean;
  size: number;
}) {
  if (server.icon_url) {
    return (
      <div
        className="rounded-[inherit] overflow-hidden bg-surface-container-highest"
        style={{ width: size, height: size }}
      >
        <img src={server.icon_url} alt="" className="w-full h-full object-cover" loading="lazy" draggable={false} />
      </div>
    );
  }
  return (
    <div
      className={`rounded-[inherit] flex items-center justify-center text-sm font-headline font-bold ${active ? "text-on-primary" : "text-on-surface-variant"}`}
      style={{ width: size, height: size }}
    >
      {server.abbreviation || server.name.charAt(0).toUpperCase()}
    </div>
  );
}

/** A Matrix-server group: a source and the servers shown under it. */
export interface MatrixRailGroup {
  source: ConcordSource;
  servers: Server[];
}

/**
 * Build the Matrix-server groups in Sources-rail order. The active
 * instance's own servers attach to whichever source matches the live
 * session; foreign sources attach their aggregated servers. LOCAL-instance
 * sources are excluded — the local mesh group (porch/home) represents the
 * device, so its ConcordSource (if any) must not also appear here. Pure +
 * exported so the ordering/grouping is unit-tested directly.
 */
export function buildMatrixRailGroups(params: {
  sources: ConcordSource[];
  activeServers: Server[];
  foreignServers: Server[];
  activeSourceId: string | null;
}): { groups: MatrixRailGroup[]; collapsed: ConcordSource[] } {
  const { sources, activeServers, foreignServers, activeSourceId } = params;
  const groups: MatrixRailGroup[] = [];
  const collapsed: ConcordSource[] = [];
  for (const src of sources) {
    // Exclude the local-instance source from the Matrix groups ONLY when it
    // is NOT the active source. On NATIVE the local instance is the synthetic
    // porch (its device tile is the separate local-mesh group, and any
    // isLocal-flagged ConcordSource there carries no live servers), so it is
    // correctly skipped. On WEB the local instance IS the origin source that
    // holds the live session — it owns the user's real servers and MUST render
    // its own group, or those server tiles vanish (regression from 900bac3).
    if (isLocalInstanceSource(src) && src.id !== activeSourceId) continue;
    if ((src.platform ?? "concord") === "concord-p2p") continue; // p2p porches aren't Matrix groups here
    // Reticulum is a source but not a Matrix-shaped one — no servers, no
    // channels. It renders as its own rail group (see renderReticulumTile)
    // opening the dedicated Reticulum surface, never a "no servers" group.
    if (src.platform === "reticulum") continue;
    if (!src.enabled) {
      collapsed.push(src);
      continue;
    }
    const servers =
      src.id === activeSourceId
        ? activeServers
        : foreignServers.filter((s) => s.sourceId === src.id);
    groups.push({ source: src, servers });
  }
  return { groups, collapsed };
}

interface GroupedRailProps {
  canManageSources?: boolean;
  onAddSource: () => void;
  onExplore?: () => void;
  /** Open a reticulum source's dedicated (non-Discord) surface. */
  onReticulumSelect?: (sourceId: string) => void;
  /** Activate a local mesh server (porch/home). ChatLayout wires this to
   *  openLocal() + the local-server selection so the channel column shows
   *  that surface. */
  onLocalServerSelect: (key: "porch" | "home") => void;
  /** True while a local mesh server is the active surface (porch view). */
  localActive: boolean;
  mobile?: boolean;
  /** Mobile: advance to the channels pane after a selection. */
  onServerSelect?: () => void;
}

export const GroupedRail = memo(function GroupedRail({
  canManageSources = true,
  onAddSource,
  onExplore,
  onReticulumSelect,
  onLocalServerSelect,
  localActive,
  mobile = false,
  onServerSelect,
}: GroupedRailProps) {
  const servers = useServerStore((s) => s.servers);
  const foreignServers = useServerStore((s) => s.foreignServers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const allSources = useVisibleSources();
  const toggleSource = useSourcesStore((s) => s.toggleSource);
  const currentUserId = useAuthStore((s) => s.userId);
  const syncing = useAuthStore((s) => s.syncing);
  const dmActive = useDMStore((s) => s.dmActive);
  const setDMActive = useDMStore((s) => s.setDMActive);
  const unread = useUnreadCounts();
  const highlight = useHighlightCounts();
  const [showNewServer, setShowNewServer] = useState(false);

  // Local mesh group — present on native (and once any p2p peer is known).
  const knownPeers = usePeerStore((s) => s.knownPeers);
  const loadPeers = usePeerStore((s) => s.load);
  useEffect(() => {
    void loadPeers();
  }, [loadPeers]);
  // showLocalMesh removed with the home-server group (retired).
  const homeName = useHomeServerNameStore((s) => s.name);
  const loadHomeName = useHomeServerNameStore((s) => s.load);
  useEffect(() => {
    void loadHomeName();
  }, [loadHomeName]);
  const localSelection = useLocalServerSelectionStore((s) => s.active);

  // Active source = the one holding the live session (robust on native,
  // where serverConfig.config is often null). Matches the ServerSidebar fix.
  const activeSourceId = useMemo(() => {
    if (currentUserId) {
      const bySession = allSources.find((s) => s.userId === currentUserId);
      if (bySession) return bySession.id;
    }
    // Web fallback: the origin/local source holds the live session but may
    // carry no userId (it isn't a user-added foreign source), so the lookup
    // above misses it and the user's own servers would have no group. The
    // local instance IS the active source on web — attach activeServers to it.
    // Native has no local ConcordSource (the porch is synthetic), so this
    // stays null there and the local-mesh group handles the device.
    const local = allSources.find((s) => isLocalInstanceSource(s));
    return local?.id ?? null;
  }, [currentUserId, allSources]);

  const activeServers = useMemo(() => servers.filter((s) => !s.federated), [servers]);

  // Reticulum sources — rendered as their own rail group with a
  // framework-shaped surface behind them, never as Matrix groups.
  const reticulumSources = useMemo(
    () => allSources.filter((s) => s.platform === "reticulum" && s.enabled),
    [allSources],
  );
  const reticulumActiveId = useReticulumSurfaceStore((s) => s.sourceId);

  const { groups, collapsed } = useMemo(
    () =>
      buildMatrixRailGroups({
        sources: allSources,
        activeServers,
        foreignServers,
        activeSourceId,
      }),
    [allSources, activeServers, foreignServers, activeSourceId],
  );

  const allVoiceRoomIds = useMemo(
    () =>
      groups
        .flatMap((g) => g.servers)
        .flatMap((srv) =>
          srv.channels.filter((c) => c.channel_type === "voice").map((c) => c.matrix_room_id),
        ),
    [groups],
  );
  const voiceParticipants = useVoiceParticipants(allVoiceRoomIds);

  const serverStatusDot = (srv: Server): "red" | "yellow" | "unread" | null => {
    if (!syncing) return "red";
    if (srv.channels.some((c) => (highlight.get(c.matrix_room_id) ?? 0) > 0)) return "yellow";
    if (srv.channels.some((c) => (unread.get(c.matrix_room_id) ?? 0) > 0)) return "unread";
    return null;
  };
  const serverVoiceActive = (srv: Server) =>
    srv.channels.some(
      (c) => c.channel_type === "voice" && (voiceParticipants.get(c.matrix_room_id)?.length ?? 0) > 0,
    );

  const handleServerClick = (srv: Server, group: MatrixRailGroup) => {
    setDMActive(false);
    onServerSelect?.();
    if (group.source.id === activeSourceId) {
      setActiveServer(srv.id); // clears localActive via ChatLayout effect
      return;
    }
    const result = switchToSource(group.source.id, srv.id);
    if (result === "needs-auth") {
      void import("../../stores/settings").then(({ useSettingsStore }) =>
        useSettingsStore.getState().requestAddSource(),
      );
    }
  };

  const handleDMClick = () => {
    useServerStore.setState({ activeServerId: null, activeChannelId: null });
    usePeerMessengerSurfaceStore.getState().close();
    setDMActive(true); // clears localActive via ChatLayout effect
  };

  // Peer messenger — the p2p per-peer inboxes + known-peers registry as a
  // PRIMARY surface (promoted out of the Settings tabs). Mutually
  // exclusive with the other chat surfaces, same pattern as reticulum.
  const peerMessengerOpen = usePeerMessengerSurfaceStore((s) => s.isOpen);
  const handlePeerMessengerClick = () => {
    useServerStore.setState({ activeServerId: null, activeChannelId: null });
    setDMActive(false);
    useReticulumSurfaceStore.getState().close();
    usePeerMessengerSurfaceStore.getState().open();
  };

  const sourceLabel = (src: ConcordSource) => src.instanceName || src.host;

  const renderSourceTile = (src: ConcordSource, opts: { gray: boolean }) => {
    const brand = inferSourceBrand(src);
    const isP2p = src.platform === "concord-p2p";
    return (
      <button
        key={src.id}
        onClick={() => toggleSource(src.id)}
        title={
          opts.gray
            ? `${sourceLabel(src)} — hidden · click to show its servers`
            : `${sourceLabel(src)} · click to hide its servers`
        }
        data-testid={`rail-source-${src.id}`}
        data-source-kind={isP2p ? "p2p" : "web"}
        data-source-state={opts.gray ? "collapsed" : "expanded"}
        className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all duration-150 ${
          isP2p ? "ring-1 ring-secondary/50" : "ring-1 ring-outline-variant/15"
        } ${
          opts.gray
            ? "bg-surface-container opacity-45 grayscale hover:opacity-80 scale-90"
            : "bg-surface-container-high text-on-surface"
        }`}
      >
        <SourceBrandIcon brand={brand} size={22} />
      </button>
    );
  };

  const renderReticulumTile = (src: ConcordSource) => {
    const isActive = reticulumActiveId === src.id;
    const label = src.instanceName || "Reticulum";
    return (
      <button
        key={src.id}
        onClick={() => {
          setDMActive(false);
          onServerSelect?.();
          onReticulumSelect?.(src.id);
        }}
        title={label}
        aria-label={label}
        data-testid={`rail-reticulum-${src.id}`}
        className={`btn-press w-12 h-12 flex items-center justify-center transition-all ${
          isActive
            ? "bg-green-700 text-white rounded-xl"
            : "bg-surface-container-high text-green-700 rounded-2xl hover:rounded-xl hover:bg-surface-container-highest"
        }`}
      >
        <span className="material-symbols-outlined text-xl">hub</span>
      </button>
    );
  };

  const renderLocalAnchorTile = () => {
    const anyPeerOnline = knownPeers.some((p) => {
      const t = Date.parse(p.lastSeen);
      return !Number.isNaN(t) && Date.now() - t < 60_000;
    });
    return (
      <div
        className="relative w-9 h-9 rounded-xl bg-primary/15 ring-1 ring-primary/30 flex items-center justify-center text-primary"
        title="This device"
        data-testid="rail-local-anchor"
      >
        <span className="material-symbols-outlined text-xl">home</span>
        <span
          className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full ring-2 ring-surface ${anyPeerOnline ? "bg-green-500" : "bg-on-surface-variant/40"}`}
          aria-label={anyPeerOnline ? "Peer online" : "No peers online"}
        />
      </div>
    );
  };

  const renderLocalServerTile = (key: "porch" | "home") => {
    // User-facing label only — the `"home"`/`"porch"` keys + testids are
    // unchanged. Primary reads as the user's own space; guest doorman = "Guests".
    const label = key === "home" ? homeName.trim() || "My space" : "Guests";
    const isActive = localActive && localSelection === key;
    return (
      <div key={key} className="relative">
        <button
          onClick={() => {
            setDMActive(false);
            onLocalServerSelect(key);
            onServerSelect?.();
          }}
          title={label}
          aria-label={label}
          data-testid={`rail-local-${key}`}
          className={`btn-press w-12 h-12 flex items-center justify-center text-sm font-headline font-bold transition-all ${
            isActive
              ? key === "home"
                ? "primary-glow text-on-primary rounded-xl"
                : "bg-surface-container-highest text-on-surface ring-2 ring-on-surface-variant/40 rounded-xl"
              : "bg-surface-container-high text-on-surface-variant rounded-2xl hover:rounded-xl hover:bg-surface-container-highest hover:text-on-surface"
          }`}
        >
          {label.charAt(0).toUpperCase()}
        </button>
      </div>
    );
  };

  const renderServerTile = (srv: Server, group: MatrixRailGroup) => {
    const isActive = !dmActive && !localActive && activeServerId === srv.id;
    const dot = !isActive ? serverStatusDot(srv) : null;
    const voice = serverVoiceActive(srv);
    return (
      <div key={srv.id} className="relative">
        <button
          onClick={() => handleServerClick(srv, group)}
          title={srv.name}
          aria-label={srv.name}
          data-testid={`rail-server-${srv.id}`}
          className={`btn-press w-12 h-12 flex items-center justify-center transition-all ${
            isActive
              ? "primary-glow text-on-primary rounded-xl"
              : "bg-surface-container-high text-on-surface-variant rounded-2xl hover:rounded-xl hover:bg-surface-container-highest hover:text-on-surface"
          }`}
        >
          <ServerGlyph server={srv} active={isActive} size={48} />
        </button>
        {dot === "red" && <Dot cls="bg-error" label="Disconnected" />}
        {dot === "yellow" && <Dot cls="bg-yellow-500 node-pulse" label="Needs attention" />}
        {dot === "unread" && <Dot cls="bg-primary node-pulse" label="Unread" />}
        {voice && (
          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-emerald-500 rounded-full border-2 border-surface flex items-center justify-center" aria-label="Users in voice">
            <span className="material-symbols-outlined text-white" style={{ fontSize: "10px" }}>volume_up</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`h-full bg-surface overflow-y-auto overflow-x-hidden flex flex-col items-stretch py-3 gap-1 ${mobile ? "w-full" : "w-[100px]"}`}>
      {/* DM — pinned top, ALWAYS present (not gated on opening a source). */}
      <div className="flex">
        <div className="w-11 flex-shrink-0 flex items-center justify-center">
          <button
            onClick={handleDMClick}
            title="Direct Messages"
            data-testid="rail-dm"
            className={`btn-press w-9 h-9 flex items-center justify-center transition-all ${
              dmActive ? "primary-glow text-on-primary rounded-xl" : "bg-surface-container-high text-on-surface-variant rounded-2xl hover:rounded-xl"
            }`}
          >
            <span className="material-symbols-outlined text-lg">chat_bubble</span>
          </button>
        </div>
        <div className="flex-1" />
      </div>

      {/* Peer messenger — per-peer inboxes + known peers as a PRIMARY
          surface (not a settings tab). Native-only until the docker
          server grows the per-user history store (incident 2026-08-11
          open item) — the data layer rides Tauri IPC. */}
      {isTauri() && (
        <div className="flex">
          <div className="w-11 flex-shrink-0 flex items-center justify-center">
            <button
              onClick={handlePeerMessengerClick}
              title="Peer messages"
              data-testid="rail-peer-messenger"
              className={`btn-press w-9 h-9 flex items-center justify-center transition-all ${
                peerMessengerOpen ? "primary-glow text-on-primary rounded-xl" : "bg-surface-container-high text-on-surface-variant rounded-2xl hover:rounded-xl"
              }`}
            >
              <span className="material-symbols-outlined text-lg">forum</span>
            </button>
          </div>
          <div className="flex-1" />
        </div>
      )}

      {/* Collapsed (gray) sources stacked at top. */}
      {collapsed.length > 0 && (
        <>
          <div className="flex">
            <div className="w-11 flex-shrink-0 flex flex-col items-center gap-1.5">
              {collapsed.map((src) => renderSourceTile(src, { gray: true }))}
            </div>
            <div className="flex-1" />
          </div>
          <Divider />
        </>
      )}

      {/* Local mesh group FIRST — device anchor centered on porch + home. */}
      {/* Local home-server group RETIRED ENTIRELY (user order, incident
          2026-08-11): the "home server" does not exist. Native's mesh
          surfaces live in the NativeMeshShell; this rail is the DOCKER
          instance UI only. renderLocalAnchorTile/renderLocalServerTile
          remain defined-but-unmounted pending code removal. */}
      {false && (
        <>
          <div className="flex w-full">
            <div className="w-11 flex-shrink-0 flex items-center justify-center">
              {renderLocalAnchorTile()}
            </div>
            <div className="flex-1 flex flex-col items-center gap-2 py-1 min-w-0">
              {renderLocalServerTile("home")}
            </div>
          </div>
          {groups.length > 0 && <Divider />}
        </>
      )}

      {/* Reticulum sources — mesh group, framework-shaped surface. */}
      {reticulumSources.length > 0 && (
        <>
          <div className="flex w-full">
            <div className="w-11 flex-shrink-0 flex items-center justify-center">
              <div
                className="w-9 h-9 rounded-xl bg-green-700/15 ring-1 ring-green-700/30 flex items-center justify-center text-green-700"
                title="Reticulum mesh"
                data-testid="rail-reticulum-anchor"
              >
                <span className="material-symbols-outlined text-xl">podcasts</span>
              </div>
            </div>
            <div className="flex-1 flex flex-col items-center gap-2 py-1 min-w-0">
              {reticulumSources.map((src) => renderReticulumTile(src))}
            </div>
          </div>
          {groups.length > 0 && <Divider />}
        </>
      )}

      {/* Matrix source groups: source tile centered against its servers. */}
      {groups.map((g, i) => (
        <Fragment key={g.source.id}>
          <div className="flex w-full">
            <div className="w-11 flex-shrink-0 flex items-center justify-center">
              {renderSourceTile(g.source, { gray: false })}
            </div>
            <div className="flex-1 flex flex-col items-center gap-2 py-1 min-w-0">
              {g.servers.length === 0 ? (
                <span className="text-[10px] text-on-surface-variant/50 px-1 text-center leading-tight">no servers</span>
              ) : (
                g.servers.map((srv) => renderServerTile(srv, g))
              )}
            </div>
          </div>
          {i < groups.length - 1 && <Divider />}
        </Fragment>
      ))}

      <div className="flex-1 min-h-3" />

      {/* Bottom: add source / explore (sources lane) + create-server (fixed). */}
      <Divider />
      <div className="flex">
        <div className="w-11 flex-shrink-0 flex flex-col items-center gap-2">
          <button
            onClick={onAddSource}
            title={canManageSources ? "Add source" : "Connect to a peer"}
            data-testid="rail-add-source"
            className="w-9 h-9 rounded-xl hover:rounded-lg bg-surface-container-high hover:bg-surface-container-highest flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-all"
          >
            <span className="material-symbols-outlined text-lg">{canManageSources ? "add" : "hub"}</span>
          </button>
          {onExplore && (
            <button
              onClick={onExplore}
              title="Explore"
              data-testid="rail-explore"
              className="w-9 h-9 rounded-xl hover:rounded-lg bg-surface-container-high hover:bg-surface-container-highest flex items-center justify-center text-on-surface-variant hover:text-on-surface transition-all"
            >
              <span className="material-symbols-outlined text-lg">explore</span>
            </button>
          )}
        </div>
        <div className="flex-1 flex flex-col items-center">
          <button
            onClick={() => setShowNewServer(true)}
            title="Create a server"
            data-testid="rail-add-server"
            className="btn-press w-12 h-12 rounded-2xl bg-surface-container-high text-on-surface-variant hover:bg-secondary/10 hover:text-secondary hover:rounded-xl flex items-center justify-center transition-all"
          >
            <span className="material-symbols-outlined text-xl">add</span>
          </button>
        </div>
      </div>

      {showNewServer && <NewServerModal onClose={() => setShowNewServer(false)} />}
    </div>
  );
});

function Dot({ cls, label }: { cls: string; label: string }) {
  return <div className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-surface ${cls}`} aria-label={label} />;
}

function Divider() {
  return <div className="w-full h-px bg-outline-variant/20 my-1" aria-hidden="true" />;
}
