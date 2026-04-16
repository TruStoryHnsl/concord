/**
 * LaunchAnimation smoke tests.
 *
 * Verifies the overlay renders on mount and calls onComplete after the
 * animation sequence. Uses fake timers so the 1000ms total duration does
 * not slow the test suite.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { LaunchAnimation } from "../LaunchAnimation";

const TOTAL_DURATION = 1000; // FADE_IN(300) + HOLD(400) + FADE_OUT(300)

describe("LaunchAnimation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the branded overlay on mount", () => {
    const onComplete = vi.fn();
    render(<LaunchAnimation onComplete={onComplete} />);

    // The overlay is aria-hidden, so look by its background presence.
    // The wordmark text "Concord" is the simplest observable element.
    expect(screen.getByText("Concord")).toBeDefined();
  });

  it("calls onComplete after TOTAL_DURATION ms", () => {
    const onComplete = vi.fn();
    render(<LaunchAnimation onComplete={onComplete} />);

    expect(onComplete).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(TOTAL_DURATION);
    });

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("removes the overlay from the DOM after onComplete fires", () => {
    const onComplete = vi.fn();
    const { container } = render(<LaunchAnimation onComplete={onComplete} />);

    // Before completion — overlay exists
    expect(container.firstChild).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(TOTAL_DURATION);
    });

    // After completion — component returns null
    expect(container.firstChild).toBeNull();
  });

  it("does not call onComplete before animation finishes", () => {
    const onComplete = vi.fn();
    render(<LaunchAnimation onComplete={onComplete} />);

    act(() => {
      vi.advanceTimersByTime(TOTAL_DURATION - 1);
    });

    expect(onComplete).not.toHaveBeenCalled();
  });
});
