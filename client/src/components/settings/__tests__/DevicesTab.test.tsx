/**
 * DevicesTab tests — the discoverable Settings surface for multi-device
 * consolidation.
 *
 * Mocks the `social_devices_list` / `social_consolidate_pending` / accept /
 * reject IPC wrappers (same module `useConsolidation` calls) rather than
 * `useConsolidation` itself, so the hook's real state machine (loading →
 * loaded, optimistic removal on accept/reject) is exercised end to end.
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const {
  socialDevicesListMock,
  socialConsolidatePendingMock,
  socialConsolidateAcceptMock,
  socialConsolidateRejectMock,
  usePlatformMock,
} = vi.hoisted(() => ({
  socialDevicesListMock: vi.fn(),
  socialConsolidatePendingMock: vi.fn(),
  socialConsolidateAcceptMock: vi.fn(),
  socialConsolidateRejectMock: vi.fn(),
  usePlatformMock: vi.fn(() => ({
    isTauri: true,
    isTV: false,
    hasTouchOnly: false,
  })),
}));

vi.mock("../../../hooks/usePlatform", () => ({
  usePlatform: usePlatformMock,
}));

vi.mock("../../../api/social/consolidate", () => ({
  socialDevicesList: socialDevicesListMock,
  socialConsolidatePending: socialConsolidatePendingMock,
  socialConsolidateAccept: socialConsolidateAcceptMock,
  socialConsolidateReject: socialConsolidateRejectMock,
}));

import { DevicesTab } from "../DevicesTab";

const LOCAL_DEVICE = {
  deviceId: "device-local",
  ownerId: "@alice:example.concordchat.net",
  peerId: "12D3KooWLocalDevice",
  label: "This laptop",
  lastSyncAt: null,
};

const REMOTE_DEVICE = {
  deviceId: "device-remote",
  ownerId: "@alice:example.concordchat.net",
  peerId: "12D3KooWRemoteDevice",
  label: null,
  lastSyncAt: "2026-07-19T10:00:00Z",
};

const PROPOSAL = {
  id: "proposal-1",
  localDevice: LOCAL_DEVICE,
  remoteDevice: REMOTE_DEVICE,
  conflicts: ["display name differs"],
};

describe("<DevicesTab />", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    socialDevicesListMock.mockResolvedValue([REMOTE_DEVICE]);
    socialConsolidatePendingMock.mockResolvedValue([]);
  });

  it("lists known devices once the IPC call resolves", async () => {
    render(<DevicesTab />);

    await waitFor(() => {
      expect(screen.getByTestId("devices-list")).toBeInTheDocument();
    });
    expect(screen.getByTestId(`devices-row-${REMOTE_DEVICE.deviceId}`)).toHaveTextContent(
      "12D3KooWRemoteDevice".slice(0, 12),
    );
    expect(
      screen.getByText("No pending consolidation proposals."),
    ).toBeInTheDocument();
  });

  it("shows a pending proposal with both devices and lets the user accept it", async () => {
    // Initial mount sees the pending proposal; the hook's post-accept
    // `refresh()` re-fetches and (per the Rust side) no longer finds it.
    socialConsolidatePendingMock
      .mockResolvedValueOnce([PROPOSAL])
      .mockResolvedValue([]);
    socialConsolidateAcceptMock.mockResolvedValue(PROPOSAL);
    const user = userEvent.setup();

    render(<DevicesTab />);

    await waitFor(() => {
      expect(screen.getByTestId(`devices-proposal-${PROPOSAL.id}`)).toBeInTheDocument();
    });
    expect(screen.getByText("This laptop")).toBeInTheDocument();
    expect(screen.getByText(/1 conflict\(s\)/)).toBeInTheDocument();

    await user.click(screen.getByTestId(`devices-proposal-accept-${PROPOSAL.id}`));

    await waitFor(() => {
      expect(socialConsolidateAcceptMock).toHaveBeenCalledWith(PROPOSAL.id);
    });
    // Optimistic removal — the proposal disappears once accepted.
    await waitFor(() => {
      expect(
        screen.queryByTestId(`devices-proposal-${PROPOSAL.id}`),
      ).not.toBeInTheDocument();
    });
  });

  it("lets the user reject a pending proposal", async () => {
    socialConsolidatePendingMock.mockResolvedValue([PROPOSAL]);
    socialConsolidateRejectMock.mockResolvedValue(undefined);
    const user = userEvent.setup();

    render(<DevicesTab />);

    await waitFor(() => {
      expect(screen.getByTestId(`devices-proposal-${PROPOSAL.id}`)).toBeInTheDocument();
    });

    await user.click(screen.getByTestId(`devices-proposal-reject-${PROPOSAL.id}`));

    await waitFor(() => {
      expect(socialConsolidateRejectMock).toHaveBeenCalledWith(PROPOSAL.id);
    });
    await waitFor(() => {
      expect(
        screen.queryByTestId(`devices-proposal-${PROPOSAL.id}`),
      ).not.toBeInTheDocument();
    });
  });

  it("renders a native-only message on the web build", async () => {
    usePlatformMock.mockReturnValueOnce({
      isTauri: false,
      isTV: false,
      hasTouchOnly: false,
    });

    render(<DevicesTab />);

    // Web build short-circuits to the native-only notice; the proposal/device
    // lists never render, regardless of what the (mocked) IPC layer returns.
    expect(
      screen.getByText(/available in the desktop app/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("devices-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("devices-proposals")).not.toBeInTheDocument();
    // Let the hook's in-flight (mocked) refresh settle before the test ends,
    // so its state updates don't leak an act() warning into a later test.
    await waitFor(() => expect(socialDevicesListMock).toHaveBeenCalled());
  });
});
