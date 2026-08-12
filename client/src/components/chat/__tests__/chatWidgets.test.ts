import { describe, expect, it } from "vitest";
import {
  getPollVoteSummary,
  parseWidgetComposerCommand,
  validateChatWidget,
} from "../chatWidgets";

describe("chat widget command parsing", () => {
  it("parses poll commands into widget payloads", () => {
    const result = parseWidgetComposerCommand("/poll Best day? | Friday | Saturday");
    expect(result.widget).toMatchObject({
      kind: "poll",
      question: "Best day?",
      options: ["Friday", "Saturday"],
    });
    expect(result.body).toContain("# Poll");
  });

  it("parses checklist and status commands", () => {
    expect(parseWidgetComposerCommand("/checklist Launch | QA | Ship").widget).toMatchObject({
      kind: "checklist",
      title: "Launch",
      items: ["QA", "Ship"],
    });
    expect(parseWidgetComposerCommand("/status Room | Stable | green").widget).toMatchObject({
      kind: "status",
      title: "Room",
      summary: "Stable",
      tone: "success",
    });
  });
});

describe("chat widget validation", () => {
  it("rejects malformed poll payloads", () => {
    const result = validateChatWidget({ kind: "poll", question: "Q", options: ["Only one"] });
    expect(result.ok).toBe(false);
  });

  it("summarizes poll votes from reactions", () => {
    const votes = getPollVoteSummary(
      [
        {
          emoji: "1️⃣",
          count: 2,
          userIds: ["@alice:example.concordchat.net", "@bob:example.concordchat.net"],
          eventIds: {
            "@alice:example.concordchat.net": "$r1",
            "@bob:example.concordchat.net": "$r2",
          },
        },
      ],
      ["Friday", "Saturday"],
      "@alice:example.concordchat.net",
    );

    expect(votes[0]).toMatchObject({
      option: "Friday",
      count: 2,
      selected: true,
      reactionEventId: "$r1",
    });
    expect(votes[1]).toMatchObject({
      option: "Saturday",
      count: 0,
      selected: false,
    });
  });
});

