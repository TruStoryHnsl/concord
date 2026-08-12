/**
 * HomeScreen — the native personal-messenger front door (Cycle 1 wiring).
 *
 * Wraps codex's presentational `HomeView` with real data + routing:
 *   - feed from `useHomeFeed()` (the merged projection of dm/peer/source/local)
 *   - search query + filter tab + selection from `useHomeFeedStore`
 *   - opening a row raises a one-shot intent on the store that the
 *     always-mounted ChatLayout consumes to route into the EXISTING
 *     navStack drill-down / DM view (no behavior change to those surfaces).
 *   - the new-conversation affordance maps to the EXISTING flows:
 *     NewDMModal, the peers pairing surface, and the add-source entry.
 *
 * This component owns no selection truth — it is a thin adapter between the
 * projection and the existing navigation primitives.
 */

import { useEffect, useMemo, useState } from "react";
import { HomeView } from "./HomeView";
import { NativeChatSurface } from "./NativeChatSurface";
import type { ConversationRowProps } from "./ConversationRow";
import { NewDMModal } from "../dm/NewDMModal";
import { useHomeFeed } from "./useHomeFeed";
import { SocialPeersPanel } from "../social/peers/SocialPeersPanel";
import { SocialInboxPanel } from "../social/inbox/SocialInboxPanel";
import { GroupsPanel } from "../social/groups/GroupsPanel";
import {
  useHomeFeedStore,
  type Conversation,
  type HomeTab,
} from "../../stores/homeFeed";
import { useLocalServerSelectionStore } from "../../stores/localServerSelection";
import { useSettingsStore } from "../../stores/settings";
import { personaDefaultGet } from "../../api/userProfile";

const NOOP = () => {};

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

/** Primary shell tabs — the persistent messenger navigation. */
const HOME_TABS: Array<{ id: HomeTab; icon: string; label: string }> = [
  { id: "chats", icon: "forum", label: "Chats" },
  { id: "peers", icon: "group", label: "Peers" },
];

function NavTabButton({
  icon,
  label,
  active,
  onClick,
  className,
}: {
  icon: string;
  label: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={label}
      className={cx(
        "btn-press flex flex-col items-center justify-center gap-0.5 rounded-xl font-label text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        active
          ? "bg-primary/15 text-primary"
          : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
        className,
      )}
    >
      <span className="material-symbols-outlined text-2xl">{icon}</span>
      {label}
    </button>
  );
}

/** Desktop (md+): slim persistent left rail — Chats / Peers, Settings at foot. */
function HomeNavRail({
  tab,
  onSelectTab,
  onOpenSettings,
}: {
  tab: HomeTab;
  onSelectTab: (tab: HomeTab) => void;
  onOpenSettings: () => void;
}) {
  return (
    <nav
      aria-label="Primary"
      className="safe-top hidden h-full w-16 flex-shrink-0 flex-col items-center gap-1 border-r border-outline-variant/10 bg-surface-container py-3 md:flex"
    >
      {HOME_TABS.map((item) => (
        <NavTabButton
          key={item.id}
          icon={item.icon}
          label={item.label}
          active={tab === item.id}
          onClick={() => onSelectTab(item.id)}
          className="h-14 w-14"
        />
      ))}
      <div className="flex-1" />
      <button
        type="button"
        onClick={onOpenSettings}
        aria-label="Settings"
        title="Settings"
        className="btn-press flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <span className="material-symbols-outlined text-xl">settings</span>
      </button>
    </nav>
  );
}

/** Phone: persistent bottom tab bar — hidden while a chat fills the screen. */
function HomeNavBar({
  tab,
  onSelectTab,
}: {
  tab: HomeTab;
  onSelectTab: (tab: HomeTab) => void;
}) {
  return (
    <nav
      aria-label="Primary"
      className="safe-bottom flex flex-shrink-0 items-stretch gap-1 border-t border-outline-variant/10 bg-surface-container-low px-2 pt-1 md:hidden"
    >
      {HOME_TABS.map((item) => (
        <NavTabButton
          key={item.id}
          icon={item.icon}
          label={item.label}
          active={tab === item.id}
          onClick={() => onSelectTab(item.id)}
          className="h-14 flex-1"
        />
      ))}
    </nav>
  );
}

/**
 * Peers tab — the social surfaces, reachable at last:
 *   - Directory: the known-peers registry (SocialPeersPanel).
 *   - Inbox: the per-peer 1:1 conversation surface (SocialInboxPanel).
 *   - Groups: the p2p group surface (GroupsPanel).
 * A peer row's "Message" affordance jumps Directory → that peer's inbox
 * conversation. Wave 2 reuses the same seams (onOpenConversation /
 * initialPeerId) to route Chats-feed peer rows + live events here.
 */
