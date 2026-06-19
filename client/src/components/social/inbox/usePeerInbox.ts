/**
 * Hook: **per-peer-inboxes** (OWNED by the per-peer-inboxes branch).
 *
 * Owns the renderer-side state for the per-peer 1:1 inbox: the conversation
 * summary list, the currently-open peer's message transcript, and the
 * mutating actions (send / mark-read / refresh). Wraps the `social_inbox_*`
 * Tauri commands via `../../../api/social/inbox`. Self-contained — does NOT
 * reach into the Matrix DM stores so the p2p inbox stands on its own.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  socialInboxGetMessages,
  socialInboxList,
  socialInboxMarkRead,
  socialInboxSend,
} from "../../../api/social/inbox";
import type { ConversationRecord, InboxMessage } from "../../../api/social/types";

export interface PeerInboxState {
  /** Conversation summaries, newest-activity-first (as the backend sorts). */
  conversations: ConversationRecord[];
  /** Peer id of the open conversation, or null when none is selected. */
  activePeerId: string | null;
  /** Messages of the open conversation, oldest-first. */
  messages: InboxMessage[];
  /** True while the conversation list is (re)loading. */
  loadingList: boolean;
  /** True while the open conversation's transcript is (re)loading. */
  loadingMessages: boolean;
  /** Last error surfaced by any command, or null. */
  error: string | null;
  /** Select (open) a peer's conversation; loads its messages + marks read. */
  openConversation: (peerId: string) => void;
  /** Send an outbound message to the active peer. */
  send: (body: string) => Promise<void>;
  /** Re-fetch the conversation list (e.g. after inbound delivery). */
  refresh: () => Promise<void>;
}

export function usePeerInbox(): PeerInboxState {
  const [conversations, setConversations] = useState<ConversationRecord[]>([]);
  const [activePeerId, setActivePeerId] = useState<string | null>(null);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the active peer in a ref so async callbacks can guard against a
  // stale response landing after the user switched conversations.
  const activePeerRef = useRef<string | null>(null);
  activePeerRef.current = activePeerId;

  const refresh = useCallback(async () => {
    setLoadingList(true);
    try {
      const list = await socialInboxList();
      setConversations(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadMessages = useCallback(async (peerId: string) => {
    setLoadingMessages(true);
    try {
      const msgs = await socialInboxGetMessages(peerId);
      // Drop the response if the user has since switched peers.
      if (activePeerRef.current === peerId) {
        setMessages(msgs);
        setError(null);
      }
    } catch (e) {
      if (activePeerRef.current === peerId) setError(String(e));
    } finally {
      if (activePeerRef.current === peerId) setLoadingMessages(false);
    }
  }, []);

  const openConversation = useCallback(
    (peerId: string) => {
      setActivePeerId(peerId);
      activePeerRef.current = peerId;
      setMessages([]);
      void loadMessages(peerId);
      // Clearing unread is best-effort; refresh the list afterward so the
      // badge disappears. A brand-new conversation has no row yet, so a
      // NotFound here is benign — swallow it.
      void socialInboxMarkRead(peerId)
        .then(() => refresh())
        .catch(() => {
          /* no conversation row yet — nothing to clear */
        });
    },
    [loadMessages, refresh],
  );

  const send = useCallback(
    async (body: string) => {
      const peerId = activePeerRef.current;
      if (!peerId) return;
      const trimmed = body.trim();
      if (!trimmed) return;
      try {
        const msg = await socialInboxSend(peerId, trimmed);
        // Optimistically append to the open transcript if still on this peer.
        if (activePeerRef.current === peerId) {
          setMessages((prev) => [...prev, msg]);
        }
        setError(null);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh],
  );

  // Initial load of the conversation list.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    conversations,
    activePeerId,
    messages,
    loadingList,
    loadingMessages,
    error,
    openConversation,
    send,
    refresh,
  };
}
