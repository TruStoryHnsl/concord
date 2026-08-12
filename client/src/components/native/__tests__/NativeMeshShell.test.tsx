/**
 * Cold-session coverage for NativeMeshShell — the native app's primary UI
 * (client/src/components/native/NativeMeshShell.tsx).
 *
 * N2 cold-reader test. Everything asserted is what the user SEES on the
 * native mesh messenger, discovered from the outside:
 *   - it boots into Chats (the p2p messenger is the front door, no home
 *     server, no Discord chrome);
 *   - the left nav switches Chats / Peers / Network;
 *   - Reticulum is a CONNECTION (listed under "Connections"), NOT one of
 *     the three core sections — the incident was emphatic that reticulum
 *     is a chosen path, not the core transport;
 *   - "Connect an instance" is present and opens the add-source flow;
 *   - entering a docker instance flips the shell to instance-mode (hides
 *     the mesh shell, shows the return chip / the ChatLayout beneath), and
 *     leaving returns to the shell.
 *
 * Heavy children are mocked to sentinels: this is about the shell's
 * navigation and mode, not the panels' internals.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const visibleSources = vi.fn(() => [] as unknown[]);
const switchToSource = vi.fn<(...a: unknown[]) => void>();
const fetchConnectorLayerGraph = vi.fn<
  (...a: unknown[]) => Promise<{ nodes: unknown[]; edges: unknown[] }>
>(() => Promise.resolve({ nodes: [] as unknown[], edges: [] as unknown[] }));

vi.mock("../../../stores/sources", () => ({
  useVisibleSources: () => visibleSources(),
}));
vi.mock("../../../lib/switchToSource", () => ({
  switchToSource: (...a: unknown[]) => switchToSource(...a),
}));
vi.mock("../../../api/connectors", () => ({
  fetchConnectorLayerGraph: (...a: unknown[]) => fetchConnectorLayerGraph(...a),
}));
vi.mock("../../social/inbox/SocialInboxPanel", () => ({
  SocialInboxPanel: () => <div data-testid="mock-chats">chats panel</div>,
}));
vi.mock("../../social/peers/SocialPeersPanel", () => ({
  SocialPeersPanel: () => <div data-testid="mock-peers">peers panel</div>,
}));
vi.mock("../../mesh/MeshMap", () => ({
  MeshMap: () => <div data-testid="mock-network">network map</div>,
}));
vi.mock("../../settings/ReticulumInterfacesPanel", () => ({
  ReticulumInterfacesPanel: () => (
    <div data-testid="mock-interfaces">interfaces</div>
  ),
}));
vi.mock("../../settings/SettingsModal", () => ({
  SettingsPanel: () => <div data-testid="mock-settings">settings</div>,
}));
vi.mock("../../sources/sourceBrand", () => ({
  inferSourceBrand: () => "matrix",
  SourceBrandIcon: () => <span data-testid="brand-icon" />,
}));
vi.mock("../../layout/ChatLayout", () => ({
  AddSourceModal: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="mock-add-source">
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

import { NativeMeshShell } from "../NativeMeshShell";
import { useNativeShellStore } from "../../../stores/nativeShell";
import { useSettingsStore } from "../../../stores/settings";

function makeInstanceSource() {
  return {
    id: "src-bob",
    isLocal: false,
    platform: "matrix",
    enabled: true,
    instanceName: "Bob's Concord",
    host: "bob.example",
  };
}

describe("NativeMeshShell — native mesh messenger", () => {
  beforeEach(() => {
    useNativeShellStore.setState({
      mode: "shell",
      section: "chats",
      chatPeerId: null,
    });
    useSettingsStore.setState({ settingsOpen: false });
    visibleSources.mockReturnValue([]);
    fetchConnectorLayerGraph.mockResolvedValue({ nodes: [], edges: [] });
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("boots into the Chats section", () => {
    render(<NativeMeshShell />);
    expect(screen.getByTestId("native-mesh-shell")).toBeInTheDocument();
    // Chats is the front door.
    expect(screen.getByTestId("mock-chats")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-network")).not.toBeInTheDocument();
  });

  it("the nav switches Chats / Peers / Network", async () => {
    render(<NativeMeshShell />);
    await userEvent.click(screen.getByTestId("shell-nav-peers"));
    expect(screen.getByTestId("mock-peers")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("shell-nav-network"));
    expect(screen.getByTestId("mock-network")).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("shell-nav-chats"));
    expect(screen.getByTestId("mock-chats")).toBeInTheDocument();
  });

  it("Reticulum is under Connections, NOT a core nav section", () => {
    render(<NativeMeshShell />);
    // The three core sections exist...
    expect(screen.getByTestId("shell-nav-chats")).toBeInTheDocument();
    expect(screen.getByTestId("shell-nav-peers")).toBeInTheDocument();
    expect(screen.getByTestId("shell-nav-network")).toBeInTheDocument();
    // ...but reticulum is NOT one of them.
    expect(screen.queryByTestId("shell-nav-reticulum")).not.toBeInTheDocument();
    // It lives under the "Connections" group as a connection entry.
    expect(screen.getByText("Connections")).toBeInTheDocument();
    expect(screen.getByTestId("shell-connection-reticulum")).toBeInTheDocument();
  });

  it("opening Reticulum reveals its Announces (with hops) and Interfaces tabs", async () => {
    fetchConnectorLayerGraph.mockResolvedValue({
      nodes: [
        {
          peerId: "deadbeefdeadbeefdeadbeefdeadbeef",
          hopDistance: 2,
          nodeKind: "announce-peer",
          connectionState: "online",
          hopCount: 2,
          interfaceType: "TCPInterface",
          transport: false,
        },
      ],
      edges: [],
    });
    render(<NativeMeshShell />);
    await userEvent.click(screen.getByTestId("shell-connection-reticulum"));

    // Announces tab is the default reticulum view; the heard peer shows up
    // with a Message affordance and its hop count.
    const msgBtn = await screen.findByTestId(
      "shell-announce-message-deadbeefdeadbeefdeadbeefdeadbeef",
    );
    expect(msgBtn).toBeInTheDocument();
    expect(screen.getByText(/2 hops/)).toBeInTheDocument();

    // Switching to Interfaces shows the interfaces panel.
    await userEvent.click(screen.getByTestId("shell-reticulum-tab-interfaces"));
    expect(screen.getByTestId("mock-interfaces")).toBeInTheDocument();
  });

  it("'Connect an instance' is present and opens the add-source flow", async () => {
    render(<NativeMeshShell />);
    const connect = screen.getByTestId("shell-connect-instance");
    expect(connect).toBeInTheDocument();
    expect(screen.queryByTestId("mock-add-source")).not.toBeInTheDocument();

    await userEvent.click(connect);
    expect(screen.getByTestId("mock-add-source")).toBeInTheDocument();
  });

  it("entering an instance flips to instance-mode; leaving returns to the shell", async () => {
    visibleSources.mockReturnValue([makeInstanceSource()]);
    render(<NativeMeshShell />);

    // The instance is listed in Connections.
    const instanceBtn = screen.getByTestId("shell-instance-src-bob");
    expect(instanceBtn).toHaveTextContent("Bob's Concord");

    // Entering it hides the mesh shell and shows the return chip (the
    // always-mounted ChatLayout is revealed beneath in the real app).
    await userEvent.click(instanceBtn);
    expect(switchToSource).toHaveBeenCalledWith("src-bob");
    await waitFor(() =>
      expect(screen.queryByTestId("native-mesh-shell")).not.toBeInTheDocument(),
    );
    const chip = screen.getByTestId("shell-return-chip");
    expect(chip).toBeInTheDocument();

    // Leaving returns to the mesh shell.
    await userEvent.click(chip);
    expect(screen.getByTestId("native-mesh-shell")).toBeInTheDocument();
    expect(screen.getByTestId("mock-chats")).toBeInTheDocument();
  });

  it("with no instances, shows the empty-state hint but still offers Connect", () => {
    visibleSources.mockReturnValue([]);
    render(<NativeMeshShell />);
    expect(screen.getByTestId("shell-instances-empty")).toBeInTheDocument();
    expect(screen.getByTestId("shell-connect-instance")).toBeInTheDocument();
  });
});
