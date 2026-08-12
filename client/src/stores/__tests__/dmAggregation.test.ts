import { describe, it, expect } from "vitest";
import { mergeDMConversations } from "../dm";
import type { DMConversation } from "../../api/concord";

/**
 * The superuser's DMs follow them: the native app fetches each connected
 * source's DMs and merges them into ONE profile-keyed list. These tests pin
 * that merge contract — every DM is tagged with its owning source, and a room
 * reachable from two accounts isn't duplicated.
 */
function dm(id: number, room: string, other = "@x:h"): DMConversation {
  return { id, other_user_id: other, matrix_room_id: room, created_at: null };
}

describe("mergeDMConversations", () => {
  it("aggregates DMs from multiple sources, tagging each with its source", () => {
    const merged = mergeDMConversations([
      { sourceId: "srcA", convs: [dm(1, "!a:h"), dm(2, "!b:h")] },
      { sourceId: "srcB", convs: [dm(3, "!c:h")] },
    ]);
    expect(merged).toHaveLength(3);
    expect(merged.find((c) => c.matrix_room_id === "!a:h")?.sourceId).toBe("srcA");
    expect(merged.find((c) => c.matrix_room_id === "!c:h")?.sourceId).toBe("srcB");
  });

  it("collapses a room reachable from two sources to the first seen", () => {
    const merged = mergeDMConversations([
      { sourceId: "srcA", convs: [dm(1, "!shared:h")] },
      { sourceId: "srcB", convs: [dm(9, "!shared:h")] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].sourceId).toBe("srcA");
  });

  it("preserves an already-tagged sourceId over the per-source default", () => {
    const merged = mergeDMConversations([
      { sourceId: "srcA", convs: [{ ...dm(1, "!a:h"), sourceId: "explicit" }] },
    ]);
    expect(merged[0].sourceId).toBe("explicit");
  });

  it("leaves sourceId undefined when no source tag is provided (web fallback)", () => {
    const merged = mergeDMConversations([{ convs: [dm(1, "!a:h")] }]);
    expect(merged[0].sourceId).toBeUndefined();
  });

  it("returns an empty list for no sources", () => {
    expect(mergeDMConversations([])).toEqual([]);
  });
});
