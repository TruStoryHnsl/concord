/**
 * WebviewCallLayer — app-root mount for the webview WebRTC voice+video mesh.
 *
 * Two jobs:
 *   1. Install the inbound voice-signaling listener once on mount, so an
 *      incoming offer auto-answers and pops the call UI on the callee even if
 *      they never tapped "Call".
 *   2. Render the call overlay (local preview + remote tiles + controls) while
 *      a call is active.
 *
 * The media plane is the browser WebRTC stack in this webview (works on iOS —
 * getUserMedia confirmed); signaling rides the Rust libp2p bridge. See
 * `voice/webviewVoiceMesh.ts`.
 */

import { useEffect, useRef } from "react";
import { useWebviewCall, type CallPeerView } from "../../voice/webviewVoiceMesh";

/** A <video> bound to a MediaStream via ref (srcObject can't be set in JSX). */
function StreamVideo({
  stream,
  muted,
  mirror,
  className,
}: {
  stream: MediaStream | null;
  muted: boolean;
  mirror?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && el.srcObject !== stream) el.srcObject = stream;
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted={muted}
      className={className}
      style={mirror ? { transform: "scaleX(-1)" } : undefined}
    />
  );
}

function RemoteTile({ peer }: { peer: CallPeerView }) {
  const hasVideo = (peer.remoteStream?.getVideoTracks().length ?? 0) > 0;
  return (
    <div className="relative rounded-xl overflow-hidden bg-surface-container-highest aspect-video flex items-center justify-center">
      {hasVideo ? (
        <StreamVideo stream={peer.remoteStream} muted={false} className="w-full h-full object-cover" />
      ) : (
        <>
          {/* Audio-only remote: render a hidden media element so audio plays. */}
          <StreamVideo stream={peer.remoteStream} muted={false} className="hidden" />
          <span className="material-symbols-outlined text-on-surface-variant text-4xl">person</span>
        </>
      )}
      <div className="absolute bottom-1 left-2 right-2 flex items-center justify-between text-[10px] font-mono text-white/90 drop-shadow">
        <span className="truncate">{peer.peerId.slice(0, 10)}…</span>
        <span
          className={
            peer.state === "connected"
              ? "text-green-400"
              : peer.state === "failed"
                ? "text-red-400"
                : "text-yellow-300"
          }
        >
          {peer.state}
        </span>
      </div>
    </div>
  );
}

export function WebviewCallLayer() {
  const callActive = useWebviewCall((s) => s.callActive);
  const localStream = useWebviewCall((s) => s.localStream);
  const peers = useWebviewCall((s) => s.peers);
  const micEnabled = useWebviewCall((s) => s.micEnabled);
  const camEnabled = useWebviewCall((s) => s.camEnabled);
  const videoEnabled = useWebviewCall((s) => s.videoEnabled);
  const init = useWebviewCall((s) => s.init);
  const endCall = useWebviewCall((s) => s.endCall);
  const toggleMic = useWebviewCall((s) => s.toggleMic);
  const toggleCam = useWebviewCall((s) => s.toggleCam);

  // Install the inbound-signaling listener once, app-wide.
  useEffect(() => {
    void init();
  }, [init]);

  if (!callActive) return null;

  const peerList = Object.values(peers);

  return (
    <div className="fixed inset-0 z-[9000] bg-black/90 flex flex-col">
      <div className="flex-1 min-h-0 grid gap-2 p-3 place-content-center"
        style={{ gridTemplateColumns: peerList.length > 1 ? "repeat(2, minmax(0,1fr))" : "minmax(0,1fr)" }}
      >
        {peerList.length === 0 ? (
          <div className="text-white/70 text-sm text-center">Calling… waiting for peer to answer</div>
        ) : (
          peerList.map((p) => <RemoteTile key={p.peerId} peer={p} />)
        )}
      </div>

      {/* Local preview (picture-in-picture). Muted to avoid echo. */}
      {videoEnabled && (
        <div className="absolute top-4 right-4 w-28 h-40 rounded-xl overflow-hidden bg-surface-container-highest shadow-lg ring-1 ring-white/20">
          <StreamVideo stream={localStream} muted mirror className="w-full h-full object-cover" />
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-center gap-4 pb-[max(env(safe-area-inset-bottom),16px)] pt-3">
        <button
          type="button"
          onClick={toggleMic}
          aria-label={micEnabled ? "Mute microphone" : "Unmute microphone"}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
            micEnabled ? "bg-surface-container-high text-on-surface" : "bg-red-500 text-white"
          }`}
        >
          <span className="material-symbols-outlined">{micEnabled ? "mic" : "mic_off"}</span>
        </button>
        <button
          type="button"
          onClick={() => void endCall()}
          aria-label="End call"
          className="w-16 h-16 rounded-full bg-red-600 text-white flex items-center justify-center"
        >
          <span className="material-symbols-outlined text-3xl">call_end</span>
        </button>
        <button
          type="button"
          onClick={toggleCam}
          aria-label={camEnabled ? "Turn off camera" : "Turn on camera"}
          className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
            camEnabled ? "bg-surface-container-high text-on-surface" : "bg-red-500 text-white"
          }`}
        >
          <span className="material-symbols-outlined">{camEnabled ? "videocam" : "videocam_off"}</span>
        </button>
      </div>
    </div>
  );
}
