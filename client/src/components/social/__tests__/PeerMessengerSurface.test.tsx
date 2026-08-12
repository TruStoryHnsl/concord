/**
 * Cold-session coverage for PeerMessengerSurface — the full-pane p2p
 * messenger (client/src/components/social/PeerMessengerSurface.tsx).
 *
 * N2 cold-reader test. The surface's job is to pick the RIGHT messenger
 * for the platform: on native (Tauri) it mounts the live device inbox
 * (SocialInboxPanel / SocialPeersPanel); on web it mounts the roamed +
 * pillar-backed threaded messenger (WebPeerHistory). We assert which
 * surface the user actually gets on each platform, and that the tab
 * toggle switches Messages↔Peers — mocking the heavy panels down to
 * sentinels so this test is about the routing decision, not their guts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("../inbox/SocialInboxPanel", () => ({
  SocialInboxPanel: () => <div data-testid="native-inbox">native inbox</div>,
}));
vi.mock("../peers/SocialPeersPanel", () => ({
  SocialPeersPanel: () => <div data-testid="native-peers">native peers</div>,
}));
vi.mock("../WebPeerHistory", () => ({
  WebPeerHistory: ({ tab }: { tab: string }) => (
    <div data-testid="web-history">web history: {tab}</div>
  ),
}));

import { PeerMessengerSurface } from "../PeerMessengerSurface";
import { usePeerMessengerSurfaceStore } from "../../../stores/peerMessengerSurface";

function setTauri(on: boolean) {
  if (on) (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  else delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
}

describe("PeerMessengerSurface — platform picks the messenger", () => {
  beforeEach(() => {
    usePeerMessengerSurfaceStore.setState({
      tab: "messages",
      initialPeerId: null,
      initialPersonaId: null,
    });
  });
  afterEach(() => {
    cleanup();
    setTauri(false);
    vi.clearAllMocks();
  });

  it("web build mounts the WebPeerHistory threaded messenger", () => {
    setTauri(false);
    render(<PeerMessengerSurface />);
    expect(screen.getByTestId("web-history")).toBeInTheDocument();
    expect(screen.queryByTestId("native-inbox")).not.toBeInTheDocument();
  });

  it("native build mounts the live device inbox, not the web mirror", () => {
    setTauri(true);
    render(<PeerMessengerSurface />);
    expect(screen.getByTestId("native-inbox")).toBeInTheDocument();
    expect(screen.queryByTestId("web-history")).not.toBeInTheDocument();
  });

  it("the Peers tab switches the surface (web)", async () => {
    setTauri(false);
    render(<PeerMessengerSurface />);
    expect(screen.getByTestId("web-history")).toHaveTextContent("messages");
    await userEvent.click(screen.getByTestId("peer-messenger-tab-peers"));
    expect(screen.getByTestId("web-history")).toHaveTextContent("peers");
  });

  it("the Peers tab switches native panels (native)", async () => {
    setTauri(true);
    render(<PeerMessengerSurface />);
    expect(screen.getByTestId("native-inbox")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("peer-messenger-tab-peers"));
    expect(screen.getByTestId("native-peers")).toBeInTheDocument();
    expect(screen.queryByTestId("native-inbox")).not.toBeInTheDocument();
  });
});
