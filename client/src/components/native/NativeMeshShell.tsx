/**
 * NativeMeshShell — the native app's primary UI, rebuilt crosstalk-guided.
 *
 * Crosstalk (buildwithparallel/crosstalk, the user-named design
 * reference) is a Reticulum MeshChat: a labeled section nav on the left
 * (conversations, network map, announces, interfaces), identicon-first
 * peer identity, and the mesh itself as the product. This shell is that
 * shape built from Concord's own components:
 *
 *   Chats      — SocialInboxPanel (per-peer conversations + history)
 *   Peers      — SocialPeersPanel (known-peers registry / directory)
 *   Network    — MeshMap (crosstalk-guided topology, identicons, hops)
 *   Announces  — discovered destinations, each messageable
 *   Interfaces — ReticulumInterfacesPanel (rnsd links, crosstalk taxonomy)
 *
 * There is NO local "home server" and NO Discord-style chrome here.
 * The Discord-style ChatLayout is DOCKER ONLY: the Instances section
 * lists the user's docker/matrix sources, entering one flips
 * `nativeShell.mode` to "instance" which hides this shell and reveals
 * the always-mounted ChatLayout beneath (a floating chip returns to the
 * mesh shell). App gates this mount on isTauri; web/docker never render
 * it.
 */
import { useCallback, useEffect, useState } from "react";
import { useNativeShellStore, type NativeShellSection } from "../../stores/nativeShell";
import { useSettingsStore } from "../../stores/settings";
import { useVisibleSources, type ConcordSource } from "../../stores/sources";
import { switchToSource } from "../../lib/switchToSource";
import { fetchConnectorLayerGraph } from "../../api/connectors";
import { EMPTY_MESH_GRAPH, type MeshGraph } from "../../api/meshGraph";
import { identiconDataUri } from "../mesh/identicon";
import { MeshMap } from "../mesh/MeshMap";
import { ReticulumInterfacesPanel } from "../settings/ReticulumInterfacesPanel";
import { SocialInboxPanel } from "../social/inbox/SocialInboxPanel";
import { SocialPeersPanel } from "../social/peers/SocialPeersPanel";
import { inferSourceBrand, SourceBrandIcon } from "../sources/sourceBrand";

const SECTIONS: Array<{
  id: NativeShellSection;
  icon: string;
  label: string;
  hint: string;
}> = [
  // Core = the libp2p + WireGuard p2p messenger. Reticulum is NOT core:
  // it is a chosen parallel connection path, listed under Connections
  // below exactly like a docker instance.
  { id: "chats", icon: "forum", label: "Chats", hint: "Conversations & history" },
  { id: "peers", icon: "groups", label: "Peers", hint: "Known peers" },
  { id: "network", icon: "lan", label: "Network", hint: "Topology map" },
];

const RETICULUM_TABS = [
  { id: "announces" as const, icon: "podcasts", label: "Announces" },
  { id: "interfaces" as const, icon: "settings_input_antenna", label: "Interfaces" },
];

