import { memo, useEffect, useRef, useCallback, useState } from "react";
import type { ChatMessage } from "../../hooks/useMatrix";
import { Avatar } from "../ui/Avatar";
import { MessageContent } from "./MessageContent";
import { ReactionPills, QuickReactBar } from "./ReactionBar";
import { useDisplayName } from "../../hooks/useDisplayName";

interface MessageListProps {
  messages: ChatMessage[];
  isPaginating: boolean;
  hasMore: boolean;
  onLoadMore: () => Promise<void>;
  currentUserId: string | null;
  isServerOwner: boolean;
  onDelete: (eventId: string) => Promise<void>;
  onStartEdit: (message: ChatMessage) => void;
  onReact: (eventId: string, emoji: string) => Promise<void>;
  onRemoveReaction: (reactionEventId: string) => Promise<void>;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDate(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (msgDate.getTime() === today.getTime()) return "Today";
  if (msgDate.getTime() === yesterday.getTime()) return "Yesterday";
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

function SenderName({ userId }: { userId: string }) {
  const name = useDisplayName(userId);
  return <>{name}</>;
}

function isSameDay(ts1: number, ts2: number): boolean {
  const d1 = new Date(ts1);
  const d2 = new Date(ts2);
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

export const MessageList = memo(function MessageList({
  messages,
  isPaginating,
  hasMore,
  onLoadMore,
  currentUserId,
  isServerOwner,
  onDelete,
  onStartEdit,
  onReact,
  onRemoveReaction,
}: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const prevScrollHeightRef = useRef(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [reactingId, setReactingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Track whether user is at/near bottom
  const bottomObserverCallback = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      isAtBottomRef.current = entries[0]?.isIntersecting ?? false;
    },
    [],
  );

  useEffect(() => {
    const el = bottomRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(bottomObserverCallback, {
      threshold: 0,
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [bottomObserverCallback]);

  // Single scroll effect: pagination-restore takes priority, then auto-scroll-to-bottom
  useEffect(() => {
    const container = containerRef.current;
    if (prevScrollHeightRef.current !== 0 && container) {
      const diff = container.scrollHeight - prevScrollHeightRef.current;
      if (diff > 0) container.scrollTop += diff;
      prevScrollHeightRef.current = 0;
    } else if (isAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  // Top sentinel — triggers scrollback pagination
  useEffect(() => {
    const el = topRef.current;
    const container = containerRef.current;
    if (!el || !container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasMore && !isPaginating) {
          prevScrollHeightRef.current = container.scrollHeight;
          onLoadMore();
        }
      },
      { root: container, threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, isPaginating, onLoadMore]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-zinc-500">
        No messages yet. Say something!
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto p-4 space-y-1">
      {/* Top sentinel for scrollback */}
      <div ref={topRef} className="h-1" />
      {isPaginating && (
        <div className="flex justify-center py-2">
          <span className="inline-block w-4 h-4 border-2 border-zinc-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {messages.map((msg, i) => {
        const prevMsg = messages[i - 1];
        const showHeader =
          !prevMsg ||
          prevMsg.sender !== msg.sender ||
          msg.timestamp - prevMsg.timestamp > 5 * 60 * 1000;

        const showDateSeparator =
          !prevMsg || !isSameDay(prevMsg.timestamp, msg.timestamp);

        const isHovered = hoveredId === msg.id;
        const isReacting = reactingId === msg.id;
        const canEdit =
          msg.sender === currentUserId && !msg.redacted && msg.msgtype === "m.text";
        const canDelete =
          !msg.redacted &&
          (msg.sender === currentUserId || isServerOwner);
        const showActions = (isHovered || isReacting) && !msg.redacted;

        return (
          <div
            key={msg.id}
            className="group relative"
            onMouseEnter={() => setHoveredId(msg.id)}
            onMouseLeave={() => {
              setHoveredId(null);
              if (confirmDeleteId === msg.id) setConfirmDeleteId(null);
            }}
          >
            {showDateSeparator && (
              <div className="flex items-center gap-3 py-2 mt-2">
                <div className="flex-1 h-px bg-zinc-700" />
                <span className="text-xs text-zinc-500 font-medium">
                  {formatDate(msg.timestamp)}
                </span>
                <div className="flex-1 h-px bg-zinc-700" />
              </div>
            )}

            {/* Hover action bar */}
            {showActions && (
              <div className="absolute -top-3 right-2 z-10 flex gap-0.5 bg-zinc-800 border border-zinc-600 rounded p-0.5 shadow-lg">
                {/* React button */}
                <button
                  onClick={() =>
                    setReactingId(reactingId === msg.id ? null : msg.id)
                  }
                  className="w-7 h-7 flex items-center justify-center rounded hover:bg-zinc-700 text-zinc-400 hover:text-white text-sm"
                  title="React"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.536-4.464a.75.75 0 10-1.06-1.06 3.5 3.5 0 01-4.95 0 .75.75 0 00-1.06 1.06 5 5 0 007.07 0zM9 8.5c0 .828-.448 1.5-1 1.5s-1-.672-1-1.5S7.448 7 8 7s1 .672 1 1.5zm3 1.5c.552 0 1-.672 1-1.5S12.552 7 12 7s-1 .672-1 1.5.448 1.5 1 1.5z" clipRule="evenodd" />
                  </svg>
                </button>

                {/* Edit button (own text messages only) */}
                {canEdit && (
                  <button
                    onClick={() => onStartEdit(msg)}
                    className="w-7 h-7 flex items-center justify-center rounded hover:bg-zinc-700 text-zinc-400 hover:text-white text-sm"
                    title="Edit"
                  >
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                      <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
                    </svg>
                  </button>
                )}

                {/* Delete button */}
                {canDelete && (
                  confirmDeleteId === msg.id ? (
                    <button
                      onClick={() => {
                        onDelete(msg.id);
                        setConfirmDeleteId(null);
                      }}
                      className="w-7 h-7 flex items-center justify-center rounded bg-red-600/20 text-red-400 animate-pulse text-xs font-bold"
                      title="Click to confirm"
                    >
                      ?
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(msg.id)}
                      className="w-7 h-7 flex items-center justify-center rounded hover:bg-zinc-700 text-zinc-400 hover:text-red-400 text-sm"
                      title="Delete"
                    >
                      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                        <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022 1.005 11.07A2.75 2.75 0 007.769 19.5h4.462a2.75 2.75 0 002.75-2.479l1.005-11.07.149.022a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
                      </svg>
                    </button>
                  )
                )}
              </div>
            )}

            {/* Quick react popover */}
            {isReacting && (
              <div className="absolute -top-10 right-2 z-20">
                <QuickReactBar
                  onReact={(emoji) => {
                    onReact(msg.id, emoji);
                    setReactingId(null);
                  }}
                  onClose={() => setReactingId(null)}
                />
              </div>
            )}

            <div className={showHeader && !showDateSeparator ? "pt-3" : ""}>
              {showHeader ? (
                <div className="flex gap-2">
                  <Avatar userId={msg.sender} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-semibold text-indigo-400">
                        <SenderName userId={msg.sender} />
                      </span>
                      <span className="text-xs text-zinc-500">
                        {formatTime(msg.timestamp)}
                      </span>
                      {msg.edited && (
                        <span className="text-xs text-zinc-600">(edited)</span>
                      )}
                    </div>
                    <MessageContent message={msg} />
                    <ReactionPills
                      reactions={msg.reactions}
                      currentUserId={currentUserId}
                      onReact={(emoji) => onReact(msg.id, emoji)}
                      onRemoveReaction={onRemoveReaction}
                    />
                  </div>
                </div>
              ) : (
                <div className="pl-10">
                  <MessageContent message={msg} />
                  {msg.edited && (
                    <span className="text-xs text-zinc-600 ml-1">(edited)</span>
                  )}
                  <ReactionPills
                    reactions={msg.reactions}
                    currentUserId={currentUserId}
                    onReact={(emoji) => onReact(msg.id, emoji)}
                    onRemoveReaction={onRemoveReaction}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
});
