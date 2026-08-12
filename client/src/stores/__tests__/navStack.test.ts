import { describe, it, expect, beforeEach } from "vitest";
import {
  useNavStack,
  rootFrame,
  buildStackToLevel,
  browseTabToStack,
  navTop,
  NAV_LEVEL_ORDER,
  type LegacyBrowseTab,
  type NavFrame,
} from "../navStack";

/**
 * Unit tests for the navStack store + the old-BrowseTab → NavStack mapper.
 *
 * These verify the stack OPERATIONS (push/pop/replaceTop/resetToLevel/
 * setOverlay) and the mapper produce the exact frame shapes the spec
 * requires — in particular the "branching-aware, NO reset-to-leftmost"
 * behavior: drilling in then popping must land on the SAME branch the user
 * came from, never collapse to `sources`.
 *
 * Verified against the data the navigation layer actually carries
 * (frame `level` + selection context), not abstract booleans.
 */

function resetStore() {
  useNavStack.setState({ stack: [rootFrame()], overlay: null });
}

describe("navStack — pure helpers", () => {
  it("rootFrame is a sources frame with empty selection context", () => {
    expect(rootFrame()).toEqual({
      level: "sources",
      sourceId: null,
      serverId: null,
      channelId: null,
      dmRoomId: null,
    });
  });

  it("NAV_LEVEL_ORDER is the canonical drill-down order", () => {
    expect(NAV_LEVEL_ORDER).toEqual(["sources", "servers", "channels", "chat"]);
  });

  it("buildStackToLevel synthesizes one frame per level up to the target", () => {
    const stack = buildStackToLevel("channels", {
      serverId: "srv1",
      sourceId: "src1",
    });
    expect(stack.map((f) => f.level)).toEqual(["sources", "servers", "channels"]);
    // Selection context is carried into every synthesized frame.
    for (const f of stack) {
      expect(f.serverId).toBe("srv1");
      expect(f.sourceId).toBe("src1");
    }
  });

  it("buildStackToLevel('sources') yields just the root", () => {
    expect(buildStackToLevel("sources").map((f) => f.level)).toEqual(["sources"]);
  });

  it("buildStackToLevel('chat') yields the full four-level path", () => {
    expect(buildStackToLevel("chat").map((f) => f.level)).toEqual(
      NAV_LEVEL_ORDER,
    );
  });
});

