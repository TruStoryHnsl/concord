import { useEffect } from "react";
import { useAuthStore } from "../stores/auth";
import { useDirectInviteStore } from "../stores/directInvites";

export function DirectInviteBanner() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const { pendingInvites, loadPending, respond } = useDirectInviteStore();

  // Poll for pending invites on mount and every 30 seconds
  useEffect(() => {
    if (!accessToken) return;
    loadPending(accessToken);
    const interval = setInterval(() => loadPending(accessToken), 30000);
    return () => clearInterval(interval);
  }, [accessToken, loadPending]);

  if (pendingInvites.length === 0) return null;

  return (
    <div className="fixed bottom-16 left-4 z-40 flex flex-col gap-2 max-w-sm">
      {pendingInvites.map((invite) => {
        const inviterName = invite.inviter_id
          .split(":")[0]
          .replace("@", "");
        return (
          <div
            key={invite.id}
            className="bg-zinc-800 border border-zinc-600 rounded-lg p-3 shadow-lg animate-in slide-in-from-left"
          >
            <p className="text-sm text-zinc-200 mb-2">
              <span className="text-indigo-400 font-medium">{inviterName}</span>
              {" invited you to "}
              <span className="text-white font-medium">
                {invite.server_name}
              </span>
            </p>
            <div className="flex gap-2">
              <button
                onClick={() =>
                  accessToken && respond(invite.id, "accept", accessToken)
                }
                className="flex-1 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded transition-colors"
              >
                Accept
              </button>
              <button
                onClick={() =>
                  accessToken && respond(invite.id, "decline", accessToken)
                }
                className="flex-1 py-1.5 text-xs font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded transition-colors"
              >
                Decline
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
