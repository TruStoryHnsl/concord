/**
 * Tests for TVCapabilityBanner component.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TVCapabilityBanner } from "../TVCapabilityBanner";

describe("TVCapabilityBanner", () => {
  it("renders the default message for a voice feature", () => {
    render(<TVCapabilityBanner feature="Voice" />);

    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByText(/voice is not available on tv devices/i)).toBeDefined();
  });

  it("renders a custom message when provided", () => {
    render(
      <TVCapabilityBanner
        feature="Camera"
        message="No camera hardware on Apple TV."
      />,
    );

    expect(screen.getByText("No camera hardware on Apple TV.")).toBeDefined();
  });

  it("uses volume_off icon for voice features", () => {
    const { container } = render(<TVCapabilityBanner feature="Voice" />);

    const icon = container.querySelector(".tv-capability-banner-icon");
    expect(icon?.textContent).toBe("volume_off");
  });

  it("uses videocam_off icon for non-voice features", () => {
    const { container } = render(<TVCapabilityBanner feature="Video" />);

    const icon = container.querySelector(".tv-capability-banner-icon");
    expect(icon?.textContent).toBe("videocam_off");
  });

  it("dismisses when the close button is clicked", () => {
    const onDismiss = vi.fn();
    render(<TVCapabilityBanner feature="Voice" onDismiss={onDismiss} />);

    const dismissBtn = screen.getByLabelText(/dismiss voice unavailable/i);
    fireEvent.click(dismissBtn);

    expect(onDismiss).toHaveBeenCalledOnce();
    // After dismissal, the banner should be gone
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("has data-focusable attribute on the dismiss button for DPAD nav", () => {
    render(<TVCapabilityBanner feature="Voice" />);

    const dismissBtn = screen.getByLabelText(/dismiss voice unavailable/i);
    expect(dismissBtn.getAttribute("data-focusable")).toBe("true");
    expect(dismissBtn.getAttribute("data-focus-group")).toBe("tv-main");
  });
});
