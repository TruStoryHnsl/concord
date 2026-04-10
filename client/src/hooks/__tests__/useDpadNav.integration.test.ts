/**
 * Integration test for DPAD navigation on TV builds.
 *
 * Simulates a TV-like environment and exercises the full navigation
 * flow through a 2x2 grid of focusable elements:
 *
 *   [A] [B]
 *   [C] [D]
 *
 * Covers: initial focus, ArrowRight/ArrowDown/ArrowLeft/ArrowUp
 * traversal, Enter selection, and Escape back navigation.
 *
 * jsdom has no layout engine, so getBoundingClientRect() is stubbed
 * on each element to provide spatial coordinates.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDpadNav } from "../useDpadNav";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function makeTile(
  id: string,
  rect: Rect,
  group = "tv-grid",
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
  Object.defineProperty(btn, "offsetParent", {
    configurable: true,
    get: () => document.body,
  });
  return btn;
}

function pressKey(key: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
}

afterEach(() => {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  vi.restoreAllMocks();
});

describe("DPAD navigation integration (TV 2x2 grid)", () => {
  // Grid layout:
  //   A (0,0)     B (200,0)
  //   C (0,200)   D (200,200)
  const TILE_SIZE = 150;
  const GAP = 200;

  function setupGrid() {
    const a = makeTile("A", { left: 0, top: 0, width: TILE_SIZE, height: TILE_SIZE });
    const b = makeTile("B", { left: GAP, top: 0, width: TILE_SIZE, height: TILE_SIZE });
    const c = makeTile("C", { left: 0, top: GAP, width: TILE_SIZE, height: TILE_SIZE });
    const d = makeTile("D", { left: GAP, top: GAP, width: TILE_SIZE, height: TILE_SIZE });
    return { a, b, c, d };
  }

  it("assigns initial focus to the first element (top-left tile A)", () => {
    const { a } = setupGrid();

    renderHook(() =>
      useDpadNav({ enabled: true, group: "tv-grid" }),
    );

    expect(document.activeElement).toBe(a);
  });

  it("navigates right from A to B on ArrowRight", () => {
    const { a, b } = setupGrid();
    a.focus();

    renderHook(() =>
      useDpadNav({ enabled: true, group: "tv-grid" }),
    );

    pressKey("ArrowRight");
    expect(document.activeElement).toBe(b);
  });

  it("navigates down from A to C on ArrowDown", () => {
    const { a, c } = setupGrid();
    a.focus();

    renderHook(() =>
      useDpadNav({ enabled: true, group: "tv-grid" }),
    );

    pressKey("ArrowDown");
    expect(document.activeElement).toBe(c);
  });

  it("navigates a full circuit: A -> B -> D -> C -> A", () => {
    const { a, b, c, d } = setupGrid();
    a.focus();

    renderHook(() =>
      useDpadNav({ enabled: true, group: "tv-grid" }),
    );

    // A -> B (right)
    pressKey("ArrowRight");
    expect(document.activeElement).toBe(b);

    // B -> D (down)
    pressKey("ArrowDown");
    expect(document.activeElement).toBe(d);

    // D -> C (left)
    pressKey("ArrowLeft");
    expect(document.activeElement).toBe(c);

    // C -> A (up)
    pressKey("ArrowUp");
    expect(document.activeElement).toBe(a);
  });

  it("fires onSelect with the focused element on Enter", () => {
    const onSelect = vi.fn();
    const { a, b } = setupGrid();
    a.focus();

    renderHook(() =>
      useDpadNav({ enabled: true, group: "tv-grid", onSelect }),
    );

    // Navigate to B, then select
    pressKey("ArrowRight");
    expect(document.activeElement).toBe(b);

    pressKey("Enter");
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0][0]).toBe(b);
  });

  it("fires onSelect on Space as well as Enter", () => {
    const onSelect = vi.fn();
    const { a } = setupGrid();
    a.focus();

    renderHook(() =>
      useDpadNav({ enabled: true, group: "tv-grid", onSelect }),
    );

    pressKey(" ");
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0][0]).toBe(a);
  });

  it("fires onBack on Escape (TV remote Back button)", () => {
    const onBack = vi.fn();
    setupGrid();

    renderHook(() =>
      useDpadNav({ enabled: true, group: "tv-grid", onBack }),
    );

    pressKey("Escape");
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("fires onBack on Backspace (alternate TV remote mapping)", () => {
    const onBack = vi.fn();
    setupGrid();

    renderHook(() =>
      useDpadNav({ enabled: true, group: "tv-grid", onBack }),
    );

    pressKey("Backspace");
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("does not move focus beyond grid edges (no wraparound)", () => {
    const { a } = setupGrid();
    a.focus();

    renderHook(() =>
      useDpadNav({ enabled: true, group: "tv-grid" }),
    );

    // A is top-left — pressing Up or Left should not move focus
    pressKey("ArrowUp");
    expect(document.activeElement).toBe(a);

    pressKey("ArrowLeft");
    expect(document.activeElement).toBe(a);
  });

  it("handles diagonal navigation through all 4 tiles", () => {
    const { a, b, c, d } = setupGrid();
    a.focus();

    renderHook(() =>
      useDpadNav({ enabled: true, group: "tv-grid" }),
    );

    // A -> B (right)
    pressKey("ArrowRight");
    expect(document.activeElement).toBe(b);

    // B -> D (down) — diagonal from A's perspective
    pressKey("ArrowDown");
    expect(document.activeElement).toBe(d);

    // D -> C (left)
    pressKey("ArrowLeft");
    expect(document.activeElement).toBe(c);

    // Verify all 4 tiles were visited
    // Now go back: C -> A (up)
    pressKey("ArrowUp");
    expect(document.activeElement).toBe(a);
  });

  it("does not move focus via DPAD when element is outside the group", () => {
    // Create a tile outside the "tv-grid" group
    const other = makeTile("other", { left: 0, top: 0, width: 100, height: 100 }, "other-group");
    const { a, b } = setupGrid();

    // Start with focus on A (inside the tv-grid group)
    a.focus();

    renderHook(() =>
      useDpadNav({ enabled: true, group: "tv-grid" }),
    );

    // ArrowRight should move within tv-grid (A -> B)
    pressKey("ArrowRight");
    expect(document.activeElement).toBe(b);

    // "other" tile should never receive focus from tv-grid DPAD nav
    // since it belongs to a different group
    expect(document.activeElement).not.toBe(other);
  });
});
