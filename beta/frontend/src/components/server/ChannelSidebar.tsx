import { useState, useCallback } from "react";
import type { ChannelPayload, ServerPayload } from "@/api/tauri";

interface ChannelSidebarProps {
  server: ServerPayload;
  channels: ChannelPayload[];
  activeChannelId: string | null;
  onSelectChannel: (id: string) => void;
  isOwner: boolean;
  onBack: () => void;
}

function ChannelSidebar({
  server,
  channels,
  activeChannelId,
  onSelectChannel,
  isOwner,
  onBack,
}: ChannelSidebarProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const textChannels = channels.filter((c) => c.channelType === "text");
  const voiceChannels = channels.filter((c) => c.channelType === "voice");
  const videoChannels = channels.filter((c) => c.channelType === "video");

  const toggleSection = useCallback((section: string) => {
    setCollapsed((prev) => ({ ...prev, [section]: !prev[section] }));
  }, []);

  return (
    <div className="flex flex-col h-full bg-surface-container-low">
      {/* Server Header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-outline-variant/20">
        <button
          onClick={onBack}
          className="flex items-center justify-center w-8 h-8 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors md:hidden"
        >
          <span className="material-symbols-outlined text-lg">arrow_back</span>
        </button>
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 shrink-0">
          <span className="material-symbols-outlined text-primary text-base">
            dns
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-headline font-bold text-sm text-on-surface truncate">
            {server.name}
          </p>
          <p className="text-[10px] text-on-surface-variant font-body">
            {server.memberCount} member{server.memberCount !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Channel List */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-3">
        {/* Text Channels */}
        {textChannels.length > 0 && (
          <ChannelSection
            label="Text Channels"
            channels={textChannels}
            icon="tag"
            activeChannelId={activeChannelId}
            onSelectChannel={onSelectChannel}
            collapsed={collapsed["text"] ?? false}
            onToggle={() => toggleSection("text")}
          />
        )}

        {/* Voice Channels */}
        {voiceChannels.length > 0 && (
          <ChannelSection
            label="Voice Channels"
            channels={voiceChannels}
            icon="volume_up"
            activeChannelId={activeChannelId}
            onSelectChannel={onSelectChannel}
            collapsed={collapsed["voice"] ?? false}
            onToggle={() => toggleSection("voice")}
          />
        )}

        {/* Video Channels */}
        {videoChannels.length > 0 && (
          <ChannelSection
            label="Video Channels"
            channels={videoChannels}
            icon="videocam"
            activeChannelId={activeChannelId}
            onSelectChannel={onSelectChannel}
            collapsed={collapsed["video"] ?? false}
            onToggle={() => toggleSection("video")}
          />
        )}
      </div>

      {/* Create Channel Button (owner only) */}
      {isOwner && (
        <div className="px-3 py-2 border-t border-outline-variant/20">
          <button className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors text-xs font-label">
            <span className="material-symbols-outlined text-sm">add</span>
            Create Channel
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Channel Section ─────────────────────────────────────── */

function ChannelSection({
  label,
  channels,
  icon,
  activeChannelId,
  onSelectChannel,
  collapsed,
  onToggle,
}: {
  label: string;
  channels: ChannelPayload[];
  icon: string;
  activeChannelId: string | null;
  onSelectChannel: (id: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-1 w-full px-1 py-1 text-left"
      >
        <span
          className={`material-symbols-outlined text-[10px] text-on-surface-variant transition-transform ${
            collapsed ? "-rotate-90" : ""
          }`}
        >
          expand_more
        </span>
        <span className="font-label text-[10px] uppercase tracking-widest text-on-surface-variant">
          {label}
        </span>
      </button>

      {!collapsed && (
        <div className="space-y-0.5 mt-0.5">
          {channels.map((channel) => {
            const isActive = channel.id === activeChannelId;
            return (
              <button
                key={channel.id}
                onClick={() => onSelectChannel(channel.id)}
                className={`flex items-center gap-2 w-full px-2 py-1.5 rounded-lg text-left transition-colors ${
                  isActive
                    ? "bg-surface-container-high text-on-surface"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container"
                }`}
              >
                <span
                  className={`material-symbols-outlined text-base ${
                    isActive ? "text-primary" : ""
                  }`}
                >
                  {icon}
                </span>
                <span className="font-body text-sm truncate">
                  {channel.name}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ChannelSidebar;
