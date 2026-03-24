import { create } from "zustand";
import { startVoiceSession, endVoiceSession } from "../api/concord";
import { useAuthStore } from "./auth";

const VOICE_SESSION_KEY = "concord_voice_session";
const VOICE_STATS_SESSION_KEY = "concord_voice_stats_session";

interface VoiceSession {
  serverId: string;
  channelId: string;
  channelName: string;
  roomName: string;
}

interface VoiceState {
  connected: boolean;
  token: string | null;
  livekitUrl: string | null;
  iceServers: RTCIceServer[];
  serverId: string | null;
  channelId: string | null; // matrix_room_id
  channelName: string | null;
  roomName: string | null; // LiveKit room name (same as matrix room id)
  micGranted: boolean;
  statsSessionId: number | null;

  connect: (params: {
    token: string;
    livekitUrl: string;
    iceServers: RTCIceServer[];
    serverId: string;
    channelId: string;
    channelName: string;
    roomName: string;
    micGranted: boolean;
  }) => void;
  disconnect: () => void;
}

/** Read a pending voice session from sessionStorage (if any). */
export function getPendingVoiceSession(): VoiceSession | null {
  try {
    const raw = sessionStorage.getItem(VOICE_SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as VoiceSession;
  } catch {
    return null;
  }
}

/** Clear the pending voice session (called after successful reconnect or explicit disconnect). */
export function clearPendingVoiceSession(): void {
  sessionStorage.removeItem(VOICE_SESSION_KEY);
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  connected: false,
  token: null,
  livekitUrl: null,
  iceServers: [],
  serverId: null,
  channelId: null,
  channelName: null,
  roomName: null,
  micGranted: false,
  statsSessionId: null,

  connect: (params) => {
    // Persist session info so we can reconnect after page refresh
    const session: VoiceSession = {
      serverId: params.serverId,
      channelId: params.channelId,
      channelName: params.channelName,
      roomName: params.roomName,
    };
    try {
      sessionStorage.setItem(VOICE_SESSION_KEY, JSON.stringify(session));
    } catch {
      // sessionStorage full or unavailable — non-critical
    }

    set({
      connected: true,
      ...params,
    });

    // Start stats tracking (fire-and-forget)
    const token = useAuthStore.getState().accessToken;
    if (token) {
      startVoiceSession(params.channelId, params.serverId, token)
        .then((res) => {
          set({ statsSessionId: res.session_id });
          try {
            sessionStorage.setItem(VOICE_STATS_SESSION_KEY, String(res.session_id));
          } catch {}
        })
        .catch(() => {});
    }
  },

  disconnect: () => {
    // End stats tracking (fire-and-forget)
    const sessionId = get().statsSessionId || Number(sessionStorage.getItem(VOICE_STATS_SESSION_KEY) || 0);
    if (sessionId) {
      const token = useAuthStore.getState().accessToken;
      if (token) {
        endVoiceSession(sessionId, token).catch(() => {});
      }
      try { sessionStorage.removeItem(VOICE_STATS_SESSION_KEY); } catch {}
    }

    clearPendingVoiceSession();
    set({
      connected: false,
      token: null,
      livekitUrl: null,
      iceServers: [],
      serverId: null,
      channelId: null,
      channelName: null,
      roomName: null,
      micGranted: false,
      statsSessionId: null,
    });
  },
}));
