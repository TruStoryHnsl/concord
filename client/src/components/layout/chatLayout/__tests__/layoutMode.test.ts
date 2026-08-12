/**
 * Unit tests for the adaptive layout-mode decision (iPad back-button fix).
 *
 * The bug being locked in: an iPad in iPadOS Split View / Slide Over has a
 * NARROW webview, but the old `prefersTabletLayout = platform.isIPad` forced
 * the three-pane layout anyway. The three-pane layout ships NO back control
 * (parents are always on screen), so a narrowed iPad stranded the user with
 * no way back up the nav stack. The fix: a narrow iPad must NOT use the
 * tablet layout, so the shell falls through to the responsive stacked layout
 * whose framework back control (canGoBack / handleStackBack) is present.
 *
 * These assertions verify the user-visible consequence — "does this width on
 * this device get the multi-pane (no-back) layout, or the stacked
 * (has-back) layout?" — not an abstract internal flag.
 */

import { describe, it, expect } from "vitest";
import {
  shouldUseTabletLayout,
  resolveLayoutMode,
  TABLET_LAYOUT_MIN_WIDTH,
} from "../layoutMode";

describe("shouldUseTabletLayout — iPad back-button fix", () => {
  it("the breakpoint matches Tailwind's md (768px), so a narrow iPad webview behaves like a narrow browser window", () => {
    expect(TABLET_LAYOUT_MIN_WIDTH).toBe(768);
  });

  it("a non-iPad device NEVER gets the tablet layout, at any width", () => {
    expect(shouldUseTabletLayout(false, 320)).toBe(false);
    expect(shouldUseTabletLayout(false, 1024)).toBe(false);
    expect(shouldUseTabletLayout(false, 2048)).toBe(false);
  });

  it("a WIDE iPad (full screen / wide split) gets the multi-pane tablet layout (no back control needed — parents visible)", () => {
    expect(shouldUseTabletLayout(true, 1024)).toBe(true); // iPad portrait
    expect(shouldUseTabletLayout(true, 1366)).toBe(true); // iPad Pro landscape
    expect(shouldUseTabletLayout(true, 768)).toBe(true); // exactly at threshold
  });

  it("a NARROW iPad (Slide Over / narrow Split View) does NOT get the tablet layout, so it falls through to the stacked layout WITH the back control", () => {
    expect(shouldUseTabletLayout(true, 767)).toBe(false); // one px below threshold
    expect(shouldUseTabletLayout(true, 320)).toBe(false); // Slide Over slot
    expect(shouldUseTabletLayout(true, 507)).toBe(false); // narrow Split View
  });

  it("an unknown / pre-paint width (0 or non-finite) defaults an iPad to the tablet layout (prior behavior), never flashing the phone shell", () => {
    expect(shouldUseTabletLayout(true, 0)).toBe(true);
    expect(shouldUseTabletLayout(true, Number.NaN)).toBe(true);
    expect(shouldUseTabletLayout(true, Number.POSITIVE_INFINITY)).toBe(true);
    // ...but a non-iPad with an unknown width is still not tablet.
    expect(shouldUseTabletLayout(false, 0)).toBe(false);
  });
});

describe("resolveLayoutMode — full shell selection", () => {
  it("TV always wins, even on a wide iPad-class screen", () => {
    expect(resolveLayoutMode(true, true, 1920)).toBe("tv");
    expect(resolveLayoutMode(true, false, 1920)).toBe("tv");
  });

  it("a wide iPad resolves to the tablet (multi-pane) shell", () => {
    expect(resolveLayoutMode(false, true, 1024)).toBe("tablet");
  });

  it("a narrow iPad resolves to the responsive shell (stacked layout with back control)", () => {
    expect(resolveLayoutMode(false, true, 400)).toBe("responsive");
  });

  it("a phone resolves to the responsive shell (stacked layout with back control)", () => {
    expect(resolveLayoutMode(false, false, 390)).toBe("responsive");
  });

  it("a desktop browser resolves to the responsive shell (its md: query shows the desktop three-pane)", () => {
    expect(resolveLayoutMode(false, false, 1440)).toBe("responsive");
  });
});
