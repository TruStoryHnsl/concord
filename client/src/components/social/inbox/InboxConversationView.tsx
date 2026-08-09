/**
 * Component: **per-peer-inboxes** (OWNED by the per-peer-inboxes branch).
 *
 * The open 1:1 conversation: a scrollable transcript (outbound right /
 * inbound left, chat-bubble layout) plus a composer. Pure presentational —
 * all state + the actions come from the parent via props.
 *
 * Social inbox 1.2 surfaces: deleted tombstones, "(edited)" markers, reply
 * quotes, emoji reaction chips (tap to toggle), a message action row
 * (reply / edit / delete on hover), and the peer's typing indicator.
 */
import { useEffect, useRef, useState } from "react";
import type { InboxMessage } from "../../../api/social/types";
import { PeerAvatar } from "./PeerAvatar";

/** Wall-clock time for a bubble (e.g. "14:03"). */
function clockTime(rfc3339: string): string {
  const t = new Date(rfc3339).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The quick-reaction palette offered on every message. */
const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢"] as const;

interface Props {
  peerId: string;
  messages: InboxMessage[];
  loading: boolean;
  onSend: (body: string) => void;
  /** 1.2 — reply to an earlier message. Absent = affordance hidden. */
  onSendReply?: (body: string, targetLocalId: string) => void;
  /** 1.2 — edit one of OUR messages. Absent = affordance hidden. */
  onEdit?: (messageId: string, newBody: string) => void;
  /** 1.2 — delete one of OUR messages. Absent = affordance hidden. */
  onDelete?: (messageId: string) => void;
  /** 1.2 — toggle our emoji reaction. Absent = chips render read-only. */
  onToggleReaction?: (messageId: string, emoji: string) => void;
  /** Typing — the peer is composing right now. */
  peerTyping?: boolean;
  /** Typing — composer keystroke (debounced upstream). */
  onComposerActivity?: () => void;
  /** Typing — composer emptied/blurred. */
  onComposerIdle?: () => void;
}

export function InboxConversationView({
  peerId,
  messages,
  loading,
  onSend,
  onSendReply,
  onEdit,
  onDelete,
  onToggleReaction,
  peerTyping = false,
  onComposerActivity,
  onComposerIdle,
}: Props) {
  const [draft, setDraft] = useState("");
  /** Message being replied to, or null. */
  const [replyTarget, setReplyTarget] = useState<InboxMessage | null>(null);
  /** Message id being edited (composer becomes the editor), or null. */
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Message id whose reaction palette is open, or null. */
  const [paletteFor, setPaletteFor] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pin the scroll to the newest message whenever the transcript changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, peerTyping]);

  // A conversation switch resets composer context.
  useEffect(() => {
    setDraft("");
    setReplyTarget(null);
    setEditingId(null);
    setPaletteFor(null);
  }, [peerId]);

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    if (editingId && onEdit) {
      onEdit(editingId, body);
      setEditingId(null);
    } else if (replyTarget && onSendReply) {
      onSendReply(body, replyTarget.id);
      setReplyTarget(null);
    } else {
      onSend(body);
    }
    setDraft("");
    onComposerIdle?.();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      setReplyTarget(null);
      if (editingId) {
        setEditingId(null);
        setDraft("");
      }
    }
  };

  const startEdit = (m: InboxMessage) => {
    setReplyTarget(null);
    setEditingId(m.id);
    setDraft(m.body);
  };

  const startReply = (m: InboxMessage) => {
    setEditingId(null);
    setReplyTarget(m);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-outline-variant/10 shrink-0">
        <PeerAvatar peerId={peerId} size="md" />
        <div className="min-w-0">
          <div className="font-body text-sm font-medium text-on-surface truncate">
            {peerId}
          </div>
          <div className="text-[10px] text-on-surface-variant/70 font-label">
            peer-to-peer · end-to-end encrypted in transit
          </div>
        </div>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-on-surface-variant text-sm font-body">
            Loading messages…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-on-surface-variant">
            <span className="material-symbols-outlined text-3xl opacity-40">
              waving_hand
            </span>
            <p className="text-sm font-body">No messages yet — say hello.</p>
          </div>
        ) : (
          messages.map((m) => {
            const outbound = m.direction === "outbound";
            const deleted = m.deleted === true;
            const reactions = m.reactions ?? [];
            return (
              <div
                key={m.id}
                className={`group flex flex-col ${outbound ? "items-end" : "items-start"}`}
              >
                <div className={`flex items-center gap-1 ${outbound ? "flex-row-reverse" : ""}`}>
                  <div
                    className={`max-w-[75%] rounded-2xl px-3 py-2 ${
                      outbound
                        ? "bg-primary text-on-primary rounded-br-sm"
                        : "bg-surface-container-high text-on-surface rounded-bl-sm"
                    }`}
                  >
                    {/* Reply quote — resolved snippet, or an honest gap. */}
                    {m.isReply && !deleted && (
                      <div
                        className={`mb-1 pl-2 border-l-2 text-xs italic truncate max-w-full ${
                          outbound
                            ? "border-on-primary/40 text-on-primary/70"
                            : "border-outline-variant/40 text-on-surface-variant/80"
                        }`}
                      >
                        {m.replySnippet ?? "Original message unavailable"}
                      </div>
                    )}
                    {deleted ? (
                      <div className="font-body text-sm italic opacity-60">
                        Message deleted
                      </div>
                    ) : (
                      <div className="font-body text-sm whitespace-pre-wrap break-words">
                        {m.body}
                      </div>
                    )}
                    <div
                      className={`text-[10px] mt-0.5 font-label ${
                        outbound ? "text-on-primary/70" : "text-on-surface-variant/70"
                      }`}
                    >
                      {clockTime(m.sentAt)}
                      {m.edited && !deleted && <span className="ml-1">(edited)</span>}
                    </div>
                  </div>

                  {/* Hover action row — react / reply / (own, undeleted) edit+delete */}
                  {!deleted && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      {onToggleReaction && (
                        <button
                          onClick={() =>
                            setPaletteFor(paletteFor === m.id ? null : m.id)
                          }
                          className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high"
                          title="React"
                        >
                          <span className="material-symbols-outlined text-base">
                            add_reaction
                          </span>
                        </button>
                      )}
                      {onSendReply && (
                        <button
                          onClick={() => startReply(m)}
                          className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high"
                          title="Reply"
                        >
                          <span className="material-symbols-outlined text-base">
                            reply
                          </span>
                        </button>
                      )}
                      {outbound && onEdit && (
                        <button
                          onClick={() => startEdit(m)}
                          className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high"
                          title="Edit"
                        >
                          <span className="material-symbols-outlined text-base">
                            edit
                          </span>
                        </button>
                      )}
                      {outbound && onDelete && (
                        <button
                          onClick={() => onDelete(m.id)}
                          className="w-7 h-7 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high hover:text-error"
                          title="Delete"
                        >
                          <span className="material-symbols-outlined text-base">
                            delete
                          </span>
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Quick-reaction palette */}
                {paletteFor === m.id && onToggleReaction && !deleted && (
                  <div
                    className={`flex gap-1 mt-1 px-2 py-1 rounded-full bg-surface-container-high shadow ${
                      outbound ? "mr-1" : "ml-1"
                    }`}
                  >
                    {QUICK_REACTIONS.map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => {
                          onToggleReaction(m.id, emoji);
                          setPaletteFor(null);
                        }}
                        className="text-base hover:scale-125 transition-transform"
                        title={`React ${emoji}`}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}

                {/* Reaction chips — tap toggles OUR reaction */}
                {reactions.length > 0 && !deleted && (
                  <div className={`flex flex-wrap gap-1 mt-1 ${outbound ? "mr-1" : "ml-1"}`}>
                    {reactions.map((r) => (
                      <button
                        key={r.emoji}
                        onClick={() => onToggleReaction?.(m.id, r.emoji)}
                        disabled={!onToggleReaction}
                        className={`px-1.5 py-0.5 rounded-full text-xs font-label flex items-center gap-1 border transition-colors ${
                          r.mine
                            ? "bg-primary/15 border-primary/40 text-on-surface"
                            : "bg-surface-container-high border-outline-variant/20 text-on-surface-variant"
                        }`}
                        title={r.mine ? "Tap to remove your reaction" : "Tap to react too"}
                      >
                        <span>{r.emoji}</span>
                        <span>{r.count}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}

        {/* Typing indicator — ephemeral, engine-TTL-guarded upstream */}
        {peerTyping && (
          <div className="flex justify-start" data-testid="peer-typing-indicator">
            <div className="bg-surface-container-high text-on-surface-variant rounded-2xl rounded-bl-sm px-3 py-2 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
        )}
      </div>

      {/* Reply / edit context banner */}
      {(replyTarget || editingId) && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-t border-outline-variant/10 bg-surface-container-low shrink-0">
          <span className="material-symbols-outlined text-sm text-on-surface-variant">
            {editingId ? "edit" : "reply"}
          </span>
          <div className="flex-1 min-w-0 text-xs font-body text-on-surface-variant truncate">
            {editingId
              ? "Editing message"
              : `Replying to: ${replyTarget?.deleted ? "(deleted message)" : replyTarget?.body}`}
          </div>
          <button
            onClick={() => {
              setReplyTarget(null);
              if (editingId) {
                setEditingId(null);
                setDraft("");
              }
            }}
            className="w-6 h-6 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-container-high"
            title="Cancel"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      )}

      {/* Composer */}
      <div className="flex items-end gap-2 px-3 py-3 border-t border-outline-variant/10 shrink-0">
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            if (e.target.value.trim()) onComposerActivity?.();
            else onComposerIdle?.();
          }}
          onBlur={() => onComposerIdle?.()}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={
            editingId ? "Edit message…" : replyTarget ? "Reply…" : "Message peer…"
          }
          className="flex-1 resize-none max-h-32 bg-surface-container-high text-on-surface rounded-xl px-3 py-2 text-sm font-body placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="btn-press w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          title={editingId ? "Save edit" : "Send"}
        >
          <span className="material-symbols-outlined text-lg">
            {editingId ? "check" : "send"}
          </span>
        </button>
      </div>
    </div>
  );
}
