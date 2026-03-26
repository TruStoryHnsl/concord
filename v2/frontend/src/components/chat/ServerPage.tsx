import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useServersStore } from "@/stores/servers";
import { useAuthStore } from "@/stores/auth";
import ChannelSidebar from "@/components/server/ChannelSidebar";
import ServerHeader from "@/components/server/ServerHeader";
import MemberList from "@/components/server/MemberList";
import InvitePanel from "@/components/server/InvitePanel";
import MessageList from "./MessageList";
import MessageInput from "./MessageInput";
import GlassPanel from "@/components/ui/GlassPanel";
import VoiceChannel from "@/components/voice/VoiceChannel";

function ServerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const peerId = useAuthStore((s) => s.peerId);

  const servers = useServersStore((s) => s.servers);
  const activeServerId = useServersStore((s) => s.activeServerId);
  const activeChannelId = useServersStore((s) => s.activeChannelId);
  const channels = useServersStore((s) => s.channels);
  const members = useServersStore((s) => s.members);
  const messages = useServersStore((s) => s.messages);
  const loadingChannels = useServersStore((s) => s.loadingChannels);
  const loadingMessages = useServersStore((s) => s.loadingMessages);
  const selectServer = useServersStore((s) => s.selectServer);
  const selectChannel = useServersStore((s) => s.selectChannel);
  const loadServers = useServersStore((s) => s.loadServers);

  const [showSidebar, setShowSidebar] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  // Load server data when route changes
  useEffect(() => {
    if (!id) return;
    const serverId = id;

    async function init() {
      // Make sure we have servers loaded
      if (servers.length === 0) {
        await loadServers();
      }
      // Select this server if not already active
      if (activeServerId !== serverId) {
        await selectServer(serverId);
      }
    }
    void init();
  }, [id, activeServerId, selectServer, loadServers, servers.length]);

  const handleSelectChannel = useCallback(
    (channelId: string) => {
      void selectChannel(channelId);
      setShowSidebar(false);
    },
    [selectChannel],
  );

  const handleBack = useCallback(() => {
    navigate("/");
  }, [navigate]);

  // Find the current server from the store
  const server = servers.find((s) => s.id === id) ?? null;
  const activeChannel = channels.find((c) => c.id === activeChannelId) ?? null;
  const isOwner = server ? server.ownerId === peerId : false;
  const isTextChannel = activeChannel?.channelType === "text";

  // Loading state
  if (!server && loadingChannels) {
    return (
      <div className="mesh-background min-h-full flex items-center justify-center">
        <div className="relative z-10 text-center space-y-3">
          <span className="material-symbols-outlined text-5xl text-primary/40 animate-pulse">
            dns
          </span>
          <p className="font-headline font-semibold text-on-surface">
            Loading server...
          </p>
        </div>
      </div>
    );
  }

  // Server not found
  if (!server && !loadingChannels) {
    return (
      <div className="mesh-background min-h-full flex items-center justify-center p-4">
        <div className="relative z-10">
          <GlassPanel className="p-8 text-center space-y-3 max-w-md">
            <span className="material-symbols-outlined text-5xl text-error/40">
              error_outline
            </span>
            <p className="font-headline font-semibold text-on-surface">
              Server not found
            </p>
            <p className="text-sm text-on-surface-variant font-body">
              This server may have been removed or you don&apos;t have access.
            </p>
            <button
              onClick={handleBack}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-primary hover:bg-primary/10 transition-colors font-label text-sm"
            >
              <span className="material-symbols-outlined text-lg">
                arrow_back
              </span>
              Back to Dashboard
            </button>
          </GlassPanel>
        </div>
      </div>
    );
  }

  if (!server) return null;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Mobile sidebar overlay */}
      {showSidebar && (
        <div
          className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm md:hidden"
          onClick={() => setShowSidebar(false)}
        />
      )}

      {/* Channel Sidebar */}
      <aside
        className={`
          ${showSidebar ? "fixed inset-y-0 left-0 z-50" : "hidden"}
          md:relative md:flex
          w-56 shrink-0
        `}
      >
        <ChannelSidebar
          server={server}
          channels={channels}
          activeChannelId={activeChannelId}
          onSelectChannel={handleSelectChannel}
          isOwner={isOwner}
          onBack={handleBack}
        />
      </aside>

      {/* Main content area */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Server Header */}
        <ServerHeader
          channel={activeChannel}
          memberCount={members.length}
          onToggleSidebar={() => setShowSidebar((p) => !p)}
          onShowInvite={() => setShowInvite(true)}
          onBack={handleBack}
        />

        {/* Chat or channel placeholder */}
        {activeChannel && isTextChannel ? (
          <div className="flex flex-1 overflow-hidden min-h-0">
            {/* Chat area */}
            <div className="flex flex-col flex-1 min-w-0">
              {loadingMessages ? (
                <div className="flex-1 flex items-center justify-center">
                  <span className="material-symbols-outlined text-3xl text-primary/40 animate-pulse">
                    hourglass_empty
                  </span>
                </div>
              ) : (
                <MessageList messages={messages} ownPeerId={peerId} />
              )}
              <MessageInput
                channelId={activeChannelId ?? undefined}
                serverId={server.id}
                placeholder={`Message #${activeChannel.name}...`}
              />
            </div>

            {/* Members sidebar — desktop only */}
            <aside className="hidden lg:flex w-56 shrink-0 flex-col p-3 overflow-y-auto border-l border-outline-variant/20">
              <MemberList server={server} members={members} />
            </aside>
          </div>
        ) : activeChannel && !isTextChannel ? (
          /* Voice / Video channel */
          <VoiceChannel channel={activeChannel} serverId={server.id} />
        ) : (
          /* No channel selected */
          <div className="flex-1 flex items-center justify-center p-6">
            <GlassPanel className="p-8 text-center space-y-3 max-w-sm">
              <span className="material-symbols-outlined text-5xl text-primary/40">
                forum
              </span>
              <p className="font-headline font-semibold text-on-surface">
                {loadingChannels
                  ? "Loading channels..."
                  : "Select a channel"}
              </p>
              <p className="text-sm text-on-surface-variant font-body">
                {loadingChannels
                  ? "Fetching server data..."
                  : "Pick a channel from the sidebar to start chatting."}
              </p>
            </GlassPanel>
          </div>
        )}
      </div>

      {/* Invite Modal */}
      {showInvite && (
        <InvitePanel
          serverId={server.id}
          existingCode={server.inviteCode}
          onClose={() => setShowInvite(false)}
        />
      )}
    </div>
  );
}

export default ServerPage;
