import { useEffect, useState, useRef } from "react";
import { RoomEvent, NotificationCountType } from "matrix-js-sdk";
import { useAuthStore } from "../stores/auth";

export function useUnreadCounts(): Map<string, number> {
  const client = useAuthStore((s) => s.client);
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevKeyRef = useRef<string>("");

  useEffect(() => {
    if (!client) return;

    const update = () => {
      const rooms = client.getRooms();
      const map = new Map<string, number>();
      for (const room of rooms) {
        const count = room.getUnreadNotificationCount(
          NotificationCountType.Total,
        );
        if (count > 0) {
          map.set(room.roomId, count);
        }
      }
      // Only update state if counts actually changed
      const key = Array.from(map.entries())
        .map(([id, c]) => `${id}:${c}`)
        .join(",");
      if (key !== prevKeyRef.current) {
        prevKeyRef.current = key;
        setCounts(map);
      }
    };

    // Debounce: Timeline events fire very frequently (every message in any
    // room triggers this). Without debouncing, we re-scan all rooms and
    // allocate new Maps on every single event.
    const debouncedUpdate = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(update, 200);
    };

    update();

    client.on(RoomEvent.Timeline, debouncedUpdate);
    client.on(RoomEvent.Receipt, debouncedUpdate);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      client.removeListener(RoomEvent.Timeline, debouncedUpdate);
      client.removeListener(RoomEvent.Receipt, debouncedUpdate);
    };
  }, [client]);

  return counts;
}

export function useSendReadReceipt(roomId: string | null) {
  const client = useAuthStore((s) => s.client);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!client || !roomId) return;

    debounceRef.current = setTimeout(() => {
      const room = client.getRoom(roomId);
      if (!room) return;
      const timeline = room.getLiveTimeline().getEvents();
      const lastEvent = timeline[timeline.length - 1];
      if (lastEvent) {
        client.sendReadReceipt(lastEvent).catch(() => {
          // Non-critical — silently ignore
        });
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [client, roomId]);
}
