import { describe, it, expect, beforeEach, vi } from "vitest";
import { useServerStore, type FederatedRoomsClientLike } from "../server";
import type { Server } from "../../api/concord";

/**
 * Unit tests for `useServerStore.hydrateFederatedRooms` — the loose-room
 * hydration logic that wraps joined-but-not-Concord-managed Matrix rooms
 * as synthetic Server entries so the sidebar can display them.
 *
 * All other store actions (loadServers, createServer, etc.) hit the
 * concord API and have their own integration-test surface; this file
 * focuses narrowly on the hydration algorithm's filter + merge rules.
 */

// Mock the concord API module so the store's other methods don't try
// to hit the network in tests that touch `loadServers`-adjacent state.
vi.mock("../../api/concord", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/concord")>();
  return {
    ...actual,
    listServers: vi.fn().mockResolvedValue([]),
    getDefaultServer: vi.fn().mockResolvedValue({
      server_id: null,
      is_member: true,
      name: null,
      created_at: null,
      member_count: 0,
    }),
    joinServer: vi.fn().mockResolvedValue(undefined),
    rejoinServerRooms: vi.fn().mockResolvedValue({ joined: 0, failures: {} }),
  };
});

interface FakeRoomConfig {
  roomId: string;
  name?: string;
  membership?: string;
  dmInviter?: string | null;
}

/**
 * Build a Room-like object satisfying the {@link FederatedRoomsClientLike}
 * shape. Individual tests override membership + dmInviter to exercise
 * the filter branches.
 */
function fakeRoom(config: FakeRoomConfig) {
  return {
    roomId: config.roomId,
    name: config.name,
    getMyMembership: () => config.membership ?? "join",
    getDMInviter: () => (config.dmInviter ?? null),
  };
}

/**
 * Build a FederatedRoomsClientLike stub whose `getRooms` returns the
 * given list and whose `getUserId` returns a stable tester identity.
 */
function fakeClient(rooms: ReturnType<typeof fakeRoom>[]): FederatedRoomsClientLike {
  return {
    getUserId: () => "@tester:example.org",
    getRooms: () => rooms,
  };
}

/**
 * Minimal real Concord Server record used as a fixture. Only the
 * fields `hydrateFederatedRooms` reads (id, channels) are meaningful.
 */
function concordServer(
  id: string,
  channelRoomIds: string[],
): Server {
  return {
    id,
    name: `Concord ${id}`,
    icon_url: null,
    owner_id: "@owner:example.org",
    visibility: "private",
    abbreviation: null,
    media_uploads_enabled: false,
    channels: channelRoomIds.map((roomId, idx) => ({
      id: idx + 1,
      name: `channel-${idx}`,
      channel_type: "text",
      matrix_room_id: roomId,
      position: idx,
    })),
  };
}

