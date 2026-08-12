/**
 * relay — the core instance's pending-message mailbox (store-and-forward
 * for the p2p pathway).
 *
 * A pure p2p messenger cannot deliver to a peer that is offline: the
 * native inbox queues outbound messages ONLY on the sender's device.
 * The docker instance closes that UX hole as an always-on mailbox:
 * deposits are opaque payloads addressed to a recipient persona;
 * fetch/ack are strictly scoped to the personas bound to the calling
 * account.
 */

import { apiFetch } from "./concord";

export interface PendingRelayMessage {
  id: string;
  to_persona: string;
  payload_b64: string;
  wire_id: string | null;
  channel: "http" | "reticulum";
  sender_user_id: string | null;
  sender_persona: string | null;
  sender_pubkey: string | null;
  sender_identity_hash: string | null;
  deposited_at: string;
}

export interface RelayDepositReceipt {
  id: string;
  to_persona: string;
  wire_id: string | null;
  deposited_at: string;
  expires_at: string;
  delivered: boolean;
}

export function fetchPendingMessages(
  accessToken: string,
): Promise<PendingRelayMessage[]> {
  return apiFetch("/relay/messages", {}, accessToken);
}

export function ackPendingMessages(
  accessToken: string,
  ids: string[],
): Promise<{ acked: number }> {
  return apiFetch(
    "/relay/messages/ack",
    { method: "POST", body: JSON.stringify({ ids }) },
    accessToken,
  );
}

export function depositMessage(
  accessToken: string,
  params: {
    to_persona: string;
    payload_b64: string;
    wire_id: string;
    ttl_secs?: number;
    sender_persona?: string;
    sender_pubkey?: string;
    sig?: string;
  },
): Promise<{ id: string; expires_at: string }> {
  return apiFetch(
    "/relay/messages",
    { method: "POST", body: JSON.stringify(params) },
    accessToken,
  );
}

export function fetchMyDeposits(
  accessToken: string,
): Promise<RelayDepositReceipt[]> {
  return apiFetch("/relay/deposits", {}, accessToken);
}
