import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import NodeChip from "./NodeChip";

describe("NodeChip", () => {
  it("renders the label text", () => {
    render(<NodeChip status="active" label="Online Node" />);
    expect(screen.getByText("Online Node")).toBeInTheDocument();
  });

  it("applies active status styles", () => {
    const { container } = render(<NodeChip status="active" label="Active" />);
    const chip = container.firstChild as HTMLElement;
    expect(chip.className).toContain("bg-secondary/10");
    expect(chip.className).toContain("text-secondary");
  });

  it("applies inactive status styles", () => {
    const { container } = render(<NodeChip status="inactive" label="Offline" />);
    const chip = container.firstChild as HTMLElement;
    expect(chip.className).toContain("bg-surface-container-high");
    expect(chip.className).toContain("text-on-surface-variant");
  });

  it("applies backbone status styles", () => {
    const { container } = render(<NodeChip status="backbone" label="Backbone" />);
    const chip = container.firstChild as HTMLElement;
    expect(chip.className).toContain("bg-primary/10");
    expect(chip.className).toContain("text-primary");
  });

  it("renders the status dot indicator", () => {
    const { container } = render(<NodeChip status="active" label="Test" />);
    const dot = container.querySelector("span span");
    expect(dot).not.toBeNull();
    expect(dot!.className).toContain("rounded-full");
  });
});
