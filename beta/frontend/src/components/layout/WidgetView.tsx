import { useMeshStore } from "@/stores/mesh";
import { useVoiceStore } from "@/stores/voice";
import { useServersStore } from "@/stores/servers";

function WidgetView() {
  const nodeStatus = useMeshStore((s) => s.nodeStatus);
  const isInVoice = useVoiceStore((s) => s.isInVoice);
  const channelId = useVoiceStore((s) => s.channelId);
  const isMuted = useVoiceStore((s) => s.isMuted);
  const isDeafened = useVoiceStore((s) => s.isDeafened);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const toggleDeafen = useVoiceStore((s) => s.toggleDeafen);
  const leaveVoice = useVoiceStore((s) => s.leaveVoice);
  const messages = useServersStore((s) => s.messages);
  const channels = useServersStore((s) => s.channels);

  const isOnline = nodeStatus?.isOnline ?? false;
  const peerCount = nodeStatus?.connectedPeers ?? 0;

  const channelName = channels.find((c) => c.id === channelId)?.name ?? channelId ?? "Voice";
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

  return (
    <div className="flex flex-col h-screen w-screen bg-surface p-2 gap-1.5 overflow-hidden select-none" data-tauri-drag-region="">
      {/* Node status row */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${
            isOnline ? "bg-secondary" : "bg-error"
          }`}
        />
        <span className="text-[10px] font-label font-medium text-on-surface truncate">
          {isOnline ? "Node Active" : "Offline"}
        </span>
        <span className="ml-auto text-[10px] font-label text-on-surface-variant shrink-0">
          {peerCount} peer{peerCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Middle: voice status or last message */}
      <div className="flex-1 min-h-0 flex flex-col justify-center overflow-hidden">
        {isInVoice ? (
          <div className="flex items-center gap-1.5 overflow-hidden">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse shrink-0" />
            <span className="text-[10px] font-label text-secondary truncate">
              {channelName}
            </span>
          </div>
        ) : lastMessage ? (
          <p className="text-[10px] font-body text-on-surface-variant leading-tight line-clamp-2 overflow-hidden">
            {lastMessage.content}
          </p>
        ) : (
          <p className="text-[10px] font-body text-on-surface-variant/50">
            No activity
          </p>
        )}
      </div>

      {/* Bottom: voice controls if in voice */}
      {isInVoice && (
        <div className="flex items-center justify-center gap-1 shrink-0">
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
            onClick={() => void toggleDeafen()}
            className={`flex items-center justify-center w-6 h-6 rounded-full transition-colors ${
              isDeafened
                ? "bg-error/20 text-error"
                : "bg-surface-container-highest text-on-surface-variant"
            }`}
            title={isDeafened ? "Undeafen" : "Deafen"}
          >
            <span className="material-symbols-outlined text-xs">
              {isDeafened ? "headset_off" : "headset"}
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
      )}
    </div>
  );
}

export default WidgetView;
