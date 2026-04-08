import { create } from "zustand";
import type { Server, Channel, ServerMember } from "../api/concord";
import {
  listServers,
  createServer as apiCreateServer,
  createChannel as apiCreateChannel,
  createInvite as apiCreateInvite,
  deleteServer as apiDeleteServer,
  deleteChannel as apiDeleteChannel,
  renameChannel as apiRenameChannel,
  leaveServer as apiLeaveServer,
  reorderChannels as apiReorderChannels,
  listMembers as apiListMembers,
  getDefaultServer,
  joinServer as apiJoinServer,
  rejoinServerRooms as apiRejoinServerRooms,
} from "../api/concord";
import { useToastStore } from "./toast";

interface ServerState {
  servers: Server[];
  activeServerId: string | null;
  activeChannelId: string | null; // matrix_room_id
  members: Record<string, ServerMember[]>; // keyed by server ID

  loadServers: (accessToken: string) => Promise<void>;
  createServer: (
    name: string,
    accessToken: string,
    options?: { visibility?: string; abbreviation?: string },
  ) => Promise<Server>;
  createChannel: (
    serverId: string,
    name: string,
    channelType: string,
    accessToken: string,
  ) => Promise<Channel>;
  createInvite: (serverId: string, accessToken: string) => Promise<string>;
  deleteServer: (serverId: string, accessToken: string) => Promise<void>;
  deleteChannel: (
    serverId: string,
    channelId: number,
    accessToken: string,
  ) => Promise<void>;
  renameChannel: (
    serverId: string,
    channelId: number,
    name: string,
    accessToken: string,
  ) => Promise<void>;
  reorderChannels: (
    serverId: string,
    channelIds: number[],
    accessToken: string,
  ) => Promise<void>;
  leaveServer: (serverId: string, accessToken: string) => Promise<void>;
  setActiveServer: (serverId: string) => void;
  setActiveChannel: (matrixRoomId: string) => void;
  loadMembers: (serverId: string, accessToken: string) => Promise<void>;
  updateServer: (serverId: string, updates: Partial<Server>) => void;

  activeServer: () => Server | undefined;
  activeChannel: () => Channel | undefined;
}

