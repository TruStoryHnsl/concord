/**
 * PeerMessengerSurface — full-pane p2p messenger (PRIMARY surface).
 *
 * Promotes the per-peer inboxes (SocialInboxPanel — conversation list +
 * message history + composer) and the known-peers registry
 * (SocialPeersPanel) out of the Settings tabs into the main shell.
 * Opened from the rail's peer-messages tile; takes the chat pane over
 * the Discord-style surfaces while open (same pattern as
 * ReticulumSurface).
 *
 * Native-first: the panels ride the embedded servitude via Tauri IPC.
 * The docker/web variant is pending the server-side per-user history
 * store (incident-2026-08-11 open item) — the rail tile is gated on
 * isTauri until that lands, so this surface is never reachable with a
 * broken data layer.
 */
import { usePeerMessengerSurfaceStore } from "../../stores/peerMessengerSurface";
import { SocialInboxPanel } from "./inbox/SocialInboxPanel";
import { SocialPeersPanel } from "./peers/SocialPeersPanel";

const TABS = [
  { id: "messages" as const, icon: "forum", label: "Messages" },
  { id: "peers" as const, icon: "groups", label: "Peers" },
];

export function PeerMessengerSurface() {
  const tab = usePeerMessengerSurfaceStore((s) => s.tab);
  const setTab = usePeerMessengerSurfaceStore((s) => s.setTab);
  const initialPeerId = usePeerMessengerSurfaceStore((s) => s.initialPeerId);
  const openConversation = usePeerMessengerSurfaceStore(
    (s) => s.openConversation,
  );

  return (
    <div
      className="h-full w-full min-h-0 flex flex-col bg-surface"
      data-testid="peer-messenger-surface"
    >
      <div className="flex items-center gap-1 border-b border-outline-variant/10 px-3 py-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`btn-press flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
              tab === t.id
                ? "bg-surface-container-high text-on-surface"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
            data-testid={`peer-messenger-tab-${t.id}`}
          >
            <span className="material-symbols-outlined text-lg">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === "messages" ? (
          <SocialInboxPanel initialPeerId={initialPeerId} />
        ) : (
          <SocialPeersPanel onOpenConversation={openConversation} />
        )}
      </div>
    </div>
  );
}
