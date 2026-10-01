// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * "Hide from Q" on the person's own line (founder live 2026-10-01): the
 * line stays in their history; the Q API keeps it out of what Q reads.
 */

const hide = vi.fn(() => Promise.resolve({ ok: true as const, value: null }));
vi.mock("../src/features/q/actions", () => ({
  hideQMessageAction: (...args: unknown[]) => hide(...(args as [])),
}));

const { HideFromQ } = await import("../src/features/q/hide-from-q");

const CONVERSATION = "f0000000-0000-4000-8000-000000000002";
const MESSAGE = "f0000000-0000-4000-8000-000000000003";

describe("Hide from Q", () => {
  it("hides their line through the Q API and says it stays in their history", async () => {
    render(<HideFromQ conversationId={CONVERSATION} messageId={MESSAGE} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Hide from Q" }));
      await Promise.resolve();
    });
    expect(hide).toHaveBeenCalledWith(CONVERSATION, MESSAGE);
    expect(screen.getByRole("status").textContent).toContain(
      "Hidden from Q. It stays in your history.",
    );
  });

  it("offers nothing for a line that is not stored yet, or outside a conversation", () => {
    const { container } = render(
      <HideFromQ conversationId={CONVERSATION} messageId="live-line-1" />,
    );
    expect(container.textContent).toBe("");
    const none = render(
      <HideFromQ conversationId={null} messageId={MESSAGE} />,
    );
    expect(none.container.textContent).toBe("");
  });
});
