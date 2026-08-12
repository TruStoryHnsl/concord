import { describe, expect, it } from "vitest";
import {
  dmToConversation,
  enrichPeersWithInbox,
  mergeConversations,
  peerToConversation,
  useHomeFeedStore,
  type Conversation,
  type PeerInboxConversationInput,
} from "../homeFeed";

/**
 * Wave 2 (live conversations) — merged-feed contract tests, written from
 * the USER's view of the Chats list:
 *
 *   - a peer I've been chatting with shows the LAST MESSAGE and an UNREAD
 *     badge on its row (the p2p inbox enriches the bare pairing row);
 *   - a new message BUMPS that row above stale conversations;
 *   - a conversation with a peer that no longer sits in the pairing
 *     registry still shows up (it must never silently disappear);
 *   - and tapping a peer row lands on the native chat surface (store
 *     routing), never the old pairing-panel handoff.
 *
 * Domains/ids use test-only fixtures.
 */

function inboxConv(
  over: Partial<PeerInboxConversationInput> & { peerId: string },
): PeerInboxConversationInput {
  return {
    displayName: `Peer ${over.peerId}`,
    unreadCount: 0,
    lastActivityTs: 0,
    ...over,
  };
}

describe("enrichPeersWithInbox — what an inbox conversation does to a peer row", () => {
  it("the row shows the last message preview and the unread badge", () => {
    const peers = [
      peerToConversation({
        peerId: "12D3-alpha",
        displayName: "Peer 12D3-alpha",
        lastActivityTs: 1_000,
        online: true,
      }),
    ];
    const [row] = enrichPeersWithInbox(peers, [
      inboxConv({
        peerId: "12D3-alpha",
        preview: "see you at the porch",
        unreadCount: 3,
        lastActivityTs: 5_000,
        timestamp: "10:42 AM",
      }),
    ]);
    expect(row.preview).toBe("see you at the porch");
    expect(row.unreadCount).toBe(3);
    // Message activity supersedes the pairing "last seen".
    expect(row.lastActivityTs).toBe(5_000);
    expect(row.timestamp).toBe("10:42 AM");
    // Presence + identity from the pairing row survive the enrichment.
    expect(row.presence).toBe("online");
    expect(row.target).toEqual({ kind: "peer", peerId: "12D3-alpha" });
  });

  it("a fresher pairing 'last seen' is not dragged backward by an older message", () => {
    const peers = [
      peerToConversation({
        peerId: "12D3-beta",
        displayName: "Peer 12D3-beta",
        lastActivityTs: 9_000,
        online: true,
      }),
    ];
    const [row] = enrichPeersWithInbox(peers, [
      inboxConv({
        peerId: "12D3-beta",
        preview: "old hello",
        unreadCount: 1,
        lastActivityTs: 2_000,
      }),
    ]);
    expect(row.lastActivityTs).toBe(9_000);
    // The preview + badge still surface — the user sees the conversation.
    expect(row.preview).toBe("old hello");
    expect(row.unreadCount).toBe(1);
  });

  it("a conversation with a peer missing from the registry still gets a row", () => {
    const rows = enrichPeersWithInbox(
      [],
      [
        inboxConv({
          peerId: "12D3-ghost",
          displayName: "Peer 12D3-ghost",
          preview: "am I still here?",
          unreadCount: 2,
          lastActivityTs: 4_000,
        }),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("peer");
    expect(rows[0].displayName).toBe("Peer 12D3-ghost");
    expect(rows[0].preview).toBe("am I still here?");
    expect(rows[0].unreadCount).toBe(2);
    // Tapping it must still open the 1:1 conversation.
    expect(rows[0].target).toEqual({ kind: "peer", peerId: "12D3-ghost" });
  });

  it("never duplicates: one peer = one row, even with both sources present", () => {
    const peers = [
      peerToConversation({
        peerId: "12D3-alpha",
        displayName: "Peer 12D3-alpha",
        lastActivityTs: 1_000,
        online: false,
      }),
    ];
    const rows = enrichPeersWithInbox(peers, [
      inboxConv({ peerId: "12D3-alpha", lastActivityTs: 2_000 }),
    ]);
    expect(rows.filter((r) => r.id === "peer:12D3-alpha")).toHaveLength(1);
  });

  it("leaves non-peer rows and unmatched peers untouched", () => {
    const dm = dmToConversation({
      roomId: "!r:example.test",
      userId: "@d:example.test",
      displayName: "Dana",
      unreadCount: 0,
      lastActivityTs: 100,
    });
    const bare = peerToConversation({
      peerId: "12D3-quiet",
      displayName: "Peer 12D3-quiet",
      lastActivityTs: 50,
      online: false,
    });
    const rows = enrichPeersWithInbox([dm, bare], [
      inboxConv({ peerId: "12D3-other", lastActivityTs: 10 }),
    ]);
    expect(rows).toContainEqual(dm);
    expect(rows).toContainEqual(bare);
  });
});

describe("merged feed ordering — a new message bumps the conversation", () => {
  it("an enriched peer row rises above a stale DM after a fresh message", () => {
    const dm = dmToConversation({
      roomId: "!r:example.test",
      userId: "@d:example.test",
      displayName: "Dana",
      unreadCount: 0,
      lastActivityTs: 3_000,
    });
    const peers = enrichPeersWithInbox(
      [
        peerToConversation({
          peerId: "12D3-alpha",
          displayName: "Peer 12D3-alpha",
          lastActivityTs: 1_000,
          online: true,
        }),
      ],
      [
        inboxConv({
          peerId: "12D3-alpha",
          preview: "just landed",
          unreadCount: 1,
          lastActivityTs: 8_000,
        }),
      ],
    );
    const order = mergeConversations({ dms: [dm], peers }).map(
      (r) => r.displayName,
    );
    expect(order).toEqual(["Peer 12D3-alpha", "Dana"]);
  });
});

describe("opening a peer row — where the user lands", () => {
  function peerRow(): Conversation {
    return enrichPeersWithInbox(
      [
        peerToConversation({
          peerId: "12D3-alpha",
          displayName: "Peer 12D3-alpha",
          lastActivityTs: 1_000,
          online: true,
        }),
      ],
      [inboxConv({ peerId: "12D3-alpha", preview: "hey", lastActivityTs: 2_000 })],
    )[0];
  }

  it("tapping a peer row opens the NATIVE chat surface (no pairing-panel handoff)", () => {
    useHomeFeedStore.setState({
      surface: "home",
      pendingOpen: null,
      activeChat: null,
      dockerHandoff: null,
      selectedConversationId: null,
    });
    useHomeFeedStore.getState().openConversation(peerRow());
    const s = useHomeFeedStore.getState();
    // The front door swaps to the chat surface for THIS peer…
    expect(s.surface).toBe("native-chat");
    expect(s.activeChat?.kind).toBe("peer");
    expect(s.activeChat?.peerId).toBe("12D3-alpha");
    expect(s.activeChat?.displayName).toBe("Peer 12D3-alpha");
    // …and does NOT raise the old ChatLayout handoff intent.
    expect(s.pendingOpen).toBeNull();
    expect(s.dockerHandoff).toBeNull();
  });

  it("a raw peer intent (defensive ChatLayout fallback) lands on the same surface", () => {
    useHomeFeedStore.setState({
      surface: "handoff",
      pendingOpen: { kind: "peer", peerId: "12D3-alpha" },
      activeChat: null,
      dockerHandoff: null,
      selectedConversationId: null,
    });
    // ChatLayout's `case "peer"` routes any stray intent here.
    useHomeFeedStore.getState().openPeerChat("12D3-alpha");
    const s = useHomeFeedStore.getState();
    expect(s.surface).toBe("native-chat");
    expect(s.activeChat?.kind).toBe("peer");
    expect(s.activeChat?.peerId).toBe("12D3-alpha");
    expect(s.pendingOpen).toBeNull();
  });
});
