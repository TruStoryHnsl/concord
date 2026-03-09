import { memo, useState, useMemo } from "react";
import { useServerStore } from "../../stores/server";
import { useAuthStore } from "../../stores/auth";
import { useToastStore } from "../../stores/toast";
import { useSettingsStore } from "../../stores/settings";
import { Avatar } from "../ui/Avatar";
import { useUnreadCounts } from "../../hooks/useUnreadCounts";
import { useVoiceParticipants } from "../../hooks/useVoiceParticipants";

import { InviteModal } from "../server/InviteModal";

export const ChannelSidebar = memo(function ChannelSidebar() {
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeChannelId = useServerStore((s) => s.activeChannelId);
  const setActiveChannel = useServerStore((s) => s.setActiveChannel);
  const createChannelFn = useServerStore((s) => s.createChannel);
  // createInvite still available in store but we use InviteModal now
  const deleteServerFn = useServerStore((s) => s.deleteServer);
  const deleteChannelFn = useServerStore((s) => s.deleteChannel);
  const leaveServerFn = useServerStore((s) => s.leaveServer);
  const userId = useAuthStore((s) => s.userId);
  const accessToken = useAuthStore((s) => s.accessToken);
  const logout = useAuthStore((s) => s.logout);
  const addToast = useToastStore((s) => s.addToast);

  const unreadCounts = useUnreadCounts();

  const server = servers.find((s) => s.id === activeServerId);
  const voiceRoomIds = useMemo(
    () => (server?.channels ?? [])
      .filter((c) => c.channel_type === "voice")
      .map((c) => c.matrix_room_id),
    [server?.channels],
  );
  const voiceParticipants = useVoiceParticipants(voiceRoomIds);

  const [showNewChannel, setShowNewChannel] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelType, setChannelType] = useState<"text" | "voice">("text");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showServerMenu, setShowServerMenu] = useState(false);
  const [confirmDeleteServer, setConfirmDeleteServer] = useState(false);
  const [confirmDeleteChannelId, setConfirmDeleteChannelId] = useState<number | null>(null);
  const openServerSettings = useSettingsStore((s) => s.openServerSettings);

  if (!server) {
    return (
      <div className="w-56 flex flex-col min-h-0 border-r border-zinc-700 bg-sidebar">
        <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm">
          Create a server to get started
        </div>
        <UserBar userId={userId} logout={logout} />
      </div>
    );
  }

  const isOwner = server.owner_id === userId;
  // Note: full admin check would need members list; for now owner always sees gear,
  // and we allow admins via the settings modal's own API-level permission check
  const canManage = isOwner; // admins will get 403 if they try owner-only ops
  const textChannels = server.channels.filter(
    (c) => c.channel_type === "text",
  );
  const voiceChannels = server.channels.filter(
    (c) => c.channel_type === "voice",
  );

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelName.trim() || !accessToken) return;
    try {
      await createChannelFn(
        server.id,
        channelName.trim(),
        channelType,
        accessToken,
      );
      setChannelName("");
      setChannelType("text");
      setShowNewChannel(false);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to create channel");
    }
  };

  const handleInvite = () => {
    setShowInviteModal(true);
  };

  const handleDeleteServer = async () => {
    if (!accessToken) return;
    try {
      await deleteServerFn(server.id, accessToken);
      addToast("Server deleted", "success");
      setShowServerMenu(false);
      setConfirmDeleteServer(false);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to delete server");
    }
  };

  const handleDeleteChannel = async (channelId: number) => {
    if (!accessToken) return;
    try {
      await deleteChannelFn(server.id, channelId, accessToken);
      addToast("Channel deleted", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to delete channel");
    }
    setConfirmDeleteChannelId(null);
  };

  const handleLeaveServer = async () => {
    if (!accessToken) return;
    try {
      await leaveServerFn(server.id, accessToken);
      addToast("Left server", "info");
      setShowServerMenu(false);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to leave server");
    }
  };

  const channelNotifications = useSettingsStore((s) => s.channelNotifications);
  const setChannelNotificationLevel = useSettingsStore((s) => s.setChannelNotificationLevel);
  const closeSettings = useSettingsStore((s) => s.closeSettings);
  const closeServerSettings = useSettingsStore((s) => s.closeServerSettings);

  const cycleNotificationLevel = (roomId: string) => {
    const current = channelNotifications[roomId];
    // Cycle: default → all → mentions → nothing → default
    const next = !current ? "all" : current === "all" ? "mentions" : current === "mentions" ? "nothing" : "default";
    setChannelNotificationLevel(roomId, next);
  };

  const bellTitle = (roomId: string) => {
    const level = channelNotifications[roomId];
    if (!level) return "Notifications: Default (click to cycle)";
    return `Notifications: ${level === "all" ? "All" : level === "mentions" ? "Mentions" : "Muted"} (click to cycle)`;
  };

  const renderChannelItem = (ch: { id: number; name: string; matrix_room_id: string }, prefix: string) => {
    const unread = unreadCounts.get(ch.matrix_room_id) ?? 0;
    const isActive = activeChannelId === ch.matrix_room_id;
    const notifLevel = channelNotifications[ch.matrix_room_id];
    return (
    <div key={ch.id} className="group flex items-center">
      <button
        onClick={() => { closeSettings(); closeServerSettings(); setActiveChannel(ch.matrix_room_id); }}
        className={`flex-1 text-left px-3 py-1.5 rounded text-sm transition-colors flex items-center justify-between ${
          isActive
            ? "bg-zinc-700 text-white"
            : unread > 0
              ? "text-white hover:bg-zinc-800"
              : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
        }`}
      >
        <span>{prefix} {ch.name}</span>
        <span className="flex items-center gap-1 ml-auto">
          {unread > 0 && !isActive && (
            <span className="bg-indigo-600 text-white text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </span>
      </button>
      {/* Bell icon for notification level */}
      <button
        onClick={() => cycleNotificationLevel(ch.matrix_room_id)}
        className={`text-xs px-0.5 transition-all ${
          notifLevel
            ? notifLevel === "nothing"
              ? "text-red-400"
              : notifLevel === "mentions"
                ? "text-amber-400"
                : "text-emerald-400"
            : "text-zinc-600 opacity-0 group-hover:opacity-100"
        }`}
        title={bellTitle(ch.matrix_room_id)}
      >
        {notifLevel === "nothing" ? (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707A1 1 0 0112 5v14a1 1 0 01-1.707.707L5.586 15z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
          </svg>
        )}
      </button>
      {isOwner && (
        confirmDeleteChannelId === ch.id ? (
          <button
            onClick={() => handleDeleteChannel(ch.id)}
            onMouseLeave={() => setConfirmDeleteChannelId(null)}
            className="text-red-400 text-xs px-1 animate-pulse"
            title="Click to confirm"
          >
            ?
          </button>
        ) : (
          <button
            onClick={() => setConfirmDeleteChannelId(ch.id)}
            className="text-zinc-600 hover:text-red-400 text-xs px-1 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Delete channel"
          >
            x
          </button>
        )
      )}
    </div>
  );
  };

  return (
    <div className="w-56 flex flex-col min-h-0 border-r border-zinc-700 bg-sidebar">
      {/* Server header */}
      <div className="p-3 border-b border-zinc-700 flex items-center justify-between relative">
        <h2
          className="text-sm font-semibold text-white truncate cursor-pointer hover:text-zinc-300"
          onClick={() => setShowServerMenu(!showServerMenu)}
        >
          {server.name}
        </h2>
        <div className="flex items-center gap-1">
          {canManage && (
            <button
              onClick={() => openServerSettings(server.id)}
              title="Server Settings"
              className="text-zinc-500 hover:text-white transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          )}
          <button
            onClick={handleInvite}
            title="Create Invite Link"
            className="text-zinc-500 hover:text-white text-xs transition-colors"
          >
            Invite
          </button>
        </div>

        {/* Server context menu */}
        {showServerMenu && (
          <div className="absolute top-full left-0 right-0 z-10 bg-zinc-800 border border-zinc-700 rounded-md shadow-lg mt-1 mx-2">
            {isOwner ? (
              confirmDeleteServer ? (
                <div className="p-2 text-center">
                  <p className="text-xs text-red-400 mb-2">Delete "{server.name}"?</p>
                  <div className="flex gap-1">
                    <button
                      onClick={handleDeleteServer}
                      className="flex-1 text-xs py-1 bg-red-600 hover:bg-red-500 text-white rounded"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDeleteServer(false)}
                      className="flex-1 text-xs py-1 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteServer(true)}
                  className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-zinc-700 transition-colors"
                >
                  Delete Server
                </button>
              )
            ) : (
              <button
                onClick={handleLeaveServer}
                className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-zinc-700 transition-colors"
              >
                Leave Server
              </button>
            )}
            <button
              onClick={() => {
                setShowServerMenu(false);
                setConfirmDeleteServer(false);
              }}
              className="w-full text-left px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-700 transition-colors border-t border-zinc-700"
            >
              Close
            </button>
          </div>
        )}
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto p-2">
        {textChannels.length > 0 && (
          <div className="mb-3">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-2 mb-1">
              Text Channels
            </h3>
            {textChannels.map((ch) => renderChannelItem(ch, "#"))}
          </div>
        )}

        {voiceChannels.length > 0 && (
          <div className="mb-3">
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-2 mb-1">
              Voice Channels
            </h3>
            {voiceChannels.map((ch) => (
              <div key={ch.id}>
                {renderChannelItem(ch, "🔊")}
                {/* Voice participants */}
                {voiceParticipants.get(ch.matrix_room_id)?.map((p) => (
                  <div
                    key={p.identity}
                    className="flex items-center gap-1.5 pl-6 py-0.5"
                  >
                    <Avatar userId={p.identity} size="sm" />
                    <span className="text-xs text-zinc-400 truncate">
                      {p.name || p.identity.split(":")[0].replace("@", "")}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* New channel (owner only) */}
        {isOwner && (
          showNewChannel ? (
            <form onSubmit={handleCreateChannel} className="px-1 space-y-1.5">
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setChannelType("text")}
                  className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${
                    channelType === "text"
                      ? "bg-zinc-700 text-white"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  # Text
                </button>
                <button
                  type="button"
                  onClick={() => setChannelType("voice")}
                  className={`flex-1 py-1 rounded text-xs font-medium transition-colors ${
                    channelType === "voice"
                      ? "bg-zinc-700 text-white"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Voice
                </button>
              </div>
              <input
                type="text"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                placeholder="channel-name"
                autoFocus
                onBlur={() => {
                  if (!channelName.trim()) setShowNewChannel(false);
                }}
                className="w-full px-3 py-1.5 bg-zinc-800 border border-zinc-600 rounded text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
              />
            </form>
          ) : (
            <button
              onClick={() => setShowNewChannel(true)}
              className="w-full text-left px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
            >
              + Add Channel
            </button>
          )
        )}
      </div>

      <UserBar userId={userId} logout={logout} />

      {showInviteModal && (
        <InviteModal
          serverId={server.id}
          onClose={() => setShowInviteModal(false)}
        />
      )}
    </div>
  );
});

function UserBar({
  userId,
  logout,
}: {
  userId: string | null;
  logout: () => void;
}) {
  const openSettings = useSettingsStore((s) => s.openSettings);

  return (
    <div className="p-3 border-t border-zinc-700 flex items-center justify-between">
      <div className="flex items-center gap-2 min-w-0">
        {userId && <Avatar userId={userId} size="md" showPresence />}
        <span className="text-sm text-zinc-300 truncate">
          {userId?.split(":")[0].replace("@", "")}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => openSettings()}
          className="flex items-center gap-1 px-2 py-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50 transition-colors"
          title="Settings"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
        <button
          onClick={logout}
          className="px-2 py-1 rounded text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50 transition-colors"
        >
          Logout
        </button>
      </div>
    </div>
  );
}
