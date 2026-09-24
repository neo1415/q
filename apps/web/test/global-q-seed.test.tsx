// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * "Ask Q about this" from a page opens the one global Q sheet with a draft
 * (CQ-WEB-024) — not a second Q surface — and the draft belongs to that
 * opening only: close the sheet and the next plain "Ask Q" starts empty.
 *
 * The conversation itself is mocked; what is under test is the shell's
 * hand-off of the draft to it.
 */

vi.mock("@/features/q/q-sheet", () => ({
  QSheetConversation: ({ seed }: { seed?: string | null }) => (
    <p data-testid="sheet-seed">{seed ?? "(empty)"}</p>
  ),
}));

const { GlobalQProvider, useGlobalQ } =
  await import("../src/components/app-shell/global-q");

/** A page's own controls: ask about a fact, or open and close Q plainly. */
function Page() {
  const { askAbout, setOpen } = useGlobalQ();
  return (
    <>
      <button type="button" onClick={() => askAbout("Is the stage supported?")}>
        ask about
      </button>
      <button type="button" onClick={() => setOpen(false)}>
        close
      </button>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
    </>
  );
}

afterEach(() => {
  cleanup();
});

describe("the global Q sheet's draft", () => {
  it("opens with the page's draft, and drops it when closed", async () => {
    render(
      <GlobalQProvider subject={{ kind: "NONE", scope: "unset" }} connected>
        <Page />
      </GlobalQProvider>,
    );
    expect(screen.queryByTestId("sheet-seed")).toBeNull();

    act(() => screen.getByRole("button", { name: "ask about" }).click());
    expect((await screen.findByTestId("sheet-seed")).textContent).toBe(
      "Is the stage supported?",
    );

    act(() => {
      controlsOf("close").click();
    });
    act(() => {
      controlsOf("open").click();
    });
    expect((await screen.findByTestId("sheet-seed")).textContent).toBe(
      "(empty)",
    );
  });
});

/**
 * The page's own buttons. An open sheet is modal, so they are found in the
 * DOM rather than by role, which rightly hides what sits behind a dialog.
 */
function controlsOf(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (button === undefined) throw new Error(`no ${label} button`);
  return button;
}
