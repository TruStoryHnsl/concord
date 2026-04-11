import { useEffect, useRef, useCallback, useState } from "react";
import { LiveKitRoom } from "@livekit/components-react";
import { useAuthStore } from "./stores/auth";
import { useServerStore } from "./stores/server";
import { useToastStore } from "./stores/toast";
import { useVoiceStore, getPendingVoiceSession, clearPendingVoiceSession } from "./stores/voice";
import { useSettingsStore } from "./stores/settings";
import { useServerConfigStore } from "./stores/serverConfig";
import { isDesktopMode, hasServerUrl } from "./api/serverUrl";
import { usePlatform } from "./hooks/usePlatform";
import { computeInitialServerConnected } from "./serverPickerGate";
import { redeemInvite } from "./api/concord";
import { getVoiceToken } from "./api/livekit";
import { LoginForm } from "./components/auth/LoginForm";
import { ServerPickerScreen } from "./components/auth/ServerPickerScreen";
import { SubmitPage } from "./components/public/SubmitPage";
import { ChatLayout } from "./components/layout/ChatLayout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LaunchAnimation } from "./components/LaunchAnimation";
import { ToastContainer } from "./components/ui/Toast";
import { VoiceConnectionBar } from "./components/voice/VoiceConnectionBar";
import { DirectInviteBanner } from "./components/DirectInviteBanner";
import { CustomAudioRenderer } from "./components/voice/CustomAudioRenderer";

// Capture invite token immediately at module load — before React mounts,
// before session restoration, before anything can clear the URL.
const INVITE_STORAGE_KEY = "concord_pending_invite";
const urlParams = new URLSearchParams(window.location.search);
const initialInviteToken = urlParams.get("invite");
if (initialInviteToken) {
  sessionStorage.setItem(INVITE_STORAGE_KEY, initialInviteToken);
}

export { INVITE_STORAGE_KEY };

