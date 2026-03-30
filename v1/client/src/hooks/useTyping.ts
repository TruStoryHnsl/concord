import { useEffect, useState, useRef, useCallback } from "react";
import { RoomMemberEvent } from "matrix-js-sdk";
import type { MatrixEvent, RoomMember } from "matrix-js-sdk";
import { useAuthStore } from "../stores/auth";

/**
 * Returns the list of display names currently typing in the given room,
 * excluding the local user.
 */
export function useTypingUsers(roomId: string | null): string[] {
  const client = useAuthStore((s) => s.client);
  const userId = useAuthStore((s) => s.userId);
  const [typingNames, setTypingNames] = useState<string[]>([]);

  useEffect(() => {
    if (!client || !roomId) {
      setTypingNames([]);
      return;
    }

    const onTyping = (_event: MatrixEvent, member: RoomMember) => {
      // Only care about members in our active room
      if (member.roomId !== roomId) return;

      const room = client.getRoom(roomId);
      if (!room) return;

      // Scan joined members for typing=true
      const joined = room.getMembersWithMembership("join");
      const names = joined
        .filter((m) => m.typing && m.userId !== userId)
        .map((m) => m.name || m.userId.split(":")[0].replace("@", ""));
      setTypingNames(names);
    };

    client.on(RoomMemberEvent.Typing, onTyping);
    return () => {
      client.removeListener(RoomMemberEvent.Typing, onTyping);
    };
  }, [client, roomId, userId]);

  return typingNames;
}

/**
 * Returns an `onKeystroke` callback and an `onStopTyping` callback.
 * Call `onKeystroke` on every input change (debounced internally).
 * Call `onStopTyping` on blur/send.
 */
export function useSendTyping(roomId: string | null) {
  const client = useAuthStore((s) => s.client);
  const typingRef = useRef(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTyping = useCallback(() => {
    if (!client || !roomId || !typingRef.current) return;
    typingRef.current = false;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    client.sendTyping(roomId, false, 0).catch(() => {});
  }, [client, roomId]);

  const onKeystroke = useCallback(() => {
    if (!client || !roomId) return;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(stopTyping, 3000);

    if (!typingRef.current) {
      typingRef.current = true;
      client.sendTyping(roomId, true, 30000).catch(() => {});
    }
  }, [client, roomId, stopTyping]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (typingRef.current && client && roomId) {
        client.sendTyping(roomId, false, 0).catch(() => {});
        typingRef.current = false;
      }
    };
  }, [client, roomId]);

  return { onKeystroke, onStopTyping: stopTyping };
}
