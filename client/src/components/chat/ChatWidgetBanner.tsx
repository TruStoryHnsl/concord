import type { ChatMessage } from "../../hooks/useMatrix";
import { getPollVoteSummary, validateChatWidget } from "./chatWidgets";

function badgeClasses(tone: "info" | "success" | "warning" | "error"): string {
  switch (tone) {
    case "success":
      return "bg-emerald-500/15 text-emerald-200 border-emerald-400/25";
    case "warning":
      return "bg-amber-500/15 text-amber-100 border-amber-400/25";
    case "error":
      return "bg-rose-500/15 text-rose-100 border-rose-400/25";
    default:
      return "bg-primary/15 text-primary border-primary/20";
  }
}

export function ChatWidgetBanner({
  message,
  currentUserId,
  onReact,
  onRemoveReaction,
  compact = false,
}: {
  message: ChatMessage;
  currentUserId: string | null;
  onReact: (eventId: string, emoji: string) => Promise<void>;
  onRemoveReaction: (reactionEventId: string) => Promise<void>;
  compact?: boolean;
}) {
  const result = validateChatWidget(message.widgetRaw);
  if (!result.ok) {
    return (
      <div className="mb-2 rounded-xl border border-error/20 bg-error/10 px-3 py-2 text-xs text-error">
        Invalid widget payload: {result.error}
      </div>
    );
  }

  const widget = result.value;
  if (widget.kind === "poll") {
    const votes = getPollVoteSummary(message.reactions, widget.options, currentUserId);
    return (
      <div className={`mb-2 rounded-2xl border border-primary/20 bg-primary/8 ${compact ? "px-3 py-2" : "px-4 py-3"}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-primary font-label">Pinned Poll</p>
            <p className={`font-headline font-semibold text-on-surface ${compact ? "text-sm" : "text-base"}`}>
              {widget.question}
            </p>
          </div>
          <span className="material-symbols-outlined text-primary">poll</span>
        </div>
        <div className="mt-3 space-y-2">
          {votes.map((vote) => (
            <button
              key={vote.emoji}
              type="button"
              onClick={() => {
                if (vote.selected && vote.reactionEventId) {
                  void onRemoveReaction(vote.reactionEventId);
                  return;
                }
                void Promise.all(
                  votes
                    .filter((entry) => entry.selected && entry.reactionEventId)
                    .map((entry) => onRemoveReaction(entry.reactionEventId!)),
                ).then(() => onReact(message.id, vote.emoji));
              }}
              className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors ${
                vote.selected
                  ? "border-primary/40 bg-primary/12 text-on-surface"
                  : "border-outline-variant/15 bg-surface/50 text-on-surface-variant hover:bg-surface-container-high"
              }`}
            >
              <span className="text-lg">{vote.emoji}</span>
              <span className="flex-1 text-sm">{vote.option}</span>
              <span className="text-xs font-label">{vote.count}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (widget.kind === "checklist") {
    return (
      <div className={`mb-2 rounded-2xl border border-secondary/20 bg-secondary/8 ${compact ? "px-3 py-2" : "px-4 py-3"}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-secondary font-label">Pinned Checklist</p>
            <p className={`font-headline font-semibold text-on-surface ${compact ? "text-sm" : "text-base"}`}>
              {widget.title}
            </p>
          </div>
          <span className="material-symbols-outlined text-secondary">checklist</span>
        </div>
        <div className="mt-3 space-y-1.5">
          {widget.items.map((item) => (
            <div key={item} className="flex items-start gap-2 text-sm text-on-surface-variant">
              <span className="material-symbols-outlined text-base text-secondary mt-0.5">radio_button_unchecked</span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`mb-2 rounded-2xl border ${badgeClasses(widget.tone)} ${compact ? "px-3 py-2" : "px-4 py-3"}`}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider font-label">Pinned Status</p>
          <p className={`font-headline font-semibold text-on-surface ${compact ? "text-sm" : "text-base"}`}>
            {widget.title}
          </p>
        </div>
        <span className="material-symbols-outlined">campaign</span>
      </div>
      <p className={`mt-2 text-on-surface-variant ${compact ? "text-xs" : "text-sm"}`}>
        {widget.summary}
      </p>
    </div>
  );
}

