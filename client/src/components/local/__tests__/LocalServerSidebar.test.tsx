/**
 * LocalServerSidebar — single-tile layout.
 *
 * The porch/home two-tile architecture was RETIRED (user order,
 * incident 2026-08-11): the rail shows ONE local space — the user's
 * persistent home. The ephemeral guest porch stays unmounted. See the
 * component's tile-construction comment; this suite pins that contract.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { LocalServerSidebar } from "../LocalServerSidebar";
import { useHomeServerNameStore } from "../../../stores/homeServerName";
import { useLocalServerSelectionStore } from "../../../stores/localServerSelection";

// `useHomeServerNameStore.load()` calls into the api wrapper which
// reaches for `@tauri-apps/api/core`. We don't need any of that in
// jsdom — stub the load to a no-op so the component renders against
// the store's default.
vi.mock("../../../api/homeServer", () => ({
  getHomeServerName: vi.fn().mockResolvedValue("home"),
  setHomeServerName: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  useHomeServerNameStore.setState({
    name: "home",
    loading: false,
    error: null,
  });
  useLocalServerSelectionStore.setState({ active: "home" });
});

describe("LocalServerSidebar — single local-space tile", () => {
  it("renders ONLY the home tile on desktop — the porch tile stays unmounted", () => {
    render(<LocalServerSidebar />);
    const home = screen.getByTestId("local-server-tile-home");
    expect(home).toBeTruthy();
    expect(home.textContent).toContain("H");
    expect(screen.queryByTestId("local-server-tile-porch")).toBeNull();
  });

  it("renders ONLY the home tile on mobile", () => {
    render(<LocalServerSidebar mobile />);
    expect(screen.getByTestId("local-server-tile-home")).toBeTruthy();
    expect(screen.queryByTestId("local-server-tile-porch")).toBeNull();
  });

  it("reflects the user-set home-server name on the home tile", () => {
    useHomeServerNameStore.setState({
      name: "studio",
      loading: false,
      error: null,
    });
    render(<LocalServerSidebar />);
    const home = screen.getByTestId("local-server-tile-home");
    // "studio" → first-letter abbreviation "S".
    expect(home.textContent).toContain("S");
    // The title attribute carries the full label.
    expect(home.getAttribute("title")).toBe("studio");
  });

  it("falls back to 'My space' when no vanity name is set", () => {
    useHomeServerNameStore.setState({ name: "", loading: false, error: null });
    render(<LocalServerSidebar />);
    const home = screen.getByTestId("local-server-tile-home");
    expect(home.getAttribute("title")).toBe("My space");
  });

  it("clicking the home tile updates the selection store and fires the callback", () => {
    const onServerSelect = vi.fn();
    useLocalServerSelectionStore.setState({ active: "porch" });
    render(<LocalServerSidebar onServerSelect={onServerSelect} />);

    fireEvent.click(screen.getByTestId("local-server-tile-home"));
    expect(useLocalServerSelectionStore.getState().active).toBe("home");
    expect(onServerSelect).toHaveBeenCalledTimes(1);
  });

  it("home tile is the default active selection on a fresh store", () => {
    render(<LocalServerSidebar />);
    const home = screen.getByTestId("local-server-tile-home");
    expect(home.getAttribute("data-active")).toBe("true");
  });
});
