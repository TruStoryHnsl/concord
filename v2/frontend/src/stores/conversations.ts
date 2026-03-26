import { create } from "zustand";
import type { ConversationPayload } from "@/api/tauri";
import {
  getConversations,
  createGroupConversation,
  addToConversation,
} from "@/api/tauri";

interface ConversationsState {
  conversations: ConversationPayload[];
  activeConversationId: string | null;
  loading: boolean;

  loadConversations: () => Promise<void>;
  selectConversation: (id: string) => void;
  createGroup: (peerIds: string[], name?: string) => Promise<void>;
  addParticipant: (convId: string, peerId: string) => Promise<void>;
}

export const useConversationsStore = create<ConversationsState>((set) => ({
  conversations: [],
  activeConversationId: null,
  loading: false,

  loadConversations: async () => {
    set({ loading: true });
    try {
      const conversations = await getConversations();
      set({ conversations, loading: false });
    } catch (err) {
      console.warn("Failed to load conversations:", err);
      set({ loading: false });
    }
  },

  selectConversation: (id) => {
    set({ activeConversationId: id });
  },

  createGroup: async (peerIds, name) => {
    try {
      const conv = await createGroupConversation(peerIds, name);
      set((state) => ({
        conversations: [...state.conversations, conv],
        activeConversationId: conv.id,
      }));
    } catch (err) {
      console.error("Failed to create group conversation:", err);
    }
  },

  addParticipant: async (convId, peerId) => {
    try {
      await addToConversation(convId, peerId);
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.id === convId
            ? { ...c, participants: [...c.participants, peerId] }
            : c,
        ),
      }));
    } catch (err) {
      console.error("Failed to add participant:", err);
    }
  },
}));
