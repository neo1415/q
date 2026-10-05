// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Ask Q about a relationship (founder design 2026-09-28): each starting
 * question and the person's own line open Q with exactly that question.
 */

const askAbout = vi.fn<(seed: string) => void>();
vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ open: false, setOpen: vi.fn(), askAbout, askNow: askAbout }),
}));

const { AskQRelationshipPanel } =
  await import("../src/features/relationships/ask-q-relationship");

afterEach(() => {
  cleanup();
  askAbout.mockReset();
});

describe("Ask Q about this relationship", () => {
  it("asks a starting question naming the counterpart", () => {
    render(<AskQRelationshipPanel counterpart="Ledgerfold" />);
    fireEvent.click(
      screen.getByRole("button", { name: "Draft a follow-up message" }),
    );
    expect(askAbout).toHaveBeenCalledWith(
      "Draft a follow-up message to Ledgerfold.",
    );
  });

  it("asks the person's own question and sends nothing empty", () => {
    render(<AskQRelationshipPanel counterpart="Ledgerfold" />);
    const ask = screen.getByRole("button", { name: "Ask" });
    expect(ask.hasAttribute("disabled")).toBe(true);
    fireEvent.change(
      screen.getByRole("textbox", { name: "Ask Q anything about Ledgerfold" }),
      { target: { value: "  When did we last talk?  " } },
    );
    fireEvent.click(ask);
    expect(askAbout).toHaveBeenCalledWith("When did we last talk?");
  });
});
