import type { VoiceParticipant } from "@/api/tauri";
import { shortenPeerId } from "@/utils/format";

interface ParticipantCardProps {
  participant: VoiceParticipant;
  displayName?: string;
}

/** Hash a string to a hue value 0-360. */
function peerIdToHue(peerId: string): number {
  let hash = 0;
  for (let i = 0; i < peerId.length; i++) {
    hash = peerId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

/** Get two-character initials from a peer ID or display name. */
function getInitials(peerId: string, displayName?: string): string {
  if (displayName && displayName.length >= 2) {
    return displayName.slice(0, 2).toUpperCase();
  }
  // Use chars after the "12D3KooW" prefix if present, else first two
  const clean = peerId.startsWith("12D3KooW") ? peerId.slice(8) : peerId;
  return clean.slice(0, 2).toUpperCase();
}

function ParticipantCard({ participant, displayName }: ParticipantCardProps) {
  const hue = peerIdToHue(participant.peerId);
  const initials = getInitials(participant.peerId, displayName);
  const label = displayName ?? shortenPeerId(participant.peerId);

  return (
    <div className="flex flex-col items-center gap-1.5">
      {/* Avatar */}
      <div className="relative">
        <div
          className={`flex items-center justify-center w-10 h-10 rounded-full text-sm font-bold font-label select-none ${
            participant.isSpeaking ? "ring-2 ring-secondary animate-pulse" : ""
          }`}
          style={{
            backgroundColor: `hsl(${hue}, 50%, 30%)`,
            color: `hsl(${hue}, 60%, 85%)`,
          }}
        >
          {initials}
        </div>

        {/* Muted badge */}
        {participant.isMuted && (
          <div className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center w-4 h-4 rounded-full bg-surface-container-highest">
            <span className="material-symbols-outlined text-error" style={{ fontSize: "10px" }}>
              mic_off
            </span>
          </div>
        )}
      </div>

      {/* Name */}
      <span className="text-[11px] text-on-surface-variant font-body truncate max-w-[80px] text-center">
        {label}
      </span>
    </div>
  );
}

export default ParticipantCard;
