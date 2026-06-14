import type { Server } from "../../api/concord";
import { getVoiceToken } from "../../api/livekit";
import { getHomeserverUrl } from "../../api/serverUrl";
import { isTauri } from "../../api/servitude";
import {
  selectVoicePath,
  type VoiceParticipant,
} from "../../api/voicePath";
import { useServerConfigStore } from "../../stores/serverConfig";
import { useSettingsStore } from "../../stores/settings";
import { useVoiceStore } from "../../stores/voice";
import { buildMicTrackConstraints } from "../../voice/noiseGate";

/** Flatten the voice-token `RTCIceServer[]` to the bare URL-string list
 *  the native `voice_mesh_join` Tauri command expects (it builds the
 *  `RTCIceServer` structs on the Rust side from URLs; credentials for
 *  TURN ride along separately in production TURN configs). */
function flattenIceUrls(servers: RTCIceServer[]): string[] {
  const out: string[] = [];
  for (const s of servers) {
    const urls = s.urls;
    if (typeof urls === "string") out.push(urls);
    else if (Array.isArray(urls)) out.push(...urls);
  }
  return out;
}

interface MeshJoinArgs {
  roomId: string;
  participants: VoiceParticipant[];
  iceServers: RTCIceServer[];
}

/**
 * Dispatch a real mesh-join to the correct media plane:
 *
 *   - Native (Tauri): invoke `voice_mesh_join` → the Rust webrtc-rs
 *     orchestrator (`src-tauri/src/servitude/voice/`). ICE servers are
 *     flattened to URL strings.
 *   - Web: drive the browser `RTCPeerConnection` mesh in
 *     `libp2p/voiceMesh.ts`, using the already-running js-libp2p node
 *     for signaling and the full `RTCIceServer[]` (TURN credentials
 *     intact) for the PeerConnections.
 *
 * Throws on failure so the caller can fall back to LiveKit.
 */
async function meshJoin({
  roomId,
  participants,
  iceServers,
}: MeshJoinArgs): Promise<void> {
  const peerIds = participants
    .map((p) => p.peer_id)
    .filter((p): p is string => !!p);

  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("voice_mesh_join", {
      roomId,
      participants: peerIds,
      iceServers: flattenIceUrls(iceServers),
    });
    return;
  }

  // Web build — the selector only returns `libp2p_mesh` when a browser
  // js-libp2p node is already running, so `getBrowserNodeIfStarted`
  // resolves it without a chunk fetch. Resolve the string peer ids to
  // real `PeerId`s, then drive the browser mesh orchestrator.
  const { getBrowserNodeIfStarted } = await import("../../libp2p/lazyNode");
  const node = await getBrowserNodeIfStarted();
  if (!node) {
    throw new Error("browser libp2p node not running; cannot mesh-join");
  }
  const { peerIdFromString } = await import("@libp2p/peer-id");
  const { joinMesh } = await import("../../libp2p/voiceMesh");
  const meshParticipants = peerIds.map((id) => ({
    peerId: peerIdFromString(id),
  }));
  await joinMesh(node, roomId, meshParticipants, iceServers);
}

interface JoinVoiceSessionParams {
  roomId: string;
  channelName: string;
  serverId: string;
  accessToken: string;
  activeServer?: Server;
  activeChannelId?: string | null;
  channelType?: "place" | "voice";
  /** When set (i.e. coming from a persisted pending session on page refresh),
   *  these win over the values derived from activeServer/activeChannelId. */
  serverName?: string | null;
  returnChannelId?: string | null;
  returnChannelName?: string | null;
  /** When true, transition connectionState through "reconnecting" rather
   *  than "connecting". The lock is acquired in either case. */
  reconnecting?: boolean;
}

