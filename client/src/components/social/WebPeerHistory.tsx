/**
 * WebPeerHistory — the BROWSER half of superuser roaming.
 *
 * Renders the p2p messenger state the user's native device pushed into
 * this instance (`/api/me/sync/*`): per-peer conversations, message
 * history, and known contacts. Read-only by design — the p2p keys live
 * on the device; this surface is the faithful mirror that makes the
 * browser session feel like the same account, not a second sender.
 */
import { useEffect, useMemo, useState } from "react";
import { fetchRoamedHistory } from "../../lib/messengerSync";
import { identiconDataUri } from "../mesh/identicon";

interface Row {
  key: string;
  data: Record<string, unknown>;
}

function label(row: Row, contacts: Row[]): string {
  const d = row.data;
  if (typeof d.groupName === "string" && d.groupName) return d.groupName;
  const contact = contacts.find((c) => c.key === row.key);
  const l = contact?.data?.label;
  if (typeof l === "string" && l) return l;
  const id = row.key;
  return id.length > 20 ? `${id.slice(0, 10)}…${id.slice(-6)}` : id;
}

export function WebPeerHistory({ tab }: { tab: "messages" | "peers" }) {
  const [conversations, setConversations] = useState<Row[]>([]);
  const [messages, setMessages] = useState<Row[]>([]);
  const [contacts, setContacts] = useState<Row[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void fetchRoamedHistory()
      .then((r) => {
        setConversations(
          [...r.conversations].sort((a, b) =>
            String(b.data.lastMessageAt ?? "").localeCompare(
              String(a.data.lastMessageAt ?? ""),
            ),
          ),
        );
        setMessages(r.messages);
        setContacts(r.contacts);
      })
      .finally(() => setLoaded(true));
  }, []);

  const selectedMessages = useMemo(
    () =>
      messages
        .filter((m) => m.data.conversation === selected)
        .sort((a, b) =>
          String(a.data.sentAt ?? "").localeCompare(String(b.data.sentAt ?? "")),
        ),
    [messages, selected],
  );

  if (tab === "peers") {
    return (
      <div className="h-full overflow-y-auto p-4" data-testid="web-peer-contacts">
        <h3 className="mb-1 text-sm font-semibold text-on-surface">Known peers</h3>
        <p className="mb-3 text-xs text-on-surface-variant">
          Synced from your device. Pairing and trust changes happen in the
          native app.
        </p>
        {contacts.length === 0 ? (
          <p className="text-xs italic text-on-surface-variant">
            {loaded ? "No peers synced from your device yet." : "Loading…"}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {contacts.map((c) => (
              <li
                key={c.key}
                className="flex items-center gap-3 rounded-lg bg-surface-container px-3 py-2"
              >
                <img src={identiconDataUri(c.key)} alt="" className="h-8 w-8 rounded-md" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-on-surface">
                    {typeof c.data.label === "string" && c.data.label
                      ? c.data.label
                      : c.key}
                  </div>
                  {typeof c.data.trust === "string" && c.data.trust ? (
                    <div className="text-[11px] text-on-surface-variant">
                      trust: {c.data.trust}
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0" data-testid="web-peer-history">
      <div className="flex w-72 flex-shrink-0 flex-col border-r border-outline-variant/10 bg-surface-container-low">
        <div className="px-4 py-3">
          <h3 className="text-xs font-label font-medium uppercase tracking-widest text-on-surface-variant">
            Conversations
          </h3>
          <p className="mt-1 text-[11px] text-on-surface-variant">
            Synced from your device · read-only here
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {conversations.length === 0 ? (
            <p className="px-2 text-xs italic text-on-surface-variant">
              {loaded
                ? "No conversations synced yet. Open the native app while signed into this instance and they sync automatically."
                : "Loading…"}
            </p>
          ) : (
            conversations.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setSelected(c.key)}
                className={`btn-press mb-1 flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors ${
                  selected === c.key
                    ? "bg-surface-container-high"
                    : "hover:bg-surface-container"
                }`}
              >
                <img src={identiconDataUri(c.key)} alt="" className="h-8 w-8 rounded-md" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-on-surface">
                    {label(c, contacts)}
                  </span>
                  {typeof c.data.lastPreview === "string" && c.data.lastPreview ? (
                    <span className="block truncate text-[11px] text-on-surface-variant">
                      {c.data.lastPreview}
                    </span>
                  ) : null}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {selected === null ? (
          <div className="flex h-full items-center justify-center text-sm text-on-surface-variant">
            Select a conversation to view its history.
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-2">
            {selectedMessages.map((m) => (
              <div
                key={m.key}
                className={`flex ${m.data.direction === "out" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    m.data.direction === "out"
                      ? "bg-primary/20 text-on-surface"
                      : "bg-surface-container text-on-surface"
                  }`}
                >
                  {String(m.data.body ?? "")}
                  <div className="mt-0.5 text-right text-[10px] text-on-surface-variant">
                    {String(m.data.sentAt ?? "").slice(11, 16)}
                    {m.data.edited ? " · edited" : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
