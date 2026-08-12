/**
 * Tests for `useDpadNav()`.
 *
 * jsdom doesn't do layout, so getBoundingClientRect() returns all
 * zeros by default. We stub it on each test element so the
 * findNeighbour logic has a spatial grid to work with.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDpadNav, __internal } from "../useDpadNav";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function makeTile(
  id: string,
  rect: Rect,
  group = "test",
): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.id = id;
  btn.dataset.focusable = "true";
  btn.dataset.focusGroup = group;
  btn.tabIndex = 0;
  btn.textContent = id;
  document.body.appendChild(btn);
  btn.getBoundingClientRect = () =>
    ({
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      width: rect.width,
      height: rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
  // jsdom treats detached-from-layout buttons as invisible
  // (offsetParent === null). Fake visibility so getFocusables picks
  // them up.
  Object.defineProperty(btn, "offsetParent", {
    configurable: true,
    get: () => document.body,
  });
  return btn;
}

afterEach(() => {
  // Detach every child we added during the test without touching
  // innerHTML (which trips a false-positive XSS linter even when the
  // assignment is a literal empty string).
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  vi.restoreAllMocks();
});

describe("findNeighbour", () => {
  it("moves right to the nearest tile in a row", () => {
    const a = makeTile("a", { left: 0, top: 0, width: 100, height: 100 });
    const b = makeTile("b", { left: 120, top: 0, width: 100, height: 100 });
    const c = makeTile("c", { left: 260, top: 0, width: 100, height: 100 });

    const next = __internal.findNeighbour(a, "right", [a, b, c]);
    expect(next?.id).toBe("b");
  });

  it("moves down to the nearest tile in a column", () => {
    const a = makeTile("a", { left: 0, top: 0, width: 100, height: 100 });
    const b = makeTile("b", { left: 0, top: 120, width: 100, height: 100 });
    const c = makeTile("c", { left: 0, top: 260, width: 100, height: 100 });

    const next = __internal.findNeighbour(a, "down", [a, b, c]);
    expect(next?.id).toBe("b");
  });

  it("prefers aligned tiles over diagonally-shifted ones", () => {
    const a = makeTile("a", { left: 100, top: 100, width: 80, height: 80 });
    const aligned = makeTile("b", {
      left: 100,
      top: 220,
      width: 80,
      height: 80,
    });
    // A candidate that is closer vertically but offset horizontally.
    const shifted = makeTile("c", {
      left: 400,
      top: 200,
      width: 80,
      height: 80,
    });

    const next = __internal.findNeighbour(a, "down", [a, aligned, shifted]);
    expect(next?.id).toBe("b");
  });

  it("returns null when there is no neighbour in the requested direction", () => {
    const a = makeTile("a", { left: 0, top: 0, width: 100, height: 100 });
    // Only candidate is BEHIND the current, not in front.
    const b = makeTile("b", { left: 0, top: -200, width: 100, height: 100 });

    const next = __internal.findNeighbour(a, "down", [a, b]);
    expect(next).toBeNull();
  });
});

describe("useDpadNav", () => {
  it("focuses the first tile on mount when nothing is focused", () => {
    const a = makeTile("a", { left: 0, top: 0, width: 100, height: 100 });
    makeTile("b", { left: 120, top: 0, width: 100, height: 100 });

    renderHook(() =>
      useDpadNav({ enabled: true, group: "test" }),
    );

    expect(document.activeElement).toBe(a);
  });

  it("moves focus to the right on ArrowRight", () => {
    const a = makeTile("a", { left: 0, top: 0, width: 100, height: 100 });
    const b = makeTile("b", { left: 120, top: 0, width: 100, height: 100 });
    a.focus();

    renderHook(() =>
      useDpadNav({ enabled: true, group: "test" }),
    );

    const evt = new KeyboardEvent("keydown", { key: "ArrowRight" });
    window.dispatchEvent(evt);

    expect(document.activeElement).toBe(b);
  });

  it("invokes onSelect on Enter when an in-group element is focused", () => {
    const onSelect = vi.fn();
    const a = makeTile("a", { left: 0, top: 0, width: 100, height: 100 });
    a.focus();

    renderHook(() =>
      useDpadNav({ enabled: true, group: "test", onSelect }),
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0][0]).toBe(a);
  });

  it("invokes onBack on Escape", () => {
    const onBack = vi.fn();
    makeTile("a", { left: 0, top: 0, width: 100, height: 100 });

    renderHook(() =>
      useDpadNav({ enabled: true, group: "test", onBack }),
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onBack).toHaveBeenCalledOnce();
  });

  it("does nothing when disabled", () => {
    const onSelect = vi.fn();
    const onBack = vi.fn();
    const a = makeTile("a", { left: 0, top: 0, width: 100, height: 100 });
    a.focus();

    renderHook(() =>
      useDpadNav({ enabled: false, group: "test", onSelect, onBack }),
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onSelect).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });
});
