import { create } from "zustand";
import type { VoiceParticipant } from "@/api/tauri";
import {
  joinVoice as apiJoinVoice,
  leaveVoice as apiLeaveVoice,
  toggleMute as apiToggleMute,
  toggleDeafen as apiToggleDeafen,
} from "@/api/tauri";

export type { VoiceParticipant };

interface VoiceState {
  isInVoice: boolean;
  channelId: string | null;
  serverId: string | null;
  isMuted: boolean;
  isDeafened: boolean;
  participants: VoiceParticipant[];

  joinVoice: (serverId: string, channelId: string) => Promise<void>;
  leaveVoice: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
  addParticipant: (p: VoiceParticipant) => void;
  removeParticipant: (peerId: string) => void;
  updateState: (state: Partial<VoiceState>) => void;
}

export const useVoiceStore = create<VoiceState>((set) => ({
  isInVoice: false,
  channelId: null,
  serverId: null,
  participants: [],
  isMuted: false,
  isDeafened: false,

  joinVoice: async (serverId, channelId) => {
    try {
      const result = await apiJoinVoice(serverId, channelId);
      set({
        isInVoice: result.isInVoice,
        channelId: result.channelId,
        serverId: result.serverId,
        isMuted: result.isMuted,
        isDeafened: result.isDeafened,
        participants: result.participants,
      });
    } catch (err) {
      console.error("[voice] join failed:", err);
    }
  },

  leaveVoice: async () => {
    try {
      await apiLeaveVoice();
      set({
        isInVoice: false,
        channelId: null,
        serverId: null,
        participants: [],
        isMuted: false,
        isDeafened: false,
      });
    } catch (err) {
      console.error("[voice] leave failed:", err);
    }
  },

  toggleMute: async () => {
    try {
      const newMuted = await apiToggleMute();
      set({ isMuted: newMuted });
    } catch (err) {
      // Optimistic toggle on error
      set((s) => ({ isMuted: !s.isMuted }));
      console.error("[voice] toggleMute failed:", err);
    }
  },

  toggleDeafen: async () => {
    try {
      const newDeafened = await apiToggleDeafen();
      set((s) => ({
        isDeafened: newDeafened,
        // Deafening always mutes; un-deafening restores previous mute state
        isMuted: newDeafened ? true : s.isMuted,
      }));
    } catch (err) {
      set((s) => ({
        isDeafened: !s.isDeafened,
        isMuted: !s.isDeafened ? true : s.isMuted,
      }));
      console.error("[voice] toggleDeafen failed:", err);
    }
  },

  addParticipant: (p) =>
    set((s) => {
      // Avoid duplicates
      if (s.participants.some((x) => x.peerId === p.peerId)) return s;
      return { participants: [...s.participants, p] };
    }),

  removeParticipant: (peerId) =>
    set((s) => ({
      participants: s.participants.filter((p) => p.peerId !== peerId),
    })),

  updateState: (partial) => set(partial),
}));
