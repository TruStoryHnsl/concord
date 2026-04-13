import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { SourcesPanel } from "../SourcesPanel";
import { useSourcesStore } from "../../../stores/sources";

describe("<SourcesPanel />", () => {
  beforeEach(() => {
    useSourcesStore.setState({
      sources: [
        {
          id: "src_matrix",
          host: "matrix.org",
          instanceName: "Matrix",
          inviteToken: "",
          apiBase: "https://matrix.org",
          homeserverUrl: "https://matrix.org",
          status: "connected",
          enabled: true,
          addedAt: new Date().toISOString(),
          platform: "matrix",
        },
      ],
    });
  });

  it("left click toggles the source and notifies selection", () => {
    const onSourceSelect = vi.fn();
    render(
      <SourcesPanel
        onAddSource={() => {}}
        onSourceSelect={onSourceSelect}
      />,
    );

    fireEvent.click(screen.getByTitle("Matrix — Matrix"));

    expect(useSourcesStore.getState().sources[0].enabled).toBe(false);
    expect(onSourceSelect).toHaveBeenCalledWith("src_matrix");
  });

  it("right click opens the source menu without toggling the source", () => {
    const onSourceOpen = vi.fn();
    render(
      <SourcesPanel
        onAddSource={() => {}}
        onSourceOpen={onSourceOpen}
      />,
    );

    fireEvent.contextMenu(screen.getByTitle("Matrix — Matrix"));

    expect(useSourcesStore.getState().sources[0].enabled).toBe(true);
    expect(screen.getByRole("button", { name: /open source menu/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /disable source/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /open source menu/i }));

    expect(onSourceOpen).toHaveBeenCalledWith("src_matrix");
  });
});
