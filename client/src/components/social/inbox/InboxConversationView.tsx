/**
 * Component: **per-peer-inboxes** (OWNED by the per-peer-inboxes branch).
 *
 * The open 1:1 conversation: a scrollable transcript (outbound right /
 * inbound left, chat-bubble layout) plus a composer. Pure presentational —
 * all state + the send action come from the parent via props.
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

interface Props {
  peerId: string;
  messages: InboxMessage[];
  loading: boolean;
  onSend: (body: string) => void;
}

export function InboxConversationView({ peerId, messages, loading, onSend }: Props) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pin the scroll to the newest message whenever the transcript changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
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
            return (
              <div
                key={m.id}
                className={`flex ${outbound ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 ${
                    outbound
                      ? "bg-primary text-on-primary rounded-br-sm"
                      : "bg-surface-container-high text-on-surface rounded-bl-sm"
                  }`}
                >
                  <div className="font-body text-sm whitespace-pre-wrap break-words">
                    {m.body}
                  </div>
                  <div
                    className={`text-[10px] mt-0.5 font-label ${
                      outbound ? "text-on-primary/70" : "text-on-surface-variant/70"
                    }`}
                  >
                    {clockTime(m.sentAt)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2 px-3 py-3 border-t border-outline-variant/10 shrink-0">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Message peer…"
          className="flex-1 resize-none max-h-32 bg-surface-container-high text-on-surface rounded-xl px-3 py-2 text-sm font-body placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="btn-press w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          title="Send"
        >
          <span className="material-symbols-outlined text-lg">send</span>
        </button>
      </div>
    </div>
  );
}
