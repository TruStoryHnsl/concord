/**
 * nativeShell — the native app's crosstalk-guided mesh-messenger shell.
 *
 * The NATIVE app is a p2p MESSENGER (user order, incident 2026-08-11):
 * it boots into a crosstalk-shaped shell — Chats / Peers / Network /
 * Announces / Interfaces — with NO local "home server" and NO
 * Discord-style chrome. The Discord-style UI (ChatLayout) is DOCKER
 * ONLY: it appears when, and only while, the user actively enters a
 * docker/matrix instance from the shell's Instances list
 * (`mode: "instance"` reveals the always-mounted ChatLayout beneath;
 * `leaveInstance()` returns to the shell).
 */

import { create } from "zustand";

export type NativeShellSection =
  | "chats"
  | "peers"
  | "network"
  /** The reticulum connection path, opened from Connections — a chosen
   *  parallel protocol (like entering a docker instance), NOT the core
   *  transport. The core messenger rides libp2p + WireGuard. */
  | "reticulum";

interface NativeShellState {
  /** "shell" = mesh messenger (default). "instance" = the user entered a
   *  docker/matrix instance; ChatLayout is revealed until they leave. */
  mode: "shell" | "instance";
  section: NativeShellSection;
  /** Peer id handed to the Chats section to open a conversation. */
  chatPeerId: string | null;
  setSection: (section: NativeShellSection) => void;
  openConversation: (peerId: string) => void;
  enterInstance: () => void;
  leaveInstance: () => void;
}

export const useNativeShellStore = create<NativeShellState>((set) => ({
  mode: "shell",
  section: "chats",
  chatPeerId: null,
  setSection: (section) => set({ section }),
  openConversation: (peerId) =>
    set({ mode: "shell", section: "chats", chatPeerId: peerId }),
  enterInstance: () => set({ mode: "instance" }),
  leaveInstance: () => set({ mode: "shell" }),
}));