describe("navStack — stack operations", () => {
  beforeEach(resetStore);

  it("starts at depth 1 on the sources root", () => {
    const { stack } = useNavStack.getState();
    expect(stack).toHaveLength(1);
    expect(navTop({ stack }).level).toBe("sources");
  });

  it("push deepens the stack and inherits unspecified context", () => {
    useNavStack.getState().push({ level: "servers", serverId: "srv1" });
    useNavStack.getState().push({ level: "channels", channelId: "chanA" });
    const { stack } = useNavStack.getState();
    expect(stack.map((f) => f.level)).toEqual(["sources", "servers", "channels"]);
    // channels frame inherited serverId from the servers frame below it.
    expect(navTop({ stack }).serverId).toBe("srv1");
    expect(navTop({ stack }).channelId).toBe("chanA");
  });

  it("push of the SAME level replaces the top (sibling switch, no deepen)", () => {
    useNavStack.getState().push({ level: "servers", serverId: "srv1" });
    useNavStack.getState().push({ level: "channels", channelId: "chanA" });
    // Switch to a sibling channel — must NOT push a duplicate channels frame.
    useNavStack.getState().push({ level: "channels", channelId: "chanB" });
    const { stack } = useNavStack.getState();
    expect(stack.map((f) => f.level)).toEqual(["sources", "servers", "channels"]);
    expect(navTop({ stack }).channelId).toBe("chanB");
  });

  it("pop removes the top frame", () => {
    useNavStack.getState().push({ level: "servers", serverId: "srv1" });
    useNavStack.getState().push({ level: "channels", channelId: "chanA" });
    useNavStack.getState().pop();
    const { stack } = useNavStack.getState();
    expect(stack.map((f) => f.level)).toEqual(["sources", "servers"]);
  });

  it("pop at depth 1 is a no-op (root is permanent)", () => {
    useNavStack.getState().pop();
    const { stack } = useNavStack.getState();
    expect(stack).toHaveLength(1);
    expect(navTop({ stack }).level).toBe("sources");
  });

  it("CORE FIX: drill source→server→channel→chat then back lands on the same branch", () => {
    const nav = useNavStack.getState();
    nav.push({ level: "servers", sourceId: "src1" });
    nav.push({ level: "channels", serverId: "srvX" });
    nav.push({ level: "chat", channelId: "chanQ" });

    // We are in chat for channel chanQ on server srvX.
    let top = navTop(useNavStack.getState());
    expect(top.level).toBe("chat");
    expect(top.channelId).toBe("chanQ");
    expect(top.serverId).toBe("srvX");

    // Back once → the channels list for srvX (NOT sources).
    useNavStack.getState().pop();
    top = navTop(useNavStack.getState());
    expect(top.level).toBe("channels");
    expect(top.serverId).toBe("srvX");

    // Back again → the servers list for src1 (NOT sources).
    useNavStack.getState().pop();
    top = navTop(useNavStack.getState());
    expect(top.level).toBe("servers");
    expect(top.sourceId).toBe("src1");
  });

  it("replaceTop patches the top frame in place without changing depth", () => {
    useNavStack.getState().push({ level: "servers", serverId: "srv1" });
    useNavStack.getState().replaceTop({ serverId: "srv2" });
    const { stack } = useNavStack.getState();
    expect(stack).toHaveLength(2);
    expect(navTop({ stack }).serverId).toBe("srv2");
  });

  it("resetToLevel truncates to an existing frame, preserving its context", () => {
    const nav = useNavStack.getState();
    nav.push({ level: "servers", serverId: "srvX" });
    nav.push({ level: "channels", channelId: "chanA" });
    nav.push({ level: "chat" });
    nav.resetToLevel("servers");
    const { stack } = useNavStack.getState();
    expect(stack.map((f) => f.level)).toEqual(["sources", "servers"]);
    expect(navTop({ stack }).serverId).toBe("srvX");
  });

  it("resetToLevel synthesizes intermediate frames when the level is absent", () => {
    // Stack is just the root; jump straight to chat.
    useNavStack.getState().resetToLevel("chat");
    const { stack } = useNavStack.getState();
    expect(stack.map((f) => f.level)).toEqual(NAV_LEVEL_ORDER);
  });

  it("setOverlay sets and clears the overlay without touching the stack", () => {
    useNavStack.getState().push({ level: "channels" });
    useNavStack.getState().setOverlay("dms");
    expect(useNavStack.getState().overlay).toBe("dms");
    expect(useNavStack.getState().stack).toHaveLength(2);
    useNavStack.getState().setOverlay(null);
    expect(useNavStack.getState().overlay).toBeNull();
    expect(useNavStack.getState().stack).toHaveLength(2);
  });

  it("setStack replaces the stack wholesale; empty input falls back to root", () => {
    const frames: NavFrame[] = buildStackToLevel("channels", { serverId: "s9" });
    useNavStack.getState().setStack(frames, "settings");
    expect(useNavStack.getState().stack.map((f) => f.level)).toEqual([
      "sources",
      "servers",
      "channels",
    ]);
    expect(useNavStack.getState().overlay).toBe("settings");

    useNavStack.getState().setStack([]);
    expect(useNavStack.getState().stack).toHaveLength(1);
    expect(navTop(useNavStack.getState()).level).toBe("sources");
  });
});

describe("browseTabToStack — legacy BrowseTab → NavStack mapper", () => {
  const base: LegacyBrowseTab = {
    pageView: "sources",
    serverId: null,
    channelId: null,
    dmActive: false,
    dmRoomId: null,
  };

  it("maps a fresh sources tab to just the root", () => {
    expect(browseTabToStack(base).map((f) => f.level)).toEqual(["sources"]);
  });

  it("maps a servers-depth tab to sources→servers with serverId carried", () => {
    const stack = browseTabToStack({ ...base, pageView: "servers", serverId: "srvA" });
    expect(stack.map((f) => f.level)).toEqual(["sources", "servers"]);
    expect(navTop({ stack }).serverId).toBe("srvA");
  });

  it("maps a channel-chat tab to the full path with server+channel context", () => {
    const stack = browseTabToStack({
      ...base,
      pageView: "chat",
      serverId: "srvA",
      channelId: "chanA",
    });
    expect(stack.map((f) => f.level)).toEqual(NAV_LEVEL_ORDER);
    const top = navTop({ stack });
    expect(top.serverId).toBe("srvA");
    expect(top.channelId).toBe("chanA");
    expect(top.dmRoomId).toBeNull();
  });

  it("maps a DM-active chat tab to a chat frame carrying dmRoomId and NO serverId", () => {
    const stack = browseTabToStack({
      ...base,
      pageView: "chat",
      serverId: "srvShouldBeDropped",
      channelId: "chanShouldBeDropped",
      dmActive: true,
      dmRoomId: "!dm:server",
    });
    expect(stack.map((f) => f.level)).toEqual(NAV_LEVEL_ORDER);
    const top = navTop({ stack });
    expect(top.dmRoomId).toBe("!dm:server");
    // DM is a distinct branch — server/channel selection is not carried.
    expect(top.serverId).toBeNull();
    expect(top.channelId).toBeNull();
  });

  it("round-trips: pop from a mapped chat tab lands on channels, not sources", () => {
    const stack = browseTabToStack({
      ...base,
      pageView: "chat",
      serverId: "srvA",
      channelId: "chanA",
    });
    useNavStack.setState({ stack, overlay: null });
    useNavStack.getState().pop();
    expect(navTop(useNavStack.getState()).level).toBe("channels");
  });
});
