import { useVoiceStore } from "@/stores/voice";
import type { ChannelPayload } from "@/api/tauri";
import GlassPanel from "@/components/ui/GlassPanel";
import Button from "@/components/ui/Button";
import ParticipantCard from "./ParticipantCard";

interface VoiceChannelProps {
  channel: ChannelPayload;
  serverId: string;
}

function VoiceChannel({ channel, serverId }: VoiceChannelProps) {
  const isInVoice = useVoiceStore((s) => s.isInVoice);
  const channelId = useVoiceStore((s) => s.channelId);
  const voiceServerId = useVoiceStore((s) => s.serverId);
  const participants = useVoiceStore((s) => s.participants);
  const joinVoice = useVoiceStore((s) => s.joinVoice);
  const leaveVoice = useVoiceStore((s) => s.leaveVoice);

  const isConnectedHere = isInVoice && channelId === channel.id && voiceServerId === serverId;
  const isConnectedElsewhere = isInVoice && !isConnectedHere;
  const isVoice = channel.channelType === "voice";

  const handleJoin = () => {
    void joinVoice(serverId, channel.id);
  };

  const handleSwitch = async () => {
    await leaveVoice();
    void joinVoice(serverId, channel.id);
  };

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <GlassPanel className="p-8 text-center space-y-5 max-w-md w-full">
        {/* Channel icon + name */}
        <div className="space-y-2">
          <span className="material-symbols-outlined text-5xl text-primary/60">
            {isVoice ? "graphic_eq" : "videocam"}
          </span>
          <p className="font-headline font-semibold text-lg text-on-surface">
            {channel.name}
          </p>
          <p className="text-sm text-on-surface-variant font-body">
            {isConnectedHere
              ? "You are connected"
              : isVoice
                ? "Voice channel"
                : "Video channel"}
          </p>
        </div>

        {/* Participants grid */}
        {isConnectedHere && participants.length > 0 && (
          <div className="flex flex-wrap justify-center gap-4 py-2">
            {participants.map((p) => (
              <ParticipantCard key={p.peerId} participant={p} />
            ))}
          </div>
        )}

        {/* Connection status indicator */}
        {isConnectedHere && (
          <div className="flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full bg-secondary animate-pulse" />
            <span className="text-sm font-label text-secondary">Connected</span>
          </div>
        )}

        {/* Action buttons */}
        {!isInVoice && (
          <Button onClick={handleJoin}>
            <span className="material-symbols-outlined text-lg">
              {isVoice ? "call" : "videocam"}
            </span>
            Join {isVoice ? "Voice" : "Video"}
          </Button>
        )}

        {isConnectedElsewhere && (
          <Button onClick={() => void handleSwitch()} variant="secondary">
            <span className="material-symbols-outlined text-lg">swap_calls</span>
            Switch to this channel
          </Button>
        )}

        {isConnectedHere && (
          <Button onClick={() => void leaveVoice()} variant="danger">
            <span className="material-symbols-outlined text-lg">call_end</span>
            Disconnect
          </Button>
        )}
      </GlassPanel>
    </div>
  );
}

export default VoiceChannel;
