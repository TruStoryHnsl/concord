import { describe, it, expect } from "vitest";
import { buildMatrixRailGroups } from "../GroupedRail";
import type { ConcordSource } from "../../../stores/sources";
import type { Server } from "../../../api/concord";

/**
 * The unified rail must show Matrix-server groups in Sources order, with the
 * active instance's group in its own slot (never hoisted), the local instance
 * excluded (the local mesh group represents the device), and disabled sources
 * collapsed. buildMatrixRailGroups is the pure source of that ordering.
 */
function src(p: Partial<ConcordSource> & { id: string; host: string }): ConcordSource {
  return {
    inviteToken: "",
    apiBase: `https://${p.host}/api`,
    homeserverUrl: `https://${p.host}`,
    status: "connected",
    enabled: true,
    addedAt: "",
    ...p,
  };
}
function srv(id: string, sourceId?: string): Server {
  return { id, name: id, channels: [], sourceId } as unknown as Server;
}

describe("buildMatrixRailGroups", () => {
  it("orders groups by source, active in its own slot, local excluded", () => {
    const sources = [
      src({ id: "local", host: "localhost", isLocal: true }),
      src({ id: "A", host: "a.test", userId: "@me:a.test" }),
      src({ id: "B", host: "b.test" }),
    ];
    const { groups } = buildMatrixRailGroups({
      sources,
      activeServers: [srv("a1")],
      foreignServers: [srv("b1", "B")],
      activeSourceId: "A",
    });
    expect(groups.map((g) => g.source.id)).toEqual(["A", "B"]); // local excluded, order kept
    expect(groups[0].servers.map((s) => s.id)).toEqual(["a1"]); // active → activeServers
    expect(groups[1].servers.map((s) => s.id)).toEqual(["b1"]); // foreign → by sourceId
  });

  // Regression (web): the local instance IS the active, origin-served source.
  // It owns the user's real servers, so it must render its own group — it must
  // NOT be excluded as if it were the native device tile. Reproduces the
  // 900bac3 bug where linked.example.test users lost every server tile on the web UI.
  it("renders the local source's servers when it is the active (web) source", () => {
    const sources = [
      src({ id: "origin", host: "linked.example.test", isLocal: true, userId: "@corr:linked.example.test" }),
      src({ id: "B", host: "b.test" }),
    ];
    const { groups } = buildMatrixRailGroups({
      sources,
      activeServers: [srv("lobby"), srv("tc17")], // the user's own servers
      foreignServers: [srv("b1", "B")],
      activeSourceId: "origin", // web: local instance holds the live session
    });
    expect(groups.map((g) => g.source.id)).toEqual(["origin", "B"]); // origin NOT dropped
    expect(groups[0].servers.map((s) => s.id)).toEqual(["lobby", "tc17"]); // its servers render
  });

  it("keeps the SAME order when the active source changes (no hoist)", () => {
    const sources = [
      src({ id: "A", host: "a.test" }),
      src({ id: "B", host: "b.test", userId: "@me:b.test" }),
    ];
    const { groups } = buildMatrixRailGroups({
      sources,
      activeServers: [srv("b1")],
      foreignServers: [srv("a1", "A")],
      activeSourceId: "B",
    });
    expect(groups.map((g) => g.source.id)).toEqual(["A", "B"]); // B active but NOT hoisted
  });

  it("collapses disabled sources and skips p2p porches", () => {
    const sources = [
      src({ id: "A", host: "a.test" }),
      src({ id: "D", host: "d.test", enabled: false }),
      src({ id: "P", host: "peer", platform: "concord-p2p" }),
    ];
    const { groups, collapsed } = buildMatrixRailGroups({
      sources,
      activeServers: [],
      foreignServers: [srv("a1", "A")],
      activeSourceId: null,
    });
    expect(groups.map((g) => g.source.id)).toEqual(["A"]);
    expect(collapsed.map((s) => s.id)).toEqual(["D"]);
  });
});
