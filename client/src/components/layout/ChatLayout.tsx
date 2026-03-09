import { useEffect, useState, useMemo } from "react";
import {
  useMatrixSync,
  useRoomMessages,
  useSendMessage,
  useDeleteMessage,
  useEditMessage,
  useSendFile,
  useSendReaction,
  useRemoveReaction,
} from "../../hooks/useMatrix";
import type { ChatMessage } from "../../hooks/useMatrix";
import { useTypingUsers, useSendTyping } from "../../hooks/useTyping";
import { useAuthStore } from "../../stores/auth";
import { useServerStore } from "../../stores/server";
import { useSendReadReceipt } from "../../hooks/useUnreadCounts";
import { useNotifications } from "../../hooks/useNotifications";
import { useSettingsStore } from "../../stores/settings";
import { ServerSidebar } from "./ServerSidebar";
import { ChannelSidebar } from "./ChannelSidebar";
import { MessageList } from "../chat/MessageList";
import { MessageInput } from "../chat/MessageInput";
import { TypingIndicator } from "../chat/TypingIndicator";
import { VoiceChannel } from "../voice/VoiceChannel";
import { SettingsPanel } from "../settings/SettingsModal";
import { ServerSettingsPanel } from "../settings/ServerSettingsModal";

export function ChatLayout() {
  const syncing = useMatrixSync();
  const client = useAuthStore((s) => s.client);
  const userId = useAuthStore((s) => s.userId);
  const accessToken = useAuthStore((s) => s.accessToken);
  const loadServers = useServerStore((s) => s.loadServers);
  const activeChannelId = useServerStore((s) => s.activeChannelId);
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);

  const { messages, isPaginating, hasMore, loadMore } = useRoomMessages(activeChannelId);
  const sendMessage = useSendMessage(activeChannelId);
  const deleteMessage = useDeleteMessage(activeChannelId);
  const editMessage = useEditMessage(activeChannelId);
  const { sendFile, uploading } = useSendFile(activeChannelId);
  const sendReaction = useSendReaction(activeChannelId);
  const removeReaction = useRemoveReaction(activeChannelId);
  const typingUsers = useTypingUsers(activeChannelId);
  const { onKeystroke, onStopTyping } = useSendTyping(activeChannelId);
  useSendReadReceipt(activeChannelId);
  useNotifications();

  const [editingMessage, setEditingMessage] = useState<ChatMessage | null>(null);

  // Clear edit state on channel switch
  useEffect(() => {
    setEditingMessage(null);
  }, [activeChannelId]);

  const activeServer = useMemo(
    () => servers.find((s) => s.id === activeServerId),
    [servers, activeServerId],
  );
  const activeChannel = useMemo(
    () => activeServer?.channels.find((c) => c.matrix_room_id === activeChannelId),
    [activeServer, activeChannelId],
  );
  const isVoiceChannel = activeChannel?.channel_type === "voice";
  const isOwner = activeServer?.owner_id === userId;
  const settingsOpen = useSettingsStore((s) => s.settingsOpen);
  const closeSettings = useSettingsStore((s) => s.closeSettings);
  const serverSettingsId = useSettingsStore((s) => s.serverSettingsId);
  const closeServerSettings = useSettingsStore((s) => s.closeServerSettings);

  const memberCount = useMemo(() => {
    if (!client || !activeChannelId) return 0;
    const room = client.getRoom(activeChannelId);
    if (!room) return 0;
    return room.getJoinedMemberCount();
  }, [client, activeChannelId, syncing]);

  const loadMembers = useServerStore((s) => s.loadMembers);
  const [serversLoaded, setServersLoaded] = useState(false);

  useEffect(() => {
    if (accessToken && syncing && !serversLoaded) {
      loadServers(accessToken).then(() => setServersLoaded(true));
    }
  }, [accessToken, syncing, serversLoaded, loadServers]);

  // Load members when active server changes
  useEffect(() => {
    if (accessToken && activeServerId) {
      loadMembers(activeServerId, accessToken);
    }
  }, [accessToken, activeServerId, loadMembers]);

  return (
    <div className="h-screen flex overflow-hidden bg-zinc-900 text-white">
      <ServerSidebar />
      <ChannelSidebar />

      <div className="flex-1 flex flex-col min-h-0 min-w-0">
        {settingsOpen ? (
          <>
            <div className="h-12 border-b border-zinc-700 flex items-center px-4 justify-between">
              <h2 className="font-semibold">Settings</h2>
              <button
                onClick={closeSettings}
                className="text-sm text-zinc-400 hover:text-white transition-colors"
              >
                Back
              </button>
            </div>
            <SettingsPanel />
          </>
        ) : serverSettingsId ? (
          <>
            <div className="h-12 border-b border-zinc-700 flex items-center px-4 justify-between">
              <h2 className="font-semibold">
                {servers.find((s) => s.id === serverSettingsId)?.name ?? "Server"} — Settings
              </h2>
              <button
                onClick={closeServerSettings}
                className="text-sm text-zinc-400 hover:text-white transition-colors"
              >
                Back
              </button>
            </div>
            <ServerSettingsPanel serverId={serverSettingsId} />
          </>
        ) : (
          <>
            {/* Channel header */}
            <div className="h-12 border-b border-zinc-700 flex items-center px-4">
              {activeChannel ? (
                <div className="flex items-center gap-3">
                  <h2 className="font-semibold">
                    {isVoiceChannel ? "🔊" : "#"} {activeChannel.name}
                  </h2>
                  {memberCount > 0 && (
                    <span className="text-xs text-zinc-500">
                      {memberCount} {memberCount === 1 ? "member" : "members"}
                    </span>
                  )}
                </div>
              ) : (
                <span className="text-zinc-500">
                  {!syncing ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block w-3 h-3 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
                      Connecting...
                    </span>
                  ) : servers.length === 0 ? (
                    "Create a server to get started"
                  ) : (
                    "Select a channel"
                  )}
                </span>
              )}
            </div>

            {/* Content: voice or text */}
            {activeChannelId && activeChannel ? (
              isVoiceChannel ? (
                <VoiceChannel
                  roomId={activeChannelId}
                  channelName={activeChannel.name}
                  serverId={activeServerId!}
                />
              ) : (
                <>
                  <MessageList
                    messages={messages}
                    isPaginating={isPaginating}
                    hasMore={hasMore}
                    onLoadMore={loadMore}
                    currentUserId={userId}
                    isServerOwner={isOwner}
                    onDelete={deleteMessage}
                    onStartEdit={setEditingMessage}
                    onReact={sendReaction}
                    onRemoveReaction={removeReaction}
                  />
                  <TypingIndicator typingUsers={typingUsers} />
                  <MessageInput
                    onSend={sendMessage}
                    onSubmitEdit={editMessage}
                    onSendFile={sendFile}
                    uploading={uploading}
                    editingMessage={editingMessage}
                    onCancelEdit={() => setEditingMessage(null)}
                    onKeystroke={onKeystroke}
                    onStopTyping={onStopTyping}
                    roomName={activeChannel.name}
                  />
                </>
              )
            ) : (
              <div className="flex-1 flex items-center justify-center text-zinc-500">
                {servers.length === 0
                  ? "Create a server using the + button on the left"
                  : "Select a channel to start chatting"}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
