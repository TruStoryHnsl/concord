import type { Reaction } from "../../hooks/useMatrix";

const QUICK_EMOJIS = ["👍", "❤️", "😂", "🎉", "👀"];

interface QuickReactBarProps {
  onReact: (emoji: string) => void;
  onClose: () => void;
}

export function QuickReactBar({ onReact, onClose }: QuickReactBarProps) {
  return (
    <div
      className="flex gap-0.5 glass-panel rounded-xl p-1"
      onMouseLeave={onClose}
    >
      {QUICK_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => {
            onReact(emoji);
            onClose();
          }}
          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-container-high transition-colors text-base"
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
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs transition-colors font-label ${
              isMine
                ? "bg-primary/10 text-primary hover:bg-primary/20"
                : "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
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
