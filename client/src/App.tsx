import { useState, useEffect, useRef, useCallback } from "react";
import { LiveKitRoom } from "@livekit/components-react";
import { useAuthStore } from "./stores/auth";
import { useServerStore } from "./stores/server";
import { useToastStore } from "./stores/toast";
import { useVoiceStore, getPendingVoiceSession, clearPendingVoiceSession } from "./stores/voice";
import { useSettingsStore } from "./stores/settings";
import { redeemInvite } from "./api/concorrd";
import { getVoiceToken } from "./api/livekit";
import { LoginForm } from "./components/auth/LoginForm";
import { SubmitPage } from "./components/public/SubmitPage";
import { ChatLayout } from "./components/layout/ChatLayout";
import { BugReportModal } from "./components/BugReportModal";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastContainer } from "./components/ui/Toast";
import { VoiceConnectionBar } from "./components/voice/VoiceConnectionBar";
import { DirectInviteBanner } from "./components/DirectInviteBanner";
import { CustomAudioRenderer } from "./components/voice/CustomAudioRenderer";

// Capture invite token immediately at module load — before React mounts,
// before session restoration, before anything can clear the URL.
const INVITE_STORAGE_KEY = "concorrd_pending_invite";
const urlParams = new URLSearchParams(window.location.search);
const initialInviteToken = urlParams.get("invite");
if (initialInviteToken) {
  sessionStorage.setItem(INVITE_STORAGE_KEY, initialInviteToken);
}

export { INVITE_STORAGE_KEY };

