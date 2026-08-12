/**
 * Cold-session coverage for WebPeerHistory — the BROWSER threaded
 * messenger (D1/D3/D4) in client/src/components/social/WebPeerHistory.tsx.
 *
 * N2 cold-reader test. What a web user SEES and DOES is the assertion:
 *   - the conversation list populates from /api/me/conversations,
 *   - selecting a conversation shows its history, and that history folds a
 *     device-ROAMED message next to a PILLAR message in one thread (the D1
 *     unify — the browser doesn't care which source; it shows both),
 *   - typing + Send calls the POST endpoint and the sent line appears
 *     in-thread (a real messenger, not a one-shot sender).
 *
 * The api/conversations.ts layer is mocked (per the N2 brief) so the test
 * pins the component's user-facing behavior, not the server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const PEER = "reticulum:" + "ab".repeat(16);

const listConversations = vi.fn();
const fetchConversationMessages = vi.fn();
const sendConversationMessage = vi.fn();
const listContacts = vi.fn();
const deleteConversation = vi.fn();
const deleteContact = vi.fn();
const upsertContact = vi.fn();
const exportConversations = vi.fn();

vi.mock("../../../api/conversations", () => ({
  listConversations: (...a: unknown[]) => listConversations(...a),
  fetchConversationMessages: (...a: unknown[]) => fetchConversationMessages(...a),
  sendConversationMessage: (...a: unknown[]) => sendConversationMessage(...a),
  listContacts: (...a: unknown[]) => listContacts(...a),
  deleteConversation: (...a: unknown[]) => deleteConversation(...a),
  deleteContact: (...a: unknown[]) => deleteContact(...a),
  upsertContact: (...a: unknown[]) => upsertContact(...a),
  exportConversations: (...a: unknown[]) => exportConversations(...a),
}));

import { WebPeerHistory } from "../WebPeerHistory";
import { useAuthStore } from "../../../stores/auth";

function convo(over: Record<string, unknown> = {}) {
  return {
    peer_key: PEER,
    persona_id: "bob-persona",
    label: "Mesh Bob",
    last_preview: "sent from my phone",
    last_message_at: "2026-08-12T00:00:02Z",
    sources: ["pillar", "roamed"],
    ...over,
  };
}

describe("WebPeerHistory — the browser threaded messenger", () => {
  beforeEach(() => {
    useAuthStore.setState({ accessToken: "web-token" });
    listConversations.mockResolvedValue([convo()]);
    listContacts.mockResolvedValue([]);
    fetchConversationMessages.mockResolvedValue([
      {
        id: "roamed-1",
        peer_key: PEER,
        direction: "in",
        body: "sent from my phone",
        payload_b64: null,
        from_name: "bob",
        channel: "roamed",
        state: "delivered",
        wire_id: "roamed-1",
        at: "2026-08-12T00:00:01Z",
        source: "roamed",
      },
      {
        id: "pillar-1",
        peer_key: PEER,
        direction: "out",
        body: "browser reply through the pillar",
        payload_b64: null,
        from_name: "alice",
        channel: "reticulum",
        state: "sent",
        wire_id: "pillar-1",
        at: "2026-08-12T00:00:02Z",
        source: "pillar",
      },
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    useAuthStore.setState({ accessToken: null });
  });

  it("lists conversations, and a selected thread folds roamed + pillar messages", async () => {
    render(<WebPeerHistory tab="messages" />);

    // The conversation list populates from /api/me/conversations.
    const convoBtn = await screen.findByTestId(`web-convo-${PEER}`);
    expect(within(convoBtn).getByText("Mesh Bob")).toBeInTheDocument();

    // Open the thread.
    await userEvent.click(convoBtn);

    // The D1 unify, from the user's chair: one thread shows the message
    // their phone pushed AND the reply they sent from the browser.
    const thread = await screen.findByTestId("web-convo-messages");
    await waitFor(() =>
      expect(within(thread).getByText("sent from my phone")).toBeInTheDocument(),
    );
    expect(
      within(thread).getByText("browser reply through the pillar"),
    ).toBeInTheDocument();
    expect(fetchConversationMessages).toHaveBeenCalledWith("web-token", PEER);
  });

  it("sending from the composer calls the POST endpoint and shows the line in-thread", async () => {
    sendConversationMessage.mockResolvedValue({
      id: "new-send",
      peer_key: PEER,
      direction: "out",
      body: "hello over the mesh",
      payload_b64: null,
      from_name: "alice",
      channel: "reticulum",
      state: "sent",
      wire_id: "new-send",
      at: "2026-08-12T00:00:05Z",
      source: "pillar",
    });

    render(<WebPeerHistory tab="messages" />);
    await userEvent.click(await screen.findByTestId(`web-convo-${PEER}`));
    await screen.findByTestId("web-convo-messages");

    const composer = screen.getByTestId("web-convo-composer");
    await userEvent.type(composer, "hello over the mesh");
    await userEvent.click(screen.getByTestId("web-convo-send"));

    // It hit the POST-backed send with the typed body...
    await waitFor(() => expect(sendConversationMessage).toHaveBeenCalledTimes(1));
    const [tok, peer, params] = sendConversationMessage.mock.calls[0];
    expect(tok).toBe("web-token");
    expect(peer).toBe(PEER);
    expect((params as { body: string }).body).toBe("hello over the mesh");

    // ...and the sent line appears in the thread.
    const thread = screen.getByTestId("web-convo-messages");
    await waitFor(() =>
      expect(within(thread).getByText("hello over the mesh")).toBeInTheDocument(),
    );
  });

  it("the peers tab renders the learned known-peers registry", async () => {
    listContacts.mockResolvedValue([
      {
        peer_key: PEER,
        persona_id: "bob-persona",
        label: "Mesh Bob",
        trust: "verified",
        source: "mesh_send",
        last_seen: "2026-08-12T00:00:00Z",
      },
    ]);
    render(<WebPeerHistory tab="peers" />);
    const panel = await screen.findByTestId("web-peer-contacts");
    await waitFor(() =>
      expect(within(panel).getByDisplayValue("Mesh Bob")).toBeInTheDocument(),
    );
    expect(listContacts).toHaveBeenCalledWith("web-token");
  });
});
