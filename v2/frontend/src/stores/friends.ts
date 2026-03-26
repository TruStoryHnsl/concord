import { create } from "zustand";

export interface Friend {
  id: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  status: "online" | "idle" | "dnd" | "offline";
}

export interface FriendRequest {
  id: string;
  fromUserId: string;
  fromUsername: string;
  fromDisplayName: string;
  timestamp: number;
  direction: "incoming" | "outgoing";
}

interface FriendsState {
  friends: Friend[];
  pendingRequests: FriendRequest[];
  onlineFriends: Friend[];
  setFriends: (friends: Friend[]) => void;
  setPendingRequests: (requests: FriendRequest[]) => void;
  setOnlineFriends: (friends: Friend[]) => void;
}

export const useFriendsStore = create<FriendsState>((set) => ({
  friends: [],
  pendingRequests: [],
  onlineFriends: [],

  setFriends: (friends) => set({ friends }),
  setPendingRequests: (requests) => set({ pendingRequests: requests }),
  setOnlineFriends: (friends) => set({ onlineFriends: friends }),
}));
