/**
 * API wrapper: **per-peer-inboxes** (OWNED by the per-peer-inboxes branch).
 *
 * Thin wrappers around the `social_inbox_*` Tauri commands. Base-branch
 * state: registered, returning NotImplemented until the feature lands. Owned
 * by the per-peer-inboxes branch; extend WITHOUT touching the other
 * `social/*` api files. Shared types come from `./types` (read-only).
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  ConversationRecord,
  InboxMessage,
  InboxMutationAck,
} from "./types";

/** List per-peer conversation summaries, newest-activity-first. */
export function socialInboxList(): Promise<ConversationRecord[]> {
  return invoke<ConversationRecord[]>("social_inbox_list");
}

/** Fetch a single peer's 1:1 conversation, oldest-first. */
export function socialInboxGetMessages(peerId: string): Promise<InboxMessage[]> {
  return invoke<InboxMessage[]>("social_inbox_get_messages", { peerId });
}

/** Send a message to a peer. */
export function socialInboxSend(
  peerId: string,
  body: string,
): Promise<InboxMessage> {
  return invoke<InboxMessage>("social_inbox_send", { peerId, body });
}

/** Mark a peer's conversation as read. */
export function socialInboxMarkRead(peerId: string): Promise<ConversationRecord> {
  return invoke<ConversationRecord>("social_inbox_mark_read", { peerId });
}

// --- Social inbox 1.2 — edits / deletes / reactions / replies ---------------

/** Edit one of OUR messages. Applies locally, then syncs to the peer. */
export function socialInboxEditMessage(
  messageId: string,
  newBody: string,
): Promise<InboxMutationAck> {
  return invoke<InboxMutationAck>("social_inbox_edit_message", {
    messageId,
    newBody,
  });
}

/** Delete one of OUR messages — local tombstone + cooperative peer delete. */
export function socialInboxDeleteMessage(
  messageId: string,
): Promise<InboxMutationAck> {
  return invoke<InboxMutationAck>("social_inbox_delete_message", { messageId });
}

/** Toggle OUR emoji reaction on a message. `added` says the current state. */
export function socialInboxToggleReaction(
  messageId: string,
  emoji: string,
): Promise<InboxMutationAck> {
  return invoke<InboxMutationAck>("social_inbox_toggle_reaction", {
    messageId,
    emoji,
  });
}

/** Send a reply to an earlier message in the same conversation. */
export function socialInboxSendReply(
  peerId: string,
  body: string,
  targetLocalId: string,
): Promise<InboxMessage> {
  return invoke<InboxMessage>("social_inbox_send_reply", {
    peerId,
    body,
    targetLocalId,
  });
}

// --- Typing indicators -------------------------------------------------------

/**
 * Send one typing signal (fire-and-forget). Resolves "sent", "unsupported"
 * (stop signalling this peer for the session), or "failed" (ignore — the
 * next keystroke re-asserts anyway).
 */
export function socialInboxSendTyping(
  peerId: string,
  typing: boolean,
): Promise<string> {
  return invoke<string>("social_inbox_send_typing", { peerId, typing });
}
