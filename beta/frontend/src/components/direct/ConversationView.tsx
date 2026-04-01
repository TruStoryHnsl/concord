import { useEffect, useState, useCallback, useRef, type FormEvent, type KeyboardEvent } from "react";
import { useParams, useNavigate } from "react-router-dom";
import GlassPanel from "@/components/ui/GlassPanel";
import TrustBadge from "@/components/ui/TrustBadge";
import { useDmStore } from "@/stores/dm";
import { useAuthStore } from "@/stores/auth";
import { useMeshStore } from "@/stores/mesh";
import { useFriendsStore } from "@/stores/friends";
import { useConversationsStore } from "@/stores/conversations";
import { getPeerTrust } from "@/api/tauri";
import type { TrustInfo, DmMessage, PresenceStatus } from "@/api/tauri";
import { shortenPeerId, formatRelativeTime } from "@/utils/format";

function ConversationView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const myPeerId = useAuthStore((s) => s.peerId);
  const nearbyPeers = useMeshStore((s) => s.nearbyPeers);
  const friends = useFriendsStore((s) => s.friends);
  const conversations = useConversationsStore((s) => s.conversations);

  const dmConversations = useDmStore((s) => s.conversations);
  const openConversation = useDmStore((s) => s.openConversation);
  const sendMessage = useDmStore((s) => s.sendMessage);
  const setActivePeer = useDmStore((s) => s.setActivePeer);

  const [trustInfo, setTrustInfo] = useState<TrustInfo | null>(null);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Determine if this is a group conversation (id matches a conversation) or 1:1 (id is a peerId)
  const groupConv = conversations.find((c) => c.id === id && c.isGroup);
  const isGroup = !!groupConv;
  const peerId = isGroup ? null : id;

  const dmConv = peerId ? dmConversations.find((c) => c.peerId === peerId) : null;
  const messages = dmConv?.messages ?? [];

  const peerInfo = peerId ? nearbyPeers.find((p) => p.peerId === peerId) : null;
  const friendInfo = peerId ? friends.find((f) => f.peerId === peerId) : null;
  const peerDisplayName = friendInfo?.displayName ?? peerInfo?.displayName ?? (peerId ? shortenPeerId(peerId) : "Group");

  // Presence for 1:1
  const presence: PresenceStatus | null = friendInfo?.presenceStatus ?? null;
  const presenceDotColor = presence === "online"
    ? "bg-secondary"
    : presence === "away"
      ? "bg-[#f59e0b]"
      : presence === "dnd"
        ? "bg-error"
        : "bg-outline-variant";

  const displayTitle = isGroup
    ? groupConv?.name ?? "Group Chat"
    : peerDisplayName;

  useEffect(() => {
    if (!peerId) return;
    setActivePeer(peerId);
    void openConversation(peerId, peerDisplayName);
    void getPeerTrust(peerId).then(setTrustInfo).catch(() => {});

    return () => {
      setActivePeer(null);
    };
  }, [peerId, peerDisplayName, openConversation, setActivePeer]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSend = useCallback(
    async (e?: FormEvent) => {
      e?.preventDefault();
      const trimmed = content.trim();
      if (!trimmed || sending || !peerId) return;

      setSending(true);
      try {
        await sendMessage(peerId, trimmed);
        setContent("");
      } catch (err) {
        console.error("Failed to send message:", err);
      } finally {
        setSending(false);
      }
    },
    [content, sending, peerId, sendMessage],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 glass-panel shrink-0">
        <button
          onClick={() => navigate("/direct")}
          className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-surface-container transition-colors"
        >
          <span className="material-symbols-outlined text-on-surface-variant text-lg">
            arrow_back
          </span>
        </button>

        {/* Avatar with presence */}
        <div className="relative">
          <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10">
            <span className="material-symbols-outlined text-primary text-lg">
              {isGroup ? "group" : "person"}
            </span>
          </div>
          {presence && (
            <span
              className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-surface ${presenceDotColor}`}
            />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-headline font-semibold text-sm text-on-surface truncate">
              {displayTitle}
            </p>
            {trustInfo && <TrustBadge level={trustInfo.badge} size="sm" />}
          </div>
          <p className="text-[10px] text-on-surface-variant font-body truncate">
            {isGroup
              ? `${groupConv?.participants.length ?? 0} members`
              : peerId
                ? shortenPeerId(peerId)
                : ""}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1">
          {!isGroup && (
            <button
              className="flex items-center justify-center w-9 h-9 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
              title="Voice call"
            >
              <span className="material-symbols-outlined text-xl">call</span>
            </button>
          )}
          {isGroup && (
            <button
              className="flex items-center justify-center w-9 h-9 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
              title="Add participant"
            >
              <span className="material-symbols-outlined text-xl">
                person_add
              </span>
            </button>
          )}
        </div>

        {/* E2E indicator */}
        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-secondary/10 border border-secondary/20">
          <span className="material-symbols-outlined text-secondary text-xs">
            lock
          </span>
          <span className="text-[10px] text-secondary font-label font-medium">
            E2E
          </span>
        </div>
      </div>

      {/* Messages */}
      {messages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <GlassPanel className="p-8 text-center space-y-3 max-w-sm">
            <span className="material-symbols-outlined text-5xl text-primary/40">
              chat_bubble_outline
            </span>
            <p className="font-headline font-semibold text-on-surface">
              Start a conversation
            </p>
            <p className="text-sm text-on-surface-variant font-body">
              Messages are end-to-end encrypted.
            </p>
          </GlassPanel>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
          {/* E2E banner */}
          <div className="flex items-center justify-center gap-1.5 py-2 mb-2">
            <span className="material-symbols-outlined text-secondary/60 text-sm">
              lock
            </span>
            <span className="text-[11px] text-on-surface-variant font-body">
              Messages are end-to-end encrypted
            </span>
          </div>
          {messages.map((msg) => (
            <DmBubble key={msg.id} message={msg} isOwn={msg.fromPeer === myPeerId} />
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      {/* Input */}
      <div className="p-3 glass-panel rounded-xl mx-4 mb-4">
        <form onSubmit={(e) => void handleSend(e)} className="flex items-center gap-2">
          <input
            type="text"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={`Message ${displayTitle}...`}
            disabled={sending || isGroup}
            className="flex-1 px-4 py-2.5 rounded-xl bg-surface-container border-none text-on-surface placeholder:text-on-surface-variant/50 font-body text-sm focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
          />
          <button
            type="submit"
            disabled={!content.trim() || sending || isGroup}
            className="flex items-center justify-center w-10 h-10 rounded-xl primary-glow text-on-primary hover:brightness-110 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-xl">send</span>
          </button>
        </form>
      </div>
    </div>
  );
}

/* ── DM Bubble ──────────────────────────────────────────── */

function DmBubble({ message, isOwn }: { message: DmMessage; isOwn: boolean }) {
  return (
    <div className={`flex ${isOwn ? "justify-end" : "justify-start"} mb-2`}>
      <div
        className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${
          isOwn
            ? "primary-glow text-on-primary rounded-br-md"
            : "bg-surface-container-high text-on-surface rounded-bl-md"
        }`}
      >
        <p className="font-body text-sm leading-relaxed break-words">
          {message.content}
        </p>
        <p
          className={`text-[10px] mt-1 ${
            isOwn ? "text-on-primary/60" : "text-on-surface-variant"
          }`}
        >
          {formatRelativeTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}

export default ConversationView;
