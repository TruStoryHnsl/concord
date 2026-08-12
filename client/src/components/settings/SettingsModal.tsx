import { useEffect, useState, useMemo } from "react";
import { useSettingsStore } from "../../stores/settings";
import { useAuthStore } from "../../stores/auth";
import { useServerStore } from "../../stores/server";
import { checkAdmin } from "../../api/concord";
import { usePlatform } from "../../hooks/usePlatform";
import { AudioTab } from "./AudioTab";
import { VoiceTab } from "./VoiceTab";
import { NotificationsTab } from "./NotificationsTab";
import { ProfileTab } from "./ProfileTab";
import { UsersTab } from "./UsersTab";
import { AppearanceTab } from "./AppearanceTab";
import { NodeHostingTab } from "./NodeHostingTab";
import { UserConnectionsTab } from "./UserConnectionsTab";
import { AboutTab } from "./AboutTab";
import { HostingTab } from "./HostingTab";
import { ConnectorsTab } from "./ConnectorsTab";
import { AdminTab } from "./AdminTab";
import { DevicesTab } from "./DevicesTab";
import { ServerSettingsContent } from "./ServerSettingsModal";
import { SocialPeersPanel } from "../social/peers/SocialPeersPanel";
import { SocialInboxPanel } from "../social/inbox/SocialInboxPanel";

/**
 * INS-012 + Settings makeover (#5): Unified settings panel.
 *
 * The legacy panel rendered every category as a flat strip of pill
 * buttons stacked above the content, which scaled badly: 12 user tabs
 * plus a server picker plus N server tabs all competed for the same
 * horizontal band, and related controls (Audio vs. Voice, Profile vs.
 * Identity vs. Connections) had no visual relationship.
 *
 * The makeover replaces that with a real settings layout: a scannable
 * left rail of *grouped* categories beside a single scrolling content
 * pane. Groups collapse the long list into ~6 headed sections so the
 * navigation reads top-to-bottom instead of wrapping. Each leaf is the
 * same self-contained tab component as before — this is a navigation /
 * information-architecture reorganization, not a control rewrite, so
 * every existing control and its behavior is preserved verbatim.
 *
 * Responsive: on wide viewports the rail sits beside the content
 * (two-pane). On narrow / mobile viewports the rail becomes a
 * drill-in list — tapping a category swaps to its content with a back
 * affordance — so the controls always get full width.
 *
 * Server settings stay a first-class concern: admin servers (and any
 * server opened via a context menu) surface as a "Server Settings"
 * group whose items are that server's per-server tabs. A compact server
 * picker selects which server the group reflects.
 */

type LeafKey =
  | "audio"
  | "voice"
  | "notifications"
  | "profile"
  | "users"
  | "connections"
  | "peers"
  | "messages"
  | "devices"
  | "appearance"
  | "node"
  | "connectors"
  | "hosting"
  | "about"
  | "admin"
  | "server-general"
  | "server-members"
  | "server-invite"
  | "server-bans"
  | "server-whitelist"
  | "server-webhooks"
  | "server-moderation"
  | "server-federation";

type LeafDef = {
  key: LeafKey;
  label: string;
  icon: string;
  /** Optional one-line description shown under the label in the rail. */
  hint?: string;
};

type GroupDef = {
  id: string;
  label: string;
  /** Leading icon for the group header. */
  icon: string;
  items: LeafDef[];
};

const EMPTY_MEMBERS: never[] = [];

// Pure helper — compute server settings tabs (leaves) for a given
// server/member context. Unchanged from the legacy panel so the server
// settings surface keeps identical visibility rules.
function buildServerLeaves(
  server: { id: string; owner_id: string; federated?: boolean; visibility?: string },
  members: { user_id: string; role: string }[],
  userId: string | null,
): LeafDef[] {
  if (server.federated) {
    return [{ key: "server-federation", label: "Federation", icon: "language" }];
  }
  const myMember = members.find((m) => m.user_id === userId);
  const isOwner = server.owner_id === userId;
  const isAdmin = isOwner || myMember?.role === "admin";
  const leaves: LeafDef[] = [
    { key: "server-general", label: "General", icon: "settings" },
    { key: "server-members", label: "Members", icon: "group" },
  ];
  if (isAdmin) leaves.push({ key: "server-invite", label: "Invite", icon: "person_add" });
  leaves.push({ key: "server-bans", label: "Bans", icon: "block" });
  if (server.visibility === "private") leaves.push({ key: "server-whitelist", label: "Whitelist", icon: "verified_user" });
  leaves.push({ key: "server-webhooks", label: "Webhooks", icon: "webhook" });
  if (isAdmin) leaves.push({ key: "server-moderation", label: "Moderation", icon: "gavel" });
  return leaves;
}

