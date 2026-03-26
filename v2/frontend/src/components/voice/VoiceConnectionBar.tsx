import { useVoiceStore } from "@/stores/voice";
import { useServersStore } from "@/stores/servers";

interface VoiceConnectionBarProps {
  compact?: boolean;
}

function VoiceConnectionBar({ compact = false }: VoiceConnectionBarProps) {
  const isInVoice = useVoiceStore((s) => s.isInVoice);
  const channelId = useVoiceStore((s) => s.channelId);
  const serverId = useVoiceStore((s) => s.serverId);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const isDeafened = useVoiceStore((s) => s.isDeafened);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);
  const leaveVoice = useVoiceStore((s) => s.leaveVoice);

  const servers = useServersStore((s) => s.servers);
  const channels = useServersStore((s) => s.channels);

  if (!isInVoice) return null;

  const server = servers.find((s) => s.id === serverId);
  const channel = channels.find((c) => c.id === channelId);
  const channelName = channel?.name ?? channelId ?? "Voice";
  const serverName = server?.name ?? serverId ?? "";

  if (compact) {
    return (
      <div className="flex items-center justify-between px-2 h-8 bg-surface-container-high shrink-0 border-t border-outline-variant/20">
        <div className="flex items-center gap-1 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse shrink-0" />
          <span className="text-[10px] font-label text-on-surface truncate">
            {channelName}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => void toggleMute()}
            className={`flex items-center justify-center w-6 h-6 rounded-full transition-colors ${
              isMuted
                ? "bg-error/20 text-error"
                : "bg-surface-container-highest text-on-surface-variant"
            }`}
            title={isMuted ? "Unmute" : "Mute"}
          >
            <span className="material-symbols-outlined text-xs">
              {isMuted ? "mic_off" : "mic"}
            </span>
          </button>
          <button
            onClick={() => void leaveVoice()}
            className="flex items-center justify-center w-6 h-6 rounded-full bg-error/20 text-error hover:bg-error hover:text-on-error transition-colors"
            title="Disconnect"
          >
            <span className="material-symbols-outlined text-xs">call_end</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between px-3 md:px-4 h-12 bg-surface-container-high shrink-0 border-t border-outline-variant/20">
      {/* Left: channel / server info */}
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-label font-medium text-on-surface truncate">
          {channelName}
        </span>
        {serverName && (
          <span className="text-[10px] text-on-surface-variant font-body truncate">
            {serverName}
          </span>
        )}
      </div>

      {/* Center: connection status */}
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
        <span className="text-xs font-label text-secondary">Connected</span>
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-1.5">
        {/* Mic toggle */}
        <button
          onClick={() => void toggleMute()}
          className={`flex items-center justify-center w-9 h-9 rounded-full transition-colors ${
            isMuted
              ? "bg-error/20 text-error"
              : "bg-surface-container-highest text-on-surface-variant hover:text-on-surface"
          }`}
          title={isMuted ? "Unmute" : "Mute"}
        >
          <span className="material-symbols-outlined text-lg">
            {isMuted ? "mic_off" : "mic"}
          </span>
        </button>

        {/* Headset / deafen toggle */}
        <button
          onClick={() => void toggleDeafen()}
          className={`flex items-center justify-center w-9 h-9 rounded-full transition-colors ${
            isDeafened
              ? "bg-error/20 text-error"
              : "bg-surface-container-highest text-on-surface-variant hover:text-on-surface"
          }`}
          title={isDeafened ? "Undeafen" : "Deafen"}
        >
          <span className="material-symbols-outlined text-lg">
            {isDeafened ? "headset_off" : "headset"}
          </span>
        </button>

        {/* Disconnect */}
        <button
          onClick={() => void leaveVoice()}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-error/20 text-error hover:bg-error hover:text-on-error transition-colors"
          title="Disconnect"
        >
          <span className="material-symbols-outlined text-lg">call_end</span>
        </button>
      </div>
    </div>
  );
}

export default VoiceConnectionBar;
