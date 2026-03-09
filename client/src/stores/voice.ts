import { create } from "zustand";

const VOICE_SESSION_KEY = "concorrd_voice_session";

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

export const useVoiceStore = create<VoiceState>((set) => ({
  connected: false,
  token: null,
  livekitUrl: null,
  iceServers: [],
  serverId: null,
  channelId: null,
  channelName: null,
  roomName: null,
  micGranted: false,

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
  },

  disconnect: () => {
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
    });
  },
}));
