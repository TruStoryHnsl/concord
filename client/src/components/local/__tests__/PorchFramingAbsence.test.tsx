/**
 * WS-3 — porch / home-server framing removed from user-facing surfaces
 * (COLD QA, authored by a reader who did NOT write the feature).
 *
 * The refactor's contract: NO user-facing RENDERED text says "porch",
 * "home server"/"home-server", or "a place you visit". Internal identifiers
 * — data-testids (e.g. `local-server-tile-porch`), CSS class names, store
 * keys, module paths, and the `porch:<peerid>` protocol scheme — are allowed
 * to keep the word. So this test scans ONLY what a user can actually read:
 *   - visible text nodes (container.textContent), and
 *   - the user-facing attributes title / aria-label / placeholder / alt.
 * It deliberately does NOT look at data-testid / class / id.
 *
 * It also asserts the REPLACEMENT vocabulary the user is supposed to see:
 * the local space reads as the user's own ("My space" / a vanity name) and
 * the guest doorman reads as "Guests".
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

import { LocalServerSidebar } from "../LocalServerSidebar";
import { FirstLaunchTwoNameBanner } from "../FirstLaunchTwoNameBanner";
import { useHomeServerNameStore } from "../../../stores/homeServerName";
import { useInstanceNameStore } from "../../../stores/instanceName";
import { useLocalServerSelectionStore } from "../../../stores/localServerSelection";

// LocalServerSidebar's store hydration reaches for @tauri-apps/api/core via
// the homeServer api wrapper — stub it (same posture as the sibling test).
vi.mock("../../../api/homeServer", () => ({
  getHomeServerName: vi.fn().mockResolvedValue("home"),
  setHomeServerName: vi.fn().mockResolvedValue(undefined),
}));

const FORBIDDEN = [/porch/i, /home[\s-]?server/i, /a place you visit/i];

/** Collect every string a USER can read from a rendered subtree: visible
 *  text plus the user-facing attributes. Excludes data-testid/class/id. */
function userVisibleStrings(root: HTMLElement): string {
  const parts: string[] = [root.textContent ?? ""];
  for (const el of Array.from(root.querySelectorAll("*"))) {
    for (const attr of ["title", "aria-label", "placeholder", "alt"]) {
      const v = el.getAttribute(attr);
      if (v) parts.push(v);
    }
  }
  return parts.join(" • ");
}

beforeEach(() => {
  cleanup();
  window.sessionStorage.clear();
  useHomeServerNameStore.setState({ name: "home", loading: false, error: null });
  useInstanceNameStore.setState({ name: "", loading: false, error: null });
  useLocalServerSelectionStore.setState({ active: "home" });
});

describe("WS-3 — no porch / home-server framing in rendered UI", () => {
  // NOTE: the porch/home two-tile architecture is RETIRED (user order,
  // incident 2026-08-11) — the guest-doorman tile stays unmounted, so the
  // rail shows only the user's own space. The forbidden-vocabulary scan is
  // still the contract; the "Guests" replacement label no longer renders.
  it("the local server rail shows the space name, never 'porch'", () => {
    useHomeServerNameStore.setState({
      name: "studio",
      loading: false,
      error: null,
    });
    const { container } = render(<LocalServerSidebar />);
    const visible = userVisibleStrings(container);

    for (const bad of FORBIDDEN) {
      expect(visible).not.toMatch(bad);
    }
    // The home tile carries the vanity name as its user-facing title.
    expect(visible).toMatch(/studio/);
  });

  it("no porch vocabulary before a vanity name is set", () => {
    const { container } = render(<LocalServerSidebar />);
    const visible = userVisibleStrings(container);
    for (const bad of FORBIDDEN) {
      expect(visible).not.toMatch(bad);
    }
    // Default local-space label when no vanity name is set.
    expect(visible).toMatch(/My space|home/);
  });

  it("the first-launch banner names the space without porch / home-server copy", () => {
    // The banner only renders on a truly fresh install: BOTH name stores
    // blank and the dismiss flag unset.
    useHomeServerNameStore.setState({ name: "", loading: false, error: null });
    useInstanceNameStore.setState({ name: "", loading: false, error: null });
    const { container } = render(<FirstLaunchTwoNameBanner />);
    const visible = userVisibleStrings(container);

    for (const bad of FORBIDDEN) {
      expect(visible).not.toMatch(bad);
    }
    // New vocabulary: a "guest space" that's automatic + "private space".
    expect(visible).toMatch(/guest space/i);
    expect(visible).toMatch(/private space/i);
    // The private-space input still prompts with the "My space" placeholder.
    expect(visible).toMatch(/My space/);
  });
});