describe("useServerStore.hydrateFederatedRooms", () => {
  beforeEach(() => {
    useServerStore.setState({
      servers: [],
      activeServerId: null,
      activeChannelId: null,
      members: {},
    });
  });

  it("no-op when the client has no joined rooms", () => {
    useServerStore.getState().hydrateFederatedRooms(fakeClient([]));
    expect(useServerStore.getState().servers).toEqual([]);
  });

  it("creates a synthetic federated server for each joined, non-DM, non-managed room", () => {
    const rooms = [
      fakeRoom({ roomId: "!a:remote.example", name: "Alpha" }),
      fakeRoom({ roomId: "!b:remote.example", name: "Bravo" }),
    ];
    useServerStore.getState().hydrateFederatedRooms(fakeClient(rooms));

    const servers = useServerStore.getState().servers;
    expect(servers).toHaveLength(2);
    expect(servers[0].federated).toBe(true);
    expect(servers[0].id).toBe("federated:!a:remote.example");
    expect(servers[0].name).toBe("Alpha");
    expect(servers[0].channels).toHaveLength(1);
    expect(servers[0].channels[0].matrix_room_id).toBe("!a:remote.example");
    expect(servers[1].id).toBe("federated:!b:remote.example");
  });

  it("skips rooms whose membership is not 'join' (invites, bans, leaves)", () => {
    const rooms = [
      fakeRoom({ roomId: "!invited:remote.example", membership: "invite" }),
      fakeRoom({ roomId: "!left:remote.example", membership: "leave" }),
      fakeRoom({ roomId: "!banned:remote.example", membership: "ban" }),
      fakeRoom({ roomId: "!joined:remote.example", membership: "join" }),
    ];
    useServerStore.getState().hydrateFederatedRooms(fakeClient(rooms));

    const servers = useServerStore.getState().servers;
    expect(servers).toHaveLength(1);
    expect(servers[0].channels[0].matrix_room_id).toBe("!joined:remote.example");
  });

  it("skips DM rooms (getDMInviter returns a user id)", () => {
    const rooms = [
      fakeRoom({
        roomId: "!dm:remote.example",
        dmInviter: "@friend:remote.example",
      }),
      fakeRoom({ roomId: "!public:remote.example", dmInviter: null }),
    ];
    useServerStore.getState().hydrateFederatedRooms(fakeClient(rooms));

    const servers = useServerStore.getState().servers;
    expect(servers).toHaveLength(1);
    expect(servers[0].channels[0].matrix_room_id).toBe("!public:remote.example");
  });

  it("skips rooms that are already channels of a Concord-managed server", () => {
    // Pre-seed a real Concord server whose channel is the same room
    // the client reports as joined. hydrateFederatedRooms must NOT
    // create a duplicate federated wrapper for it.
    useServerStore.setState({
      servers: [concordServer("srv-1", ["!managed:local.example"])],
      activeServerId: null,
      activeChannelId: null,
      members: {},
    });

    const rooms = [
      fakeRoom({ roomId: "!managed:local.example", name: "Managed" }),
      fakeRoom({ roomId: "!loose:remote.example", name: "Loose" }),
    ];
    useServerStore.getState().hydrateFederatedRooms(fakeClient(rooms));

    const servers = useServerStore.getState().servers;
    expect(servers).toHaveLength(2);
    // The Concord server is preserved untouched...
    expect(servers[0].id).toBe("srv-1");
    expect(servers[0].federated).toBeUndefined();
    // ...and only the un-managed room became a federated wrapper.
    expect(servers[1].id).toBe("federated:!loose:remote.example");
    expect(servers[1].federated).toBe(true);
  });

  it("is idempotent — repeated calls replace stale federated entries rather than accumulating", () => {
    // First call: two rooms, produces two federated wrappers.
    useServerStore.getState().hydrateFederatedRooms(
      fakeClient([
        fakeRoom({ roomId: "!a:remote.example", name: "A" }),
        fakeRoom({ roomId: "!b:remote.example", name: "B" }),
      ]),
    );
    expect(useServerStore.getState().servers).toHaveLength(2);

    // Second call: only ONE room remains joined (user left the other).
    // The store should contain exactly one federated wrapper, not
    // three (it must drop the stale !b entry).
    useServerStore.getState().hydrateFederatedRooms(
      fakeClient([fakeRoom({ roomId: "!a:remote.example", name: "A" })]),
    );
    const servers = useServerStore.getState().servers;
    expect(servers).toHaveLength(1);
    expect(servers[0].id).toBe("federated:!a:remote.example");
  });

  it("preserves Concord servers across repeated hydration calls", () => {
    useServerStore.setState({
      servers: [concordServer("srv-persistent", ["!managed:local.example"])],
      activeServerId: null,
      activeChannelId: null,
      members: {},
    });

    useServerStore.getState().hydrateFederatedRooms(
      fakeClient([fakeRoom({ roomId: "!loose:remote.example" })]),
    );
    useServerStore.getState().hydrateFederatedRooms(
      fakeClient([fakeRoom({ roomId: "!loose:remote.example" })]),
    );

    const servers = useServerStore.getState().servers;
    expect(servers.filter((s) => s.id === "srv-persistent")).toHaveLength(1);
    expect(servers.filter((s) => s.federated)).toHaveLength(1);
  });

  it("falls back to the room id when the room has no name", () => {
    const rooms = [fakeRoom({ roomId: "!unnamed:remote.example", name: undefined })];
    useServerStore.getState().hydrateFederatedRooms(fakeClient(rooms));

    const servers = useServerStore.getState().servers;
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("!unnamed:remote.example");
    expect(servers[0].abbreviation).toBe("!");
  });
});
