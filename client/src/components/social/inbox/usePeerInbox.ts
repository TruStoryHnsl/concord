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
  socialInboxDeleteMessage,
  socialInboxEditMessage,
  socialInboxGetMessages,
  socialInboxList,
  socialInboxMarkRead,
  socialInboxSend,
  socialInboxSendReply,
  socialInboxSendTyping,
  socialInboxToggleReaction,
} from "../../../api/social/inbox";
import { isTauri } from "../../../api/servitude";
import type { ConversationRecord, InboxMessage } from "../../../api/social/types";

/**
 * Cadence constants — mirror the engine's typing protocol
 * (TYPING_DEBOUNCE / TYPING_REPEAT / TYPING_TTL in
 * `concord-engine/src/servitude/social/typing.rs`). The webview owns the
 * send cadence; the engine owns the wire.
 */
const TYPING_DEBOUNCE_MS = 400;
const TYPING_REPEAT_MS = 3000;
const TYPING_TTL_MS = 8000;

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
  /** The ACTIVE peer is currently typing (inbound indicator, TTL 8s). */
  peerTyping: boolean;
  /** Select (open) a peer's conversation; loads its messages + marks read. */
  openConversation: (peerId: string) => void;
  /** Send an outbound message to the active peer. */
  send: (body: string) => Promise<void>;
  /** Send a reply to an earlier message in the active conversation. */
  sendReply: (body: string, targetLocalId: string) => Promise<void>;
  /** Edit one of OUR messages in the active conversation. */
  editMessage: (messageId: string, newBody: string) => Promise<void>;
  /** Delete one of OUR messages (tombstone). */
  deleteMessage: (messageId: string) => Promise<void>;
  /** Toggle our emoji reaction on a message. */
  toggleReaction: (messageId: string, emoji: string) => Promise<void>;
  /**
   * Report composer keystrokes. Debounced/repeated per the engine cadence;
   * call with every input change. `notifyComposerIdle` (or a send) stops it.
   */
  notifyComposerActivity: () => void;
  /** The composer emptied or lost focus — send a stop signal if one is due. */
  notifyComposerIdle: () => void;
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
  const [peerTyping, setPeerTyping] = useState(false);

  // Track the active peer in a ref so async callbacks can guard against a
  // stale response landing after the user switched conversations.
  const activePeerRef = useRef<string | null>(null);
  activePeerRef.current = activePeerId;

  // Inbound typing indicator TTL timer (matches the engine's 8s TTL — a
  // dropped Stop frame must not leave the indicator on forever).
  const typingTtlRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Outbound typing cadence state.
  const typingSendRef = useRef<{
    debounce: ReturnType<typeof setTimeout> | null;
    lastSentAt: number;
    active: boolean;
    /** Peer answered "unsupported" — stop signalling for the session. */
    unsupported: Set<string>;
  }>({ debounce: null, lastSentAt: 0, active: false, unsupported: new Set() });

  const clearInboundTyping = useCallback(() => {
    if (typingTtlRef.current) {
      clearTimeout(typingTtlRef.current);
      typingTtlRef.current = null;
    }
    setPeerTyping(false);
  }, []);

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
      clearInboundTyping();
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
    [loadMessages, refresh, clearInboundTyping],
  );

  /** Fire one typing signal at the active peer, respecting "unsupported". */
  const fireTyping = useCallback((typing: boolean) => {
    const peerId = activePeerRef.current;
    if (!peerId || !isTauri()) return;
    const state = typingSendRef.current;
    if (state.unsupported.has(peerId)) return;
    void socialInboxSendTyping(peerId, typing)
      .then((outcome) => {
        if (outcome === "unsupported") state.unsupported.add(peerId);
      })
      .catch(() => {
        /* fire-and-forget by protocol design — next keystroke re-asserts */
      });
  }, []);

  const notifyComposerActivity = useCallback(() => {
    const state = typingSendRef.current;
    const now = Date.now();
    if (state.active) {
      // Still typing — re-assert at most every TYPING_REPEAT.
      if (now - state.lastSentAt >= TYPING_REPEAT_MS) {
        state.lastSentAt = now;
        fireTyping(true);
      }
      return;
    }
    // First keystroke of a burst: debounce so a single character doesn't
    // open a stream on its own.
    if (state.debounce) clearTimeout(state.debounce);
    state.debounce = setTimeout(() => {
      state.debounce = null;
      state.active = true;
      state.lastSentAt = Date.now();
      fireTyping(true);
    }, TYPING_DEBOUNCE_MS);
  }, [fireTyping]);

  const notifyComposerIdle = useCallback(() => {
    const state = typingSendRef.current;
    if (state.debounce) {
      clearTimeout(state.debounce);
      state.debounce = null;
    }
    if (state.active) {
      state.active = false;
      fireTyping(false);
    }
  }, [fireTyping]);

  const send = useCallback(
    async (body: string) => {
      const peerId = activePeerRef.current;
      if (!peerId) return;
      const trimmed = body.trim();
      if (!trimmed) return;
      // A send IS a stop-typing signal on the recipient's side, but the
      // engine only clears on the message event when the transcript
      // reloads; stop our own outbound cadence explicitly.
      notifyComposerIdle();
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
    [refresh, notifyComposerIdle],
  );

  const sendReply = useCallback(
    async (body: string, targetLocalId: string) => {
      const peerId = activePeerRef.current;
      if (!peerId) return;
      const trimmed = body.trim();
      if (!trimmed) return;
      notifyComposerIdle();
      try {
        const msg = await socialInboxSendReply(peerId, trimmed, targetLocalId);
        if (activePeerRef.current === peerId) {
          setMessages((prev) => [...prev, msg]);
        }
        setError(null);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [refresh, notifyComposerIdle],
  );

  const editMessage = useCallback(
    async (messageId: string, newBody: string) => {
      const peerId = activePeerRef.current;
      const trimmed = newBody.trim();
      if (!trimmed) return;
      try {
        await socialInboxEditMessage(messageId, trimmed);
        // Re-read the transcript rather than patching in place: the store is
        // the source of truth for edited/reply-snippet fan-out effects.
        if (peerId && activePeerRef.current === peerId) {
          await loadMessages(peerId);
        }
        setError(null);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [loadMessages, refresh],
  );

  const deleteMessage = useCallback(
    async (messageId: string) => {
      const peerId = activePeerRef.current;
      try {
        await socialInboxDeleteMessage(messageId);
        if (peerId && activePeerRef.current === peerId) {
          await loadMessages(peerId);
        }
        setError(null);
        await refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [loadMessages, refresh],
  );

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      const peerId = activePeerRef.current;
      try {
        await socialInboxToggleReaction(messageId, emoji);
        if (peerId && activePeerRef.current === peerId) {
          await loadMessages(peerId);
        }
        setError(null);
      } catch (e) {
        setError(String(e));
      }
    },
    [loadMessages],
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
              // Their message arrived — whatever they were typing, it landed.
              clearInboundTyping();
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
        // Ephemeral typing signal for the OPEN 1:1 conversation. Group
        // signals (groupId non-null) are ignored here — the group surface
        // owns those. TTL-guarded: a dropped Stop frame clears after the
        // engine's 8s TTL.
        const unlistenTyping = await listen<{
          peerId: string;
          groupId: string | null;
          typing: boolean;
        }>("social_typing", (event) => {
          const { peerId, groupId, typing } = event.payload;
          if (groupId != null) return;
          if (activePeerRef.current !== peerId) return;
          if (typingTtlRef.current) {
            clearTimeout(typingTtlRef.current);
            typingTtlRef.current = null;
          }
          if (typing) {
            setPeerTyping(true);
            typingTtlRef.current = setTimeout(() => {
              typingTtlRef.current = null;
              setPeerTyping(false);
            }, TYPING_TTL_MS);
          } else {
            setPeerTyping(false);
          }
        });
        if (cancelled) unlistenTyping();
        else unlisteners.push(unlistenTyping);
      } catch (e) {
        console.warn("[peerInbox] failed to attach inbox event listeners:", e);
      }
    })();
    return () => {
      cancelled = true;
      unlisteners.forEach((u) => u());
    };
  }, [loadMessages, refresh, clearInboundTyping]);

  // Unmount hygiene: clear pending timers (the unsupported set dies with the
  // ref) so no signal fires into a dead surface.
  useEffect(() => {
    return () => {
      const state = typingSendRef.current;
      if (state.debounce) clearTimeout(state.debounce);
      if (typingTtlRef.current) clearTimeout(typingTtlRef.current);
    };
  }, []);

  return {
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
  };
}
