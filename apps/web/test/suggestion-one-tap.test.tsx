// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * C8: a suggestion Q wrote runs as it is tapped. Q opens beside the page
 * already answering it; nothing is left in a box to send again.
 */

const ask = vi.fn(async () => undefined);
vi.mock("next/navigation", () => ({ usePathname: () => "/relationships" }));
vi.mock("@/features/q/q-session", () => ({
  QSessionProvider: ({ children }: { children: React.ReactNode }) => children,
  useQSessionOptional: () => ({
    q: { ask, conversationId: null },
    voice: { active: false, client: { connected: false, sendText: vi.fn() } },
    turns: [],
  }),
}));
vi.mock("@/features/q/q-sheet", () => ({
  QSheetConversation: ({ seed }: { seed?: string | null }) => (
    <p data-testid="sheet-seed">{seed ?? "(empty)"}</p>
  ),
}));

const { GlobalQProvider, useGlobalQ } =
  await import("../src/components/app-shell/global-q");

function Suggestion() {
  const { askNow } = useGlobalQ();
  return (
    <button
      type="button"
      onClick={() => askNow("Where does our relationship stand?")}
    >
      suggestion
    </button>
  );
}

afterEach(cleanup);

describe("one tap on a suggestion", () => {
  it("sends it once, and opens Q with an empty composer", async () => {
    render(
      <GlobalQProvider subject={{ kind: "NONE", scope: "unset" }} connected>
        <Suggestion />
      </GlobalQProvider>,
    );
    act(() => screen.getByRole("button", { name: "suggestion" }).click());
    expect(ask).toHaveBeenCalledOnce();
    expect(ask).toHaveBeenCalledWith("Where does our relationship stand?");
    expect((await screen.findByTestId("sheet-seed")).textContent).toBe(
      "(empty)",
    );
  });
});
