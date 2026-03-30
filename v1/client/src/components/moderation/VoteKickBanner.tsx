import { useAuthStore } from "../../stores/auth";
import { castVoteKick, executeVoteKick } from "../../api/concord";
import { useToastStore } from "../../stores/toast";

interface VoteKickBannerProps {
  voteId: number;
  targetUserId: string;
  initiatedBy: string;
  yesCount: number;
  totalEligible: number;
  onVoted: () => void;
  onKickExecuted?: (result: { kick_count: number; kick_limit?: number; ban_mode?: string; show_harsh_message?: boolean }) => void;
}

export function VoteKickBanner({
  voteId,
  targetUserId,
  initiatedBy,
  yesCount,
  totalEligible,
  onVoted,
  onKickExecuted,
}: VoteKickBannerProps) {
  const accessToken = useAuthStore((s) => s.accessToken);
  const userId = useAuthStore((s) => s.userId);
  const addToast = useToastStore((s) => s.addToast);

  // Don't show to the target user
  if (userId === targetUserId) return null;

  const targetName = targetUserId.split(":")[0].replace("@", "");
  const initiatorName = initiatedBy.split(":")[0].replace("@", "");

  const handleVote = async (vote: boolean) => {
    if (!accessToken) return;
    try {
      const result = await castVoteKick(voteId, vote, accessToken);
      onVoted();

      // Auto-execute if vote passed
      if (result.status === "passed") {
        try {
          const execResult = await executeVoteKick(voteId, accessToken);
          if (execResult.status !== "already_executed") {
            addToast(`${targetName} has been kicked`);
            onKickExecuted?.(execResult);
          }
        } catch {
          // Another client may have already executed it
        }
      }
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Vote failed");
    }
  };

  return (
    <div className="bg-amber-950/40 border border-amber-800/50 rounded-lg px-4 py-3 mx-4 my-2 animate-[fadeSlideUp_0.3s_ease-out]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-amber-200">
            <strong>{initiatorName}</strong> wants to kick <strong>{targetName}</strong>
          </p>
          <p className="text-xs text-amber-400/70 mt-0.5">
            {yesCount}/{totalEligible} votes needed (all must agree)
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => handleVote(true)}
            className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-xs rounded transition-colors"
          >
            Kick
          </button>
          <button
            onClick={() => handleVote(false)}
            className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded transition-colors"
          >
            No
          </button>
        </div>
      </div>
    </div>
  );
}
