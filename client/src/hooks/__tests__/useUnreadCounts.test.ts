import { act, renderHook } from "@testing-library/react";
import { RoomEvent } from "matrix-js-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSendReadReceipt } from "../useUnreadCounts";
import { useAuthStore } from "../../stores/auth";

function createFakeClient() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const lastEvent = { getId: () => "$event-1" };
  const room = {
    getLiveTimeline: () => ({
      getEvents: () => [lastEvent],
    }),
  };

  return {
    lastEvent,
    getRoom: vi.fn(() => room),
    setRoomReadMarkers: vi.fn().mockResolvedValue({}),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    }),
    removeListener: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
    }),
    emitTimeline(roomId: string) {
      for (const listener of listeners.get(RoomEvent.Timeline) ?? []) {
        listener({}, { roomId }, false, false, { liveEvent: true });
      }
    },
  };
}

describe("useSendReadReceipt", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAuthStore.setState({
      client: null,
      userId: "@tester:test.local",
      accessToken: "token",
      isLoggedIn: true,
      isLoading: false,
      syncing: false,
    });
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    useAuthStore.setState({
      client: null,
      userId: null,
      accessToken: null,
      isLoggedIn: false,
      isLoading: false,
      syncing: false,
    });
  });

  it("advances room read markers on room switch", async () => {
    const client = createFakeClient();
    useAuthStore.setState({ client: client as never });

    renderHook(() => useSendReadReceipt("!dm:test.local"));

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(client.setRoomReadMarkers).toHaveBeenCalledWith(
      "!dm:test.local",
      "$event-1",
      client.lastEvent,
    );
  });

  it("advances room read markers for live events while the room is visible", async () => {
    const client = createFakeClient();
    useAuthStore.setState({ client: client as never });

    renderHook(() => useSendReadReceipt("!dm:test.local"));
    client.setRoomReadMarkers.mockClear();

    await act(async () => {
      client.emitTimeline("!dm:test.local");
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(client.setRoomReadMarkers).toHaveBeenCalledWith(
      "!dm:test.local",
      "$event-1",
      client.lastEvent,
    );
  });
});
