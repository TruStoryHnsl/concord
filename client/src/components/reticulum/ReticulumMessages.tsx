/**
 * ReticulumMessages — the Messages section of the Reticulum surface.
 *
 * Three blocks, all served by the CORE instance (the user's portal):
 *
 *  1. **Send over the mesh** — RelayFrame v1 text via the pillar's RNS
 *     node (`POST /api/reticulum/send`). The pillar is the web user's
 *     reticulum transport; wire-identical to a native peer's frame.
 *  2. **Pending mailbox** — store-and-forward deposits addressed to the
 *     account's bound personas (`/api/relay/messages` + ack). This is
 *     mail that arrived while the user's own devices were offline.
 *  3. **Deposit receipts** — delivery status of the user's own deposits.
 *
 * Everything here is strictly user-scoped server-side.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ackPendingMessages,
  fetchMyDeposits,
  fetchPendingMessages,
  type PendingRelayMessage,
  type RelayDepositReceipt,
} from "../../api/relay";
import {
  getReticulumEntrypoint,
  getReticulumStatus,
  sendReticulumText,
  type ReticulumEntrypoint,
  type ReticulumStatus,
} from "../../api/reticulum";
import { useAuthStore } from "../../stores/auth";
import { useToastStore } from "../../stores/toast";

function decodePayloadPreview(b64: string): string {
  try {
    const raw = atob(b64);
    const parsed = JSON.parse(raw);
    if (typeof parsed?.body === "string") return parsed.body;
    return raw.slice(0, 120);
  } catch {
    return "(opaque payload)";
  }
}

export function ReticulumMessages() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const addToast = useToastStore((s) => s.addToast);

  const [status, setStatus] = useState<ReticulumStatus | null>(null);
  const [entrypoint, setEntrypoint] = useState<ReticulumEntrypoint | null>(null);
  const [pending, setPending] = useState<PendingRelayMessage[]>([]);
  const [deposits, setDeposits] = useState<RelayDepositReceipt[]>([]);

  const [destHash, setDestHash] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    const results = await Promise.allSettled([
      getReticulumStatus(accessToken),
      getReticulumEntrypoint(accessToken),
      fetchPendingMessages(accessToken),
      fetchMyDeposits(accessToken),
    ]);
    if (results[0].status === "fulfilled") setStatus(results[0].value);
    setEntrypoint(results[1].status === "fulfilled" ? results[1].value : null);
    if (results[2].status === "fulfilled") setPending(results[2].value);
    if (results[3].status === "fulfilled") setDeposits(results[3].value);
  }, [accessToken]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const handleSend = async () => {
    if (!accessToken || sending) return;
    setSending(true);
    try {
      await sendReticulumText(accessToken, {
        destination_hash: destHash.trim().toLowerCase(),
        persona_id: personaId.trim(),
        body: text,
      });
      addToast("Sent over the mesh.", "success");
      setText("");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  const handleAck = async (id: string) => {
    if (!accessToken) return;
    try {
      await ackPendingMessages(accessToken, [id]);
      setPending((rows) => rows.filter((r) => r.id !== id));
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Ack failed");
    }
  };

  const nodeUp = status?.running === true;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6" data-testid="reticulum-messages">
      {/* Entrypoint card */}
      <section className="rounded-xl bg-surface-container p-4 space-y-2">
        <h3 className="text-sm font-semibold text-on-surface flex items-center gap-2">
          <span className="material-symbols-outlined text-green-700 text-lg">login</span>
          Mesh entrypoint
        </h3>
        {entrypoint ? (
          <div className="space-y-1">
            <p className="text-xs text-on-surface-variant">
              This instance is your {entrypoint.mode === "private" ? "private" : "public"}{" "}
              Reticulum entrypoint.
              {entrypoint.mode === "private" &&
                " Keep the routing address between you and the people it was shared with."}
            </p>
            <div className="font-mono text-sm text-on-surface bg-surface-container-highest rounded-lg px-3 py-2">
              {entrypoint.domain ?? "(host of this instance)"}:{entrypoint.port}
            </div>
            <p className="text-[11px] text-on-surface-variant">
              Native app: Settings → Connectors → Reticulum → add a{" "}
              <code>TCPClientInterface</code> with this host and port.
              {entrypoint.mailbox_destination && (
                <>
                  {" "}
                  Pillar mailbox destination:{" "}
                  <code>{entrypoint.mailbox_destination}</code>
                </>
              )}
            </p>
          </div>
        ) : (
          <p className="text-xs text-on-surface-variant">
            {status?.mode === "off" || !status
              ? "This instance is not configured as a Reticulum entrypoint."
              : "No entrypoint descriptor is available to this account."}
          </p>
        )}
      </section>

      {/* Send */}
      <section className="rounded-xl bg-surface-container p-4 space-y-2">
        <h3 className="text-sm font-semibold text-on-surface flex items-center gap-2">
          <span className="material-symbols-outlined text-green-700 text-lg">send</span>
          Send over the mesh
        </h3>
        {!nodeUp && (
          <p className="text-xs text-on-surface-variant">
            The instance's Reticulum node is not running — sending is unavailable.
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text"
            value={destHash}
            onChange={(e) => setDestHash(e.target.value)}
            placeholder="destination hash (32 hex)"
            className="px-3 py-2 bg-surface-container-highest rounded-lg text-sm text-on-surface font-mono border border-outline-variant/20 focus:border-green-700/50 focus:outline-none"
          />
          <input
            type="text"
            value={personaId}
            onChange={(e) => setPersonaId(e.target.value)}
            placeholder="recipient persona id"
            className="px-3 py-2 bg-surface-container-highest rounded-lg text-sm text-on-surface font-mono border border-outline-variant/20 focus:border-green-700/50 focus:outline-none"
          />
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="message"
          rows={2}
          maxLength={4096}
          className="w-full px-3 py-2 bg-surface-container-highest rounded-lg text-sm text-on-surface border border-outline-variant/20 focus:border-green-700/50 focus:outline-none"
        />
        <button
          onClick={() => void handleSend()}
          disabled={!nodeUp || sending || !destHash.trim() || !personaId.trim() || !text.trim()}
          className="py-2 px-4 bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-green-600 transition-colors"
          data-testid="reticulum-send-button"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </section>

      {/* Pending mailbox */}
      <section className="rounded-xl bg-surface-container p-4 space-y-2">
        <h3 className="text-sm font-semibold text-on-surface flex items-center gap-2">
          <span className="material-symbols-outlined text-green-700 text-lg">move_to_inbox</span>
          Pending mailbox
          {pending.length > 0 && (
            <span className="text-[11px] bg-green-700 text-white rounded-full px-2 py-0.5">
              {pending.length}
            </span>
          )}
        </h3>
        <p className="text-[11px] text-on-surface-variant">
          Store-and-forward mail addressed to your personas, held by this
          instance while your devices were offline.
        </p>
        {pending.length === 0 ? (
          <p className="text-xs text-on-surface-variant">Nothing pending.</p>
        ) : (
          <ul className="space-y-1.5">
            {pending.map((m) => (
              <li
                key={m.id}
                className="flex items-start gap-3 px-3 py-2 rounded-lg bg-surface-container-high"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-on-surface break-words">
                    {decodePayloadPreview(m.payload_b64)}
                  </div>
                  <div className="text-[11px] text-on-surface-variant font-mono">
                    → {m.to_persona}
                    {" · from "}
                    {m.sender_persona ?? m.sender_user_id ?? m.sender_identity_hash ?? "unknown"}
                    {" · via "}
                    {m.channel}
                  </div>
                </div>
                <button
                  onClick={() => void handleAck(m.id)}
                  title="Mark delivered"
                  className="text-on-surface-variant hover:text-on-surface"
                >
                  <span className="material-symbols-outlined text-lg">done</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Deposit receipts */}
      {deposits.length > 0 && (
        <section className="rounded-xl bg-surface-container p-4 space-y-2">
          <h3 className="text-sm font-semibold text-on-surface flex items-center gap-2">
            <span className="material-symbols-outlined text-green-700 text-lg">outbox</span>
            Your deposits
          </h3>
          <ul className="space-y-1">
            {deposits.map((d) => (
              <li key={d.id} className="flex items-center gap-2 text-[12px] text-on-surface-variant font-mono">
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${d.delivered ? "bg-green-500" : "bg-yellow-500"}`}
                  aria-label={d.delivered ? "Delivered" : "Pending"}
                />
                <span className="truncate">→ {d.to_persona}</span>
                <span>{d.delivered ? "delivered" : "waiting"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
