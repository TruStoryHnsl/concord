import { memo, useState, useMemo } from "react";
import { useServerStore } from "../../stores/server";
import { useDMStore } from "../../stores/dm";
import { useUnreadCounts } from "../../hooks/useUnreadCounts";
import { NewServerModal } from "../server/NewServerModal";

interface ServerSidebarProps {
  mobile?: boolean;
  onServerSelect?: () => void;
}

export const ServerSidebar = memo(function ServerSidebar({ mobile, onServerSelect }: ServerSidebarProps) {
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const unreadCounts = useUnreadCounts();
  const [showNewServer, setShowNewServer] = useState(false);

  // DM state
  const dmActive = useDMStore((s) => s.dmActive);
  const setDMActive = useDMStore((s) => s.setDMActive);
  const dmConversations = useDMStore((s) => s.conversations);

  // Check if any DM has unreads
  const hasDMUnreads = useMemo(
    () => dmConversations.some((dm) => (unreadCounts.get(dm.matrix_room_id) ?? 0) > 0),
    [dmConversations, unreadCounts],
  );

  const handleServerClick = (serverId: string) => {
    setDMActive(false);
    setActiveServer(serverId);
    onServerSelect?.();
  };

  const handleDMClick = () => {
    useServerStore.setState({ activeServerId: null, activeChannelId: null });
    setDMActive(true);
  };

  // Mobile: full-width list view
  if (mobile) {
    return (
      <div className="h-full bg-surface-container-low overflow-y-auto p-3">
        <h3 className="text-xs font-label font-medium text-on-surface-variant uppercase tracking-widest px-2 mb-3">
          Your Servers
        </h3>
        <div className="space-y-1">
          {servers.map((server) => {
            const isActive = !dmActive && activeServerId === server.id;
            const hasUnreads = !isActive && server.channels.some(
              (ch) => (unreadCounts.get(ch.matrix_room_id) ?? 0) > 0,
            );
            return (
              <button
                key={server.id}
                onClick={() => handleServerClick(server.id)}
                className={`btn-press w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all ${
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-on-surface hover:bg-surface-container-high"
                }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-headline font-bold flex-shrink-0 ${
                  isActive
                    ? "primary-glow text-on-primary"
                    : "bg-surface-container-highest text-on-surface-variant"
                }`}>
                  {server.abbreviation || server.name.charAt(0).toUpperCase()}
                </div>
                <span className="truncate font-body font-medium">{server.name}</span>
                {hasUnreads && (
                  <div className="w-2.5 h-2.5 rounded-full bg-primary ml-auto flex-shrink-0 node-pulse" />
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => setShowNewServer(true)}
          className="btn-press w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-on-surface-variant hover:text-secondary hover:bg-secondary/5 transition-all mt-2"
        >
          <div className="w-10 h-10 rounded-xl bg-surface-container-highest flex items-center justify-center flex-shrink-0">
            <span className="material-symbols-outlined text-xl">add</span>
          </div>
          <span className="font-body font-medium">Add Server</span>
        </button>

        {showNewServer && <NewServerModal onClose={() => setShowNewServer(false)} />}
      </div>
    );
  }

  // Desktop: compact icon sidebar
  return (
    <div className="w-16 bg-surface flex flex-col items-center py-3 gap-2 overflow-y-auto min-h-0">
      {/* DM button */}
      <div className="relative group">
        <div className={`absolute -left-1 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-primary transition-all ${
          dmActive ? "h-8" : hasDMUnreads ? "h-2" : "h-0 group-hover:h-5"
        }`} />
        <button
          onClick={handleDMClick}
          title="Direct Messages"
          className={`btn-press w-12 h-12 flex items-center justify-center transition-all ${
            dmActive
              ? "primary-glow text-on-primary rounded-xl"
              : "bg-surface-container-high text-on-surface-variant rounded-2xl hover:rounded-xl hover:bg-surface-container-highest hover:text-on-surface"
          }`}
        >
          <span className="material-symbols-outlined text-xl">chat_bubble</span>
        </button>
        {hasDMUnreads && !dmActive && (
          <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-primary rounded-full border-2 border-surface node-pulse" />
        )}
      </div>

      {/* Divider */}
      <div className="w-8 h-px bg-outline-variant/20 my-0.5" />

      {/* Server list */}
      {servers.map((server) => {
        const isActive = !dmActive && activeServerId === server.id;
        const hasUnreads = !isActive && server.channels.some(
          (ch) => (unreadCounts.get(ch.matrix_room_id) ?? 0) > 0,
        );
        return (
          <div key={server.id} className="relative group">
            {/* Active indicator bar */}
            <div className={`absolute -left-1 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-primary transition-all ${
              isActive ? "h-8" : hasUnreads ? "h-2" : "h-0 group-hover:h-5"
            }`} />
            <button
              onClick={() => handleServerClick(server.id)}
              title={server.name}
              className={`btn-press w-12 h-12 flex items-center justify-center text-sm font-headline font-bold transition-all ${
                isActive
                  ? "primary-glow text-on-primary rounded-xl"
                  : "bg-surface-container-high text-on-surface-variant rounded-2xl hover:rounded-xl hover:bg-surface-container-highest hover:text-on-surface"
              }`}
            >
              {server.abbreviation || server.name.charAt(0).toUpperCase()}
            </button>
            {hasUnreads && (
              <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-primary rounded-full border-2 border-surface node-pulse" />
            )}
          </div>
        );
      })}

      {/* Add server */}
      <button
        onClick={() => setShowNewServer(true)}
        title="Add Server"
        className="btn-press w-12 h-12 rounded-2xl bg-surface-container-high text-on-surface-variant hover:bg-secondary/10 hover:text-secondary hover:rounded-xl flex items-center justify-center transition-all"
      >
        <span className="material-symbols-outlined text-xl">add</span>
      </button>

      {showNewServer && <NewServerModal onClose={() => setShowNewServer(false)} />}
    </div>
  );
});