function PeersSurface() {
  const [view, setView] = useState<"directory" | "inbox" | "groups">("directory");
  const [inboxPeerId, setInboxPeerId] = useState<string | null>(null);

  const openPeerConversation = (peerId: string) => {
    setInboxPeerId(peerId);
    setView("inbox");
  };

  return (
    <section
      aria-label="Peers"
      className="flex h-full min-h-0 flex-col bg-surface text-on-surface"
    >
      <header className="safe-top flex-shrink-0 border-b border-outline-variant/10 bg-surface-container-low">
        <div className="flex h-14 items-center gap-3 px-4">
          <h1 className="min-w-0 flex-1 truncate font-headline text-lg font-bold text-primary">
            Peers
          </h1>
          <div className="flex items-center gap-1 rounded-lg bg-surface-container p-1">
            {(
              [
                { id: "directory", label: "Directory" },
                { id: "inbox", label: "Inbox" },
                { id: "groups", label: "Groups" },
              ] as const
            ).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setView(item.id)}
                aria-pressed={view === item.id}
                className={cx(
                  "btn-press h-8 rounded-md px-3 font-label text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  view === item.id
                    ? "bg-primary/15 text-primary"
                    : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {view === "directory" ? (
          <div className="h-full overflow-y-auto px-4 py-3">
            <SocialPeersPanel onOpenConversation={openPeerConversation} />
          </div>
        ) : view === "groups" ? (
          <GroupsPanel />
        ) : (
          <SocialInboxPanel initialPeerId={inboxPeerId} />
        )}
      </div>
    </section>
  );
}

/** Map a projection Conversation onto codex's row props (sans onClick — the
 *  HomeView supplies the real click handler from `onSelectConversation`). */
function toRowProps(conv: Conversation): ConversationRowProps {
  const base = {
    id: conv.id,
    name: conv.displayName,
    preview: conv.preview,
    timestamp: conv.timestamp,
    unreadCount: conv.unreadCount,
    pinned: conv.pinned,
    onClick: NOOP,
  };
  if (conv.kind === "docker") {
    return { ...base, kind: "docker", source: conv.source! };
  }
  if (conv.kind === "local") {
    return { ...base, kind: "local", localLabel: conv.localLabel };
  }
  return {
    ...base,
    kind: conv.kind,
    userId: conv.userId,
    avatarUrl: conv.avatarUrl,
    presence: conv.presence,
    federationLabel: conv.federationLabel,
  };
}

export function HomeScreen() {
  const conversations = useHomeFeed();
  const query = useHomeFeedStore((s) => s.query);
  const filter = useHomeFeedStore((s) => s.filter);
  const selectedId = useHomeFeedStore((s) => s.selectedConversationId);
  const setQuery = useHomeFeedStore((s) => s.setQuery);
  const setFilter = useHomeFeedStore((s) => s.setFilter);
  const requestOpen = useHomeFeedStore((s) => s.requestOpen);
  const openConversation = useHomeFeedStore((s) => s.openConversation);
  const surface = useHomeFeedStore((s) => s.surface);
  const activeChat = useHomeFeedStore((s) => s.activeChat);
  const tab = useHomeFeedStore((s) => s.tab);
  const setTab = useHomeFeedStore((s) => s.setTab);

  const [showNewDM, setShowNewDM] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  // The active default (mesh) persona's display name, if any. Loaded once on
  // mount from the porch; `null` on web / when no default persona is set.
  const [personaLabel, setPersonaLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void personaDefaultGet()
      .then((persona) => {
        if (!cancelled) setPersonaLabel(persona?.display_name ?? null);
      })
      .catch(() => {
        // No porch / native-only IPC unavailable — leave the chip in its
        // "Set persona" prompt state rather than surfacing an error.
        if (!cancelled) setPersonaLabel(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { rows, byId } = useMemo(() => {
    const rows = conversations.map(toRowProps);
    const byId = new Map(conversations.map((c) => [c.id, c]));
    return { rows, byId };
  }, [conversations]);

  const handleSelect = (row: ConversationRowProps) => {
    const conv = byId.get(row.id);
    if (!conv) return;
    // DM → native messenger chat surface (WS-C). docker/local/bare-peer →
    // reveal the existing ChatLayout drill-down (WS-D + Cycle 1 behavior).
    openConversation(conv);
  };

  const openAddSource = () => {
    setMenuOpen(false);
    // Existing add-source entry: ChatLayout's mount effect consumes this
    // request and opens the pick-a-source flow. Reveal it underneath.
    useSettingsStore.getState().requestAddSource("pick");
    useHomeFeedStore.getState().showHandoff();
  };

  const openPairPeer = () => {
    setMenuOpen(false);
    // Existing pairing surface = the local source's `peers` pseudo-channel
    // (tap-to-pair + known-peer connect/call). Flag it, then route into the
    // local porch where ChatLayout renders it.
    useLocalServerSelectionStore.getState().setPeersOpen(true);
    requestOpen({ kind: "local" });
  };

  const openNewDM = () => {
    setMenuOpen(false);
    setShowNewDM(true);
  };

  // Open the existing Settings overlay at a specific tab and step the Home
  // front door aside so ChatLayout's settings panel shows underneath. Routes
  // through the settings store (which drives BOTH the desktop overlay and the
  // mobile settings view) rather than duplicating any account-management UI.
  const openSettingsAt = (tab?: "users" | "profile") => {
    setMenuOpen(false);
    setOverflowOpen(false);
    useSettingsStore.getState().openSettings(tab);
    useHomeFeedStore.getState().showHandoff();
  };

  // Reachable persona switcher → the existing Identity tab (UsersTab), which
  // owns persona create/select/designate-default + the SuperuserPanel.
  const openPersona = () => openSettingsAt("users");
  // Reachable superuser keychain + account backup/restore → the Profile tab
  // (ProfileTab: SuperuserBackupSection + AccountServicesSection).
  const openBackup = () => openSettingsAt("profile");

  // Reachable mesh map: flag it open, then reveal ChatLayout (which renders
  // <MeshMap/> for the active local source). Mirrors openPairPeer's pattern.
  const openMeshMap = () => {
    setMenuOpen(false);
    setOverflowOpen(false);
    useLocalServerSelectionStore.getState().setMeshMapOpen(true);
    requestOpen({ kind: "local" });
  };

  const openSettings = () => openSettingsAt();

  const chatActive = surface === "native-chat" && !!activeChat;

  const selectTab = (next: HomeTab) => {
    setMenuOpen(false);
    setOverflowOpen(false);
    setTab(next);
  };

  return (
    <>
      <div className="relative flex h-full w-full">
        <HomeNavRail
          tab={tab}
          onSelectTab={selectTab}
          onOpenSettings={openSettings}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            {tab === "peers" ? (
              <PeersSurface />
            ) : (
              <HomeView
                conversations={rows}
                selectedConversationId={selectedId ?? undefined}
                filter={filter}
                query={query}
                detail={
                  chatActive && activeChat ? (
                    <NativeChatSurface chat={activeChat} />
                  ) : undefined
                }
                phoneDetailActive={chatActive}
                onSelectConversation={handleSelect}
                onQueryChange={setQuery}
                onFilterChange={setFilter}
                onNewConversation={() => {
                  setOverflowOpen(false);
                  setMenuOpen((open) => !open);
                }}
                onAddSource={openAddSource}
                onOpenSettings={openSettings}
                personaLabel={personaLabel ?? undefined}
                onOpenPersona={openPersona}
                onOverflow={() => {
                  setMenuOpen(false);
                  setOverflowOpen((open) => !open);
                }}
              />
            )}
          </div>

          {/* Phone: hide the tab bar while a chat fills the screen so the
              conversation keeps every pixel; the in-chat back affordance
              returns to the list (and the bar). */}
          {!(tab === "chats" && chatActive) && (
            <HomeNavBar tab={tab} onSelectTab={selectTab} />
          )}
        </div>

        {menuOpen && (
          <>
            {/* click-away scrim */}
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setMenuOpen(false)}
            />
            <div className="safe-top absolute right-3 top-14 z-50 w-52 overflow-hidden rounded-xl bg-surface-container-high elev-md edge-hairline">
              <NewConvMenuItem icon="chat" label="Start a DM" onClick={openNewDM} />
              <NewConvMenuItem icon="hub" label="Pair a peer" onClick={openPairPeer} />
              <NewConvMenuItem icon="add_link" label="Add source" onClick={openAddSource} />
            </div>
          </>
        )}

        {overflowOpen && (
          <>
            {/* click-away scrim */}
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setOverflowOpen(false)}
            />
            <div className="safe-top absolute right-3 top-14 z-50 w-56 overflow-hidden rounded-xl bg-surface-container-high elev-md edge-hairline">
              <NewConvMenuItem
                icon="hub"
                label="Mesh map"
                onClick={openMeshMap}
              />
              <NewConvMenuItem
                icon="manage_accounts"
                label="Identity & personas"
                onClick={openPersona}
              />
              <NewConvMenuItem
                icon="backup"
                label="Account & backup"
                onClick={openBackup}
              />
            </div>
          </>
        )}
      </div>

      {showNewDM && <NewDMModal onClose={() => setShowNewDM(false)} />}
    </>
  );
}

function NewConvMenuItem({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="btn-press flex w-full items-center gap-3 px-3 py-2.5 text-left font-label text-sm text-on-surface transition-colors hover:bg-surface-container-highest"
    >
      <span className="material-symbols-outlined text-lg text-on-surface-variant">
        {icon}
      </span>
      {label}
    </button>
  );
}
