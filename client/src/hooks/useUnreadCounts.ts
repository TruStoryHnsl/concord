import { useEffect, useState, useRef } from "react";
import { RoomEvent, NotificationCountType, ClientEvent } from "matrix-js-sdk";
import { useAuthStore } from "../stores/auth";

/** Event types the unread counter cares about. State events, reactions,
 *  receipts, and other ambient updates don't contribute to unread and
 *  marking them read doesn't decrement anything. We walk back from the
 *  end of the live timeline until we hit a message-shaped event so the
 *  read marker lands on the thing the user actually saw. */
const UNREAD_CONTRIBUTING_TYPES = new Set([
  "m.room.message",
  "m.room.encrypted",
  "m.sticker",
  "m.call.invite",
]);

async function markRoomRead(
  client: ReturnType<typeof useAuthStore.getState>["client"],
  roomId: string,
): Promise<void> {
  if (!client) return;
  const room = client.getRoom(roomId);
  if (!room) return;
  const timeline = room.getLiveTimeline().getEvents();
  // Walk back to the last event that actually contributes to unread.
  // Using the tail of the live timeline unconditionally means the marker
  // often lands on a membership / receipt / redaction event whose id the
  // server doesn't consider part of the room's "unread run" — the
  // badge stays lit until the next message arrives and rescans.
  let target = null;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const ev = timeline[i];
    if (ev && UNREAD_CONTRIBUTING_TYPES.has(ev.getType())) {
      target = ev;
      break;
    }
  }
  // Fall back to the raw tail if no message-shaped event is visible (new
  // or quiet room) — better to send a receipt than nothing.
  const lastEvent = target ?? timeline[timeline.length - 1];
  const lastEventId = lastEvent?.getId?.();
  if (!lastEvent || !lastEventId) return;
  try {
    await client.setRoomReadMarkers(roomId, lastEventId, lastEvent);
  } catch (err) {
    // Surface failures instead of swallowing — when the receipt doesn't
    // land the badge stays lit forever and the user has no signal for
    // why. A console.warn at least shows up in a bug report.
    console.warn("[unread] setRoomReadMarkers failed", { roomId, err });
    throw err;
  }
}

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
    // Account-data updates carry the `m.fully_read` marker — without
    // this listener the badge stays lit until the next Receipt or
    // Timeline event happens to bump the refresh.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.on(ClientEvent.AccountData as any, debouncedUpdate);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      client.removeListener(RoomEvent.Timeline, debouncedUpdate);
      client.removeListener(RoomEvent.Receipt, debouncedUpdate);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.removeListener(ClientEvent.AccountData as any, debouncedUpdate);
    };
  }, [client]);

  return counts;
}

/**
 * Per-room "needs attention" highlight counts. Returns rooms that have
 * any highlight-worthy notification (@mentions, keyword alerts, DMs
 * by push rule) so the server tile can surface a yellow dot when a
 * channel inside it is actually asking for the user's attention, as
 * distinct from the ordinary unread indicator.
 *
 * Parallel implementation to `useUnreadCounts` above; kept as a
 * sibling hook rather than extended in-place so each consumer only
 * re-renders when ITS count map actually changes.
 */
export function useHighlightCounts(): Map<string, number> {
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
          NotificationCountType.Highlight,
        );
        if (count > 0) {
          map.set(room.roomId, count);
        }
      }
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
    // Account-data updates carry the `m.fully_read` marker — without
    // this listener the badge stays lit until the next Receipt or
    // Timeline event happens to bump the refresh.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.on(ClientEvent.AccountData as any, debouncedUpdate);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      client.removeListener(RoomEvent.Timeline, debouncedUpdate);
      client.removeListener(RoomEvent.Receipt, debouncedUpdate);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.removeListener(ClientEvent.AccountData as any, debouncedUpdate);
    };
  }, [client]);

  return counts;
}

/**
 * Send read receipts for the active room.
 *
 * Fires on two triggers:
 *   1. Room switch — debounced 300ms after `roomId` changes, so opening a
 *      channel marks its latest event as read.
 *   2. Live message arrival — debounced 500ms after new timeline events land
 *      in the active room, so a user sitting in a channel doesn't see a
 *      ghost unread badge for a message they were literally looking at.
 *
 * Both triggers gate on visibility: `document.visibilityState === "visible"`
 * plus an optional caller-supplied `isVisible` (e.g. mobile view-switcher
 * state — false when the user is on the channels/settings tab, not chat).
 */
export function useSendReadReceipt(
  roomId: string | null,
  isVisible: boolean = true,
) {
  const client = useAuthStore((s) => s.client);
  const switchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Room-switch read receipt — fires once 300ms after roomId changes.
  useEffect(() => {
    if (switchDebounceRef.current) clearTimeout(switchDebounceRef.current);

    if (!client || !roomId) return;
    if (!isVisible) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

    switchDebounceRef.current = setTimeout(() => {
      markRoomRead(client, roomId).catch(() => {
        // Non-critical — silently ignore
      });
    }, 300);

    return () => {
      if (switchDebounceRef.current) clearTimeout(switchDebounceRef.current);
    };
  }, [client, roomId, isVisible]);

  // Live-message read receipt — listens for Timeline events in the active
  // room and marks them read while the user is looking at the chat.
  useEffect(() => {
    if (!client || !roomId) return;

    const onTimeline = (
      _event: unknown,
      room: { roomId: string } | undefined,
      _toStartOfTimeline: boolean | undefined,
      removed: boolean,
      data: { liveEvent?: boolean } | undefined,
    ) => {
      // Ignore pagination, redactions, and non-live updates.
      if (removed) return;
      if (!data?.liveEvent) return;
      if (!room || room.roomId !== roomId) return;

      // Visibility gate — only mark read if the user is actually looking.
      if (!isVisible) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;

      if (liveDebounceRef.current) clearTimeout(liveDebounceRef.current);
      liveDebounceRef.current = setTimeout(() => {
        markRoomRead(client, roomId).catch(() => {
          // Non-critical — silently ignore
        });
      }, 500);
    };

    // The matrix-js-sdk Timeline event signature is broader than what we
    // need; cast through `any` at the listener boundary to keep the rest
    // of the hook strictly typed.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client.on(RoomEvent.Timeline, onTimeline as any);

    return () => {
      if (liveDebounceRef.current) clearTimeout(liveDebounceRef.current);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client.removeListener(RoomEvent.Timeline, onTimeline as any);
    };
  }, [client, roomId, isVisible]);
}
