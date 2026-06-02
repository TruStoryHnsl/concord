import { useEffect } from "react";
import { RoomEvent } from "matrix-js-sdk";
import type { MatrixEvent, Room } from "matrix-js-sdk";
import { useAuthStore } from "../stores/auth";
import { useSettingsStore } from "../stores/settings";
import { useServerStore } from "../stores/server";

function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain).connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1320, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
    // Close the AudioContext after the sound finishes — each unclosed
    // AudioContext leaks ~1-4 MB of native audio resources.
    setTimeout(() => ctx.close(), 500);
  } catch {
    // AudioContext may not be available
  }
}

export function useNotifications() {
  const client = useAuthStore((s) => s.client);
  const userId = useAuthStore((s) => s.userId);
  const enabled = useSettingsStore((s) => s.notificationsEnabled);

  useEffect(() => {
    if (!client || !enabled) return;

    // Don't request permission here — the settings tab has a dedicated button.
    // We only fire notifications if permission is already granted.

    const onTimeline = (event: MatrixEvent, room: Room | undefined) => {
      // Only notify when tab is not focused
      if (!document.hidden) return;

      // Only for actual messages
      if (event.getType() !== "m.room.message") return;

      // Don't notify for own messages
      const sender = event.getSender();
      if (sender === userId) return;

      // Check permission
      if (Notification.permission !== "granted") return;

      const roomId = room?.roomId;
      if (!roomId) return;

      // Resolve notification level via cascade: channel → server → default
      const settings = useSettingsStore.getState();
      const servers = useServerStore.getState().servers;

      // Find which server this room belongs to
      let serverId: string | null = null;
      for (const s of servers) {
        if (s.channels.some((c) => c.matrix_room_id === roomId)) {
          serverId = s.id;
          break;
        }
      }

      // Determine effective level
      let level: "all" | "mentions" | "nothing" = settings.defaultNotificationLevel;
      if (serverId && settings.serverNotifications[serverId]) {
        level = settings.serverNotifications[serverId];
      }
      if (settings.channelNotifications[roomId]) {
        level = settings.channelNotifications[roomId];
      }

      // Apply level
      if (level === "nothing") return;

      if (level === "mentions") {
        const body = (event.getContent().body as string) || "";
        const localpart = userId?.split(":")[0] ?? "";
        // Check for @userId or @localpart mention
        if (!body.includes(userId ?? "") && !body.includes(localpart)) {
          return;
        }
      }

      // Fire notification
      const senderName =
        sender?.split(":")[0].replace("@", "") ?? "Someone";
      const body = (event.getContent().body as string) || "";
      const roomName = room?.name || "a channel";

      const notification = new Notification(`${senderName} in #${roomName}`, {
        body,
        tag: roomId, // Coalesce per channel
        silent: true, // We handle sound ourselves
      });

      notification.onclick = () => {
        window.focus();
        notification.close();
      };

      // Play sound if enabled
      if (settings.notificationSound) {
        playNotificationSound();
      }
    };

    client.on(RoomEvent.Timeline, onTimeline);

    return () => {
      client.removeListener(RoomEvent.Timeline, onTimeline);
    };
  }, [client, userId, enabled]);
}
