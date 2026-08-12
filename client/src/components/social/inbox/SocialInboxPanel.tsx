/**
 * Component home: **per-peer-inboxes** (OWNED by the per-peer-inboxes branch).
 *
 * Per-peer 1:1 inbox surface: a conversation list rail on the left and the
 * open conversation (transcript + composer) on the right. Drives the
 * `social_inbox_*` Tauri commands through {@link usePeerInbox}. The
 * per-peer-inboxes branch owns everything under
 * `client/src/components/social/inbox/`.
 */
import { useEffect } from "react";
import { InboxConversationList } from "./InboxConversationList";
import { InboxConversationView } from "./InboxConversationView";
import { usePeerInbox } from "./usePeerInbox";

export interface SocialInboxPanelProps {
  /**
   * Wave-2 routing seam: a peer id to open on mount (and whenever it
   * changes). The messenger shell passes the peer chosen on the Peers
   * directory; Wave 2 reuses it to deep-link Chats-feed peer rows into
   * their 1:1 conversation. `null`/undefined → open with no selection.
   */
  initialPeerId?: string | null;
}

export function SocialInboxPanel({ initialPeerId }: SocialInboxPanelProps = {}) {
  const {
    conversations,
    activePeerId,
    messages,
    loadingList,
    loadingMessages,
    error,
    peerTyping,
    openConversation,
    send,
    sendReply,
    editMessage,
    deleteMessage,
    toggleReaction,
    notifyComposerActivity,
    notifyComposerIdle,
    refresh,
  } = usePeerInbox();

  // Deep-link seam: open the requested peer's conversation. openConversation
  // is stable (useCallback in usePeerInbox), so this fires only when the
  // requested peer actually changes.
  useEffect(() => {
    if (initialPeerId) openConversation(initialPeerId);
  }, [initialPeerId, openConversation]);

  return (
    <div className="flex h-full min-h-0 bg-surface-container-low">
      {/* Conversation rail */}
      <div className="w-72 shrink-0 flex flex-col min-h-0 border-r border-outline-variant/10">
        <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/10 shrink-0">
          <h3 className="text-xs font-label font-medium text-on-surface-variant uppercase tracking-widest">
            Peer Inboxes
          </h3>
          <button
            onClick={() => void refresh()}
            className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
            title="Refresh"
          >
            <span className="material-symbols-outlined text-lg">refresh</span>
          </button>
        </div>

        {error && (
          <div className="px-4 py-2 text-xs text-rose-400 font-body border-b border-outline-variant/10">
            {error}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          <InboxConversationList
            conversations={conversations}
            activePeerId={activePeerId}
            loading={loadingList}
            onSelect={openConversation}
          />
        </div>
      </div>

      {/* Open conversation */}
      <div className="flex-1 min-w-0 min-h-0">
        {activePeerId ? (
          <InboxConversationView
            peerId={activePeerId}
            messages={messages}
            loading={loadingMessages}
            onSend={send}
            onSendReply={sendReply}
            onEdit={editMessage}
            onDelete={deleteMessage}
            onToggleReaction={toggleReaction}
            peerTyping={peerTyping}
            onComposerActivity={notifyComposerActivity}
            onComposerIdle={notifyComposerIdle}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-on-surface-variant">
            <span className="material-symbols-outlined text-4xl opacity-40">
              chat
            </span>
            <p className="font-body text-sm">
              Select a peer to open the conversation.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
