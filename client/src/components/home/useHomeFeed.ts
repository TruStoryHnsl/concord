/**
 * useHomeFeed — React-side gathering for the native front-door feed.
 *
 * Reads the four existing stores (dm, peerStore, sources, plus the porch
 * instance name) and the matrix client, resolves the per-row presentation
 * bits (display names, unread counts, last-activity / preview), then hands
 * resolved inputs to the PURE mappers in `stores/homeFeed.ts`. The store
 * stays free of React/matrix imports so its merge/sort/filter contract is
 * unit-testable on its own; this hook is the impure adapter.
 *
 * It does NOT own selection — opening a row raises an intent on the
 * homeFeed store that ChatLayout consumes. This is a projection only.
 */

import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "../../stores/auth";
import { useDMStore } from "../../stores/dm";
import { usePeerStore } from "../../stores/peerStore";
import { useSourcesStore } from "../../stores/sources";
import { useInstanceNameStore } from "../../stores/instanceName";
import { useUnreadCounts } from "../../hooks/useUnreadCounts";
import { useDisplayNames } from "../../hooks/useDisplayName";
import { isTauri } from "../../api/servitude";
import {
  type Conversation,
  dmToConversation,
  peerToConversation,
  sourceToConversation,
  localToConversation,
  mergeConversations,
  isDockerConversationSource,
} from "../../stores/homeFeed";

const ONLINE_WINDOW_MS = 60_000;

/** Compact, locale-aware activity label. Empty when there's no activity. */
export function formatActivity(ts: number, now: number): string | undefined {
  if (!ts || ts <= 0) return undefined;
  const d = new Date(ts);
  const sameDay = new Date(now).toDateString() === d.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (now - ts < 7 * 24 * 60 * 60 * 1000) {
    return d.toLocaleDateString(undefined, { weekday: "short" });
  }
  return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric" });
}

/** Best-effort last-message preview + last-activity ts from the matrix room. */
function readRoom(
  client: ReturnType<typeof useAuthStore.getState>["client"],
  roomId: string,
): { preview?: string; ts: number } {
  try {
    const room = client?.getRoom(roomId);
    if (!room) return { ts: 0 };
    const lastActive = room.getLastActiveTimestamp?.() ?? 0;
    const events = room.getLiveTimeline().getEvents();
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.getType() === "m.room.message") {
        const body = ev.getContent()?.body;
        const ts = lastActive > 0 ? lastActive : ev.getTs();
        return { preview: typeof body === "string" ? body : undefined, ts };
      }
    }
    return { ts: lastActive > 0 ? lastActive : 0 };
  } catch {
    return { ts: 0 };
  }
}

function shortPeerId(peerId: string): string {
  if (peerId.length <= 12) return `Peer ${peerId}`;
  return `Peer ${peerId.slice(0, 6)}…${peerId.slice(-4)}`;
}

/**
 * The merged, sorted conversation feed. Filtering by the active query/tab
 * is done downstream by `HomeView` (it owns the search/filter props), so
 * this returns the full sorted list.
 */
export function useHomeFeed(): Conversation[] {
  const dms = useDMStore((s) => s.conversations);
  const pinnedRoomIds = useDMStore((s) => s.pinnedRoomIds);
  const loadConversations = useDMStore((s) => s.loadConversations);
  const knownPeers = usePeerStore((s) => s.knownPeers);
  const loadPeers = usePeerStore((s) => s.load);
  const sources = useSourcesStore((s) => s.sources);
  const unread = useUnreadCounts();
  const client = useAuthStore((s) => s.client);
  const accessToken = useAuthStore((s) => s.accessToken);
  const porchName = useInstanceNameStore((s) => s.name);
  // Live-ticking clock so relative row timestamps ("10:42 AM" → "Mon" →
  // "6/2") refresh without a remount. Cycle 2 fix: Cycle 1 froze `now` at
  // mount, so labels went stale until the feed re-rendered for another
  // reason. One 60s timer for the whole feed is cheap.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Kick the underlying loads so a cold front door populates. Both are
  // idempotent and safe to call on web; peers no-op without a porch.
  useEffect(() => {
    void loadPeers();
  }, [loadPeers]);
  useEffect(() => {
    if (accessToken) void loadConversations(accessToken);
  }, [accessToken, loadConversations]);

  const dmUserIds = useMemo(() => dms.map((d) => d.other_user_id), [dms]);
  const displayNames = useDisplayNames(dmUserIds);

  return useMemo(() => {
    const dmConvs = dms.map((d) => {
      const { preview, ts } = readRoom(client, d.matrix_room_id);
      const lastActivityTs =
        ts || (d.created_at ? Date.parse(d.created_at) : 0) || 0;
      return dmToConversation({
        roomId: d.matrix_room_id,
        userId: d.other_user_id,
        sourceId: d.sourceId,
        displayName:
          displayNames[d.other_user_id] ??
          d.other_user_id.split(":")[0].replace("@", ""),
        preview,
        unreadCount: unread.get(d.matrix_room_id) ?? 0,
        lastActivityTs,
        timestamp: formatActivity(lastActivityTs, now),
        pinned: pinnedRoomIds.includes(d.matrix_room_id),
      });
    });

    // Peers that already have a DM room shouldn't double up as a bare peer
    // row — the DM row supersedes. (Cycle 1 has no peer↔room linkage table,
    // so this is a no-op today, but the guard keeps the merge honest once
    // that linkage exists.)
    const peerConvs = knownPeers.map((p) => {
      const lastSeenTs = Date.parse(p.lastSeen);
      const ts = Number.isNaN(lastSeenTs) ? 0 : lastSeenTs;
      return peerToConversation({
        peerId: p.peerId,
        displayName: shortPeerId(p.peerId),
        lastActivityTs: ts,
        online: ts > 0 && now - ts < ONLINE_WINDOW_MS,
      });
    });

    const dockerConvs = sources
      .filter(isDockerConversationSource)
      .map(sourceToConversation);

    // The local porch only exists on native (web is already "inside" its
    // single instance). Always show one local row there.
    const local = isTauri()
      ? localToConversation({
          label: porchName.trim() || "My space",
          // Float the user's own place near the top of a fresh feed.
          lastActivityTs: now,
        })
      : null;

    return mergeConversations({
      dms: dmConvs,
      peers: peerConvs,
      dockers: dockerConvs,
      local,
    });
  }, [dms, knownPeers, sources, unread, client, displayNames, pinnedRoomIds, porchName, now]);
}
