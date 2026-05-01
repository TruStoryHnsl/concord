import { describe, expect, it } from "vitest";
import { isBrowserSurfaceSrcAllowed } from "../BrowserSurface";

const ORIGIN = "https://app.concord.local";

describe("BrowserSurface allowlist (INS-066 W4)", () => {
  it("allows hosted *.concord.app origins", () => {
    expect(
      isBrowserSurfaceSrcAllowed("https://worldview.concord.app/", ORIGIN),
    ).toBe(true);
    expect(
      isBrowserSurfaceSrcAllowed("https://abc-123.concord.app/path", ORIGIN),
    ).toBe(true);
  });

  it("allows bare /ext/{id}/ relative paths", () => {
    expect(
      isBrowserSurfaceSrcAllowed(
        "/ext/com.concord.orrdia-bridge/index.html",
        ORIGIN,
      ),
    ).toBe(true);
    expect(isBrowserSurfaceSrcAllowed("/ext/foo/", ORIGIN)).toBe(true);
  });

  it("allows same-origin absolute /ext/{id}/ URLs", () => {
    expect(
      isBrowserSurfaceSrcAllowed(
        `${ORIGIN}/ext/com.concord.orrdia-bridge/index.html`,
        ORIGIN,
      ),
    ).toBe(true);
  });

  it("rejects /ext/ on a different origin", () => {
    expect(
      isBrowserSurfaceSrcAllowed(
        "https://evil.example.com/ext/foo/index.html",
        ORIGIN,
      ),
    ).toBe(false);
  });

  it("rejects unrelated external origins", () => {
    expect(
      isBrowserSurfaceSrcAllowed("https://evil.example.com/", ORIGIN),
    ).toBe(false);
    expect(
      isBrowserSurfaceSrcAllowed(
        "https://concord-app.evil.com/",
        ORIGIN,
      ),
    ).toBe(false);
  });

  it("rejects path traversal under /ext/", () => {
    expect(
      isBrowserSurfaceSrcAllowed("/ext/../etc/passwd", ORIGIN),
    ).toBe(false);
  });

  it("rejects empty src", () => {
    expect(isBrowserSurfaceSrcAllowed("", ORIGIN)).toBe(false);
  });

  it("VITE_EXT_DEV_URL bypass allows the exact dev origin", () => {
    expect(
      isBrowserSurfaceSrcAllowed(
        "http://localhost:5174/index.html",
        ORIGIN,
        "http://localhost:5174",
      ),
    ).toBe(true);
  });

  it("VITE_EXT_DEV_URL bypass does not allow other origins", () => {
    expect(
      isBrowserSurfaceSrcAllowed(
        "http://localhost:5175/index.html",
        ORIGIN,
        "http://localhost:5174",
      ),
    ).toBe(false);
  });

  it("VITE_EXT_DEV_URL bypass off when env is unset", () => {
    expect(
      isBrowserSurfaceSrcAllowed(
        "http://localhost:5174/index.html",
        ORIGIN,
      ),
    ).toBe(false);
  });
});
