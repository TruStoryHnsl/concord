import { useState, useCallback } from "react";
import {
  useLocalParticipant,
  useConnectionState,
  useRoomContext,
} from "@livekit/components-react";
import { ConnectionState } from "livekit-client";
import { useVoiceStore } from "../../stores/voice";
import { useServerStore } from "../../stores/server";

export function VoiceConnectionBar() {
  const connected = useVoiceStore((s) => s.connected);
  const channelName = useVoiceStore((s) => s.channelName);
  const serverId = useVoiceStore((s) => s.serverId);
  const channelId = useVoiceStore((s) => s.channelId);
  const disconnect = useVoiceStore((s) => s.disconnect);
  const servers = useServerStore((s) => s.servers);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const setActiveChannel = useServerStore((s) => s.setActiveChannel);
  const activeChannelId = useServerStore((s) => s.activeChannelId);

  if (!connected) return null;

  // Don't show the bar when we're already viewing the voice channel
  if (activeChannelId === channelId) return null;

  const serverName = servers.find((s) => s.id === serverId)?.name ?? "Server";

  return (
    <div className="flex items-center justify-between px-3 md:px-4 py-2 md:py-2 bg-emerald-900/90 border-t border-emerald-700/50 backdrop-blur-sm flex-shrink-0 safe-bottom">
      <div className="flex items-center gap-2 text-sm text-emerald-200 min-w-0">
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
        <span className="truncate">
          <strong>#{channelName}</strong>
          <span className="hidden sm:inline"> in <strong>{serverName}</strong></span>
        </span>
      </div>

      <VoiceBarControls
        onReturn={() => {
          if (serverId) setActiveServer(serverId);
          if (channelId) setActiveChannel(channelId);
        }}
        onLeave={disconnect}
      />
    </div>
  );
}

function VoiceBarControls({
  onReturn,
  onLeave,
}: {
  onReturn: () => void;
  onLeave: () => void;
}) {
  const { localParticipant } = useLocalParticipant();
  const connectionState = useConnectionState();
  const room = useRoomContext();
  const [deafened, setDeafened] = useState(false);
  const isMicEnabled = localParticipant.isMicrophoneEnabled;

  const toggleMic = useCallback(async () => {
    try {
      await localParticipant.setMicrophoneEnabled(!isMicEnabled);
    } catch {
      // Permission or state error — ignore
    }
  }, [localParticipant, isMicEnabled]);

  const toggleDeafen = useCallback(() => {
    const newDeaf = !deafened;
    setDeafened(newDeaf);

    // Deafen: mute all remote audio subscriptions
    for (const p of room.remoteParticipants.values()) {
      for (const pub of p.audioTrackPublications.values()) {
        if (pub.track) {
          pub.track.mediaStreamTrack.enabled = !newDeaf;
        }
      }
    }

    // Also mute mic when deafening (Discord behavior)
    if (newDeaf && isMicEnabled) {
      localParticipant.setMicrophoneEnabled(false);
    }
  }, [room, localParticipant, deafened, isMicEnabled]);

  if (connectionState !== ConnectionState.Connected) return null;

  return (
    <div className="flex items-center gap-1.5">
      {/* Mute */}
      <button
        onClick={toggleMic}
        className={`btn-press min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 px-3 py-2 md:px-2.5 md:py-1 text-xs rounded-lg md:rounded transition-colors flex items-center justify-center ${
          isMicEnabled
            ? "bg-emerald-800 hover:bg-emerald-700 text-emerald-200"
            : "bg-red-600/30 text-red-300 hover:bg-red-600/50"
        }`}
        title={isMicEnabled ? "Mute" : "Unmute"}
      >
        <svg className="w-5 h-5 md:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          {isMicEnabled ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3z" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3z M3 3l18 18" />
          )}
        </svg>
        <span className="hidden md:inline">{isMicEnabled ? "Mic On" : "Mic Off"}</span>
      </button>

      {/* Return to channel */}
      <button
        onClick={onReturn}
        className="btn-press min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 px-3 py-2 md:px-2.5 md:py-1 text-xs bg-emerald-800 hover:bg-emerald-700 text-emerald-200 rounded-lg md:rounded transition-colors flex items-center justify-center"
        title="Return to voice channel"
      >
        <svg className="w-5 h-5 md:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 15l-3-3m0 0l3-3m-3 3h8M3 12a9 9 0 1118 0 9 9 0 01-18 0z" /></svg>
        <span className="hidden md:inline">Return</span>
      </button>

      {/* Leave */}
      <button
        onClick={onLeave}
        className="btn-press min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 px-3 py-2 md:px-2.5 md:py-1 text-xs bg-red-600/30 text-red-300 hover:bg-red-600/50 rounded-lg md:rounded transition-colors flex items-center justify-center"
        title="Disconnect from voice"
      >
        <svg className="w-5 h-5 md:hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
        <span className="hidden md:inline">Leave</span>
      </button>
    </div>
  );
}
