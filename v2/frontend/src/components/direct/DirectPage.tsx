import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import GlassPanel from "@/components/ui/GlassPanel";
import Skeleton from "@/components/ui/Skeleton";
import Button from "@/components/ui/Button";
import { useConversationsStore } from "@/stores/conversations";
import { useFriendsStore } from "@/stores/friends";
import type { ConversationPayload, PresenceStatus } from "@/api/tauri";
import { formatRelativeTime, shortenPeerId } from "@/utils/format";

function DirectPage() {
  const conversations = useConversationsStore((s) => s.conversations);
  const loading = useConversationsStore((s) => s.loading);
  const loadConversations = useConversationsStore((s) => s.loadConversations);
  const friends = useFriendsStore((s) => s.friends);
  const loadFriends = useFriendsStore((s) => s.loadFriends);
  const [showNewGroup, setShowNewGroup] = useState(false);

  useEffect(() => {
    void loadConversations();
    void loadFriends();
  }, [loadConversations, loadFriends]);

  // Build a presence lookup from friends
  const presenceMap: Record<string, PresenceStatus> = {};
  for (const f of friends) {
    presenceMap[f.peerId] = f.presenceStatus;
  }

  // Build a display name lookup
  const nameMap: Record<string, string> = {};
  for (const f of friends) {
    nameMap[f.peerId] = f.displayName ?? f.aliasName ?? shortenPeerId(f.peerId);
  }

  return (
    <div className="mesh-background min-h-full p-4 md:p-6">
      <div className="relative z-10 max-w-2xl mx-auto space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="font-headline font-bold text-2xl text-on-surface">
              Direct
            </h1>
            <p className="text-sm text-on-surface-variant font-body">
              Private conversations, end-to-end encrypted.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              onClick={() => setShowNewGroup(!showNewGroup)}
            >
              <span className="material-symbols-outlined text-lg">
                group_add
              </span>
              New Group
            </Button>
          </div>
        </div>

        {/* Conversations list */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3">
                <Skeleton className="w-10 h-10" circle />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-48" />
                </div>
              </div>
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <GlassPanel className="rounded-xl p-8 flex flex-col items-center text-center space-y-3">
            <span className="material-symbols-outlined text-4xl text-primary/40">
              chat_bubble_outline
            </span>
            <p className="font-headline font-semibold text-on-surface">
              No conversations yet
            </p>
            <p className="text-sm text-on-surface-variant font-body max-w-xs">
              Start a conversation from the Friends page, or create a group chat.
            </p>
          </GlassPanel>
        ) : (
          <div className="space-y-1">
            {conversations.map((conv) => (
              <ConversationRow
                key={conv.id}
                conversation={conv}
                presenceMap={presenceMap}
                nameMap={nameMap}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Conversation Row ──────────────────────────────────────── */

function ConversationRow({
  conversation,
  presenceMap,
  nameMap,
}: {
  conversation: ConversationPayload;
  presenceMap: Record<string, PresenceStatus>;
  nameMap: Record<string, string>;
}) {
  const isGroup = conversation.isGroup;
  const firstParticipant = conversation.participants[0] ?? "";
  const displayName = isGroup
    ? conversation.name ?? conversation.participants.map((p) => nameMap[p] ?? shortenPeerId(p)).join(", ")
    : nameMap[firstParticipant] ?? shortenPeerId(firstParticipant);

  // For 1:1 conversations, show presence
  const singlePeerId = !isGroup ? firstParticipant : null;
  const presence = singlePeerId ? presenceMap[singlePeerId] ?? "offline" : null;

  const presenceDotColor = presence === "online"
    ? "bg-secondary"
    : presence === "away"
      ? "bg-[#f59e0b]"
      : presence === "dnd"
        ? "bg-error"
        : "bg-outline-variant";

  // For the link, 1:1 convs link to /direct/:peerId, groups to /direct/:id
  const href = isGroup
    ? `/direct/${conversation.id}`
    : `/direct/${firstParticipant}`;

  return (
    <Link to={href} className="block">
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-container-high/50 transition-colors">
        {/* Avatar */}
        <div className="relative shrink-0">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
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

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-label font-medium text-on-surface truncate">
              {displayName}
            </p>
            {isGroup && (
              <span className="text-[10px] text-on-surface-variant font-body">
                {conversation.participants.length} members
              </span>
            )}
          </div>
          {/* E2E indicator */}
          <div className="flex items-center gap-1 mt-0.5">
            <span className="material-symbols-outlined text-secondary text-[10px]">
              lock
            </span>
            <span className="text-[10px] text-on-surface-variant font-body">
              End-to-end encrypted
            </span>
          </div>
        </div>

        {/* Right: timestamp */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          {conversation.lastMessageAt && (
            <span className="text-[10px] text-on-surface-variant font-body">
              {formatRelativeTime(conversation.lastMessageAt)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export default DirectPage;