export default function App() {
  // Desktop/native mode: require a server picker pass before anything
  // else. INS-027 landed the `serverConfig` store + ServerPickerScreen
  // as the modern first-launch flow; the picker is skipped when the
  // store already has a config, OR when the legacy `_serverUrl` is set
  // (for Tauri users who configured a server before INS-027 shipped —
  // their existing URL keeps working without being kicked through the
  // picker again).
  //
  // INS-020 extension: native mobile Tauri builds AND mobile browsers
  // also need the picker on first launch because they have no
  // implicit origin-based server to fall back to. The decision is
  // extracted into `computeInitialServerConnected` for unit testing.
  const hasNewConfig = useServerConfigStore((s) => s.config !== null);
  const { isMobile, isTV } = usePlatform();
  const [serverConnected, setServerConnected] = useState(() =>
    computeInitialServerConnected({
      isDesktop: isDesktopMode(),
      isMobile,
      hasNewConfig,
      hasLegacyUrl: hasServerUrl(),
    }),
  );

  // INS-023 launch animation: a cross-platform boot splash that
  // covers the first-paint gap and any subsequent isLoading window.
  // `launchDone` flips true once the `<LaunchAnimation/>` has
  // finished its dismiss animation; the overlay then unmounts so
  // interactive elements underneath stop sitting beneath a z-9999
  // invisible layer. The `index.html` inline <style> block paints
  // the dark background before React even boots, so the splash
  // merely sits on top of a dark page instead of over a white flash.
  const [launchDone, setLaunchDone] = useState(false);

  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const isLoading = useAuthStore((s) => s.isLoading);
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const accessToken = useAuthStore((s) => s.accessToken);
  const loadServers = useServerStore((s) => s.loadServers);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const addToast = useToastStore((s) => s.addToast);
  const inviteHandled = useRef(false);

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

  // Appearance — mirror the persisted chatFontSize preference into the
  // `--concord-chat-font-size` CSS variable so `.concord-message-body`
  // picks it up without every <MessageContent> needing to re-render.
  // Runs once on mount (with the hydrated value from localStorage) and
  // again whenever the user moves the slider in Settings → Appearance.
  const chatFontSize = useSettingsStore((s) => s.chatFontSize);
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty(
      "--concord-chat-font-size",
      `${chatFontSize}px`,
    );
  }, [chatFontSize]);

  // TV mode: set the data-tv attribute on <html> so all TV CSS rules
  // in styles/tv.css and the focus ring styles in index.css activate.
  // Removed when the flag flips false (e.g. window resize in dev tools).
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (isTV) {
      document.documentElement.setAttribute("data-tv", "true");
    } else {
      document.documentElement.removeAttribute("data-tv");
    }
    return () => {
      document.documentElement.removeAttribute("data-tv");
    };
  }, [isTV]);

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

  // One-shot orphan-room cleanup. Runs the first time a user logs in
  // on this browser after the fix landed; leaves any local-homeserver
  // rooms they're still joined to but which aren't part of any
  // Concord-managed server. These are ghosts from deleted servers
  // that flood the sidebar otherwise. Guarded by a per-user
  // localStorage flag so it never runs twice.
  const cleanupHandled = useRef(false);
  const cleanupUserId = useAuthStore((s) => s.userId);
  useEffect(() => {
    if (!isLoggedIn || !cleanupUserId || cleanupHandled.current) return;
    const flagKey = `concord_orphan_cleanup_v1:${cleanupUserId}`;
    if (typeof window !== "undefined" && window.localStorage.getItem(flagKey)) {
      cleanupHandled.current = true;
      return;
    }
    const client = useAuthStore.getState().client;
    if (!client) return;
    cleanupHandled.current = true;

    (async () => {
      // Let the Matrix client finish its initial sync before we start
      // leaving rooms — leaveOrphanRooms reads `client.getRooms()` and
      // we want the full joined-room set, not whatever happened to be
      // in the cache half a second after login. 3 seconds is plenty on
      // a warm client and harmless on a cold one (we only run once
      // per user ever).
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const left = await useServerStore
          .getState()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .leaveOrphanRooms(client as any);
        if (typeof window !== "undefined") {
          window.localStorage.setItem(flagKey, String(Date.now()));
        }
        if (left.length > 0) {
          addToast(
            `Cleaned up ${left.length} ghost room${left.length === 1 ? "" : "s"} from deleted servers`,
            "success",
          );
        }
      } catch (err) {
        console.warn("Orphan room cleanup failed:", err);
      }
    })();
  }, [isLoggedIn, cleanupUserId, addToast]);

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

  // Compose the launch splash overlay once so every early return
  // path below can reuse it. Must be emitted as a Fragment sibling
  // of the actual screen so it stays layered on top via its own
  // position:fixed styling.
  const launchOverlay = !launchDone ? (
    <LaunchAnimation
      isLoading={isLoading}
      onDone={() => setLaunchDone(true)}
    />
  ) : null;

  // Native mode: show the first-launch server picker when no
  // HomeserverConfig has been selected yet.
  if (!serverConnected) {
    return (
      <>
        <ServerPickerScreen onConnected={() => setServerConnected(true)} />
        {launchOverlay}
      </>
    );
  }

  // Public submit page — no auth required
  const path = window.location.pathname;
  if (path.startsWith("/submit/")) {
    const webhookId = path.slice("/submit/".length);
    return (
      <>
        <SubmitPage webhookId={webhookId} />
        {launchOverlay}
      </>
    );
  }

  if (isLoading) {
    // No inline spinner — the LaunchAnimation below handles the
    // "we're booting" affordance uniformly across every platform.
    return (
      <>
        <div className="h-full bg-surface mesh-background" aria-hidden="true" />
        {launchOverlay}
      </>
    );
  }

  // Authenticated content, optionally wrapped in LiveKitRoom
  const authenticatedContent = (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 min-h-0">
        <ChatLayout />
      </div>
      <VoiceConnectionBar />
      <DirectInviteBanner />
    </div>
  );

  return (
    <>
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
      </ErrorBoundary>
      {launchOverlay}
    </>
  );
}
