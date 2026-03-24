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
    <div className="flex items-center justify-between px-4 py-2 bg-emerald-900/90 border-t border-emerald-700/50 backdrop-blur-sm flex-shrink-0">
      <div className="flex items-center gap-2 text-sm text-emerald-200">
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span>
          Connected to <strong>#{channelName}</strong> in{" "}
          <strong>{serverName}</strong>
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
    <div className="flex items-center gap-1">
      {/* Mute */}
      <button
        onClick={toggleMic}
        className={`btn-press px-2.5 py-1 text-xs rounded transition-colors ${
          isMicEnabled
            ? "bg-emerald-800 hover:bg-emerald-700 text-emerald-200"
            : "bg-red-600/30 text-red-300 hover:bg-red-600/50"
        }`}
        title={isMicEnabled ? "Mute" : "Unmute"}
      >
        {isMicEnabled ? "Mic On" : "Mic Off"}
      </button>

      {/* Deafen */}
      <button
        onClick={toggleDeafen}
        className={`btn-press px-2.5 py-1 text-xs rounded transition-colors ${
          deafened
            ? "bg-red-600/30 text-red-300 hover:bg-red-600/50"
            : "bg-emerald-800 hover:bg-emerald-700 text-emerald-200"
        }`}
        title={deafened ? "Undeafen" : "Deafen"}
      >
        {deafened ? "Deafened" : "Deafen"}
      </button>

      {/* Return to channel */}
      <button
        onClick={onReturn}
        className="btn-press px-2.5 py-1 text-xs bg-emerald-800 hover:bg-emerald-700 text-emerald-200 rounded transition-colors"
        title="Return to voice channel"
      >
        Return
      </button>

      {/* Leave */}
      <button
        onClick={onLeave}
        className="btn-press px-2.5 py-1 text-xs bg-red-600/30 text-red-300 hover:bg-red-600/50 rounded transition-colors"
        title="Disconnect from voice"
      >
        Leave
      </button>
    </div>
  );
}
