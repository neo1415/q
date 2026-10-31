// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
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

  // Lane 8 (owner's boss, 2026-10-22): "it attached, but the send button
  // did not come alive".
  it("sends on a finished attachment alone, and holds Send while one uploads", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <QComposer
        onSubmit={onSubmit}
        onAttach={vi.fn()}
        attachments={[
          { key: "a", label: "term-sheet.pdf · reading", state: "uploading" },
        ]}
      />,
    );
    const send = screen.getByRole("button", { name: "Send to Q" });
    expect(send.hasAttribute("disabled")).toBe(true);
    // Words typed while it uploads still wait for the document.
    await user.type(screen.getByRole("textbox", { name: "Ask Q" }), "Hi");
    expect(send.hasAttribute("disabled")).toBe(true);
    await user.clear(screen.getByRole("textbox", { name: "Ask Q" }));
    rerender(
      <QComposer
        onSubmit={onSubmit}
        onAttach={vi.fn()}
        attachments={[{ key: "a", label: "term-sheet.pdf", state: "ready" }]}
      />,
    );
    expect(send.hasAttribute("disabled")).toBe(false);
    await user.click(send);
    expect(onSubmit).toHaveBeenCalledWith("");
  });

  it("a failed attachment alone sends nothing", () => {
    render(
      <QComposer
        onSubmit={vi.fn()}
        onAttach={vi.fn()}
        attachments={[{ key: "a", label: "x · too large", state: "failed" }]}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "Send to Q" })
        .hasAttribute("disabled"),
    ).toBe(true);
  });

  it("attaches a file dropped on the composer", () => {
    const onAttach = vi.fn();
    render(<QComposer onSubmit={vi.fn()} onAttach={onAttach} />);
    const form = screen.getByRole("form", { name: "Ask Q" });
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    const dataTransfer = { types: ["Files"], files: [file], dropEffect: "" };
    fireEvent.dragOver(form, { dataTransfer });
    expect(form.hasAttribute("data-dragging")).toBe(true);
    fireEvent.drop(form, { dataTransfer });
    expect(onAttach).toHaveBeenCalledWith(file);
    expect(form.hasAttribute("data-dragging")).toBe(false);
  });

  // Live 2026-10-31: an Enter right as Q's reply landed did nothing for two
  // minutes, the words left in the box. A typed message is never dropped.
  it("an Enter while Q is still working keeps the words and sends them once it is free", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = render(<QComposer onSubmit={onSubmit} disabled />);
    const input = screen.getByRole("textbox", { name: "Ask Q" });
    // Held, never `disabled`: it keeps focus and takes their words.
    expect(input.hasAttribute("disabled")).toBe(false);
    await user.type(input, "I'm the CEO");
    await user.keyboard("{Enter}");
    expect(onSubmit).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe("I'm the CEO");
    rerender(<QComposer onSubmit={onSubmit} disabled={false} />);
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith("I'm the CEO");
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("an Enter while the last message is still sending is sent after it, not lost", async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const onSubmit = vi
      .fn<(text: string) => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>((done) => {
            release = done;
          }),
      )
      .mockResolvedValue(undefined);
    render(<QComposer onSubmit={onSubmit} />);
    const input = screen.getByRole("textbox", { name: "Ask Q" });
    await user.type(input, "yes{Enter}");
    expect(onSubmit).toHaveBeenNthCalledWith(1, "yes");
    await user.type(input, " and three founders");
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(2);
    });
  });
});
