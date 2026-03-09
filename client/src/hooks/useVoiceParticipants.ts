import { useEffect, useState, useRef } from "react";
import { useAuthStore } from "../stores/auth";
import { getVoiceParticipants } from "../api/concorrd";
import type { VoiceRoomParticipant } from "../api/concorrd";

const POLL_INTERVAL = 10_000; // 10 seconds

export function useVoiceParticipants(
  voiceRoomIds: string[],
): Map<string, VoiceRoomParticipant[]> {
  const accessToken = useAuthStore((s) => s.accessToken);
  const [participants, setParticipants] = useState<
    Map<string, VoiceRoomParticipant[]>
  >(new Map());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!accessToken || voiceRoomIds.length === 0) {
      setParticipants(new Map());
      return;
    }

    const poll = async () => {
      try {
        const data = await getVoiceParticipants(voiceRoomIds, accessToken);
        const map = new Map<string, VoiceRoomParticipant[]>();
        for (const [roomId, list] of Object.entries(data)) {
          if (list.length > 0) {
            map.set(roomId, list);
          }
        }
        setParticipants(map);
      } catch {
        // Non-critical — keep stale data
      }
    };

    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [accessToken, voiceRoomIds.join(",")]);

  return participants;
}
