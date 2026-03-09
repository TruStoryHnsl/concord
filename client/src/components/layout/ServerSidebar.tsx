import { memo, useState } from "react";
import { useServerStore } from "../../stores/server";
import { useUnreadCounts } from "../../hooks/useUnreadCounts";
import { NewServerModal } from "../server/NewServerModal";

export const ServerSidebar = memo(function ServerSidebar() {
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const unreadCounts = useUnreadCounts();
  const [showNewServer, setShowNewServer] = useState(false);

  return (
    <div className="w-16 bg-zinc-950 flex flex-col items-center py-3 gap-2 border-r border-zinc-800 overflow-y-auto min-h-0">
      {servers.map((server) => {
        const isActive = activeServerId === server.id;
        const hasUnreads = !isActive && server.channels.some(
          (ch) => (unreadCounts.get(ch.matrix_room_id) ?? 0) > 0,
        );
        return (
          <div key={server.id} className="relative">
            <button
              onClick={() => setActiveServer(server.id)}
              title={server.name}
              className={`w-12 h-12 rounded-2xl flex items-center justify-center text-sm font-bold transition-all hover:rounded-xl ${
                isActive
                  ? "bg-indigo-600 text-white rounded-xl"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"
              }`}
            >
              {server.abbreviation || server.name.charAt(0).toUpperCase()}
            </button>
            {hasUnreads && (
              <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-indigo-500 rounded-full border-2 border-zinc-950" />
            )}
          </div>
        );
      })}

      {/* Create/browse server button */}
      <button
        onClick={() => setShowNewServer(true)}
        title="Add Server"
        className="w-12 h-12 rounded-2xl bg-zinc-800 text-zinc-500 hover:bg-emerald-600 hover:text-white hover:rounded-xl flex items-center justify-center text-xl transition-all"
      >
        +
      </button>

      {showNewServer && (
        <NewServerModal onClose={() => setShowNewServer(false)} />
      )}
    </div>
  );
});
