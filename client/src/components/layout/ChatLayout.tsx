import { useEffect, useState, useMemo, useCallback, useRef } from "react";
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
import { BugReportModal } from "../BugReportModal";
import { StatsModal } from "../StatsModal";

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
  const [showBugReport, setShowBugReport] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Resizable channel sidebar
  const SIDEBAR_MIN = 160;
  const SIDEBAR_MAX = 400;
  const SIDEBAR_DEFAULT = 224; // w-56
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      const saved = localStorage.getItem("concord_sidebar_width");
      if (saved) return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Number(saved)));
    } catch {}
    return SIDEBAR_DEFAULT;
  });
  const isDragging = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const onUp = () => {
      isDragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        localStorage.setItem("concord_sidebar_width", String(sidebarWidth));
      } catch {}
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [sidebarWidth]);

  // Persist sidebar width on change
  useEffect(() => {
    try { localStorage.setItem("concord_sidebar_width", String(sidebarWidth)); } catch {}
  }, [sidebarWidth]);

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
      loadServers(accessToken).then(() => {
        setServersLoaded(true);
      });
    }
  }, [accessToken, syncing, serversLoaded, loadServers]);

  // Load members when active server changes
  useEffect(() => {
    if (accessToken && activeServerId) {
      loadMembers(activeServerId, accessToken);
    }
  }, [accessToken, activeServerId, loadMembers]);

  return (
    <div className="h-full flex overflow-hidden bg-zinc-900 text-white">
      <ServerSidebar />
      <div className="flex min-h-0" style={{ width: sidebarWidth, minWidth: SIDEBAR_MIN, maxWidth: SIDEBAR_MAX }}>
        <ChannelSidebar />
      </div>
      {/* Resize handle */}
      <div
        onMouseDown={handleResizeStart}
        className="w-1 cursor-col-resize hover:bg-indigo-500/50 active:bg-indigo-500/70 transition-colors flex-shrink-0"
      />

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
                  {!syncing || !serversLoaded ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block w-3 h-3 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
                      {!syncing ? "Connecting..." : "Loading servers..."}
                    </span>
                  ) : servers.length === 0 ? (
                    "Welcome — join or create a server to get started"
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
                  <FloatingButtons onStats={() => setShowStats(true)} onBug={() => setShowBugReport(true)} onHelp={() => setShowHelp(true)} />
                  <MessageInput
                    onSend={sendMessage}
                    onSubmitEdit={editMessage}
                    onSendFile={activeServer?.media_uploads_enabled !== false ? sendFile : undefined}
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
              <div className="flex-1 flex items-center justify-center p-8">
                {!syncing || !serversLoaded ? (
                  <div className="flex flex-col items-center gap-3">
                    <span className="inline-block w-6 h-6 border-2 border-zinc-600 border-t-indigo-400 rounded-full animate-spin" />
                    <p className="text-zinc-500 text-sm">
                      {!syncing ? "Connecting..." : "Loading your servers..."}
                    </p>
                  </div>
                ) : servers.length === 0 ? (
                  <OnboardingGuide />
                ) : (
                  <div className="text-center space-y-2">
                    <p className="text-zinc-400">Select a channel to start chatting</p>
                    <p className="text-zinc-600 text-sm">
                      Pick a text or voice channel from the sidebar
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {showBugReport && <BugReportModal onClose={() => setShowBugReport(false)} />}
        {showStats && <StatsModal onClose={() => setShowStats(false)} />}
        {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      </div>
    </div>
  );
}

function FloatingButtons({ onStats, onBug, onHelp }: { onStats: () => void; onBug: () => void; onHelp: () => void }) {
  return (
    <div className="flex-shrink-0 flex justify-end gap-2 px-4 py-1">
      <button
        onClick={onHelp}
        className="btn-press w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 border border-zinc-700 text-zinc-500 hover:text-white hover:border-zinc-500 transition-colors"
        title="Help & Getting Started"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>
      <button
        onClick={onStats}
        className="btn-press w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 border border-zinc-700 text-zinc-500 hover:text-white hover:border-zinc-500 transition-colors"
        title="Your Stats"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      </button>
      <button
        onClick={onBug}
        className="btn-press w-8 h-8 flex items-center justify-center rounded-full bg-zinc-800 border border-zinc-700 text-zinc-500 hover:text-white hover:border-zinc-500 transition-colors"
        title="Report a Bug"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      </button>
    </div>
  );
}

function OnboardingGuide() {
  return (
    <div className="max-w-md w-full space-y-6 animate-[fadeSlideUp_0.5s_ease-out]">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-white">Welcome to Concord</h2>
        <p className="text-zinc-400 text-sm">
          Get started by joining or creating a server.
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-start gap-3 p-4 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
          <div className="w-8 h-8 rounded-full bg-indigo-600/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <span className="text-indigo-400 font-bold text-sm">+</span>
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-200">Create or browse servers</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Click the <strong className="text-zinc-400">+</strong> button in the left sidebar to create your own server or browse public ones.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-4 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
          <div className="w-8 h-8 rounded-full bg-emerald-600/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-200">Got an invite link?</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Paste the invite URL in your browser to automatically join a server.
            </p>
          </div>
        </div>

        <div className="flex items-start gap-3 p-4 rounded-lg bg-zinc-800/50 border border-zinc-700/50">
          <div className="w-8 h-8 rounded-full bg-amber-600/20 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-200">Customize your profile</p>
            <p className="text-xs text-zinc-500 mt-0.5">
              Click the gear icon in the bottom left to set up two-factor auth, change your password, and adjust audio settings.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative animate-[fadeSlideUp_0.3s_ease-out]">
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 w-8 h-8 flex items-center justify-center rounded-full bg-zinc-700 text-zinc-300 hover:text-white hover:bg-zinc-600 transition-colors z-10"
          title="Close"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
        <OnboardingGuide />
      </div>
    </div>
  );
}
