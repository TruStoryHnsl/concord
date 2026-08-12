/**
 * Component: **per-peer-inboxes** (OWNED by the per-peer-inboxes branch).
 *
 * Left-rail list of per-peer conversation summaries. Renders the unread
 * badge, the last-message preview, and a relative timestamp. Selecting a row
 * opens that peer's transcript (handled by the parent panel).
 */
import type { ConversationRecord } from "../../../api/social/types";
import { PeerAvatar } from "./PeerAvatar";

/** Short, base58-id-friendly peer label: first 6 + last 4 chars. */
function shortPeerId(peerId: string): string {
  if (peerId.length <= 12) return peerId;
  return `${peerId.slice(0, 6)}…${peerId.slice(-4)}`;
}

/** Compact relative time from an RFC3339 stamp (e.g. "3m", "2h", "Apr 4"). */
function relativeTime(rfc3339: string | null | undefined): string {
  if (!rfc3339) return "";
  const then = new Date(rfc3339).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(then).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

interface Props {
  conversations: ConversationRecord[];
  activePeerId: string | null;
  loading: boolean;
  onSelect: (peerId: string) => void;
}

export function InboxConversationList({
  conversations,
  activePeerId,
  loading,
  onSelect,
}: Props) {
  if (loading && conversations.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-on-surface-variant text-sm font-body">
        Loading conversations…
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 px-4 gap-2">
        <span className="material-symbols-outlined text-3xl text-on-surface-variant/40">
          forum
        </span>
        <p className="text-on-surface-variant text-sm text-center font-body">
          No peer conversations yet
        </p>
        <p className="text-on-surface-variant/60 text-xs text-center font-body">
          Messages from connected peers will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {conversations.map((c) => {
        const isActive = activePeerId === c.peerId;
        return (
          <button
            key={c.peerId}
            onClick={() => onSelect(c.peerId)}
            className={`btn-press w-full flex items-center gap-3 px-3 py-2 rounded-lg transition-all text-left ${
              isActive
                ? "bg-primary/10 text-primary"
                : "text-on-surface hover:bg-surface-container-high"
            }`}
          >
            <PeerAvatar peerId={c.peerId} size="md" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate font-body text-sm font-medium">
                  {shortPeerId(c.peerId)}
                </span>
                <span className="ml-auto text-[10px] text-on-surface-variant/70 font-label shrink-0">
                  {relativeTime(c.lastMessageAt)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="truncate text-xs text-on-surface-variant font-body">
                  {c.lastPreview ?? "No messages"}
                </span>
                {c.unread > 0 && !isActive && (
                  <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-primary text-on-primary text-xs font-bold flex items-center justify-center shrink-0">
                    {c.unread > 99 ? "99+" : c.unread}
                  </span>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
