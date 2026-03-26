import { create } from "zustand";
import type { FriendPayload, PresenceStatus } from "@/api/tauri";
import {
  getFriends,
  sendFriendRequest,
  acceptFriendRequest,
  removeFriend,
  setPresence,
} from "@/api/tauri";

interface FriendsState {
  friends: FriendPayload[];
  pendingRequests: FriendPayload[];
  presenceVisible: boolean;
  myPresence: PresenceStatus;
  loading: boolean;

  loadFriends: () => Promise<void>;
  sendRequest: (peerId: string) => Promise<void>;
  acceptRequest: (peerId: string) => Promise<void>;
  removeFriend: (peerId: string) => Promise<void>;
  addPendingRequest: (friend: FriendPayload) => void;
  movePendingToFriends: (peerId: string) => void;
  updatePresence: (peerId: string, status: PresenceStatus) => void;
  setMyPresence: (status: PresenceStatus) => void;
  setPresenceVisible: (visible: boolean) => void;
}

export const useFriendsStore = create<FriendsState>((set) => ({
  friends: [],
  pendingRequests: [],
  presenceVisible: true,
  myPresence: "online",
  loading: false,

  loadFriends: async () => {
    set({ loading: true });
    try {
      const friends = await getFriends();
      set({ friends, loading: false });
    } catch (err) {
      console.warn("Failed to load friends:", err);
      set({ loading: false });
    }
  },

  sendRequest: async (peerId) => {
    try {
      await sendFriendRequest(peerId);
    } catch (err) {
      console.error("Failed to send friend request:", err);
    }
  },

  acceptRequest: async (peerId) => {
    try {
      await acceptFriendRequest(peerId);
      set((state) => {
        const request = state.pendingRequests.find((r) => r.peerId === peerId);
        const updatedPending = state.pendingRequests.filter((r) => r.peerId !== peerId);
        if (request) {
          return {
            pendingRequests: updatedPending,
            friends: [...state.friends, { ...request, isMutual: true }],
          };
        }
        return { pendingRequests: updatedPending };
      });
    } catch (err) {
      console.error("Failed to accept friend request:", err);
    }
  },

  removeFriend: async (peerId) => {
    try {
      await removeFriend(peerId);
      set((state) => ({
        friends: state.friends.filter((f) => f.peerId !== peerId),
      }));
    } catch (err) {
      console.error("Failed to remove friend:", err);
    }
  },

  addPendingRequest: (friend) => {
    set((state) => {
      if (state.pendingRequests.some((r) => r.peerId === friend.peerId)) return state;
      return { pendingRequests: [...state.pendingRequests, friend] };
    });
  },

  movePendingToFriends: (peerId) => {
    set((state) => {
      const request = state.pendingRequests.find((r) => r.peerId === peerId);
      if (!request) return state;
      return {
        pendingRequests: state.pendingRequests.filter((r) => r.peerId !== peerId),
        friends: [...state.friends, { ...request, isMutual: true }],
      };
    });
  },

  updatePresence: (peerId, status) => {
    set((state) => ({
      friends: state.friends.map((f) =>
        f.peerId === peerId ? { ...f, presenceStatus: status } : f,
      ),
    }));
  },

  setMyPresence: (status) => {
    set({ myPresence: status });
    void setPresence(status);
  },

  setPresenceVisible: (visible) => {
    set({ presenceVisible: visible });
  },
}));
