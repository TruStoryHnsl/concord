import { lazy, Suspense } from "react";
import { useVoiceStore } from "../../stores/voice";
import { useServerStore } from "../../stores/server";
import { BringingUpSplash } from "../BringingUpSplash";

// Phase 10 (bundle split): VoiceConnectionBar is mounted on every screen
// (it lives in App.tsx's shellContent). Its only LiveKit-coupled part is
// the mic/return/leave control cluster, which is now isolated in its own
// module and lazy-loaded here. That keeps `@livekit/components-react` /
// `livekit-client` out of the always-mounted bar's static import graph,
// so the LiveKit vendor chunk is fetched on first voice join, not at cold
// start. The controls only render inside the connected `<LiveKitRoom>`
// subtree (the `connected` branch below), so the dynamic import fires
// exactly when a Room context exists for its hooks.
const VoiceBarControls = lazy(() =>
  import("./VoiceBarControls").then((m) => ({ default: m.VoiceBarControls })),
);

export function VoiceConnectionBar() {
  const connected = useVoiceStore((s) => s.connected);
  const connectionState = useVoiceStore((s) => s.connectionState);
  const reconnectAttempt = useVoiceStore((s) => s.reconnectAttempt);
  const channelName = useVoiceStore((s) => s.channelName);
  const serverId = useVoiceStore((s) => s.serverId);
  const rememberedServerName = useVoiceStore((s) => s.serverName);
  const channelId = useVoiceStore((s) => s.channelId);
  const disconnect = useVoiceStore((s) => s.disconnect);
  const servers = useServerStore((s) => s.servers);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const setActiveChannel = useServerStore((s) => s.setActiveChannel);
  const activeChannelId = useServerStore((s) => s.activeChannelId);

  // Show reconnecting state even when not yet connected
  const showReconnecting = connectionState === "reconnecting" || connectionState === "connecting";
  const showFailed = connectionState === "failed";

  if (!connected && !showReconnecting && !showFailed) return null;
  if (connected && activeChannelId === channelId) return null;

  const serverName =
    servers.find((s) => s.id === serverId)?.name ??
    rememberedServerName ??
    "Server";

  // Reconnecting indicator
  if (showReconnecting) {
    return (
      <div className="flex items-center justify-between px-3 md:px-4 py-2 md:py-2 glass-panel flex-shrink-0 safe-bottom">
        <div className="flex items-center gap-2 text-sm text-yellow-400 min-w-0 font-body">
          <BringingUpSplash size="inline" className="flex-shrink-0" />
          <span className="truncate">
            Reconnecting to voice{reconnectAttempt > 0 ? ` (attempt ${reconnectAttempt})` : ""}...
          </span>
        </div>
        <button
          onClick={disconnect}
          className="btn-press px-2.5 py-1 text-xs bg-error-container/30 text-on-error-container rounded-lg transition-colors font-label"
        >
          Cancel
        </button>
      </div>
    );
  }

  // Failed state
  if (showFailed) {
    return (
      <div className="flex items-center justify-between px-3 md:px-4 py-2 md:py-2 glass-panel flex-shrink-0 safe-bottom">
        <div className="flex items-center gap-2 text-sm text-error min-w-0 font-body">
          <div className="w-2 h-2 rounded-full bg-error flex-shrink-0" />
          <span className="truncate">Voice reconnection failed</span>
        </div>
        <button
          onClick={() => useVoiceStore.getState().setConnectionState("disconnected")}
          className="btn-press px-2.5 py-1 text-xs bg-surface-container text-on-surface rounded-lg transition-colors font-label"
        >
          Dismiss
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between px-3 md:px-4 py-2 md:py-2 glass-panel flex-shrink-0 safe-bottom">
      <div className="flex items-center gap-2 text-sm text-secondary min-w-0 font-body">
        <div className="w-2 h-2 rounded-full bg-secondary animate-pulse flex-shrink-0" />
        <span className="truncate">
          <strong className="font-headline">#{channelName}</strong>
          <span className="hidden sm:inline text-secondary-dim"> in <strong className="font-headline">{serverName}</strong></span>
        </span>
      </div>

      <Suspense fallback={null}>
        <VoiceBarControls
          onReturn={() => {
            if (serverId) setActiveServer(serverId);
            if (channelId) setActiveChannel(channelId);
          }}
          onLeave={disconnect}
        />
      </Suspense>
    </div>
  );
}
