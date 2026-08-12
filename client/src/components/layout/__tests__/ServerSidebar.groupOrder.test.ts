import { describe, it, expect } from "vitest";
import { orderServerGroups } from "../ServerSidebar";

/**
 * Regression test for the repeatedly-reported bug: switching the active
 * source REORDERED the server rail, hoisting the active source's server
 * group to the top. The contract the user stated: "The order of the
 * sources to the left is the order of the displayed server groups." The
 * active source must render in its OWN slot, never hoisted.
 *
 * `orderServerGroups` is the single source of truth ServerSidebar uses to
 * lay out groups, so asserting its output IS asserting the displayed order.
 * We render the result as a flat order of source identifiers ("active"
 * stands in for whichever source is currently the active instance) and
 * check it matches the left-rail source order regardless of which source
 * is active.
 */

const sources = [
  { id: "A", enabled: true },
  { id: "B", enabled: true },
  { id: "C", enabled: true },
];

/** Render the group order as the sequence of source ids it produces, with
 *  the active group represented by the active source's id so the sequence
 *  is directly comparable to the left-rail source order. */
function asSourceSequence(
  groups: ReturnType<typeof orderServerGroups>,
  activeSourceId: string | null,
): string[] {
  return groups.map((g) =>
    g.kind === "active" ? (activeSourceId ?? "active") : g.sourceId,
  );
}

describe("orderServerGroups", () => {
  it("keeps groups in source order when B is active (B not hoisted)", () => {
    const groups = orderServerGroups(
      sources,
      "B", // B is the active instance
      new Set(["A", "C"]), // A and C have foreign servers
      true, // B has servers
    );
    // The displayed order must be A, B, C — exactly the left-rail order.
    expect(asSourceSequence(groups, "B")).toEqual(["A", "B", "C"]);
  });

  it("keeps the SAME order when the active source changes to A", () => {
    const groups = orderServerGroups(
      sources,
      "A",
      new Set(["B", "C"]),
      true,
    );
    expect(asSourceSequence(groups, "A")).toEqual(["A", "B", "C"]);
  });

  it("keeps the SAME order when the active source changes to C", () => {
    const groups = orderServerGroups(
      sources,
      "C",
      new Set(["A", "B"]),
      true,
    );
    expect(asSourceSequence(groups, "C")).toEqual(["A", "B", "C"]);
  });

  it("respects a user-reordered source list (order follows sources array)", () => {
    const reordered = [
      { id: "C", enabled: true },
      { id: "A", enabled: true },
      { id: "B", enabled: true },
    ];
    const groups = orderServerGroups(reordered, "A", new Set(["C", "B"]), true);
    expect(asSourceSequence(groups, "A")).toEqual(["C", "A", "B"]);
  });

  it("skips disabled sources", () => {
    const withDisabled = [
      { id: "A", enabled: true },
      { id: "B", enabled: false },
      { id: "C", enabled: true },
    ];
    const groups = orderServerGroups(withDisabled, "A", new Set(["B", "C"]), true);
    // B is disabled → omitted even though it has servers.
    expect(asSourceSequence(groups, "A")).toEqual(["A", "C"]);
  });

  it("omits a foreign source with no servers", () => {
    const groups = orderServerGroups(sources, "B", new Set(["A"]), true);
    // C has no servers → omitted; A then active-B remain in order.
    expect(asSourceSequence(groups, "B")).toEqual(["A", "B"]);
  });

  it("fallback: active instance with no matching source row renders first", () => {
    const groups = orderServerGroups(sources, null, new Set(["A", "B", "C"]), true);
    expect(asSourceSequence(groups, null)).toEqual(["active", "A", "B", "C"]);
  });

  it("omits the active group when the active instance has no servers", () => {
    const groups = orderServerGroups(sources, "B", new Set(["A", "C"]), false);
    expect(asSourceSequence(groups, "B")).toEqual(["A", "C"]);
  });
});
