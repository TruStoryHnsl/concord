/**
 * WebPeerHistory — the BROWSER threaded messenger (D3/D4), fed by the D1
 * per-user conversation store on the docker portal.
 *
 * This is a REAL messenger, not a read-only mirror: conversation list →
 * message history → composer that sends THROUGH the pillar
 * (`POST /api/me/conversations/{peer}/messages`). The browser never holds
 * superuser/p2p keys (identity model: superuser = device↔device only) —
 * the pillar is the transport and the durable history, so a web send shows
 * in-thread, carries a delivery state (D5), and roams.
 *
 * The inbox is UNIFIED (D4): the store folds durable pillar-sent threads,
 * roamed device threads, and live relay mail into ONE list keyed like
 * native (`reticulum:<dest>` etc.).
 *
 * The "peers" tab is the D2 known-peers registry with account-local
 * label/trust the browser may edit (X1) plus prune/export of roamed
 * history — all account-scoped, never touching superuser keys.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Contact,
  type Conversation,
  type ConversationMessage,
  type DeliveryState,
  deleteContact,
  deleteConversation,
  exportConversations,
  fetchConversationMessages,
  listContacts,
  listConversations,
  sendConversationMessage,
  upsertContact,
} from "../../api/conversations";
import { useAuthStore } from "../../stores/auth";
import { useToastStore } from "../../stores/toast";
import { identiconDataUri } from "../mesh/identicon";

const TRUST_OPTIONS = ["unverified", "verified", "blocked"];

function shortKey(key: string): string {
  const bare = key.includes(":") ? key.slice(key.indexOf(":") + 1) : key;
  return bare.length > 20 ? `${bare.slice(0, 10)}…${bare.slice(-6)}` : bare;
}

function convoLabel(c: Conversation): string {
  return c.label || shortKey(c.peer_key);
}

function stateBadge(state: DeliveryState): { text: string; cls: string } {
  switch (state) {
    case "sent":
      return { text: "sent", cls: "text-green-500" };
    case "delivered":
      return { text: "delivered", cls: "text-green-500" };
    case "received":
      return { text: "", cls: "" };
    case "failed":
      return { text: "failed", cls: "text-red-500" };
    case "queued":
    default:
      return { text: "queued", cls: "text-yellow-500" };
  }
}

function bodyText(m: ConversationMessage): string {
  if (m.body) return m.body;
  if (m.payload_b64) {
    try {
      const raw = atob(m.payload_b64);
      const parsed = JSON.parse(raw);
      if (typeof parsed?.body?.body === "string") return parsed.body.body;
      if (typeof parsed?.body === "string") return parsed.body;
      return "(sealed message)";
    } catch {
      return "(sealed message)";
    }
  }
  return "";
}

export function WebPeerHistory({
  tab,
  initialSelected = null,
  initialPersonaId = null,
}: {
  tab: "messages" | "peers";
  initialSelected?: string | null;
  initialPersonaId?: string | null;
}) {
  const token = useAuthStore((s) => s.accessToken);
  const addToast = useToastStore((s) => s.addToast);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selected, setSelected] = useState<string | null>(initialSelected);
  const [selectedPersona, setSelectedPersona] = useState<string | null>(
    initialPersonaId,
  );
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (initialSelected) setSelected(initialSelected);
    if (initialPersonaId) setSelectedPersona(initialPersonaId);
  }, [initialSelected, initialPersonaId]);

  const loadConversations = useCallback(async () => {
    if (!token) return;
    try {
      const rows = await listConversations(token);
      setConversations(rows);
    } catch {
      /* best-effort */
    } finally {
      setLoaded(true);
    }
  }, [token]);

  const loadContacts = useCallback(async () => {
    if (!token) return;
    try {
      setContacts(await listContacts(token));
    } catch {
      /* best-effort */
    }
  }, [token]);

  const loadMessages = useCallback(async () => {
    if (!token || !selected) return;
    try {
      const rows = await fetchConversationMessages(token, selected);
      setMessages(rows);
    } catch {
      /* best-effort */
    }
  }, [token, selected]);

  useEffect(() => {
    void loadConversations();
    const t = setInterval(() => void loadConversations(), 30_000);
    return () => clearInterval(t);
  }, [loadConversations]);

  useEffect(() => {
    if (tab === "peers") void loadContacts();
  }, [tab, loadContacts]);

  useEffect(() => {
    if (!selected) {
      setMessages([]);
      return;
    }
    void loadMessages();
    const t = setInterval(() => void loadMessages(), 15_000);
    return () => clearInterval(t);
  }, [selected, loadMessages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const selectedConvo = useMemo(
    () => conversations.find((c) => c.peer_key === selected),
    [conversations, selected],
  );

  const isReticulum = selected?.startsWith("reticulum:") ?? false;
  const effectivePersona = selectedPersona || selectedConvo?.persona_id || "";

  const handleSend = async () => {
    if (!token || !selected || !draft.trim() || sending) return;
    setSending(true);
    try {
      const msg = await sendConversationMessage(token, selected, {
        body: draft.trim(),
        persona_id: effectivePersona || undefined,
      });
      setMessages((prev) => [...prev, msg]);
      setDraft("");
      if (msg.state === "queued") {
        addToast(
          isReticulum && !effectivePersona
            ? "Saved. Add the recipient persona to send over the mesh."
            : "Saved — the mesh node isn't reachable, will show as queued.",
        );
      } else if (msg.state === "failed") {
        addToast("Send failed — kept in the thread as failed.");
      }
      void loadConversations();
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  const handlePrune = async () => {
    if (!token || !selected) return;
    try {
      await deleteConversation(token, selected);
      setSelected(null);
      setMessages([]);
      void loadConversations();
      addToast("Conversation pruned.", "success");
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Prune failed");
    }
  };

  const handleExport = async () => {
    if (!token) return;
    try {
      const data = await exportConversations(token);
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "concord-conversations.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      addToast(err instanceof Error ? err.message : "Export failed");
    }
  };

  // -------------------------------------------------------------- Peers tab
  if (tab === "peers") {
    return (
      <div className="h-full overflow-y-auto p-4" data-testid="web-peer-contacts">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-on-surface">Known peers</h3>
            <p className="text-xs text-on-surface-variant">
              Contacts your portal learned. Labels and trust here are your own
              notes — they never change device-side keys.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleExport()}
            className="btn-press rounded-lg bg-surface-container-high px-3 py-1.5 text-xs text-on-surface hover:bg-surface-container-highest"
            data-testid="web-peer-export"
          >
            Export history
          </button>
        </div>
        {contacts.length === 0 ? (
          <p className="text-xs italic text-on-surface-variant">
            {loaded ? "No peers learned yet." : "Loading…"}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {contacts.map((c) => (
              <ContactRow
                key={c.peer_key}
                contact={c}
                onSave={async (label, trust) => {
                  if (!token) return;
                  try {
                    const updated = await upsertContact(token, {
                      peer_key: c.peer_key,
                      persona_id: c.persona_id,
                      label,
                      trust,
                    });
                    setContacts((prev) =>
                      prev.map((x) => (x.peer_key === c.peer_key ? updated : x)),
                    );
                    addToast("Contact updated.", "success");
                  } catch (err) {
                    addToast(err instanceof Error ? err.message : "Update failed");
                  }
                }}
                onDelete={async () => {
                  if (!token) return;
                  try {
                    await deleteContact(token, c.peer_key);
                    setContacts((prev) =>
                      prev.filter((x) => x.peer_key !== c.peer_key),
                    );
                  } catch (err) {
                    addToast(err instanceof Error ? err.message : "Delete failed");
                  }
                }}
              />
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ----------------------------------------------------------- Messages tab
  return (
    <div className="flex h-full min-h-0" data-testid="web-peer-history">
      <div className="flex w-72 flex-shrink-0 flex-col border-r border-outline-variant/10 bg-surface-container-low">
        <div className="px-4 py-3">
          <h3 className="text-xs font-label font-medium uppercase tracking-widest text-on-surface-variant">
            Conversations
          </h3>
          <p className="mt-1 text-[11px] text-on-surface-variant">
            Mesh, mail &amp; device — one inbox
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {conversations.length === 0 ? (
            <p className="px-2 text-xs italic text-on-surface-variant">
              {loaded
                ? "No conversations yet. Open one from the mesh Announces tab, or from a peer, and send a message."
                : "Loading…"}
            </p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.peer_key}
                type="button"
                onClick={() => {
                  setSelected(c.peer_key);
                  setSelectedPersona(c.persona_id);
                }}
                className={`btn-press mb-1 flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors ${
                  selected === c.peer_key
                    ? "bg-surface-container-high"
                    : "hover:bg-surface-container"
                }`}
                data-testid={`web-convo-${c.peer_key}`}
              >
                <img
                  src={identiconDataUri(c.peer_key)}
                  alt=""
                  className="h-8 w-8 rounded-md"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-on-surface">
                    {convoLabel(c)}
                  </span>
                  {c.last_preview ? (
                    <span className="block truncate text-[11px] text-on-surface-variant">
                      {c.last_preview}
                    </span>
                  ) : null}
                </span>
                {c.sources.includes("mailbox") ? (
                  <span
                    className="h-2 w-2 flex-shrink-0 rounded-full bg-green-500"
                    title="Has pending mail"
                  />
                ) : null}
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {selected === null ? (
          <div className="flex h-full items-center justify-center text-sm text-on-surface-variant">
            Select a conversation to view its history.
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-outline-variant/10 px-4 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-on-surface">
                  {selectedConvo ? convoLabel(selectedConvo) : shortKey(selected)}
                </div>
                <div className="truncate font-mono text-[11px] text-on-surface-variant">
                  {selected}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handlePrune()}
                title="Prune this conversation"
                data-testid="web-convo-prune"
                className="text-on-surface-variant hover:text-red-500"
              >
                <span className="material-symbols-outlined text-lg">delete</span>
              </button>
            </div>

            <div
              ref={scrollRef}
              className="min-h-0 flex-1 overflow-y-auto p-4"
              data-testid="web-convo-messages"
            >
              <div className="mx-auto max-w-2xl space-y-2">
                {messages.map((m) => {
                  const badge = stateBadge(m.state);
                  const out = m.direction === "out";
                  return (
                    <div
                      key={m.id}
                      className={`flex ${out ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                          out
                            ? "bg-primary/20 text-on-surface"
                            : "bg-surface-container text-on-surface"
                        }`}
                      >
                        {bodyText(m)}
                        <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[10px] text-on-surface-variant">
                          <span>{m.at ? m.at.slice(11, 16) : ""}</span>
                          {out && badge.text ? (
                            <span className={badge.cls}>· {badge.text}</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {messages.length === 0 ? (
                  <p className="text-center text-xs italic text-on-surface-variant">
                    No messages yet — say something.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="border-t border-outline-variant/10 p-3">
              {isReticulum && !effectivePersona ? (
                <input
                  type="text"
                  value={selectedPersona ?? ""}
                  onChange={(e) => setSelectedPersona(e.target.value)}
                  placeholder="recipient persona id (needed to send over the mesh)"
                  className="mb-2 w-full rounded-lg border border-outline-variant/20 bg-surface-container-highest px-3 py-1.5 font-mono text-xs text-on-surface focus:border-green-700/50 focus:outline-none"
                  data-testid="web-convo-persona"
                />
              ) : null}
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder="Message"
                  rows={1}
                  maxLength={4096}
                  className="flex-1 resize-none rounded-lg border border-outline-variant/20 bg-surface-container-highest px-3 py-2 text-sm text-on-surface focus:border-primary/50 focus:outline-none"
                  data-testid="web-convo-composer"
                />
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={sending || !draft.trim()}
                  className="btn-press rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
                  data-testid="web-convo-send"
                >
                  {sending ? "…" : "Send"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ContactRow({
  contact,
  onSave,
  onDelete,
}: {
  contact: Contact;
  onSave: (label: string | null, trust: string) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
}) {
  const [label, setLabel] = useState(contact.label ?? "");
  const [trust, setTrust] = useState(contact.trust);
  const dirty = label !== (contact.label ?? "") || trust !== contact.trust;
  const editable = contact.source === "manual" || contact.source === "roamed";

  return (
    <li className="flex items-center gap-3 rounded-lg bg-surface-container px-3 py-2">
      <img
        src={identiconDataUri(contact.peer_key)}
        alt=""
        className="h-8 w-8 rounded-md"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={shortKey(contact.peer_key)}
          className="w-full rounded bg-surface-container-high px-2 py-1 text-sm text-on-surface focus:outline-none"
        />
        <div className="flex items-center gap-2 text-[11px] text-on-surface-variant">
          <select
            value={trust}
            onChange={(e) => setTrust(e.target.value)}
            className="rounded bg-surface-container-high px-1.5 py-0.5 text-[11px] text-on-surface focus:outline-none"
          >
            {TRUST_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <span>· {contact.source}</span>
        </div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1">
        <button
          type="button"
          disabled={!dirty}
          onClick={() => void onSave(label.trim() || null, trust)}
          className="btn-press rounded px-2 py-1 text-xs text-primary disabled:opacity-30"
          title="Save"
          data-testid={`web-contact-save-${contact.peer_key}`}
        >
          Save
        </button>
        {editable ? (
          <button
            type="button"
            onClick={() => void onDelete()}
            className="text-on-surface-variant hover:text-red-500"
            title="Remove"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        ) : null}
      </div>
    </li>
  );
}
