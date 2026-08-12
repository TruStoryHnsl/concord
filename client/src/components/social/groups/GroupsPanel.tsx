/**
 * Component: **p2p groups** (OWNED by the tertiary engine-ui track).
 *
 * The p2p group surface: a group list rail on the left (with a create form)
 * and the open group's transcript + composer on the right. Drives the
 * `social_group_*` Tauri commands through {@link useGroups}. The tertiary
 * track owns everything under `client/src/components/social/groups/`.
 */
import { useEffect, useRef, useState } from "react";
import { socialPeersList } from "../../../api/social/peers";
import type { PeerRecord } from "../../../api/social/types";
import { useGroups } from "./useGroups";

/** Wall-clock time for a bubble (e.g. "14:03"). */
function clockTime(rfc3339: string): string {
  const t = new Date(rfc3339).getTime();
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Short peer id for display (first 12 chars + ellipsis). */
function shortPeer(peerId: string): string {
  return peerId.length > 12 ? `${peerId.slice(0, 12)}…` : peerId;
}

/** The create-group form: name + other-member peer ids. */
function CreateGroupForm({
  creating,
  onCancel,
  onCreate,
}: {
  creating: boolean;
  onCancel: () => void;
  onCreate: (name: string, members: string[]) => void;
}) {
  const [name, setName] = useState("");
  const [members, setMembers] = useState("");
  const [knownPeers, setKnownPeers] = useState<PeerRecord[]>([]);

  // Offer known peers as quick-pick member chips (best-effort; the registry
  // is native-only, so a web build just shows the free-text field).
  useEffect(() => {
    let cancelled = false;
    socialPeersList()
      .then((peers) => {
        if (!cancelled) setKnownPeers(peers);
      })
      .catch(() => {
        /* registry unavailable — free-text only */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleMember = (peerId: string) => {
    setMembers((prev) => {
      const current = prev
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const next = current.includes(peerId)
        ? current.filter((p) => p !== peerId)
        : [...current, peerId];
      return next.join(", ");
    });
  };

  const submit = () => {
    const memberList = members
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    onCreate(name, memberList);
  };

  return (
    <div className="flex flex-col gap-3 p-3 border-b border-outline-variant/10">
      <div className="flex items-center justify-between">
        <h4 className="font-label text-xs font-semibold text-on-surface-variant uppercase tracking-widest">
          New group
        </h4>
        <button
          onClick={onCancel}
          className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
          title="Close"
        >
          <span className="material-symbols-outlined text-lg">close</span>
        </button>
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Group name"
        className="w-full bg-surface-container-high text-on-surface rounded-lg px-3 py-2 text-sm font-body placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
      />
      <textarea
        value={members}
        onChange={(e) => setMembers(e.target.value)}
        rows={2}
        placeholder="Other members' peer ids, comma-separated"
        className="w-full resize-none bg-surface-container-high text-on-surface rounded-lg px-3 py-2 text-sm font-body placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
      />
      {knownPeers.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {knownPeers.map((p) => {
            const selected = members
              .split(",")
              .map((s) => s.trim())
              .includes(p.peerId);
            return (
              <button
                key={p.peerId}
                type="button"
                onClick={() => toggleMember(p.peerId)}
                title={p.peerId}
                className={`px-2 py-0.5 rounded-full text-[10px] font-label transition-colors ${
                  selected
                    ? "bg-primary/20 text-primary"
                    : "bg-surface-container-high text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {p.label || shortPeer(p.peerId)}
              </button>
            );
          })}
        </div>
      )}
      <button
        onClick={submit}
        disabled={creating || !name.trim()}
        className="btn-press h-9 rounded-lg bg-primary text-on-primary font-label text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
      >
        {creating ? "Creating…" : "Create group"}
      </button>
    </div>
  );
}

/** The open group: transcript + composer. */
function GroupConversationView({
  group,
  messages,
  loading,
  onSend,
}: {
  group: { group_id: string; name: string; members: string[] };
  messages: import("../../../api/social/types").InboxMessage[];
  loading: boolean;
  onSend: (body: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pin the scroll to the newest message whenever the transcript changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    onSend(body);
    setDraft("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-outline-variant/10 shrink-0">
        <div className="w-9 h-9 rounded-full bg-primary/15 text-primary flex items-center justify-center shrink-0">
          <span className="material-symbols-outlined text-lg">group</span>
        </div>
        <div className="min-w-0">
          <div className="font-body text-sm font-medium text-on-surface truncate">
            {group.name}
          </div>
          <div className="text-[10px] text-on-surface-variant/70 font-label truncate">
            {group.members.length} members · peer-to-peer
          </div>
        </div>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2 min-h-0">
        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-on-surface-variant text-sm font-body">
            Loading messages…
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-on-surface-variant">
            <span className="material-symbols-outlined text-3xl opacity-40">
              forum
            </span>
            <p className="text-sm font-body">No messages yet — start the conversation.</p>
          </div>
        ) : (
          messages.map((m) => {
            const outbound = m.direction === "outbound";
            return (
              <div
                key={m.id}
                className={`flex ${outbound ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 ${
                    outbound
                      ? "bg-primary text-on-primary rounded-br-sm"
                      : "bg-surface-container-high text-on-surface rounded-bl-sm"
                  }`}
                >
                  <div className="font-body text-sm whitespace-pre-wrap break-words">
                    {m.body}
                  </div>
                  <div
                    className={`text-[10px] mt-0.5 font-label ${
                      outbound ? "text-on-primary/70" : "text-on-surface-variant/70"
                    }`}
                  >
                    {clockTime(m.sentAt)}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2 px-3 py-3 border-t border-outline-variant/10 shrink-0">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder="Message group…"
          className="flex-1 resize-none max-h-32 bg-surface-container-high text-on-surface rounded-xl px-3 py-2 text-sm font-body placeholder:text-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary/40"
        />
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="btn-press w-10 h-10 rounded-full bg-primary text-on-primary flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          title="Send"
        >
          <span className="material-symbols-outlined text-lg">send</span>
        </button>
      </div>
    </div>
  );
}

export function GroupsPanel() {
  const {
    groups,
    activeGroupId,
    messages,
    loadingList,
    loadingMessages,
    creating,
    error,
    openGroup,
    createGroup,
    send,
    refresh,
  } = useGroups();
  const [showCreate, setShowCreate] = useState(false);

  const activeGroup = groups.find((g) => g.group_id === activeGroupId) ?? null;

  return (
    <div className="flex h-full min-h-0 bg-surface-container-low">
      {/* Group rail */}
      <div className="w-72 shrink-0 flex flex-col min-h-0 border-r border-outline-variant/10">
        <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/10 shrink-0">
          <h3 className="text-xs font-label font-medium text-on-surface-variant uppercase tracking-widest">
            Groups
          </h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => void refresh()}
              className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
              title="Refresh"
            >
              <span className="material-symbols-outlined text-lg">refresh</span>
            </button>
            <button
              onClick={() => setShowCreate((v) => !v)}
              className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors"
              title="New group"
            >
              <span className="material-symbols-outlined text-lg">add</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="px-4 py-2 text-xs text-rose-400 font-body border-b border-outline-variant/10">
            {error}
          </div>
        )}

        {showCreate && (
          <CreateGroupForm
            creating={creating}
            onCancel={() => setShowCreate(false)}
            onCreate={(name, members) => {
              void createGroup(name, members).then((ok) => {
                if (ok) setShowCreate(false);
              });
            }}
          />
        )}

        <div className="flex-1 overflow-y-auto p-2 min-h-0">
          {loadingList && groups.length === 0 ? (
            <div className="flex items-center justify-center h-full text-on-surface-variant text-sm font-body">
              Loading groups…
            </div>
          ) : groups.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-on-surface-variant px-4 text-center">
              <span className="material-symbols-outlined text-3xl opacity-40">
                group_add
              </span>
              <p className="text-sm font-body">
                No groups yet. Create one to start a p2p group conversation.
              </p>
            </div>
          ) : (
            <ul className="space-y-1">
              {groups.map((g) => {
                const active = g.group_id === activeGroupId;
                return (
                  <li key={g.group_id}>
                    <button
                      onClick={() => openGroup(g.group_id)}
                      className={`w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
                        active
                          ? "bg-primary/15 text-primary"
                          : "hover:bg-surface-container-high text-on-surface"
                      }`}
                    >
                      <span className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center shrink-0">
                        <span className="material-symbols-outlined text-base">
                          group
                        </span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-body text-sm font-medium truncate">
                          {g.name}
                        </span>
                        <span className="block text-[10px] text-on-surface-variant/70 font-label">
                          {g.members.length} members
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Open group */}
      <div className="flex-1 min-w-0 min-h-0">
        {activeGroup ? (
          <GroupConversationView
            group={activeGroup}
            messages={messages}
            loading={loadingMessages}
            onSend={send}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-on-surface-variant">
            <span className="material-symbols-outlined text-4xl opacity-40">
              group
            </span>
            <p className="font-body text-sm">
              Select a group to open the conversation.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