export default function App() {
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const isLoading = useAuthStore((s) => s.isLoading);
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const accessToken = useAuthStore((s) => s.accessToken);
  const loadServers = useServerStore((s) => s.loadServers);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const addToast = useToastStore((s) => s.addToast);
  const inviteHandled = useRef(false);
  const [showBugReport, setShowBugReport] = useState(false);

  // Voice state
  const voiceConnected = useVoiceStore((s) => s.connected);
  const voiceToken = useVoiceStore((s) => s.token);
  const livekitUrl = useVoiceStore((s) => s.livekitUrl);
  const iceServers = useVoiceStore((s) => s.iceServers);
  const micGranted = useVoiceStore((s) => s.micGranted);
  const voiceDisconnect = useVoiceStore((s) => s.disconnect);

  const echoCancellation = useSettingsStore((s) => s.echoCancellation);
  const noiseSuppression = useSettingsStore((s) => s.noiseSuppression);
  const autoGainControl = useSettingsStore((s) => s.autoGainControl);
  const preferredInputDeviceId = useSettingsStore((s) => s.preferredInputDeviceId);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  // Handle ?invite=TOKEN auto-join for logged-in users
  useEffect(() => {
    if (!isLoggedIn || !accessToken || inviteHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const inviteToken =
      params.get("invite") || sessionStorage.getItem(INVITE_STORAGE_KEY);
    if (!inviteToken) return;

    inviteHandled.current = true;

    (async () => {
      try {
        const result = await redeemInvite(inviteToken, accessToken);
        // Only clear after successful redemption
        sessionStorage.removeItem(INVITE_STORAGE_KEY);
        const url = new URL(window.location.href);
        url.searchParams.delete("invite");
        window.history.replaceState({}, "", url.toString());

        if (result.status === "already_member") {
          addToast(`Already a member of ${result.server_name}`, "info");
        } else {
          addToast(`Joined ${result.server_name}!`, "success");
        }
        await loadServers(accessToken);
        setActiveServer(result.server_id);
      } catch (err) {
        // Don't clear the invite — if the session is stale and the user
        // gets logged out, LoginForm can still pick it up from sessionStorage
        addToast(
          err instanceof Error ? err.message : "Failed to redeem invite",
        );
      }
    })();
  }, [isLoggedIn, accessToken, loadServers, setActiveServer, addToast]);

  // Track whether we're in a page unload so we can skip the disconnect handler
  // and preserve the voice session for auto-reconnect after refresh.
  const isUnloadingRef = useRef(false);

  const handleVoiceDisconnect = useCallback(() => {
    if (isUnloadingRef.current) return; // page refreshing — keep session for reconnect
    voiceDisconnect();
  }, [voiceDisconnect]);

  // Warn user before closing/refreshing if voice is active
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (useVoiceStore.getState().connected) {
        isUnloadingRef.current = true;
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Auto-reconnect to voice after page refresh
  const voiceReconnectHandled = useRef(false);
  const voiceConnect = useVoiceStore((s) => s.connect);
  useEffect(() => {
    if (!isLoggedIn || !accessToken || voiceReconnectHandled.current) return;
    if (voiceConnected) return; // already connected

    const session = getPendingVoiceSession();
    if (!session) return;

    voiceReconnectHandled.current = true;

    (async () => {
      try {
        // Request mic permission
        let micGrantedLocal = false;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach((t) => t.stop());
          micGrantedLocal = true;
        } catch {
          // Continue without mic
        }

        const result = await getVoiceToken(session.channelId, accessToken);
        const wsProto = window.location.protocol === "https:" ? "wss" : "ws";
        const port = window.location.port ? `:${window.location.port}` : "";
        const clientUrl = `${wsProto}://${window.location.hostname}${port}/livekit/`;

        voiceConnect({
          token: result.token,
          livekitUrl: clientUrl,
          iceServers: result.ice_servers?.length ? result.ice_servers : [],
          serverId: session.serverId,
          channelId: session.channelId,
          channelName: session.channelName,
          roomName: session.roomName,
          micGranted: micGrantedLocal,
        });

        // Navigate back to the voice channel
        setActiveServer(session.serverId);
        useServerStore.getState().setActiveChannel(session.channelId);
      } catch (err) {
        console.error("Voice reconnect failed:", err);
        clearPendingVoiceSession();
      }
    })();
  }, [isLoggedIn, accessToken, voiceConnected, voiceConnect]);

  // Public submit page — no auth required
  const path = window.location.pathname;
  if (path.startsWith("/submit/")) {
    const webhookId = path.slice("/submit/".length);
    return <SubmitPage webhookId={webhookId} />;
  }

  if (isLoading) {
    return (
      <div className="h-screen bg-zinc-900 flex items-center justify-center">
        <span className="text-zinc-500">Loading...</span>
      </div>
    );
  }

  // Authenticated content, optionally wrapped in LiveKitRoom
  const authenticatedContent = (
    <>
      <ChatLayout />
      <VoiceConnectionBar />
      <DirectInviteBanner />
    </>
  );

  return (
    <ErrorBoundary>
      {isLoggedIn ? (
        voiceConnected && voiceToken && livekitUrl ? (
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
            audio={micGranted}
            video={false}
            options={{
              audioCaptureDefaults: {
                echoCancellation,
                noiseSuppression,
                autoGainControl,
                ...(preferredInputDeviceId && { deviceId: preferredInputDeviceId }),
              },
            }}
            onDisconnected={handleVoiceDisconnect}
            style={{ display: "contents" }}
          >
            <CustomAudioRenderer />
            {authenticatedContent}
          </LiveKitRoom>
        ) : (
          authenticatedContent
        )
      ) : (
        <LoginForm />
      )}
      <ToastContainer />
      {/* Bug report button — always visible when logged in */}
      {isLoggedIn && (
        <button
          onClick={() => setShowBugReport(true)}
          className="fixed bottom-4 right-4 z-40 w-10 h-10 flex items-center justify-center rounded-full bg-zinc-800 border border-zinc-600 text-zinc-400 hover:text-white hover:border-zinc-400 shadow-lg transition-colors"
          title="Report a Bug"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
          </svg>
        </button>
      )}
      {showBugReport && (
        <BugReportModal onClose={() => setShowBugReport(false)} />
      )}
    </ErrorBoundary>
  );
}
