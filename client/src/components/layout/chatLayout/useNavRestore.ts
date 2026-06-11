import { useEffect, useRef } from "react";
import { useServerStore } from "../../../stores/server";
import type { Server } from "../../../api/concord";
import { useDMStore } from "../../../stores/dm";
import { useNavStack, buildStackToLevel } from "../../../stores/navStack";

export function lastChannelStorageKey(userId: string | null): string {
  return userId ? `concord_last_channel:${userId}` : "concord_last_channel";
}

/**
 * Boot-restore + history persistence for the active channel selection.
 *
 * Two effects, extracted verbatim from ChatLayout:
 *
 *   1. Persistence — track the most recently-active server channel in
 *      localStorage (TASK 26) so it can be restored across reloads. Only
 *      server channels are tracked; DMs reconnect via their own store.
 *
 *   2. Startup restore — on first mount with a populated server list,
 *      reopen the last channel AND rebuild the navStack so a phone
 *      refresh inside a channel reopens the chat frame with a working
 *      back path (sources → servers → channels → chat). Desktop ignores
 *      the stack, so the rebuild is a no-op there.
 */
export function useNavRestore(
  serversLoaded: boolean,
  userId: string | null,
  servers: Server[],
  dmActive: boolean,
  activeServerId: string | null,
  activeChannelId: string | null,
): void {
  const setDMActive = useDMStore((s) => s.setDMActive);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const origSetActiveChannel = useServerStore((s) => s.setActiveChannel);
  const startupRestoreHandled = useRef<string | null>(null);

  // TASK 26: persist the most recently-active server channel so the
  // "Reconnect to last channel" quick action can restore it.
  useEffect(() => {
    if (!dmActive && activeServerId && activeChannelId) {
      try {
        localStorage.setItem(
          lastChannelStorageKey(userId),
          JSON.stringify({ serverId: activeServerId, roomId: activeChannelId }),
        );
      } catch {}
    }
  }, [dmActive, activeServerId, activeChannelId, userId]);

  useEffect(() => {
    if (!serversLoaded || !userId) return;
    if (startupRestoreHandled.current === userId) return;

    try {
      const raw = localStorage.getItem(lastChannelStorageKey(userId));
      if (!raw) {
        startupRestoreHandled.current = userId;
        return;
      }
      const parsed = JSON.parse(raw) as { serverId?: string; roomId?: string };
      const server = servers.find((s) => s.id === parsed.serverId);
      const channel = server?.channels.find((c) => c.matrix_room_id === parsed.roomId);
      if (!server || !channel) return;
      startupRestoreHandled.current = userId;
      setDMActive(false);
      setActiveServer(server.id);
      origSetActiveChannel(channel.matrix_room_id);
      // Deep-link/refresh rehydrate: rebuild the navStack so a phone refresh
      // inside a channel reopens the chat frame WITH a working back path
      // (sources → servers → channels → chat) rather than landing on the
      // top-of-stack `sources` root. Desktop ignores the stack, so this is a
      // no-op there. `buildStackToLevel` synthesizes the intermediate frames.
      useNavStack.getState().setStack(
        buildStackToLevel("chat", {
          serverId: server.id,
          channelId: channel.matrix_room_id,
        }),
        null,
      );
    } catch {
      startupRestoreHandled.current = userId;
    }
  }, [serversLoaded, userId, servers, setDMActive, setActiveServer, origSetActiveChannel]);
}
