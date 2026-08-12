import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MessageContent } from "../MessageContent";

const baseMessage = {
  id: "evt_1",
  sender: "@alice:example.concordchat.net",
  timestamp: Date.now(),
  redacted: false,
  edited: false,
  msgtype: "m.text",
  url: null,
  reactions: [],
};

describe("<MessageContent /> markdown rendering", () => {
  it("renders gfm tables from plain markdown", () => {
    render(
      <MessageContent
        message={{
          ...baseMessage,
          body: "| Column | Value |\n| --- | --- |\n| A | B |",
        }}
      />,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Column")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("renders custom alignment and sizing wrappers", () => {
    const { container } = render(
      <MessageContent
        message={{
          ...baseMessage,
          body: "[center]Centered[/center]\n\n[large]Big callout[/large]",
        }}
      />,
    );

    expect(container.querySelector(".text-center")).toBeTruthy();
    expect(container.querySelector(".text-\\[1\\.15em\\]")).toBeTruthy();
  });
});