export async function joinVoiceSession({
  roomId,
  channelName,
  serverId,
  accessToken,
  activeServer,
  activeChannelId,
  channelType,
  serverName,
  returnChannelId: returnChannelIdOverride,
  returnChannelName: returnChannelNameOverride,
  reconnecting,
}: JoinVoiceSessionParams): Promise<void> {
  const claimed = useVoiceStore.getState().beginConnectAttempt({ reconnecting });
  if (!claimed) {
    // Another attempt is already in flight. Bail to avoid concurrent
    // getUserMedia + connect calls fighting each other.
    return;
  }
  const {
    echoCancellation,
    noiseSuppression,
    autoGainControl,
    preferredInputDeviceId,
    masterInputVolume,
    inputNoiseGateEnabled,
    inputNoiseGateThresholdDb,
  } = useSettingsStore.getState();

  let micGranted = false;
  if (navigator.mediaDevices?.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: buildMicTrackConstraints({
          masterInputVolume,
          preferredInputDeviceId,
          echoCancellation,
          noiseSuppression,
          autoGainControl,
          inputNoiseGateEnabled,
          inputNoiseGateThresholdDb,
        }),
      });
      stream.getTracks().forEach((track) => track.stop());
      micGranted = true;
    } catch {
      // Permission denial is non-fatal. Continue muted.
    }
  }

  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
    if (ctx.state === "suspended") await ctx.resume();
  } catch {
    // Best-effort playback resume only.
  } finally {
    ctx?.close();
  }

  // The voice token endpoint is the source of truth for both the
  // LiveKit fallback AND the STUN/TURN servers the mesh PeerConnections
  // need for NAT traversal. Fetch it once, up-front, so the mesh path
  // and the LiveKit path share the same `ice_servers` and we never
  // double-fetch. A token failure is fatal to the whole voice flow.
  let result;
  try {
    result = await getVoiceToken(roomId, accessToken);
  } catch (err) {
    // Release the connect lock so the next attempt (manual retry or the next
    // backoff iteration) can proceed.
    useVoiceStore.getState().setConnectionState("disconnected");
    throw err;
  }
  const tokenIceServers: RTCIceServer[] = result.ice_servers?.length
    ? result.ice_servers
    : [];

  // Phase 8/9 follow-up — ask the servitude layer which voice path to
  // use. If the selector picks `libp2p_mesh`, attempt a REAL mesh-join
  // (native: webrtc-rs via Tauri; web: browser RTCPeerConnection via
  // `voiceMesh.ts`), threading the real STUN/TURN servers through so
  // calls traverse NAT. On any failure the flow falls through to the
  // proven LiveKit path.
  let meshJoined = false;
  try {
    // The Phase 8 selector treats `peer_id === null` as a web-only
    // participant. The room-roster → peer-store resolution still lands
    // as a follow-up; today we send an empty participant list. With no
    // remotes named, mesh-join wires the local PeerConnection +
    // signaling handler so subsequent inbound Offers from late joiners
    // are still handled.
    const participants: VoiceParticipant[] = [];
    const decision = await selectVoicePath(participants);
    if (decision.path === "libp2p_mesh") {
      // eslint-disable-next-line no-console
      console.info(
        `[voice] libp2p mesh selected — reason=${decision.reason}; attempting mesh-join`,
      );
      try {
        await meshJoin({
          roomId,
          participants,
          iceServers: tokenIceServers,
        });
        useVoiceStore.getState().connect({
          token: "",
          livekitUrl: "",
          iceServers: tokenIceServers,
          serverId,
          serverName: serverName ?? activeServer?.name ?? null,
          channelId: roomId,
          channelName,
          channelType: channelType ?? "voice",
          roomName: roomId,
          returnChannelId:
            returnChannelIdOverride ??
            activeServer?.channels.find(
              (channel) =>
                channel.matrix_room_id === activeChannelId &&
                channel.channel_type !== "voice",
            )?.matrix_room_id ??
            null,
          returnChannelName:
            returnChannelNameOverride ??
            activeServer?.channels.find(
              (channel) =>
                channel.matrix_room_id === activeChannelId &&
                channel.channel_type !== "voice",
            )?.name ??
            null,
          micGranted,
          transport: "libp2p_mesh",
        });
        meshJoined = true;
      } catch (meshErr) {
        // eslint-disable-next-line no-console
        console.warn(
          "[voice] mesh-join failed; falling back to LiveKit",
          meshErr,
        );
      }
    } else {
      // eslint-disable-next-line no-console
      console.info(
        `[voice] LiveKit SFU selected — reason=${decision.reason}`,
      );
    }
  } catch (decisionErr) {
    // selectVoicePath has its own try/catch fallback; this is
    // belt-and-suspenders so a bug in path selection cannot prevent
    // the voice flow from progressing to LiveKit.
    // eslint-disable-next-line no-console
    console.warn(
      "[voice] voice path selection threw; continuing on LiveKit:",
      decisionErr,
    );
  }
  if (meshJoined) return;
  const wkLivekit = useServerConfigStore.getState().config?.livekit_url;
  const rawUrl = wkLivekit
    || result.livekit_url
    || `${getHomeserverUrl().replace(/^http/, "ws")}/livekit/`;
  const livekitUrl = rawUrl.endsWith("/") ? rawUrl : `${rawUrl}/`;

  const derivedReturnChannelId =
    activeServer?.channels.find(
      (channel) =>
        channel.matrix_room_id === activeChannelId &&
        channel.channel_type !== "voice",
    )?.matrix_room_id ??
    activeServer?.channels.find((channel) => channel.channel_type !== "voice")?.matrix_room_id ??
    null;
  const derivedReturnChannelName =
    activeServer?.channels.find(
      (channel) =>
        channel.matrix_room_id === activeChannelId &&
        channel.channel_type !== "voice",
    )?.name ??
    activeServer?.channels.find((channel) => channel.channel_type !== "voice")?.name ??
    null;

  useVoiceStore.getState().connect({
    token: result.token,
    livekitUrl,
    iceServers: result.ice_servers?.length ? result.ice_servers : [],
    serverId,
    serverName: serverName ?? activeServer?.name ?? null,
    channelId: roomId,
    channelName,
    channelType: channelType ?? "voice",
    roomName: roomId,
    returnChannelId: returnChannelIdOverride ?? derivedReturnChannelId,
    returnChannelName: returnChannelNameOverride ?? derivedReturnChannelName,
    micGranted,
  });
}
