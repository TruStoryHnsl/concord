import type { Reaction } from "../../hooks/useMatrix";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "👀"];

interface QuickReactBarProps {
  onReact: (emoji: string) => void;
  onClose: () => void;
}

export function QuickReactBar({ onReact, onClose }: QuickReactBarProps) {
  return (
    <div
      className="flex gap-0.5 bg-zinc-800 border border-zinc-600 rounded-lg p-1 shadow-lg"
      onMouseLeave={onClose}
    >
      {QUICK_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => {
            onReact(emoji);
            onClose();
          }}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-zinc-700 transition-colors text-base"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

interface ReactionPillsProps {
  reactions: Reaction[];
  currentUserId: string | null;
  onReact: (emoji: string) => void;
  onRemoveReaction: (reactionEventId: string) => void;
}

export function ReactionPills({
  reactions,
  currentUserId,
  onReact,
  onRemoveReaction,
}: ReactionPillsProps) {
  if (reactions.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {reactions.map((r) => {
        const myReactionEventId =
          currentUserId ? r.eventIds[currentUserId] : undefined;
        const isMine = !!myReactionEventId;

        return (
          <button
            key={r.emoji}
            onClick={() => {
              if (isMine) {
                onRemoveReaction(myReactionEventId!);
              } else {
                onReact(r.emoji);
              }
            }}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-colors ${
              isMine
                ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20"
                : "border-zinc-700 bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            <span>{r.emoji}</span>
            <span>{r.count}</span>
          </button>
        );
      })}
    </div>
  );
}