export const useServerStore = create<ServerState>((set, get) => ({
  servers: [],
  activeServerId: null,
  activeChannelId: null,
  members: {},

  loadServers: async (accessToken) => {
    let servers: Server[];
    try {
      servers = await listServers(accessToken);
    } catch (err) {
      useToastStore.getState().addToast(
        err instanceof Error ? err.message : "Failed to load servers",
      );
      return;
    }

    // Server-side auto-joins the lobby if needed, but if user somehow
    // still has zero servers, try the explicit join as a fallback
    if (servers.length === 0) {
      try {
        const defaultInfo = await getDefaultServer(accessToken);
        if (defaultInfo.server_id && !defaultInfo.is_member) {
          await apiJoinServer(defaultInfo.server_id, accessToken);
          servers = await listServers(accessToken);
        }
      } catch {
        // Default server may not exist — that's fine
      }
    }

    set({ servers });

    // Background reconciliation: ensure the user's Matrix membership covers
    // every channel of every server they belong to. This catches the case
    // where a channel was created before the auto-invite code shipped and
    // existing members never got invited to the underlying Matrix room.
    // Idempotent: /rejoin calls /join on each room and silently no-ops if
    // already joined. Fire-and-forget to keep loadServers fast.
    for (const srv of servers) {
      apiRejoinServerRooms(srv.id, accessToken).catch(() => {
        // Best-effort — failures here just leave the user in the prior state
      });
    }

    // Auto-select: land in the lobby's #welcome channel by default
    const { activeServerId } = get();
    if (!activeServerId && servers.length > 0) {
      // Find the lobby (first server, which is oldest by created_at)
      const lobby = servers[0];
      // Prefer #welcome channel, fall back to first channel
      const welcomeChannel = lobby.channels.find((ch) => ch.name === "welcome");
      const targetChannel = welcomeChannel ?? lobby.channels[0];
      set({
        activeServerId: lobby.id,
        activeChannelId: targetChannel?.matrix_room_id ?? null,
      });
    }
  },

  createServer: async (name, accessToken, options) => {
    const server = await apiCreateServer(name, accessToken, options);
    set((s) => ({
      servers: [...s.servers, server],
      activeServerId: server.id,
      activeChannelId: server.channels[0]?.matrix_room_id ?? null,
    }));
    return server;
  },

  createChannel: async (serverId, name, channelType, accessToken) => {
    const channel = await apiCreateChannel(
      serverId,
      name,
      channelType,
      accessToken,
    );
    set((s) => ({
      servers: s.servers.map((srv) =>
        srv.id === serverId
          ? { ...srv, channels: [...srv.channels, channel] }
          : srv,
      ),
    }));
    return channel;
  },

  createInvite: async (serverId, accessToken) => {
    const invite = await apiCreateInvite(serverId, accessToken);
    return invite.token;
  },

  deleteServer: async (serverId, accessToken) => {
    await apiDeleteServer(serverId, accessToken);
    const { servers, activeServerId } = get();
    const remaining = servers.filter((s) => s.id !== serverId);
    const newActive = activeServerId === serverId ? remaining[0] ?? null : null;
    set({
      servers: remaining,
      ...(activeServerId === serverId && {
        activeServerId: newActive?.id ?? null,
        activeChannelId: newActive?.channels[0]?.matrix_room_id ?? null,
      }),
    });
  },

  deleteChannel: async (serverId, channelId, accessToken) => {
    await apiDeleteChannel(serverId, channelId, accessToken);
    set((s) => {
      const servers = s.servers.map((srv) =>
        srv.id === serverId
          ? { ...srv, channels: srv.channels.filter((c) => c.id !== channelId) }
          : srv,
      );
      // If the deleted channel was active, switch to first available
      const activeServer = servers.find((srv) => srv.id === serverId);
      const wasActive = s.activeChannelId && activeServer?.channels.every(
        (c) => c.matrix_room_id !== s.activeChannelId,
      );
      return {
        servers,
        ...(wasActive && {
          activeChannelId: activeServer?.channels[0]?.matrix_room_id ?? null,
        }),
      };
    });
  },

  renameChannel: async (serverId, channelId, name, accessToken) => {
    const updated = await apiRenameChannel(serverId, channelId, name, accessToken);
    set((s) => ({
      servers: s.servers.map((srv) =>
        srv.id === serverId
          ? {
              ...srv,
              channels: srv.channels.map((c) =>
                c.id === channelId ? { ...c, name: updated.name } : c,
              ),
            }
          : srv,
      ),
    }));
  },

  reorderChannels: async (serverId, channelIds, accessToken) => {
    // Snapshot previous channel order so we can roll back on API failure.
    const prevServers = get().servers;
    const prevServer = prevServers.find((s) => s.id === serverId);
    if (!prevServer) return;

    // Optimistic reorder: sort the server's channels by the index each ID
    // appears at in `channelIds`. Any channel not mentioned (e.g. a voice
    // channel when we're only reordering text channels) keeps its original
    // relative order at the end of the list, so partial reorders are safe.
    const indexMap = new Map<number, number>();
    channelIds.forEach((id, idx) => indexMap.set(id, idx));
    const reordered = [...prevServer.channels].sort((a, b) => {
      const ai = indexMap.has(a.id) ? indexMap.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const bi = indexMap.has(b.id) ? indexMap.get(b.id)! : Number.MAX_SAFE_INTEGER;
      if (ai !== bi) return ai - bi;
      // Stable fallback for un-mentioned channels: preserve original order
      return prevServer.channels.indexOf(a) - prevServer.channels.indexOf(b);
    });

    set((s) => ({
      servers: s.servers.map((srv) =>
        srv.id === serverId ? { ...srv, channels: reordered } : srv,
      ),
    }));

    try {
      await apiReorderChannels(serverId, channelIds, accessToken);
    } catch (err) {
      // Roll back the optimistic reorder and surface the error.
      set({ servers: prevServers });
      useToastStore.getState().addToast(
        err instanceof Error ? err.message : "Failed to reorder channels",
      );
      throw err;
    }
  },

  leaveServer: async (serverId, accessToken) => {
    await apiLeaveServer(serverId, accessToken);
    const { servers, activeServerId } = get();
    const remaining = servers.filter((s) => s.id !== serverId);
    const newActive = activeServerId === serverId ? remaining[0] ?? null : null;
    set({
      servers: remaining,
      ...(activeServerId === serverId && {
        activeServerId: newActive?.id ?? null,
        activeChannelId: newActive?.channels[0]?.matrix_room_id ?? null,
      }),
    });
  },

  loadMembers: async (serverId, accessToken) => {
    try {
      const members = await apiListMembers(serverId, accessToken);
      set((s) => ({ members: { ...s.members, [serverId]: members } }));
    } catch {
      // silent fail — members list is supplementary
    }
  },

  updateServer: (serverId, updates) => {
    set((s) => ({
      servers: s.servers.map((srv) =>
        srv.id === serverId ? { ...srv, ...updates } : srv,
      ),
    }));
  },

  setActiveServer: (serverId) => {
    const server = get().servers.find((s) => s.id === serverId);
    set({
      activeServerId: serverId,
      activeChannelId: server?.channels[0]?.matrix_room_id ?? null,
    });
  },

  setActiveChannel: (matrixRoomId) => {
    set({ activeChannelId: matrixRoomId });
  },

  activeServer: () => {
    const { servers, activeServerId } = get();
    return servers.find((s) => s.id === activeServerId);
  },

  activeChannel: () => {
    const server = get().activeServer();
    if (!server) return undefined;
    return server.channels.find(
      (c) => c.matrix_room_id === get().activeChannelId,
    );
  },
}));
