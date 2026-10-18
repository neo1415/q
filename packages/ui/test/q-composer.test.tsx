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

  it("opens with a draft the person can still edit, and sends nothing on its own", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <QComposer initialValue="Is the stage supported?" onSubmit={onSubmit} />,
    );
    const input = screen.getByRole("textbox", { name: "Ask Q" });
    expect((input as HTMLTextAreaElement).value).toBe(
      "Is the stage supported?",
    );
    expect(onSubmit).not.toHaveBeenCalled();
    await user.type(input, " Really?");
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledWith("Is the stage supported? Really?");
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

  it("is one compact line by default: field, microphone and send in one row", () => {
    render(
      <QComposer onSubmit={vi.fn()} onVoice={vi.fn()} showContext={false} />,
    );
    const input = screen.getByRole("textbox", { name: "Ask Q" });
    expect(input.getAttribute("rows")).toBe("1");
    const row = input.closest("[data-q-composer-row]");
    expect(row).not.toBeNull();
    expect(
      row?.contains(screen.getByRole("button", { name: "Send to Q" })),
    ).toBe(true);
    expect(
      row?.contains(screen.getByRole("button", { name: "Talk with Q" })),
    ).toBe(true);
    // Nothing else below it when there is no context and nothing live.
    const form = screen.getByRole("form", { name: "Ask Q" });
    expect(form.children).toHaveLength(1);
  });

  it("grows with what is typed up to a cap, then scrolls inside itself", async () => {
    const user = userEvent.setup();
    render(<QComposer onSubmit={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "Ask Q" });
    expect(input.className).toMatch(/\[field-sizing:content\]/);
    expect(input.className).toMatch(/\bmax-h-40\b/);
    expect(input.className).toMatch(/\boverflow-y-auto\b/);
    Object.defineProperty(input, "scrollHeight", {
      configurable: true,
      get: () => 96,
    });
    await user.type(input, "one{Shift>}{Enter}{/Shift}two");
    // The fallback sizes to the content; the class's max-height caps it.
    expect((input as HTMLTextAreaElement).style.height).toBe("96px");
  });
});
