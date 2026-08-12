import type { ReactNode } from "react";
import { LiveKitRoom } from "@livekit/components-react";
import { CustomAudioRenderer } from "./CustomAudioRenderer";
import { FloatingVideoTiles } from "./FloatingVideoTiles";
import { EffectsBroadcastReceiver } from "../../effects/EffectsBroadcastReceiver";
import { isDesktopMode } from "../../api/serverUrl";
import { buildLiveKitAudioCaptureOptions } from "../../voice/noiseGate";

// Phase 10 (bundle split): the live `<LiveKitRoom>` provider tree —
// LiveKitRoom + CustomAudioRenderer + FloatingVideoTiles — is the entire
// `@livekit/components-react` consumer surface that App.tsx used to import
// statically. Pulling it behind this module lets App lazy-load it (via
// React.lazy + Suspense) ONLY once `voiceConnected` flips true, so the
// LiveKit vendor chunk is fetched on first voice join instead of cold
// start. Behaviour is identical to the previous inline JSX — same props,
// same audio-capture wiring, same children.

export interface VoiceRoomLayerProps {
  voiceToken: string;
  livekitUrl: string;
  iceServers: RTCIceServer[];
  micGranted: boolean;
  audioCaptureSettings: {
    masterInputVolume: number;
    preferredInputDeviceId: string | null;
    echoCancellation: boolean;
    noiseSuppression: boolean;
    autoGainControl: boolean;
    inputNoiseGateEnabled: boolean;
    inputNoiseGateThresholdDb: number;
  };
  onDisconnected: () => void;
  onError: (error: Error) => void;
  onMediaDeviceFailure: () => void;
  children: ReactNode;
}

export default function VoiceRoomLayer({
  voiceToken,
  livekitUrl,
  iceServers,
  micGranted,
  audioCaptureSettings,
  onDisconnected,
  onError,
  onMediaDeviceFailure,
  children,
}: VoiceRoomLayerProps) {
  return (
    <LiveKitRoom
      token={voiceToken}
      serverUrl={livekitUrl}
      connectOptions={{
        autoSubscribe: true,
        ...(iceServers.length > 0 && {
          rtcConfig: {
            iceServers: [
              { urls: "stun:stun.l.google.com:19302" },
              ...iceServers,
            ],
          },
        }),
      }}
      audio={
        micGranted && !isDesktopMode()
          ? buildLiveKitAudioCaptureOptions(audioCaptureSettings)
          : false
      }
      video={false}
      options={{
        // Do NOT set ``webAudioMix: true``. It was added in v0.2.4 on
        // a wrong premise (it is NOT required for the local-mic
        // processor — ``Room.acquireAudioContext`` always creates a
        // room AudioContext, and both ``LocalParticipant.createTracks``
        // and ``publishOrRepublishTrack`` call
        // ``LocalAudioTrack.setAudioContext`` unconditionally). Its
        // actual effect is to also propagate the room AudioContext to
        // every REMOTE audio track — which then hits
        // ``RemoteAudioTrack.attach``'s ``connectWebAudio`` branch and
        // pipes the remote stream through ``ctx.destination`` in
        // PARALLEL with our ``CustomAudioRenderer`` Tier 2 cloned-
        // track chain. Two simultaneous outputs of the same track
        // create comb-filter coloration that users perceive as a
        // tinny / "two streams overlapping" sound. Leave it off and
        // let CustomAudioRenderer be the sole remote-playback path.
        audioCaptureDefaults: {
          ...buildLiveKitAudioCaptureOptions(audioCaptureSettings),
        },
      }}
      onDisconnected={onDisconnected}
      onError={onError}
      onMediaDeviceFailure={onMediaDeviceFailure}
      style={{ display: "contents" }}
    >
      <CustomAudioRenderer />
      {/* Effects board: receive peer-broadcast visual effects and play
       *  them on the local screen. The paired sound arrives via the
       *  published "soundboard" audio track; this only carries visuals. */}
      <EffectsBroadcastReceiver />
      {/* Issue E (2026-04-18): floating picture-in-picture tiles so
       *  camera/screen streams stay visible when the user navigates
       *  away from the voice channel. Renders null when the user is
       *  viewing the voice channel's docked UI. */}
      <FloatingVideoTiles />
      {children}
    </LiveKitRoom>
  );
}
