import { useCallback } from "react";
import { useLocalParticipant, useConnectionState } from "@livekit/components-react";
import { ConnectionState } from "livekit-client";

// Phase 10 (bundle split): the mic/return/leave control cluster is the
// ONLY part of the voice connection bar that consumes LiveKit hooks
// (`useLocalParticipant`, `useConnectionState`). Splitting it into its
// own module keeps `@livekit/components-react` and `livekit-client` out
// of `VoiceConnectionBar.tsx`'s static import graph, so the always-mounted
// bar no longer drags the LiveKit chunk into cold start. It is rendered
// (lazily) only from inside the connected `<LiveKitRoom>` subtree, where
// the hooks have a Room context to read from.
export function VoiceBarControls({
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
