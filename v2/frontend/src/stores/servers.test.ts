import { describe, it, expect, beforeEach } from "vitest";
import { useServersStore } from "./servers";

describe("useServersStore", () => {
  beforeEach(() => {
    // Reset the store between tests
    useServersStore.setState({
      servers: [],
      activeServerId: null,
      activeChannelId: null,
      channels: [],
      members: [],
      messages: [],
      loadingServers: false,
      loadingChannels: false,
      loadingMessages: false,
    });
  });

  it("addMessage deduplicates by id", () => {
    const store = useServersStore.getState();

    // Set an active channel so messages are accepted
    useServersStore.setState({ activeChannelId: "ch1" });

    const msg = {
      id: "m1",
      channelId: "ch1",
      senderId: "peer1",
      content: "hello",
      timestamp: Date.now(),
    };

    store.addMessage(msg);
    expect(useServersStore.getState().messages).toHaveLength(1);

    // Adding the same message again should not duplicate
    useServersStore.getState().addMessage(msg);
    expect(useServersStore.getState().messages).toHaveLength(1);
  });

  it("addMessage ignores messages from non-active channels", () => {
    useServersStore.setState({ activeChannelId: "ch1" });

    const msg = {
      id: "m1",
      channelId: "ch2", // different from active channel
      senderId: "peer1",
      content: "hello",
      timestamp: Date.now(),
    };

    useServersStore.getState().addMessage(msg);
    expect(useServersStore.getState().messages).toHaveLength(0);
  });

  it("clearActiveServer resets all active state", () => {
    useServersStore.setState({
      activeServerId: "srv1",
      activeChannelId: "ch1",
      channels: [{ id: "ch1", serverId: "srv1", name: "general", channelType: "text" }],
      members: [{ peerId: "peer1", role: "member", joinedAt: Date.now() }],
      messages: [
        {
          id: "m1",
          channelId: "ch1",
          senderId: "peer1",
          content: "hi",
          timestamp: Date.now(),
        },
      ],
    });

    useServersStore.getState().clearActiveServer();

    const state = useServersStore.getState();
    expect(state.activeServerId).toBeNull();
    expect(state.activeChannelId).toBeNull();
    expect(state.channels).toHaveLength(0);
    expect(state.members).toHaveLength(0);
    expect(state.messages).toHaveLength(0);
  });

  it("removeServer clears active state if removing the active server", () => {
    useServersStore.setState({
      servers: [
        { id: "srv1", name: "Server One", ownerId: "me", visibility: "public", channels: [], memberCount: 1 },
        { id: "srv2", name: "Server Two", ownerId: "me", visibility: "public", channels: [], memberCount: 1 },
      ],
      activeServerId: "srv1",
      activeChannelId: "ch1",
    });

    useServersStore.getState().removeServer("srv1");

    const state = useServersStore.getState();
    expect(state.servers).toHaveLength(1);
    expect(state.servers[0]!.id).toBe("srv2");
    expect(state.activeServerId).toBeNull();
    expect(state.activeChannelId).toBeNull();
  });

  it("addServer deduplicates by server id", () => {
    const server = {
      id: "srv1",
      name: "Server One",
      ownerId: "me",
      visibility: "public" as const,
      channels: [],
      memberCount: 1,
    };

    useServersStore.getState().addServer(server);
    expect(useServersStore.getState().servers).toHaveLength(1);

    // Adding the same server again should not duplicate
    useServersStore.getState().addServer(server);
    expect(useServersStore.getState().servers).toHaveLength(1);
  });
});
