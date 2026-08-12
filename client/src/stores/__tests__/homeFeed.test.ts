import { describe, it, expect, beforeEach } from "vitest";
import {
  dmToConversation,
  peerToConversation,
  sourceToConversation,
  localToConversation,
  mergeConversations,
  sortConversations,
  filterConversations,
  useHomeFeedStore,
  type Conversation,
} from "../homeFeed";
import type { ConcordSource } from "../sources";

/**
 * Cold-session tests (Cycle 3 / WS-F) for the native Home conversation feed.
 *
 * These assert what a USER ends up SEEING in the Home list — the rows that
 * appear, the ORDER they appear in, what the search box and filter tabs
 * hide/show — and what HAPPENS when a user taps a row (which surface the
 * front door switches to and what identity the handoff/chat header carries).
 * They drive the real merge/sort/filter mappers and the real store action,
 * never an abstract restatement of internals.
 *
 * Domains in fixtures use `example.test` only — never a real instance.
 */

function makeSource(over: Partial<ConcordSource>): ConcordSource {
  return {
    id: "s1",
    host: "chat.example.test",
    inviteToken: "",
    apiBase: "https://chat.example.test",
    homeserverUrl: "https://chat.example.test",
    status: "connected",
    enabled: true,
    addedAt: "2026-06-29T12:00:00.000Z",
    platform: "concord",
    ...over,
  } as ConcordSource;
}

describe("homeFeed mappers — the rows a user sees", () => {
  it("a DM becomes a row labelled with the other party and its last message", () => {
    const row = dmToConversation({
      roomId: "!room:example.test",
      userId: "@dana:example.test",
      displayName: "Dana",
      preview: "see you tomorrow",
      unreadCount: 2,
      lastActivityTs: 1_000,
      timestamp: "10:42 AM",
    });
    expect(row.kind).toBe("dm");
    expect(row.displayName).toBe("Dana");
    expect(row.preview).toBe("see you tomorrow");
    expect(row.unreadCount).toBe(2);
    // Tapping it must open the matrix room the messages live in.
    expect(row.target).toEqual({
      kind: "dm",
      roomId: "!room:example.test",
      sourceId: undefined,
    });
  });

  it("a docker source becomes a business row that opens that source's drill-down", () => {
    const src = makeSource({
      id: "acme",
      host: "chat.acme.example.test",
      instanceName: "Acme Chat",
    });
    const row = sourceToConversation(src);
    expect(row.kind).toBe("docker");
    // The user sees the friendly instance name, not the raw host.
    expect(row.displayName).toBe("Acme Chat");
    // The row carries the branding ref the business-chat treatment renders.
    expect(row.source?.instanceName).toBe("Acme Chat");
    // Tapping it routes into THIS source's existing server UI.
    expect(row.target).toEqual({ kind: "docker", sourceId: "acme" });
  });

  it("a disconnected source's preview tells the user it isn't connected", () => {
    const row = sourceToConversation(
      makeSource({ id: "beta", host: "beta.example.test", status: "connecting", instanceName: undefined }),
    );
    expect(row.preview).toBe("beta.example.test · connecting");
  });
});

describe("homeFeed ordering — what floats to the top of the list", () => {
  it("pinned rows sit above everything, then most-recent, then alphabetical on ties", () => {
    const rows: Conversation[] = [
      dmToConversation({ roomId: "!a", userId: "@a:x", displayName: "Zara", unreadCount: 0, lastActivityTs: 500 }),
      dmToConversation({ roomId: "!b", userId: "@b:x", displayName: "Older", unreadCount: 0, lastActivityTs: 100 }),
      dmToConversation({ roomId: "!c", userId: "@c:x", displayName: "Newest", unreadCount: 0, lastActivityTs: 900 }),
      dmToConversation({ roomId: "!d", userId: "@d:x", displayName: "Pinned-old", unreadCount: 0, lastActivityTs: 50, pinned: true }),
      // Same ts as Zara → tie broken by name ("Allan" before "Zara").
      dmToConversation({ roomId: "!e", userId: "@e:x", displayName: "Allan", unreadCount: 0, lastActivityTs: 500 }),
    ];
    const order = sortConversations(rows).map((r) => r.displayName);
    expect(order).toEqual(["Pinned-old", "Newest", "Allan", "Zara", "Older"]);
  });

  it("the porch leads when it is the most-recently-active row", () => {
    // The hook stamps the local porch with `now`, so on a fresh feed it
    // out-ranks an older docker source (sorted by recency).
    const local = localToConversation({ label: "My Porch", lastActivityTs: Date.now() });
    const docker = sourceToConversation(
      makeSource({ id: "acme", instanceName: "Acme", addedAt: "2020-01-01T00:00:00.000Z" }),
    );
    const merged = mergeConversations({ local, dockers: [docker] });
    expect(merged.map((r) => r.kind)).toEqual(["local", "docker"]);
  });
});

