import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useProximityPairStore } from "../../../stores/proximityPair";
import { TapToPairSheet } from "../TapToPairSheet";

vi.mock("../../BringingUpSplash", () => ({
  BringingUpSplash: () => <div data-testid="splash" />,
}));

beforeEach(() => {
  useProximityPairStore.setState({ phase: "idle", code: null, error: null, remote: null });
});

describe("TapToPairSheet", () => {
  it("shows the splash while searching", () => {
    useProximityPairStore.setState({ phase: "searching" });
    render(<TapToPairSheet open onClose={() => {}} />);
    expect(screen.getByTestId("splash")).toBeInTheDocument();
  });

  it("shows the 6-digit code in awaitingConfirm", () => {
    useProximityPairStore.setState({ phase: "awaitingConfirm", code: "428913" });
    render(<TapToPairSheet open onClose={() => {}} />);
    expect(screen.getByText("428913")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /confirm/i })).toBeInTheDocument();
  });
});
