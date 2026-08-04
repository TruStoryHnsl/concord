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
import { isTauri } from "../../../api/servitude";
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

  // Live updates (Wave 2): the Rust side emits dedicated Tauri events when
  // the swarm records an inbound message (`social_inbox_message`, payload
  // `{ peerId }`) and when an outbound message is confirmed written toward
  // the peer (`social_inbox_delivered`, payload `{ peerId, messageId }`).
  // Subscribe once per hook instance so open conversations update WITHOUT a
  // manual refresh: inbound → re-pull the list (unread badges bump) and, if
  // the message is for the OPEN conversation, reload its transcript and
  // clear the unread it just created (the user is looking at it). Delivered
  // → flip that outbound row's status in place, then re-pull the list.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const unlisteners: Array<() => void> = [];
    void (async () => {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        if (cancelled) return;
        const unlistenInbound = await listen<{ peerId: string }>(
          "social_inbox_message",
          (event) => {
            const { peerId } = event.payload;
            if (activePeerRef.current === peerId) {
              void loadMessages(peerId);
              // The user is looking at this conversation — clear the unread
              // the inbound just created so its badge doesn't grow under
              // them (best-effort, like the mark-read on open), THEN pull
              // the list so the row reflects the cleared badge + preview.
              void socialInboxMarkRead(peerId)
                .catch(() => {
                  /* row raced away — refresh below still runs */
                })
                .then(() => refresh());
            } else {
              void refresh();
            }
          },
        );
        if (cancelled) unlistenInbound();
        else unlisteners.push(unlistenInbound);
        const unlistenDelivered = await listen<{
          peerId: string;
          messageId: string;
        }>("social_inbox_delivered", (event) => {
          const { peerId, messageId } = event.payload;
          if (activePeerRef.current === peerId) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === messageId ? { ...m, delivery: "delivered" } : m,
              ),
            );
          }
          void refresh();
        });
        if (cancelled) unlistenDelivered();
        else unlisteners.push(unlistenDelivered);
      } catch (e) {
        console.warn("[peerInbox] failed to attach inbox event listeners:", e);
      }
    })();
    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, [loadMessages, refresh]);

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
