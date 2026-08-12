import { useEffect, useState } from "react";
import { getRoomDiagnostics, type RoomDiagnostics } from "../../../api/concord";

export interface RoomDiagnosticsState {
  roomDiagnostics: RoomDiagnostics | null;
  roomDiagnosticsLoading: boolean;
  diagnosticsPopupOpen: boolean;
  setDiagnosticsPopupOpen: (open: boolean) => void;
}

/**
 * Fetches room binding / history-access diagnostics for the active room
 * whenever it has no loaded messages — the data backing the small wrench
 * button in the empty-channel placeholder. Extracted verbatim from
 * ChatLayout. The popup open/close state lives here too so the empty
 * state and the popup agree on visibility.
 */
export function useRoomDiagnostics(
  accessToken: string | null,
  activeRoomId: string | null | undefined,
  messagesLength: number,
  userId: string | null,
): RoomDiagnosticsState {
  const [roomDiagnostics, setRoomDiagnostics] = useState<RoomDiagnostics | null>(null);
  const [roomDiagnosticsLoading, setRoomDiagnosticsLoading] = useState(false);
  const [diagnosticsPopupOpen, setDiagnosticsPopupOpen] = useState(false);

  useEffect(() => {
    if (!accessToken || !activeRoomId || messagesLength > 0) {
      setRoomDiagnostics(null);
      setRoomDiagnosticsLoading(false);
      return;
    }

    let cancelled = false;
    setRoomDiagnosticsLoading(true);
    getRoomDiagnostics(activeRoomId, accessToken)
      .then((diag) => {
        if (!cancelled) setRoomDiagnostics(diag);
      })
      .catch((err) => {
        if (!cancelled) {
          setRoomDiagnostics({
            room_id: activeRoomId,
            user_id: userId ?? "",
            binding: { kind: "unknown" },
            inference: "diagnostic_request_failed",
            summary: err instanceof Error ? err.message : "Room diagnostics failed",
            steps: [],
          });
        }
      })
      .finally(() => {
        if (!cancelled) setRoomDiagnosticsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken, activeRoomId, messagesLength, userId]);

  return {
    roomDiagnostics,
    roomDiagnosticsLoading,
    diagnosticsPopupOpen,
    setDiagnosticsPopupOpen,
  };
}