describe("homeFeed search + filter — what the box and tabs hide", () => {
  const list: Conversation[] = [
    dmToConversation({ roomId: "!a", userId: "@a:x", displayName: "Dana", preview: "lunch?", unreadCount: 3, lastActivityTs: 5 }),
    peerToConversation({ peerId: "peer-xyz", displayName: "Peer abc", lastActivityTs: 4, online: true }),
    sourceToConversation(makeSource({ id: "acme", instanceName: "Acme Chat" })),
    localToConversation({ label: "My Porch", lastActivityTs: 3 }),
  ];

  it("'People' shows only peers + DMs", () => {
    const kinds = filterConversations(list, "", "people").map((r) => r.kind);
    expect(kinds.sort()).toEqual(["dm", "peer"]);
  });

  it("'Sources' shows only docker + local", () => {
    const kinds = filterConversations(list, "", "sources").map((r) => r.kind).sort();
    expect(kinds).toEqual(["docker", "local"]);
  });

  it("'Unread' shows only rows with a badge", () => {
    const rows = filterConversations(list, "", "unread");
    expect(rows).toHaveLength(1);
    expect(rows[0].displayName).toBe("Dana");
  });

  it("typing in search matches name and preview, case-insensitively", () => {
    expect(filterConversations(list, "acme", "all").map((r) => r.displayName)).toEqual(["Acme Chat"]);
    // matches against the preview text, not just the name
    expect(filterConversations(list, "LUNCH", "all").map((r) => r.displayName)).toEqual(["Dana"]);
  });
});

describe("openConversation — which surface a tapped row opens", () => {
  beforeEach(() => {
    useHomeFeedStore.setState({
      surface: "home",
      activeChat: null,
      dockerHandoff: null,
      pendingOpen: null,
      selectedConversationId: null,
    });
  });

  it("tapping a DM opens the native messenger chat surface for its room", () => {
    const dm = dmToConversation({
      roomId: "!room:example.test",
      userId: "@dana:example.test",
      displayName: "Dana",
      unreadCount: 0,
      lastActivityTs: 1,
    });
    useHomeFeedStore.getState().openConversation(dm);
    const s = useHomeFeedStore.getState();
    expect(s.surface).toBe("native-chat");
    expect(s.activeChat?.roomId).toBe("!room:example.test");
    expect(s.activeChat?.displayName).toBe("Dana");
    expect(s.dockerHandoff).toBeNull();
  });

  it("tapping a docker row hands off to that source with its identity in the chip", () => {
    const docker = sourceToConversation(
      makeSource({ id: "acme", instanceName: "Acme Chat", host: "chat.acme.example.test" }),
    );
    useHomeFeedStore.getState().openConversation(docker);
    const s = useHomeFeedStore.getState();
    expect(s.surface).toBe("handoff");
    expect(s.pendingOpen).toEqual({ kind: "docker", sourceId: "acme" });
    expect(s.dockerHandoff?.sourceId).toBe("acme");
    expect(s.dockerHandoff?.title).toBe("Acme Chat");
    expect(s.activeChat).toBeNull();
  });

  it("tapping the local porch reveals the porch drill-down (no native chat)", () => {
    const local = localToConversation({ label: "My Porch", lastActivityTs: 1 });
    useHomeFeedStore.getState().openConversation(local);
    const s = useHomeFeedStore.getState();
    expect(s.surface).toBe("handoff");
    expect(s.pendingOpen).toEqual({ kind: "local", sourceId: undefined });
    expect(s.activeChat).toBeNull();
  });

  it("goHome returns to the list and clears any open chat/handoff", () => {
    const docker = sourceToConversation(makeSource({ id: "acme" }));
    useHomeFeedStore.getState().openConversation(docker);
    useHomeFeedStore.getState().goHome();
    const s = useHomeFeedStore.getState();
    expect(s.surface).toBe("home");
    expect(s.dockerHandoff).toBeNull();
    expect(s.activeChat).toBeNull();
  });
});
