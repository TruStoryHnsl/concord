import { describe, it, expect } from "vitest";
import { shortenPeerId, formatRelativeTime } from "./format";

describe("shortenPeerId", () => {
  it("shortens long peer IDs to 8 chars + ellipsis", () => {
    const long = "12D3KooWPeer1AAAAxxxxxxxxxxxxxx";
    expect(shortenPeerId(long)).toBe("12D3KooW...");
  });

  it("returns short IDs unchanged", () => {
    expect(shortenPeerId("abcdefghij")).toBe("abcdefghij");
    expect(shortenPeerId("short")).toBe("short");
  });

  it("handles empty string", () => {
    expect(shortenPeerId("")).toBe("");
  });
});

describe("formatRelativeTime", () => {
  it("returns 'just now' for timestamps within 60 seconds", () => {
    const recent = Date.now() - 30 * 1000;
    expect(formatRelativeTime(recent)).toBe("just now");
  });

  it("returns 'just now' for future timestamps", () => {
    const future = Date.now() + 60000;
    expect(formatRelativeTime(future)).toBe("just now");
  });

  it("returns minutes ago for timestamps within an hour", () => {
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;
    expect(formatRelativeTime(fiveMinAgo)).toBe("5m ago");
  });

  it("returns hours ago for timestamps within a day", () => {
    const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
    expect(formatRelativeTime(threeHoursAgo)).toBe("3h ago");
  });

  it("returns days ago for timestamps within a week", () => {
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
    expect(formatRelativeTime(twoDaysAgo)).toBe("2d ago");
  });

  it("handles Unix timestamps in seconds (auto-converts)", () => {
    const fiveMinAgoSeconds = Math.floor(Date.now() / 1000) - 5 * 60;
    expect(formatRelativeTime(fiveMinAgoSeconds)).toBe("5m ago");
  });

  it("returns a localized date for timestamps older than a week", () => {
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const result = formatRelativeTime(thirtyDaysAgo);
    // Should be a date string, not a relative time
    expect(result).not.toContain("ago");
    expect(result).not.toBe("just now");
  });
});
