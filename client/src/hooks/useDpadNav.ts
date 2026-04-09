/**
 * DPAD (TV remote) focus navigation hook.
 *
 * Google TV / Android TV / Apple TV remotes + game controllers all
 * emit the same basic event set for navigation:
 *
 *   ArrowUp / ArrowDown / ArrowLeft / ArrowRight — reticle movement
 *   Enter / " " (space) — select / activate
 *   Escape / Backspace — back / cancel
 *
 * Tauri's Android webview translates Android KEYCODE_DPAD_* events
 * into normal DOM KeyboardEvents automatically, so a plain `keydown`
 * listener handles everything without needing a native bridge. The
 * trouble is that browser default focus traversal is terrible for TV
 * — hitting DownArrow inside the sidebar jumps to the next link in
 * the DOM source order, which is often the wrong pane.
 *
 * This hook implements a **roving tabindex** model instead:
 *
 *   - Mark any focusable element with `data-focusable="true"` and an
 *     optional `data-focus-group="<id>"` to scope it.
 *   - `useDpadNav({ group: "..." })` registers a keydown listener that
 *     takes over the arrow keys for that group, moves focus to the
 *     spatially-nearest element (by bounding-box distance), and
 *     invokes `onSelect` when Enter / Space is pressed on the active
 *     element.
 *   - `onBack` fires for Escape / Backspace — the app should use that
 *     to pop navigation state.
 *
 * The hook is idle (registers no listeners) when `enabled` is false,
 * so the common pattern is:
 *
 *     const { isTV } = usePlatform();
 *     useDpadNav({ enabled: isTV, group: "main", onBack: navigate.back });
 *
 * so that desktop + mobile builds pay zero cost.
 */

import { useCallback, useEffect, useRef } from "react";

export interface DpadNavOptions {
  /**
   * Whether the nav handler is registered. Defaults to true — pass
   * `isTV` from usePlatform() to scope to TV builds only.
   */
  enabled?: boolean;
  /**
   * Optional focus group identifier. When set, only elements marked
   * with `data-focus-group="<this>"` participate in the nav ring.
   */
  group?: string;
  /**
   * Called when the user activates the currently focused element
   * (Enter or Space on a TV remote). Receives the active element.
   */
  onSelect?: (target: HTMLElement) => void;
  /**
   * Called when the user hits Back (Escape or Backspace).
   */
  onBack?: () => void;
  /**
   * Override the initial focus target. Defaults to the first
   * data-focusable element discovered in the group.
   */
  initialFocusSelector?: string;
}

type Dir = "up" | "down" | "left" | "right";

function getFocusables(group: string | undefined): HTMLElement[] {
  const selector = group
    ? `[data-focusable="true"][data-focus-group="${CSS.escape(group)}"]`
    : `[data-focusable="true"]`;
  return Array.from(
    document.querySelectorAll<HTMLElement>(selector),
  ).filter(
    (el) =>
      el.offsetParent !== null ||
      getComputedStyle(el).position === "fixed",
  );
}

/**
 * Find the spatially nearest focusable element in a given direction.
 * Uses a simple scoring function: the target must be STRICTLY in the
 * requested direction (bounding-box edge relation), and among those
 * candidates, the one with the smallest primary-axis distance plus
 * half the perpendicular-axis distance wins (so a button directly
 * above beats one far above and slightly to the left).
 */
function findNeighbour(
  current: HTMLElement,
  dir: Dir,
  candidates: HTMLElement[],
): HTMLElement | null {
  const cur = current.getBoundingClientRect();
  const cx = cur.left + cur.width / 2;
  const cy = cur.top + cur.height / 2;

  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const el of candidates) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    const rx = r.left + r.width / 2;
    const ry = r.top + r.height / 2;

    const dx = rx - cx;
    const dy = ry - cy;

    // Hard direction gate — the candidate must be on the correct
    // side. We use bounding-box edge relations instead of centres
    // so sibling tiles in a row are still candidates for left/right.
    switch (dir) {
      case "up":
        if (r.bottom > cur.top + 1) continue;
        break;
      case "down":
        if (r.top < cur.bottom - 1) continue;
        break;
      case "left":
        if (r.right > cur.left + 1) continue;
        break;
      case "right":
        if (r.left < cur.right - 1) continue;
        break;
    }

    const primary = dir === "up" || dir === "down" ? Math.abs(dy) : Math.abs(dx);
    const perp = dir === "up" || dir === "down" ? Math.abs(dx) : Math.abs(dy);
    const score = primary + perp * 0.5;

    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }

  return best;
}

const ARROW_KEY_TO_DIR: Record<string, Dir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

export function useDpadNav(options: DpadNavOptions = {}): void {
  // `onSelect` and `onBack` are read via optionsRef below so they
  // always see the latest closures without re-registering the
  // keydown listener; they are intentionally not destructured here.
  const { enabled = true, group, initialFocusSelector } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      const key = event.key;
      if (key === "Escape" || key === "Backspace") {
        if (optionsRef.current.onBack) {
          event.preventDefault();
          optionsRef.current.onBack();
        }
        return;
      }

      if (key === "Enter" || key === " ") {
        const active = document.activeElement as HTMLElement | null;
        if (
          active &&
          active.dataset.focusable === "true" &&
          (optionsRef.current.group
            ? active.dataset.focusGroup === optionsRef.current.group
            : true)
        ) {
          event.preventDefault();
          optionsRef.current.onSelect?.(active);
        }
        return;
      }

      const dir = ARROW_KEY_TO_DIR[key];
      if (!dir) return;

      event.preventDefault();
      const candidates = getFocusables(optionsRef.current.group);
      if (candidates.length === 0) return;

      const active = document.activeElement as HTMLElement | null;
      const startsAtFocusable =
        active &&
        active.dataset.focusable === "true" &&
        candidates.includes(active);
      const current = startsAtFocusable ? active! : candidates[0];

      if (!startsAtFocusable) {
        current.focus();
        return;
      }

      const next = findNeighbour(current, dir, candidates);
      if (next) {
        next.focus();
      }
    },
    [],
  );

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    // Initial focus — move to the configured selector or the first
    // focusable in the group, but only if nothing is focused yet.
    const active = document.activeElement as HTMLElement | null;
    const alreadyFocused =
      active && active.dataset.focusable === "true";
    if (!alreadyFocused) {
      const candidates = getFocusables(group);
      if (candidates.length > 0) {
        const initial = initialFocusSelector
          ? (document.querySelector(initialFocusSelector) as HTMLElement | null)
          : candidates[0];
        initial?.focus();
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [enabled, group, initialFocusSelector, handleKey]);
}

// Expose the internal helper for unit tests — not part of the public API.
export const __internal = { findNeighbour, getFocusables };
