import { create } from "zustand";
import type { DmMessage } from "@/api/tauri";
import { getDmHistory, sendDm, initiateDmSession } from "@/api/tauri";

export interface DmConversation {
  peerId: string;
  displayName?: string;
  messages: DmMessage[];
  unreadCount: number;
  lastMessage?: DmMessage;
}

interface DmState {
  conversations: DmConversation[];
  activePeerId: string | null;

  /* Actions */
  openConversation: (peerId: string, displayName?: string) => Promise<void>;
  sendMessage: (peerId: string, content: string) => Promise<void>;
  addIncomingMessage: (message: DmMessage) => void;
  setActivePeer: (peerId: string | null) => void;
  getConversation: (peerId: string) => DmConversation | undefined;
}

export const useDmStore = create<DmState>((set, get) => ({
  conversations: [],
  activePeerId: null,

  openConversation: async (peerId, displayName) => {
    set({ activePeerId: peerId });

    try {
      await initiateDmSession(peerId);
      const history = await getDmHistory(peerId, 50);

      set((state) => {
        const existing = state.conversations.find((c) => c.peerId === peerId);
        if (existing) {
          return {
            conversations: state.conversations.map((c) =>
              c.peerId === peerId
                ? { ...c, messages: history, unreadCount: 0, lastMessage: history[history.length - 1] }
                : c,
            ),
          };
        }
        const lastMsg = history[history.length - 1];
        return {
          conversations: [
            ...state.conversations,
            { peerId, displayName, messages: history, unreadCount: 0, lastMessage: lastMsg },
          ],
        };
      });
    } catch (err) {
      console.warn("Failed to open DM session:", err);
    }
  },

  sendMessage: async (peerId, content) => {
    try {
      const msg = await sendDm(peerId, content);
      set((state) => ({
        conversations: state.conversations.map((c) =>
          c.peerId === peerId
            ? { ...c, messages: [...c.messages, msg], lastMessage: msg }
            : c,
        ),
      }));
    } catch (err) {
      console.error("Failed to send DM:", err);
    }
  },

  addIncomingMessage: (message) => {
    set((state) => {
      const fromPeer = message.fromPeer;
      const existing = state.conversations.find((c) => c.peerId === fromPeer);

      if (existing) {
        // Avoid duplicates
        if (existing.messages.some((m) => m.id === message.id)) return state;
        const isActive = state.activePeerId === fromPeer;
        return {
          conversations: state.conversations.map((c) =>
            c.peerId === fromPeer
              ? {
                  ...c,
                  messages: [...c.messages, message],
                  lastMessage: message,
                  unreadCount: isActive ? c.unreadCount : c.unreadCount + 1,
                }
              : c,
          ),
        };
      }

      // New conversation from incoming message
      return {
        conversations: [
          ...state.conversations,
          {
            peerId: fromPeer,
            messages: [message],
            unreadCount: 1,
            lastMessage: message,
          },
        ],
      };
    });
  },

  setActivePeer: (peerId) => {
    set((state) => ({
      activePeerId: peerId,
      conversations: state.conversations.map((c) =>
        c.peerId === peerId ? { ...c, unreadCount: 0 } : c,
      ),
    }));
  },

  getConversation: (peerId) => {
    return get().conversations.find((c) => c.peerId === peerId);
  },
}));
