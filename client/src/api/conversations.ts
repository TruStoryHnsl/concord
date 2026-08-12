/**
 * conversations — web API for the docker portal's per-user conversation
 * + contact store (D1/D2). Backed by `server/routers/conversations.py`.
 *
 * This is what turns the browser from a one-shot sender into a real
 * threaded messenger: it lists the account's unified inbox (durable
 * pillar-sent threads + roamed device threads + live relay mail), reads a
 * thread's messages, and originates a send THROUGH the pillar (the browser
 * never holds superuser/p2p keys — identity model: superuser = device↔
 * device only). Contacts carry account-local label/trust the browser may
 * edit; none of it is a cryptographic trust change.
 */

import { apiFetch } from "./concord";

export type DeliveryState =
  | "queued"
  | "sent"
  | "failed"
  | "received"
  | "delivered";

export interface Conversation {
  peer_key: string;
  persona_id: string | null;
  label: string | null;
  last_preview: string | null;
  last_message_at: string | null;
  sources: string[];
}

export interface ConversationMessage {
  id: string;
  peer_key: string;
  direction: "in" | "out";
  body: string | null;
  payload_b64: string | null;
  from_name: string | null;
  channel: string;
  state: DeliveryState;
  wire_id: string | null;
  at: string;
  source: string;
}

export interface Contact {
  peer_key: string;
  persona_id: string | null;
  label: string | null;
  trust: string;
  source: string;
  last_seen: string | null;
}

export function listConversations(token: string): Promise<Conversation[]> {
  return apiFetch("/me/conversations", {}, token);
}

export function fetchConversationMessages(
  token: string,
  peerKey: string,
): Promise<ConversationMessage[]> {
  return apiFetch(
    `/me/conversations/${encodeURIComponent(peerKey)}/messages`,
    {},
    token,
  );
}

export function sendConversationMessage(
  token: string,
  peerKey: string,
  params: { body: string; persona_id?: string | null; label?: string | null },
): Promise<ConversationMessage> {
  return apiFetch(
    `/me/conversations/${encodeURIComponent(peerKey)}/messages`,
    { method: "POST", body: JSON.stringify(params) },
    token,
  );
}

export function deleteConversation(
  token: string,
  peerKey: string,
): Promise<{ ok: boolean }> {
  return apiFetch(
    `/me/conversations/${encodeURIComponent(peerKey)}`,
    { method: "DELETE" },
    token,
  );
}

export function exportConversations(token: string): Promise<unknown> {
  return apiFetch("/me/conversations/export", {}, token);
}

export function listContacts(token: string): Promise<Contact[]> {
  return apiFetch("/me/contacts", {}, token);
}

export function upsertContact(
  token: string,
  params: {
    peer_key: string;
    persona_id?: string | null;
    label?: string | null;
    trust?: string | null;
  },
): Promise<Contact> {
  return apiFetch(
    "/me/contacts",
    { method: "POST", body: JSON.stringify(params) },
    token,
  );
}

export function deleteContact(
  token: string,
  peerKey: string,
): Promise<{ ok: boolean }> {
  return apiFetch(
    `/me/contacts/${encodeURIComponent(peerKey)}`,
    { method: "DELETE" },
    token,
  );
}

export interface SyncDeviceStatus {
  device_id: string | null;
  rows: number;
  last_write: string | null;
  kinds: Record<string, number>;
}

export interface SyncStatus {
  total_rows: number;
  by_kind: Record<string, number>;
  devices: SyncDeviceStatus[];
}

export function fetchSyncStatus(token: string): Promise<SyncStatus> {
  return apiFetch("/me/sync/status/devices", {}, token);
}
