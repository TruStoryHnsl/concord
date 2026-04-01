import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import GlassPanel from "@/components/ui/GlassPanel";
import Button from "@/components/ui/Button";
import TrustBadge from "@/components/ui/TrustBadge";
import Skeleton from "@/components/ui/Skeleton";
import { useFriendsStore } from "@/stores/friends";
import { useMeshStore } from "@/stores/mesh";
import { getPeerTrust } from "@/api/tauri";
import type { TrustInfo, FriendPayload, PresenceStatus } from "@/api/tauri";
import { shortenPeerId } from "@/utils/format";

function FriendsPage() {
  const navigate = useNavigate();
  const friends = useFriendsStore((s) => s.friends);
  const pendingRequests = useFriendsStore((s) => s.pendingRequests);
  const loading = useFriendsStore((s) => s.loading);
  const loadFriends = useFriendsStore((s) => s.loadFriends);
  const acceptRequest = useFriendsStore((s) => s.acceptRequest);
  const removeFriendAction = useFriendsStore((s) => s.removeFriend);
  const nodeStatus = useMeshStore((s) => s.nodeStatus);

  const [searchQuery, setSearchQuery] = useState("");
  const [trustMap, setTrustMap] = useState<Record<string, TrustInfo>>({});
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addPeerId, setAddPeerId] = useState("");

  // Load friends and trust data
  useEffect(() => {
    void loadFriends();
  }, [loadFriends]);

  // Load trust info for friends
  useEffect(() => {
    async function loadTrust() {
      const entries = await Promise.all(
        friends.map(async (f) => {
          try {
            const t = await getPeerTrust(f.peerId);
            return [f.peerId, t] as const;
          } catch {
            return null;
          }
        }),
      );
      const map: Record<string, TrustInfo> = {};
      for (const entry of entries) {
        if (entry) map[entry[0]] = entry[1];
      }
      setTrustMap(map);
    }
    if (friends.length > 0) {
      void loadTrust();
    }
  }, [friends]);

  // Filter by search
  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return friends;
    const q = searchQuery.toLowerCase();
    return friends.filter(
      (f) =>
        (f.displayName?.toLowerCase().includes(q) ?? false) ||
        (f.aliasName?.toLowerCase().includes(q) ?? false) ||
        f.peerId.toLowerCase().includes(q),
    );
  }, [friends, searchQuery]);

  // Group by presence status
  const onlineFriends = filtered.filter((f) => f.presenceStatus === "online");
  const awayFriends = filtered.filter((f) => f.presenceStatus === "away");
  const dndFriends = filtered.filter((f) => f.presenceStatus === "dnd");
  const offlineFriends = filtered.filter((f) => f.presenceStatus === "offline");

  const sendRequest = useFriendsStore((s) => s.sendRequest);

  if (loading) {
    return (
      <div className="mesh-background min-h-full p-6">
        <div className="relative z-10 max-w-5xl mx-auto space-y-6">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-80" />
          </div>
          <Skeleton className="h-10 w-full" />
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
            <div className="space-y-5">
              <GlassPanel className="p-4 space-y-3">
                <Skeleton className="h-4 w-32" />
                {[1, 2].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </GlassPanel>
            </div>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mesh-background min-h-full p-6">
      <div className="relative z-10 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="font-headline font-bold text-3xl text-on-surface">
              Friends
            </h1>
            <p className="text-on-surface-variant text-sm font-body">
              Connect with peers across the decentralized mesh.
            </p>
          </div>
          <Button variant="primary" onClick={() => setShowAddDialog(true)}>
            <span className="material-symbols-outlined text-lg">person_add</span>
            Add Friend
          </Button>
        </div>

        {/* Search */}
        <div className="relative">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-lg">
            search
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search friends..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface-container text-on-surface placeholder:text-on-surface-variant/50 font-body text-sm border-none focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
          />
        </div>

        {/* Layout: sidebar + main */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          {/* Left sidebar */}
          <div className="space-y-5">
            {/* Pending Requests */}
            {pendingRequests.length > 0 && (
              <GlassPanel className="p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-lg">
                    person_add
                  </span>
                  <span className="font-label text-xs uppercase tracking-wider text-on-surface-variant">
                    Pending Requests
                  </span>
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary/20 text-primary text-[10px] font-label font-semibold">
                    {pendingRequests.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {pendingRequests.map((req) => (
                    <div
                      key={req.peerId}
                      className="flex items-center gap-2.5 px-2 py-2 rounded-lg bg-surface-container/50"
                    >
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10">
                        <span className="material-symbols-outlined text-primary text-sm">
                          person
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-label font-medium text-on-surface truncate">
                          {req.displayName ?? req.aliasName ?? shortenPeerId(req.peerId)}
                        </p>
                        <p className="text-[10px] text-on-surface-variant font-body">
                          {shortenPeerId(req.peerId)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => void acceptRequest(req.peerId)}
                          className="flex items-center justify-center w-7 h-7 rounded-lg bg-secondary/10 text-secondary hover:bg-secondary/20 transition-colors"
                        >
                          <span className="material-symbols-outlined text-sm">
                            check
                          </span>
                        </button>
                        <button className="flex items-center justify-center w-7 h-7 rounded-lg bg-error/10 text-error hover:bg-error/20 transition-colors">
                          <span className="material-symbols-outlined text-sm">
                            close
                          </span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </GlassPanel>
            )}

            {/* Node Status */}
            <GlassPanel className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-secondary text-lg">
                  hub
                </span>
                <span className="font-label text-xs uppercase tracking-wider text-on-surface-variant">
                  Your Node Status
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-on-surface-variant font-body">
                  {nodeStatus?.isOnline ? "Online" : "Offline"} &middot; {nodeStatus?.connectedPeers ?? 0} peers
                </span>
              </div>
            </GlassPanel>
          </div>

          {/* Main area — friends list */}
          <div className="space-y-6">
            {/* Online */}
            {onlineFriends.length > 0 && (
              <FriendSection
                label="Online"
                status="online"
                friends={onlineFriends}
                trustMap={trustMap}
                onMessage={(peerId) => navigate(`/direct/${peerId}`)}
                onRemove={(peerId) => void removeFriendAction(peerId)}
              />
            )}

            {/* Away */}
            {awayFriends.length > 0 && (
              <FriendSection
                label="Away"
                status="away"
                friends={awayFriends}
                trustMap={trustMap}
                onMessage={(peerId) => navigate(`/direct/${peerId}`)}
                onRemove={(peerId) => void removeFriendAction(peerId)}
              />
            )}

            {/* Do Not Disturb */}
            {dndFriends.length > 0 && (
              <FriendSection
                label="Do Not Disturb"
                status="dnd"
                friends={dndFriends}
                trustMap={trustMap}
                onMessage={(peerId) => navigate(`/direct/${peerId}`)}
                onRemove={(peerId) => void removeFriendAction(peerId)}
              />
            )}

            {/* Offline */}
            {offlineFriends.length > 0 && (
              <FriendSection
                label="Offline"
                status="offline"
                friends={offlineFriends}
                trustMap={trustMap}
                onMessage={(peerId) => navigate(`/direct/${peerId}`)}
                onRemove={(peerId) => void removeFriendAction(peerId)}
              />
            )}

            {filtered.length === 0 && (
              <GlassPanel className="p-8 flex flex-col items-center justify-center text-center space-y-4">
                <div className="flex items-center justify-center w-16 h-16 rounded-full bg-primary/10">
                  <span className="material-symbols-outlined text-4xl text-primary/40">
                    {searchQuery ? "search_off" : "group"}
                  </span>
                </div>
                <div className="space-y-1">
                  <p className="font-headline font-semibold text-on-surface">
                    {searchQuery ? "No results found" : "No friends yet"}
                  </p>
                  <p className="text-sm text-on-surface-variant font-body max-w-xs mx-auto">
                    {searchQuery
                      ? "No friends matching your search."
                      : "Add friends via their peer ID to start chatting."}
                  </p>
                </div>
                {!searchQuery && (
                  <Button variant="primary" onClick={() => setShowAddDialog(true)}>
                    <span className="material-symbols-outlined text-lg">person_add</span>
                    Add Friend
                  </Button>
                )}
              </GlassPanel>
            )}
          </div>
        </div>
      </div>

      {/* Add Friend Dialog */}
      {showAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm">
          <GlassPanel className="p-6 w-full max-w-md space-y-4">
            <h2 className="font-headline font-bold text-lg text-on-surface">
              Add Friend
            </h2>
            <p className="text-sm text-on-surface-variant font-body">
              Enter the peer ID of the person you want to add.
            </p>
            <input
              type="text"
              value={addPeerId}
              onChange={(e) => setAddPeerId(e.target.value)}
              placeholder="12D3KooW..."
              className="w-full px-4 py-2.5 rounded-xl bg-surface-container text-on-surface placeholder:text-on-surface-variant/50 font-body text-sm border-none focus:outline-none focus:ring-1 focus:ring-primary/30 transition-colors"
            />
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => { setShowAddDialog(false); setAddPeerId(""); }}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!addPeerId.trim()}
                onClick={() => {
                  void sendRequest(addPeerId.trim());
                  setShowAddDialog(false);
                  setAddPeerId("");
                }}
              >
                Send Request
              </Button>
            </div>
          </GlassPanel>
        </div>
      )}
    </div>
  );
}

/* ── Friend Section ──────────────────────────────────────── */

function FriendSection({
  label,
  status,
  friends,
  trustMap,
  onMessage,
  onRemove,
}: {
  label: string;
  status: PresenceStatus;
  friends: FriendPayload[];
  trustMap: Record<string, TrustInfo>;
  onMessage: (peerId: string) => void;
  onRemove: (peerId: string) => void;
}) {
  const statusColor =
    status === "online"
      ? "text-secondary"
      : status === "away"
        ? "text-[#f59e0b]"
        : status === "dnd"
          ? "text-error"
          : "text-on-surface-variant/50";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className={`font-label text-xs uppercase tracking-wider ${statusColor}`}>
          {label}
        </span>
        <span className="text-[10px] text-on-surface-variant font-body">
          {friends.length}
        </span>
      </div>
      <div className="space-y-1.5">
        {friends.map((f) => (
          <FriendCard
            key={f.peerId}
            friend={f}
            trust={trustMap[f.peerId]}
            onMessage={() => onMessage(f.peerId)}
            onRemove={() => onRemove(f.peerId)}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Friend Card ────────────────────────────────────────── */

function FriendCard({
  friend,
  trust,
  onMessage,
  onRemove,
}: {
  friend: FriendPayload;
  trust?: TrustInfo;
  onMessage: () => void;
  onRemove: () => void;
}) {
  const displayName = friend.displayName ?? friend.aliasName ?? shortenPeerId(friend.peerId);

  const presenceDotColor =
    friend.presenceStatus === "online"
      ? "bg-secondary"
      : friend.presenceStatus === "away"
        ? "bg-[#f59e0b]"
        : friend.presenceStatus === "dnd"
          ? "bg-error"
          : "bg-outline-variant";

  return (
    <GlassPanel className="p-3">
      <div className="flex items-center gap-3">
        {/* Avatar + presence */}
        <div className="relative shrink-0">
          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
            <span className="material-symbols-outlined text-primary text-lg">
              person
            </span>
          </div>
          <span
            className={`absolute bottom-0 right-0 w-2 h-2 rounded-full border-2 border-surface ${presenceDotColor}`}
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-label font-medium text-on-surface truncate">
              {displayName}
            </p>
            {trust && <TrustBadge level={trust.badge} size="sm" />}
            {friend.isMutual && (
              <span className="text-[10px] text-secondary font-label">Mutual</span>
            )}
          </div>
          <p className="text-[10px] text-on-surface-variant font-body truncate">
            {shortenPeerId(friend.peerId)}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onMessage}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors text-xs font-label"
          >
            <span className="material-symbols-outlined text-sm">chat</span>
            Message
          </button>
          <button
            className="flex items-center justify-center w-8 h-8 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
            title="Voice call"
          >
            <span className="material-symbols-outlined text-sm">call</span>
          </button>
          <button
            onClick={onRemove}
            className="flex items-center justify-center w-8 h-8 rounded-lg text-on-surface-variant hover:text-error hover:bg-error/10 transition-colors"
            title="Remove friend"
          >
            <span className="material-symbols-outlined text-sm">person_remove</span>
          </button>
        </div>
      </div>
    </GlassPanel>
  );
}

export default FriendsPage;
