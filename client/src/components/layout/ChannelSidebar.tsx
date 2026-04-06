import { memo, useState, useMemo } from "react";
import { useServerStore } from "../../stores/server";
import { useAuthStore } from "../../stores/auth";
import { useToastStore } from "../../stores/toast";
import { useSettingsStore } from "../../stores/settings";
import { Avatar } from "../ui/Avatar";
import { useUnreadCounts } from "../../hooks/useUnreadCounts";
import { useVoiceParticipants } from "../../hooks/useVoiceParticipants";
import { InviteModal } from "../server/InviteModal";

interface ChannelSidebarProps {
  mobile?: boolean;
  onChannelSelect?: (roomId: string) => void;
}

export const ChannelSidebar = memo(function ChannelSidebar({ mobile, onChannelSelect }: ChannelSidebarProps) {
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeChannelId = useServerStore((s) => s.activeChannelId);
  const setActiveChannel = useServerStore((s) => s.setActiveChannel);
  const createChannelFn = useServerStore((s) => s.createChannel);
  const deleteServerFn = useServerStore((s) => s.deleteServer);
  const deleteChannelFn = useServerStore((s) => s.deleteChannel);
  const renameChannelFn = useServerStore((s) => s.renameChannel);
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
  const [renamingChannelId, setRenamingChannelId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const openServerSettings = useSettingsStore((s) => s.openServerSettings);
  const channelNotifications = useSettingsStore((s) => s.channelNotifications);
  const setChannelNotificationLevel = useSettingsStore((s) => s.setChannelNotificationLevel);
  const closeSettings = useSettingsStore((s) => s.closeSettings);
  const closeServerSettings = useSettingsStore((s) => s.closeServerSettings);

  if (!server) {
    return (
      <div className="w-full flex flex-col min-h-0 bg-surface-container-low">
        <div className="flex-1 flex flex-col items-center justify-center px-4 gap-3">
          <div className="w-12 h-12 rounded-full bg-surface-container-high flex items-center justify-center">
            <span className="material-symbols-outlined text-on-surface-variant text-2xl">forum</span>
          </div>
          <p className="text-on-surface-variant text-sm text-center font-body">
            No server selected
          </p>
          <p className="text-on-surface-variant/50 text-xs text-center font-label">
            Use the <strong className="text-on-surface">+</strong> button to create or join a server
          </p>
        </div>
        {!mobile && <UserBar userId={userId} logout={logout} />}
      </div>
    );
  }

  const isOwner = server.owner_id === userId;
  const canManage = isOwner;
  const textChannels = server.channels.filter((c) => c.channel_type === "text");
  const voiceChannels = server.channels.filter((c) => c.channel_type === "voice");

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channelName.trim() || !accessToken) return;
    try {
      await createChannelFn(server.id, channelName.trim(), channelType, accessToken);
      setChannelName("");
      setChannelType("text");
      setShowNewChannel(false);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to create channel");
    }
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

  const startRenameChannel = (channelId: number, currentName: string) => {
    setRenamingChannelId(channelId);
    setRenameValue(currentName);
  };

  const cancelRenameChannel = () => {
    setRenamingChannelId(null);
    setRenameValue("");
  };

  const submitRenameChannel = async (channelId: number) => {
    if (!accessToken) return;
    const trimmed = renameValue.trim();
    if (!trimmed) {
      cancelRenameChannel();
      return;
    }
    const original = server.channels.find((c) => c.id === channelId);
    if (!original || original.name === trimmed) {
      cancelRenameChannel();
      return;
    }
    try {
      await renameChannelFn(server.id, channelId, trimmed, accessToken);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Failed to rename channel");
    }
    cancelRenameChannel();
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

  const cycleNotificationLevel = (roomId: string) => {
    const current = channelNotifications[roomId];
    const next = !current ? "all" : current === "all" ? "mentions" : current === "mentions" ? "nothing" : "default";
    setChannelNotificationLevel(roomId, next);
  };

  const bellTitle = (roomId: string) => {
    const level = channelNotifications[roomId];
    if (!level) return "Notifications: Default (click to cycle)";
    return `Notifications: ${level === "all" ? "All" : level === "mentions" ? "Mentions" : "Muted"} (click to cycle)`;
  };

  const handleChannelClick = (roomId: string) => {
    closeSettings();
    closeServerSettings();
    if (onChannelSelect) {
      onChannelSelect(roomId);
    } else {
      setActiveChannel(roomId);
    }
  };

  const renderChannelItem = (ch: { id: number; name: string; matrix_room_id: string }, isVoice: boolean) => {
    const unread = unreadCounts.get(ch.matrix_room_id) ?? 0;
    const isActive = activeChannelId === ch.matrix_room_id;
    const notifLevel = channelNotifications[ch.matrix_room_id];
    const isRenaming = renamingChannelId === ch.id;
    return (
      <div key={ch.id} className="group flex items-center">
        {isRenaming ? (
          <form
            onSubmit={(e) => { e.preventDefault(); submitRenameChannel(ch.id); }}
            className="flex-1 flex items-center gap-1 px-3 py-1.5"
          >
            <span className="text-on-surface-variant text-sm">{isVoice ? "🔊" : "#"}</span>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={() => submitRenameChannel(ch.id)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.preventDefault(); cancelRenameChannel(); }
              }}
              autoFocus
              className="flex-1 min-w-0 px-2 py-0.5 bg-surface-container rounded-lg text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/30 font-body"
            />
          </form>
        ) : (
          <button
            onClick={() => handleChannelClick(ch.matrix_room_id)}
            className={`flex-1 min-w-0 text-left px-3 py-2 rounded-xl text-sm transition-all flex items-center justify-between font-body ${
              isActive
                ? "bg-surface-container-highest text-on-surface"
                : unread > 0
                  ? "text-on-surface hover:bg-surface-container-high"
                  : "text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
            }`}
          >
            <span className="flex items-center gap-2 min-w-0">
              {isVoice ? (
                <span className="material-symbols-outlined text-base flex-shrink-0">volume_up</span>
              ) : (
                <span className="text-on-surface-variant flex-shrink-0">#</span>
              )}
              <span className="truncate">{ch.name}</span>
            </span>
            <span className="flex items-center gap-1 ml-auto flex-shrink-0">
              {unread > 0 && !isActive && (
                <span className="primary-glow text-on-primary text-xs font-bold rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center font-label">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </span>
          </button>
        )}
        {/* Notification bell */}
        {!isRenaming && (
          <button
            onClick={() => cycleNotificationLevel(ch.matrix_room_id)}
            className={`text-xs px-0.5 transition-all ${
              notifLevel
                ? notifLevel === "nothing"
                  ? "text-error"
                  : notifLevel === "mentions"
                    ? "text-primary"
                    : "text-secondary"
                : "text-outline opacity-0 group-hover:opacity-100"
            }`}
            title={bellTitle(ch.matrix_room_id)}
          >
            <span className="material-symbols-outlined text-sm">
              {notifLevel === "nothing" ? "notifications_off" : "notifications"}
            </span>
          </button>
        )}
        {isOwner && !isRenaming && (
          <>
            <button
              onClick={() => startRenameChannel(ch.id, ch.name)}
              className="text-outline hover:text-on-surface text-xs px-1 opacity-0 group-hover:opacity-100 transition-opacity"
              title="Rename channel"
            >
              <span className="material-symbols-outlined text-sm">edit</span>
            </button>
            {confirmDeleteChannelId === ch.id ? (
              <button
                onClick={() => handleDeleteChannel(ch.id)}
                onMouseLeave={() => setConfirmDeleteChannelId(null)}
                className="text-error text-xs px-1 animate-pulse font-label"
                title="Click to confirm"
              >
                ?
              </button>
            ) : (
              <button
                onClick={() => setConfirmDeleteChannelId(ch.id)}
                className="text-outline hover:text-error text-xs px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Delete channel"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            )}
          </>
        )}
      </div>
    );
  };

  return (
    <div className="w-full flex flex-col min-h-0 bg-surface-container-low">
      {/* Server header */}
      <div className="p-3 flex items-center justify-between relative">
        <h2
          className="text-sm font-headline font-semibold text-on-surface truncate cursor-pointer hover:text-on-surface-variant transition-colors"
          onClick={() => setShowServerMenu(!showServerMenu)}
        >
          {server.name}
        </h2>
        <div className="flex items-center gap-1">
          {canManage && (
            <button
              onClick={() => openServerSettings(server.id)}
              title="Server Settings"
              className="text-on-surface-variant hover:text-on-surface transition-colors"
            >
              <span className="material-symbols-outlined text-lg">settings</span>
            </button>
          )}
          <button
            onClick={() => setShowInviteModal(true)}
            title="Create Invite Link"
            className="text-on-surface-variant hover:text-primary text-xs transition-colors font-label font-medium"
          >
            Invite
          </button>
        </div>

        {/* Server context menu */}
        {showServerMenu && (
          <div className="absolute top-full left-0 right-0 z-10 glass-panel rounded-xl shadow-lg mt-1 mx-2 overflow-hidden">
            {isOwner ? (
              confirmDeleteServer ? (
                <div className="p-3 text-center">
                  <p className="text-xs text-error mb-2 font-body">Delete "{server.name}"?</p>
                  <div className="flex gap-1">
                    <button
                      onClick={handleDeleteServer}
                      className="flex-1 text-xs py-1.5 bg-error-container text-on-error-container rounded-lg font-label"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setConfirmDeleteServer(false)}
                      className="flex-1 text-xs py-1.5 bg-surface-container-highest text-on-surface-variant rounded-lg font-label"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDeleteServer(true)}
                  className="w-full text-left px-3 py-2.5 text-sm text-error hover:bg-surface-container-high transition-colors font-body"
                >
                  Delete Server
                </button>
              )
            ) : (
              <button
                onClick={handleLeaveServer}
                className="w-full text-left px-3 py-2.5 text-sm text-error hover:bg-surface-container-high transition-colors font-body"
              >
                Leave Server
              </button>
            )}
            <button
              onClick={() => { setShowServerMenu(false); setConfirmDeleteServer(false); }}
              className="w-full text-left px-3 py-2.5 text-sm text-on-surface-variant hover:bg-surface-container-high transition-colors font-body"
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
            <h3 className="text-[10px] font-label font-medium text-on-surface-variant uppercase tracking-widest px-2 mb-1">
              Text Channels
            </h3>
            {textChannels.map((ch) => renderChannelItem(ch, false))}
          </div>
        )}

        {voiceChannels.length > 0 && (
          <div className="mb-3">
            <h3 className="text-[10px] font-label font-medium text-on-surface-variant uppercase tracking-widest px-2 mb-1">
              Voice Channels
            </h3>
            {voiceChannels.map((ch) => (
              <div key={ch.id}>
                {renderChannelItem(ch, true)}
                {voiceParticipants.get(ch.matrix_room_id)?.map((p) => (
                  <div key={p.identity} className="flex items-center gap-1.5 pl-8 py-0.5">
                    <Avatar userId={p.identity} size="sm" />
                    <span className="text-xs text-on-surface-variant truncate font-body">
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
                  className={`flex-1 py-1 rounded-lg text-xs font-label font-medium transition-colors ${
                    channelType === "text"
                      ? "bg-surface-container-highest text-on-surface"
                      : "text-on-surface-variant hover:text-on-surface"
                  }`}
                >
                  # Text
                </button>
                <button
                  type="button"
                  onClick={() => setChannelType("voice")}
                  className={`flex-1 py-1 rounded-lg text-xs font-label font-medium transition-colors ${
                    channelType === "voice"
                      ? "bg-surface-container-highest text-on-surface"
                      : "text-on-surface-variant hover:text-on-surface"
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
                onBlur={() => { if (!channelName.trim()) setShowNewChannel(false); }}
                className="w-full px-3 py-1.5 bg-surface-container rounded-xl text-sm text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/30 focus:bg-surface-container-high transition-all font-body"
              />
            </form>
          ) : (
            <button
              onClick={() => setShowNewChannel(true)}
              className="w-full text-left px-3 py-1.5 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high rounded-xl transition-colors font-body"
            >
              + Add Channel
            </button>
          )
        )}
      </div>

      {!mobile && <UserBar userId={userId} logout={logout} />}

      {showInviteModal && (
        <InviteModal serverId={server.id} onClose={() => setShowInviteModal(false)} />
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
    <div className="p-3 bg-surface-container flex items-center justify-between">
      <div className="flex items-center gap-2 min-w-0">
        {userId && <Avatar userId={userId} size="md" showPresence />}
        <span className="text-sm text-on-surface truncate font-body">
          {userId?.split(":")[0].replace("@", "")}
        </span>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={() => openSettings()}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
          title="Settings"
        >
          <span className="material-symbols-outlined text-lg">settings</span>
        </button>
        <button
          onClick={logout}
          className="px-2 py-1 rounded-lg text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors font-label"
        >
          Logout
        </button>
      </div>
    </div>
  );
}