function shortHash(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

/** Announces — discovered destinations, crosstalk announce-browser shaped:
 *  every discovered peer is actionable (identicon → Message). */
function AnnouncesSection() {
  const openConversation = useNativeShellStore((s) => s.openConversation);
  const [graph, setGraph] = useState<MeshGraph>(EMPTY_MESH_GRAPH);
  const [loaded, setLoaded] = useState(false);

  const pull = useCallback(async () => {
    try {
      const g = await fetchConnectorLayerGraph("reticulum");
      setGraph(g);
    } catch {
      /* connector not running — empty list */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void pull();
    const id = setInterval(() => void pull(), 15_000);
    return () => clearInterval(id);
  }, [pull]);

  const peers = graph.nodes.filter((n) => n.kind !== "self");

  return (
    <div className="h-full overflow-y-auto p-4" data-testid="native-shell-announces">
      <h3 className="mb-3 text-sm font-semibold text-on-surface">
        Announced destinations
      </h3>
      {peers.length === 0 ? (
        <p className="text-xs text-on-surface-variant">
          {loaded
            ? "No announces heard yet. Announces propagate as peers speak on your configured interfaces."
            : "Listening…"}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {peers.map((n) => (
            <li
              key={n.peerId}
              className="flex items-center gap-3 rounded-lg bg-surface-container px-3 py-2"
            >
              <img
                src={identiconDataUri(n.peerId)}
                alt=""
                className="h-8 w-8 flex-shrink-0 rounded-md"
              />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-sm text-on-surface">
                  {shortHash(n.peerId)}
                </div>
                <div className="text-[11px] text-on-surface-variant">
                  {n.interfaceType ?? "unknown interface"}
                  {typeof (n.hopCount ?? n.hopDistance) === "number" &&
                    ` · ${n.hopCount ?? n.hopDistance} hop${(n.hopCount ?? n.hopDistance) === 1 ? "" : "s"}`}
                  {n.transport && " · transport node"}
                </div>
              </div>
              <button
                type="button"
                title="Message this peer"
                data-testid={`shell-announce-message-${n.peerId}`}
                onClick={() => openConversation(`reticulum:${n.peerId}`)}
                className="btn-press flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <span className="material-symbols-outlined text-lg">forum</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Floating return chip shown while the user is inside a docker/matrix
 *  instance (ChatLayout revealed beneath the hidden shell). */
function InstanceReturnChip() {
  const leaveInstance = useNativeShellStore((s) => s.leaveInstance);
  return (
    <div className="safe-top fixed left-3 top-3 z-[60]">
      <button
        type="button"
        onClick={leaveInstance}
        title="Back to mesh"
        data-testid="shell-return-chip"
        className="btn-press flex items-center gap-2 rounded-full bg-surface-container-high/95 py-1.5 pl-2 pr-3 elev-md edge-hairline backdrop-blur text-sm text-on-surface"
      >
        <span className="material-symbols-outlined text-lg">arrow_back</span>
        Mesh
      </button>
    </div>
  );
}

export function NativeMeshShell() {
  const mode = useNativeShellStore((s) => s.mode);
  const [reticulumTab, setReticulumTab] = useState<"announces" | "interfaces">(
    "announces",
  );
  const section = useNativeShellStore((s) => s.section);
  const setSection = useNativeShellStore((s) => s.setSection);
  const chatPeerId = useNativeShellStore((s) => s.chatPeerId);
  const openConversation = useNativeShellStore((s) => s.openConversation);
  const enterInstance = useNativeShellStore((s) => s.enterInstance);
  const openSettings = useSettingsStore((s) => s.openSettings);
  const sources = useVisibleSources();

  // Instances = the user's docker/matrix sources. NO local "home server"
  // — the local porch/home concept does not exist in the native shell.
  const instances = sources.filter(
    (s) => !s.isLocal && s.platform !== "reticulum" && s.enabled,
  );

  if (mode === "instance") {
    return <InstanceReturnChip />;
  }

  const handleEnterInstance = (src: ConcordSource) => {
    switchToSource(src.id);
    enterInstance();
  };

  return (
    <div
      className="fixed inset-0 z-[55] flex bg-surface"
      data-testid="native-mesh-shell"
    >
      {/* Section nav — crosstalk-style labeled sidebar. */}
      <nav className="flex w-56 flex-shrink-0 flex-col border-r border-outline-variant/10 bg-surface-container-low">
        <div className="flex items-center gap-2 px-4 py-4">
          <img src="/logo.png" alt="" className="h-7 w-7" />
          <span className="font-label text-base font-semibold text-on-surface">
            Concord
          </span>
        </div>
        <div className="flex-1 space-y-0.5 px-2">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              data-testid={`shell-nav-${s.id}`}
              className={`btn-press flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
                section === s.id
                  ? "bg-surface-container-high text-on-surface"
                  : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
              }`}
            >
              <span
                className={`material-symbols-outlined text-xl ${section === s.id ? "text-green-700" : ""}`}
              >
                {s.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight">
                  {s.label}
                </span>
                <span className="block truncate text-[11px] leading-tight opacity-70">
                  {s.hint}
                </span>
              </span>
            </button>
          ))}

          <div className="px-3 pb-1 pt-4 text-[10px] font-label uppercase tracking-widest text-on-surface-variant">
            Connections
          </div>
          {/* Reticulum — a parallel connection path the user CHOOSES,
              surfaced exactly like a docker instance. The docker
              instance doubles as a reticulum support node (pillar), so
              this path is www-agnostic. */}
          <button
            type="button"
            onClick={() => setSection("reticulum")}
            data-testid="shell-connection-reticulum"
            className={`btn-press flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${
              section === "reticulum"
                ? "bg-surface-container-high text-on-surface"
                : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
            }`}
          >
            <span className={`material-symbols-outlined text-xl ${section === "reticulum" ? "text-green-700" : ""}`}>
              podcasts
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium leading-tight">Reticulum</span>
              <span className="block truncate text-[11px] leading-tight opacity-70">Mesh protocol</span>
            </span>
          </button>
          {instances.length > 0 && (
            <>
              {instances.map((src) => {
                const brand = inferSourceBrand(src);
                return (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() => handleEnterInstance(src)}
                    title={`Enter ${src.instanceName || src.host}`}
                    data-testid={`shell-instance-${src.id}`}
                    className="btn-press flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
                  >
                    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-container">
                      <SourceBrandIcon brand={brand} size={16} />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {src.instanceName || src.host}
                    </span>
                    <span className="material-symbols-outlined text-base opacity-60">
                      login
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
        <div className="border-t border-outline-variant/10 p-2">
          <button
            type="button"
            onClick={() => openSettings()}
            data-testid="shell-nav-settings"
            className="btn-press flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
          >
            <span className="material-symbols-outlined text-xl">settings</span>
            <span className="text-sm font-medium">Settings</span>
          </button>
        </div>
      </nav>

      {/* Main pane. */}
      <main className="min-w-0 flex-1">
        {section === "chats" && <SocialInboxPanel initialPeerId={chatPeerId} />}
        {section === "peers" && (
          <SocialPeersPanel onOpenConversation={openConversation} />
        )}
        {section === "network" && (
          <div className="h-full overflow-y-auto">
            <MeshMap />
          </div>
        )}
        {section === "reticulum" && (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex items-center gap-1 border-b border-outline-variant/10 px-3 py-2">
              {RETICULUM_TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setReticulumTab(t.id)}
                  data-testid={`shell-reticulum-tab-${t.id}`}
                  className={`btn-press flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                    reticulumTab === t.id
                      ? "bg-surface-container-high text-on-surface"
                      : "text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  <span className="material-symbols-outlined text-lg">{t.icon}</span>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              {reticulumTab === "announces" ? (
                <AnnouncesSection />
              ) : (
                <div className="h-full overflow-y-auto p-4">
                  <ReticulumInterfacesPanel />
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
