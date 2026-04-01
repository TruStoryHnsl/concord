import { useCallback } from "react";
import {
  useLocalParticipant,
  useConnectionState,
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
  if (activeChannelId === channelId) return null;

  const serverName = servers.find((s) => s.id === serverId)?.name ?? "Server";

  return (
    <div className="flex items-center justify-between px-3 md:px-4 py-2 md:py-2 glass-panel flex-shrink-0 safe-bottom">
      <div className="flex items-center gap-2 text-sm text-secondary min-w-0 font-body">
        <div className="w-2 h-2 rounded-full bg-secondary animate-pulse flex-shrink-0" />
        <span className="truncate">
          <strong className="font-headline">#{channelName}</strong>
          <span className="hidden sm:inline text-secondary-dim"> in <strong className="font-headline">{serverName}</strong></span>
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
  const isMicEnabled = localParticipant.isMicrophoneEnabled;

  const toggleMic = useCallback(async () => {
    try {
      await localParticipant.setMicrophoneEnabled(!isMicEnabled);
    } catch {
      // Permission or state error
    }
  }, [localParticipant, isMicEnabled]);

  if (connectionState !== ConnectionState.Connected) return null;

  return (
    <div className="flex items-center gap-1.5">
      {/* Mute */}
      <button
        onClick={toggleMic}
        className={`btn-press min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 px-3 py-2 md:px-2.5 md:py-1 text-xs rounded-xl md:rounded-lg transition-colors flex items-center justify-center font-label ${
          isMicEnabled
            ? "bg-secondary-container text-on-secondary-container"
            : "bg-error-container/30 text-on-error-container"
        }`}
        title={isMicEnabled ? "Mute" : "Unmute"}
      >
        <span className="material-symbols-outlined text-lg md:hidden">
          {isMicEnabled ? "mic" : "mic_off"}
        </span>
        <span className="hidden md:inline">{isMicEnabled ? "Mic On" : "Mic Off"}</span>
      </button>

      {/* Return to channel */}
      <button
        onClick={onReturn}
        className="btn-press min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 px-3 py-2 md:px-2.5 md:py-1 text-xs bg-secondary-container text-on-secondary-container rounded-xl md:rounded-lg transition-colors flex items-center justify-center font-label"
        title="Return to voice channel"
      >
        <span className="material-symbols-outlined text-lg md:hidden">arrow_back</span>
        <span className="hidden md:inline">Return</span>
      </button>

      {/* Leave */}
      <button
        onClick={onLeave}
        className="btn-press min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 px-3 py-2 md:px-2.5 md:py-1 text-xs bg-error-container/30 text-on-error-container rounded-xl md:rounded-lg transition-colors flex items-center justify-center font-label"
        title="Disconnect from voice"
      >
        <span className="material-symbols-outlined text-lg md:hidden">call_end</span>
        <span className="hidden md:inline">Leave</span>
      </button>
    </div>
  );
}
