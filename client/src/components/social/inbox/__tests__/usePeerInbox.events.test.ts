/**
 * Wave 2 (live conversations) — usePeerInbox reacts to the Rust-emitted
 * inbox events WITHOUT any manual refresh.
 *
 * Only the Tauri boundaries are mocked (invoke + listen, following the
 * lanPeers/peerStore test pattern); the hook's real body runs. The events
 * are fired exactly as `src-tauri/src/commands/events.rs` emits them:
 *   - `social_inbox_message`   payload `{ peerId }`            (inbound recorded)
 *   - `social_inbox_delivered` payload `{ peerId, messageId }` (outbound confirmed)
 *
 * Asserted from the user's side:
 *   - an inbound for a CLOSED conversation re-pulls the list → unread badge
 *     data updates;
 *   - an inbound for the OPEN conversation reloads the transcript (the new
 *     message appears) and clears its unread (mark-read while looking);
 *   - a delivered confirmation flips the pending outbound row to delivered.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ConversationRecord, InboxMessage } from "../../../../api/social/types";

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
// Force the hook's isTauri() guard on so the subscription path runs in jsdom.
vi.mock("../../../../api/servitude", () => ({ isTauri: () => true }));

import { usePeerInbox } from "../usePeerInbox";

type Handler = (event: { payload: unknown }) => void;

/** Captured event handlers keyed by event name, installed via listenMock. */
let handlers: Map<string, Handler>;

async function waitForHandlers(): Promise<void> {
  await waitFor(() => {
    expect(handlers.has("social_inbox_message")).toBe(true);
    expect(handlers.has("social_inbox_delivered")).toBe(true);
  });
}

function fire(event: string, payload: unknown) {
  const handler = handlers.get(event);
  if (!handler) throw new Error(`no handler installed for ${event}`);
  act(() => handler({ payload }));
}

/** Mutable backend the invoke mock serves — tests mutate it between events. */
let conversations: ConversationRecord[];
let messagesByPeer: Record<string, InboxMessage[]>;

function msg(over: Partial<InboxMessage> & { id: string; peerId: string }): InboxMessage {
  return {
    direction: "inbound",
    body: "hello",
    sentAt: "2026-07-20T10:00:00Z",
    read: false,
    ...over,
  };
}

beforeEach(() => {
  handlers = new Map();
  conversations = [];
  messagesByPeer = {};
  listenMock.mockReset();
  listenMock.mockImplementation((event: string, handler: Handler) => {
    handlers.set(event, handler);
    return Promise.resolve(() => handlers.delete(event));
  });
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string, args?: { peerId?: string }) => {
    switch (cmd) {
      case "social_inbox_list":
        return Promise.resolve(conversations);
      case "social_inbox_get_messages":
        return Promise.resolve(messagesByPeer[args?.peerId ?? ""] ?? []);
      case "social_inbox_mark_read": {
        const conv = conversations.find((c) => c.peerId === args?.peerId);
        if (!conv) return Promise.reject(new Error("NotFound"));
        conv.unread = 0;
        return Promise.resolve(conv);
      }
      default:
        return Promise.reject(new Error(`unexpected command ${cmd}`));
    }
  });
});

describe("usePeerInbox — event-driven live refresh", () => {
  it("an inbound for a closed conversation bumps its unread badge, hands-free", async () => {
    const { result } = renderHook(() => usePeerInbox());
    await waitForHandlers();
    await waitFor(() => expect(result.current.loadingList).toBe(false));
    expect(result.current.conversations).toEqual([]);

    // A message from afar arrives: the backend now has a conversation…
    conversations = [
      {
        peerId: "12D3-remote",
        unread: 1,
        lastMessageAt: "2026-07-20T10:00:00Z",
        lastPreview: "knock knock",
      },
    ];
    // …and the swarm announces it.
    fire("social_inbox_message", { peerId: "12D3-remote" });

    // The list refreshes on its own — the user sees the badge appear.
    await waitFor(() => {
      expect(result.current.conversations).toHaveLength(1);
    });
    expect(result.current.conversations[0].unread).toBe(1);
    expect(result.current.conversations[0].lastPreview).toBe("knock knock");
  });

  it("an inbound for the OPEN conversation shows the new message and clears its unread", async () => {
    conversations = [
      { peerId: "12D3-open", unread: 0, lastMessageAt: null, lastPreview: null },
    ];
    messagesByPeer["12D3-open"] = [msg({ id: "m1", peerId: "12D3-open" })];

    const { result } = renderHook(() => usePeerInbox());
    await waitForHandlers();
    act(() => result.current.openConversation("12D3-open"));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    invokeMock.mockClear();

    // The peer sends another message while the user is looking.
    messagesByPeer["12D3-open"] = [
      msg({ id: "m1", peerId: "12D3-open" }),
      msg({ id: "m2", peerId: "12D3-open", body: "still there?" }),
    ];
    conversations[0].unread = 1;
    fire("social_inbox_message", { peerId: "12D3-open" });

    // The transcript grows without any manual refresh…
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(result.current.messages[1].body).toBe("still there?");
    // …and the open conversation is marked read (badge never sticks).
    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("social_inbox_mark_read", {
        peerId: "12D3-open",
      });
    });
    await waitFor(() =>
      expect(result.current.conversations[0]?.unread).toBe(0),
    );
  });

  it("a delivered confirmation flips the pending outbound row to delivered", async () => {
    conversations = [
      { peerId: "12D3-open", unread: 0, lastMessageAt: null, lastPreview: null },
    ];
    messagesByPeer["12D3-open"] = [
      msg({
        id: "out-1",
        peerId: "12D3-open",
        direction: "outbound",
        body: "on my way",
        delivery: "pending",
      }),
    ];

    const { result } = renderHook(() => usePeerInbox());
    await waitForHandlers();
    act(() => result.current.openConversation("12D3-open"));
    await waitFor(() =>
      expect(result.current.messages[0]?.delivery).toBe("pending"),
    );

    fire("social_inbox_delivered", {
      peerId: "12D3-open",
      messageId: "out-1",
    });

    // The user's bubble indicator flips pending → delivered.
    await waitFor(() =>
      expect(result.current.messages[0]?.delivery).toBe("delivered"),
    );
  });

  it("a delivered event for ANOTHER peer leaves the open transcript alone", async () => {
    conversations = [
      { peerId: "12D3-open", unread: 0, lastMessageAt: null, lastPreview: null },
    ];
    messagesByPeer["12D3-open"] = [
      msg({
        id: "out-1",
        peerId: "12D3-open",
        direction: "outbound",
        delivery: "pending",
      }),
    ];
    const { result } = renderHook(() => usePeerInbox());
    await waitForHandlers();
    act(() => result.current.openConversation("12D3-open"));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    fire("social_inbox_delivered", { peerId: "12D3-else", messageId: "out-1" });

    // Still pending — the confirmation belonged to a different conversation.
    await waitFor(() => expect(result.current.loadingList).toBe(false));
    expect(result.current.messages[0]?.delivery).toBe("pending");
  });
});
