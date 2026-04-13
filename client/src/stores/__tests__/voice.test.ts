import { beforeEach, describe, expect, it } from "vitest";
import { useAuthStore } from "../auth";
import {
  clearPendingVoiceSession,
  getPendingVoiceSession,
  useVoiceStore,
} from "../voice";

describe("useVoiceStore session persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    useAuthStore.setState({
      client: null,
      userId: "@tester:concorrd.com",
      accessToken: "token",
      isLoggedIn: true,
      isLoading: false,
      syncing: false,
    });
    useVoiceStore.setState({
      connected: false,
      connectionState: "disconnected",
      reconnectAttempt: 0,
      token: null,
      livekitUrl: null,
      iceServers: [],
      serverId: null,
      serverName: null,
      channelId: null,
      channelName: null,
      roomName: null,
      returnChannelId: null,
      returnChannelName: null,
      micGranted: false,
      statsSessionId: null,
    });
  });

  it("persists the full reconnect context for the current user", () => {
    useVoiceStore.getState().connect({
      token: "lk-token",
      livekitUrl: "wss://livekit.concorrd.com/livekit/",
      iceServers: [],
      serverId: "federated:discord_689673845279293457",
      serverName: "Concord Testers",
      channelId: "!0HioYNQoSymZ0kG1pO:concorrd.com",
      channelName: "voice-ops",
      roomName: "!0HioYNQoSymZ0kG1pO:concorrd.com",
      returnChannelId: "!general:concorrd.com",
      returnChannelName: "general",
      micGranted: true,
    });

    expect(getPendingVoiceSession()).toEqual({
      serverId: "federated:discord_689673845279293457",
      serverName: "Concord Testers",
      channelId: "!0HioYNQoSymZ0kG1pO:concorrd.com",
      channelName: "voice-ops",
      roomName: "!0HioYNQoSymZ0kG1pO:concorrd.com",
      returnChannelId: "!general:concorrd.com",
      returnChannelName: "general",
    });
  });

  it("clears the persisted reconnect context on explicit disconnect", () => {
    useVoiceStore.getState().connect({
      token: "lk-token",
      livekitUrl: "wss://livekit.concorrd.com/livekit/",
      iceServers: [],
      serverId: "srv_1",
      serverName: "Concord",
      channelId: "!voice:concorrd.com",
      channelName: "voice",
      roomName: "!voice:concorrd.com",
      returnChannelId: "!general:concorrd.com",
      returnChannelName: "general",
      micGranted: true,
    });

    useVoiceStore.getState().disconnect();

    expect(getPendingVoiceSession()).toBeNull();
  });

  it("can clear a stale session payload directly", () => {
    window.localStorage.setItem(
      "concord_voice_session:@tester:concorrd.com",
      JSON.stringify({
        serverId: "srv_1",
        channelId: "!voice:concorrd.com",
        channelName: "voice",
        roomName: "!voice:concorrd.com",
      }),
    );

    clearPendingVoiceSession();

    expect(getPendingVoiceSession()).toBeNull();
  });
});
