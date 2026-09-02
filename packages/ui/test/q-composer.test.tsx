// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  Q_COMPOSER_PLACEHOLDER,
  QComposer,
} from "../src/patterns/q-composer.js";

describe("QComposer", () => {
  it("has a real accessible label, not just a placeholder", () => {
    render(<QComposer />);
    const input = screen.getByRole("textbox", { name: "Ask Q" });
    expect(input.getAttribute("placeholder")).toBe(Q_COMPOSER_PLACEHOLDER);
    expect(screen.getByRole("form", { name: "Ask Q" })).toBeTruthy();
  });

  it("keeps submit disabled until there is a question", async () => {
    const user = userEvent.setup();
    render(<QComposer />);
    const send = screen.getByRole("button", { name: "Send to Q" });
    expect(send.hasAttribute("disabled")).toBe(true);
    await user.type(screen.getByRole("textbox", { name: "Ask Q" }), "  ");
    expect(send.hasAttribute("disabled")).toBe(true);
    await user.type(
      screen.getByRole("textbox", { name: "Ask Q" }),
      "What is my runway?",
    );
    expect(send.hasAttribute("disabled")).toBe(false);
  });

  it("submits on Enter and keeps Shift+Enter for a new line", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<QComposer onSubmit={onSubmit} />);
    const input = screen.getByRole("textbox", { name: "Ask Q" });
    await user.type(input, "First line{Shift>}{Enter}{/Shift}second");
    expect(onSubmit).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("First line\nsecond");
  });

  it("never fabricates a response: without Q wired it says nothing was sent", async () => {
    const user = userEvent.setup();
    render(<QComposer />);
    await user.type(
      screen.getByRole("textbox", { name: "Ask Q" }),
      "Who should I talk to?",
    );
    await user.click(screen.getByRole("button", { name: "Send to Q" }));
    const notice = screen.getByRole("status");
    expect(notice.textContent).toContain("Nothing was sent");
    // The question is preserved for when Q is available.
    const textbox = screen.getByRole("textbox", { name: "Ask Q" });
    expect((textbox as HTMLTextAreaElement).value).toBe(
      "Who should I talk to?",
    );
  });

  it("shows the context it will ask in without inventing one", () => {
    render(<QComposer />);
    expect(screen.getByText("No context set")).toBeTruthy();
  });
});