export function SettingsPanel() {
  const activeTab = useSettingsStore((s) => s.settingsTab);
  const setTab = useSettingsStore((s) => s.setSettingsTab);
  const close = useSettingsStore((s) => s.closeSettings);
  const serverSettingsId = useSettingsStore((s) => s.serverSettingsId);
  const setServerSettingsId = useSettingsStore((s) => s.setServerSettingsId);
  const accessToken = useAuthStore((s) => s.accessToken);
  const userId = useAuthStore((s) => s.userId);
  const [isAdmin, setIsAdmin] = useState(false);
  const { isTauri, isTV, hasTouchOnly } = usePlatform();

  // Track viewport width so the shell can flip between the two-pane
  // (rail + content) desktop layout and the drill-in mobile layout. We
  // key off a media-query-ish breakpoint rather than `isMobile` so the
  // desktop web app at a narrow window also gets the drill-in behavior.
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 768 : false,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setNarrow(window.innerWidth < 768);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const tvFocusProps = isTV
    ? ({ "data-focusable": "true", "data-focus-group": "tv-main" } as const)
    : ({} as const);

  const servers = useServerStore((s) => s.servers);
  const membersByServer = useServerStore((s) => s.members);

  // Servers where the user is owner or has the admin role.
  const adminServers = useMemo(
    () =>
      servers.filter((s) => {
        if (s.owner_id === userId) return true;
        return membersByServer[s.id]?.some((m) => m.user_id === userId && m.role === "admin") ?? false;
      }),
    [servers, membersByServer, userId],
  );

  // Server-settings leaves per admin server.
  const adminServerLeaves = useMemo(() => {
    const map = new Map<string, LeafDef[]>();
    for (const server of adminServers) {
      map.set(server.id, buildServerLeaves(server, membersByServer[server.id] ?? EMPTY_MEMBERS, userId));
    }
    return map;
  }, [adminServers, membersByServer, userId]);

  // If serverSettingsId points to a non-admin server (opened via a
  // context menu), still surface that server's section so the user
  // doesn't lose context after landing here from a gear click.
  const contextServer =
    serverSettingsId && !adminServerLeaves.has(serverSettingsId)
      ? (servers.find((s) => s.id === serverSettingsId) ?? null)
      : null;
  const contextServerLeaves = useMemo(
    () =>
      contextServer
        ? buildServerLeaves(contextServer, membersByServer[contextServer.id] ?? EMPTY_MEMBERS, userId)
        : [],
    [contextServer, membersByServer, userId],
  );

  // Leaves for whichever server is currently active in the content pane.
  const activeServerLeaves = serverSettingsId
    ? (adminServerLeaves.get(serverSettingsId) ?? contextServerLeaves)
    : [];

  // Grouped user-settings navigation. Groups collapse the formerly-flat
  // 12-item strip into a handful of scannable headed sections.
  const userGroups = useMemo<GroupDef[]>(() => {
    const groups: GroupDef[] = [
      {
        id: "audio-voice",
        label: "Audio & Voice",
        icon: "graphic_eq",
        items: [
          { key: "audio", label: "Audio", icon: "headphones", hint: "Output & normalization" },
          { key: "voice", label: "Voice", icon: "mic", hint: "Input & processing" },
        ],
      },
      {
        id: "account",
        label: "Account",
        icon: "account_circle",
        items: [
          { key: "profile", label: "Profile", icon: "person", hint: "Name, avatar, security" },
          { key: "users", label: "Identity", icon: "manage_accounts", hint: "Logins & trust" },
          { key: "connections", label: "Connections", icon: "link", hint: "Linked instances & peers" },
          // p2p-social: the known-peers registry + 1:1 inbox. Native-only —
          // both ride the embedded servitude swarm (Tauri commands), so they
          // gate on isTauri like Node/Connectors below.
          ...(isTauri
            ? ([
                { key: "peers", label: "Peers", icon: "groups", hint: "Known-peers registry" },
                { key: "messages", label: "Messages", icon: "forum", hint: "Per-peer inboxes" },
                { key: "devices", label: "Devices", icon: "devices", hint: "This device & merge proposals" },
              ] as LeafDef[])
            : []),
        ],
      },
      {
        id: "app",
        label: "App",
        icon: "tune",
        items: [
          { key: "notifications", label: "Notifications", icon: "notifications" },
          { key: "appearance", label: "Appearance", icon: "palette", hint: "Theme & text size" },
        ],
      },
    ];

    // Instance group — hosting plus the native-only node/connectors.
    const instanceItems: LeafDef[] = [
      { key: "hosting", label: "Hosting", icon: "dns", hint: "Keep your server online" },
    ];
    if (isTauri) {
      // INS-022: Node is visible on mobile Tauri too — the embedded
      // servitude module runs on mobile.
      instanceItems.push({ key: "node", label: "Node", icon: "lan", hint: "Embedded homeserver" });
      // F7 / W2.4 — external-mesh connectors (Reticulum, Meshtastic,
      // LoRa). Native-only: connectors run in the swarm, not the browser.
      instanceItems.push({ key: "connectors", label: "Connectors", icon: "device_hub", hint: "Mesh & radio bridges" });
    }
    groups.push({ id: "instance", label: "Instance", icon: "hub", items: instanceItems });

    if (isAdmin) {
      groups.push({
        id: "admin",
        label: "Administration",
        icon: "shield_person",
        items: [{ key: "admin", label: "Admin", icon: "shield_person", hint: "Server administration" }],
      });
    }

    groups.push({
      id: "about",
      label: "About",
      icon: "info",
      items: [{ key: "about", label: "About", icon: "info" }],
    });

    return groups;
  }, [isTauri, isAdmin]);

  // Set of all user-settings leaf keys (used to distinguish user vs.
  // server context when auto-selecting tabs).
  const userLeafKeys = useMemo(
    () => new Set<string>(userGroups.flatMap((g) => g.items.map((i) => i.key))),
    [userGroups],
  );

  // Server-settings group, if any server is in context.
  const serverGroup = useMemo<GroupDef | null>(() => {
    const options: { server: (typeof servers)[0]; leaves: LeafDef[] }[] = [];
    for (const server of adminServers) {
      const leaves = adminServerLeaves.get(server.id);
      if (leaves && leaves.length > 0) options.push({ server, leaves });
    }
    if (
      contextServer &&
      contextServerLeaves.length > 0 &&
      !options.some((o) => o.server.id === contextServer.id)
    ) {
      options.push({ server: contextServer, leaves: contextServerLeaves });
    }
    if (options.length === 0) return null;

    const selected = options.find((o) => o.server.id === serverSettingsId) ?? null;
    return {
      id: "server",
      label: "Server Settings",
      icon: "dns",
      items: selected ? selected.leaves : [],
    };
  }, [adminServers, adminServerLeaves, contextServer, contextServerLeaves, serverSettingsId, servers]);

  const serverPickerOptions = useMemo(() => {
    const opts: { id: string; name: string }[] = [];
    for (const server of adminServers) {
      const leaves = adminServerLeaves.get(server.id);
      if (leaves && leaves.length > 0) opts.push({ id: server.id, name: server.name });
    }
    if (
      contextServer &&
      contextServerLeaves.length > 0 &&
      !opts.some((o) => o.id === contextServer.id)
    ) {
      opts.push({ id: contextServer.id, name: contextServer.name });
    }
    return opts;
  }, [adminServers, adminServerLeaves, contextServer, contextServerLeaves]);

  // Auto-select the first server tab when server context activates and
  // the active tab isn't a valid server leaf.
  useEffect(() => {
    if (!serverSettingsId || activeServerLeaves.length === 0) return;
    if (activeServerLeaves.some((t) => t.key === activeTab)) return;
    if (userLeafKeys.has(activeTab)) return;
    setTab(activeServerLeaves[0].key as typeof activeTab);
  }, [activeTab, serverSettingsId, activeServerLeaves, setTab, userLeafKeys]);

  useEffect(() => {
    if (!accessToken) return;
    checkAdmin(accessToken).then((r) => setIsAdmin(r.is_admin)).catch(() => {});
  }, [accessToken]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [close]);

  const isServerTab = activeTab.startsWith("server-");
  const serverSubTab = isServerTab ? activeTab.replace("server-", "") : null;

  // Selecting a user-settings leaf. We do NOT clear server context so
  // the admin server section stays highlighted in the rail; it only
  // clears on close (preserving the legacy navigation contract).
  const handleSelectTab = (tab: LeafKey) => {
    setTab(tab as typeof activeTab);
  };

  // Selecting a server-settings leaf — set which server's content to
  // show, then switch to that leaf.
  const handleSelectServerTab = (serverId: string, tab: LeafKey) => {
    setServerSettingsId(serverId);
    setTab(tab as typeof activeTab);
  };

  // On narrow layouts the rail and content are separate "screens". We
  // show the content screen whenever a leaf has been chosen; the back
  // button returns to the rail screen. `showContentScreen` starts true
  // so deep-links (e.g. openServerSettings) land directly on content.
  const [showContentScreen, setShowContentScreen] = useState(true);

  const allGroups = useMemo(
    () => (serverGroup ? [...userGroups, serverGroup] : userGroups),
    [userGroups, serverGroup],
  );

  // Find the active leaf's label for the content header.
  const activeLeafLabel = useMemo(() => {
    for (const g of allGroups) {
      const found = g.items.find((i) => i.key === activeTab);
      if (found) return found.label;
    }
    if (isServerTab) {
      // Server leaf not yet materialized into the visible group (e.g.
      // before the picker resolves) — fall back to a readable label.
      const sub = serverSubTab ?? "";
      return sub ? sub.charAt(0).toUpperCase() + sub.slice(1) : "Server";
    }
    return "Settings";
  }, [allGroups, activeTab, isServerTab, serverSubTab]);

  const selectLeaf = (group: GroupDef, leaf: LeafDef) => {
    if (group.id === "server") {
      // The server picker drives which server the group reflects; the
      // leaves already belong to the selected server.
      const sel = serverPickerOptions.find((o) => o.id === serverSettingsId);
      if (sel) handleSelectServerTab(sel.id, leaf.key);
    } else {
      handleSelectTab(leaf.key);
    }
    if (narrow) setShowContentScreen(true);
  };

  // ----- Rail (category list) -----
  const rail = (
    <nav
      aria-label="Settings categories"
      className="flex flex-col gap-5 p-3"
      data-testid="settings-rail"
    >
      {allGroups.map((group) => (
        <div key={group.id} className="flex flex-col gap-1.5">
          {/* Category header — a filled, primary-tinted icon chip + a bold
              label, deliberately distinct from the (indented, plain) leaf rows
              below so the rail reads as headers-over-items, not a flat list. */}
          <div className="flex items-center gap-2.5 px-1 pb-0.5">
            <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/12 ring-1 ring-primary/20 flex-shrink-0">
              <span
                className="material-symbols-outlined text-lg text-primary"
                style={{ fontVariationSettings: '"FILL" 1, "wght" 500, "GRAD" 0, "opsz" 20' }}
              >
                {group.icon}
              </span>
            </span>
            <span className="text-[0.72rem] font-headline font-bold text-on-surface uppercase tracking-[0.13em]">
              {group.label}
            </span>
          </div>

          {/* Server group gets a compact picker above its leaves so the
             user chooses which server the section reflects. */}
          {group.id === "server" && serverPickerOptions.length > 0 && (
            <div className="px-1 pb-1">
              <label className="block">
                <span className="sr-only">Select server</span>
                <select
                  value={serverSettingsId ?? ""}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id) {
                      setServerSettingsId(null);
                      return;
                    }
                    const opt = serverPickerOptions.find((o) => o.id === id);
                    if (!opt) return;
                    // Keep the active server leaf if it still applies,
                    // otherwise jump to the new server's first leaf.
                    const sourceLeaves =
                      adminServerLeaves.get(id) ??
                      (contextServer?.id === id ? contextServerLeaves : []);
                    const staying = sourceLeaves.some((l) => l.key === activeTab);
                    handleSelectServerTab(
                      id,
                      (staying ? activeTab : sourceLeaves[0]?.key ?? "server-general") as LeafKey,
                    );
                    if (narrow) setShowContentScreen(true);
                  }}
                  {...tvFocusProps}
                  className="w-full px-3 py-2 rounded-xl text-sm bg-surface-container-high text-on-surface border border-outline-variant/20 focus:outline-none focus:border-primary/40"
                >
                  <option value="">Select server…</option>
                  {serverPickerOptions.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {/* Leaf rows — nested under the category via a left guide line +
              indent, so they're visually subordinate to the header above. */}
          <div className="flex flex-col gap-0.5 ml-3.5 pl-2.5 border-l border-outline-variant/15">
          {group.items.map((leaf) => {
            const active =
              activeTab === leaf.key &&
              (group.id !== "server" || serverSettingsId != null);
            return (
              <button
                key={leaf.key}
                onClick={() => selectLeaf(group, leaf)}
                {...tvFocusProps}
                aria-current={active ? "page" : undefined}
                className={`btn-press group/leaf relative flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 rounded-lg transition-colors ${
                  active
                    ? "bg-surface-container-highest text-on-surface"
                    : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                }`}
              >
                {active && (
                  <span className="absolute -left-[0.72rem] top-1/2 -translate-y-1/2 h-4 w-0.5 rounded-full bg-primary" />
                )}
                <span
                  className={`material-symbols-outlined text-lg flex-shrink-0 ${
                    active ? "text-primary" : "text-on-surface-variant/70"
                  }`}
                  style={
                    active
                      ? { fontVariationSettings: '"FILL" 1, "wght" 500, "GRAD" 0, "opsz" 20' }
                      : undefined
                  }
                >
                  {leaf.icon}
                </span>
                <span className="min-w-0 flex flex-col">
                  <span className="text-sm font-label leading-tight truncate">{leaf.label}</span>
                  {leaf.hint && (
                    <span className="text-xs text-on-surface-variant/55 leading-tight truncate">
                      {leaf.hint}
                    </span>
                  )}
                </span>
                {narrow && (
                  <span className="material-symbols-outlined text-lg text-on-surface-variant/40 ml-auto flex-shrink-0">
                    chevron_right
                  </span>
                )}
              </button>
            );
          })}
          </div>
        </div>
      ))}
    </nav>
  );

  // ----- Content pane -----
  // The Messages (per-peer inbox) surface is a full-height two-pane layout
  // (conversation rail + transcript), so it opts out of the centered,
  // max-w-2xl scrolling column the other leaf tabs share and fills the
  // content area instead.
  const content =
    activeTab === "messages" ? (
      <div
        key={`${serverSettingsId ?? "user"}:messages`}
        className="h-full min-h-0"
        data-testid="settings-content"
      >
        <SocialInboxPanel />
      </div>
    ) : (
    <div
      key={`${serverSettingsId ?? "user"}:${activeTab}`}
      className="mx-auto w-full max-w-2xl p-6"
      data-testid="settings-content"
    >
      {/* User settings tabs */}
      {activeTab === "audio" && <AudioTab />}
      {activeTab === "voice" && <VoiceTab />}
      {activeTab === "notifications" && <NotificationsTab />}
      {activeTab === "profile" && <ProfileTab />}
      {activeTab === "users" && <UsersTab />}
      {activeTab === "connections" && <UserConnectionsTab />}
      {activeTab === "peers" && <SocialPeersPanel />}
      {activeTab === "devices" && <DevicesTab />}
      {activeTab === "appearance" && <AppearanceTab />}
      {activeTab === "node" && <NodeHostingTab />}
      {activeTab === "connectors" && <ConnectorsTab />}
      {activeTab === "hosting" && <HostingTab />}
      {activeTab === "about" && <AboutTab />}
      {activeTab === "admin" && isAdmin && <AdminTab />}

      {/* Server settings tabs — delegated to ServerSettingsContent */}
      {isServerTab && serverSettingsId && accessToken && (
        <ServerSettingsContent serverId={serverSettingsId} activeTab={serverSubTab!} />
      )}
    </div>
    );

  // ----- Layout -----
  // Wide: two-pane (rail beside scrolling content).
  // Narrow: drill-in (rail screen ↔ content screen with a back button).
  if (narrow) {
    return (
      <div className="flex-1 flex flex-col min-h-0 bg-surface">
        {showContentScreen ? (
          <>
            <div className="h-12 flex items-center gap-2 px-2 bg-surface-container-low flex-shrink-0 border-b border-outline-variant/10">
              <button
                onClick={() => setShowContentScreen(false)}
                {...tvFocusProps}
                className="btn-press flex items-center justify-center w-9 h-9 rounded-full text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
                aria-label="Back to settings categories"
              >
                <span className="material-symbols-outlined text-xl">arrow_back</span>
              </button>
              <h2 className="font-headline font-semibold text-on-surface truncate">
                {activeLeafLabel}
              </h2>
            </div>
            <div className="flex-1 overflow-y-auto min-h-0">{content}</div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0">{rail}</div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex min-h-0 bg-surface">
      {/* Left rail */}
      <aside
        className={`flex-shrink-0 ${
          hasTouchOnly ? "w-72" : "w-64"
        } border-r border-outline-variant/10 bg-surface-container-low/40 overflow-y-auto`}
      >
        {rail}
      </aside>
      {/* Content pane */}
      <div className="flex-1 overflow-y-auto min-h-0">{content}</div>
    </div>
  );
}
