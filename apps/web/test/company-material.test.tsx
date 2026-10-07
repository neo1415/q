// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DECK_SECTIONS } from "@capital-q/contracts";

/**
 * Overnight A3-A6 on screen: the investor's data room lists exactly what
 * the API sent and asks before it sends a request; the founder's levels are
 * words with icons; Q's read of the deck is twelve sections in the same
 * order, swiped or stepped with arrows and keys, coverage only (never the
 * rubric) for investors; the coaching is weakest first.
 */

vi.mock("../src/features/company/material/material-actions", () => ({
  openDocumentAction: vi.fn(() =>
    Promise.resolve({
      ok: true,
      value: {
        url: "https://s.example/f",
        downloadable: false,
        watermark: "D · N · view only",
      },
    }),
  ),
  openDeckAction: vi.fn(() =>
    Promise.resolve({
      ok: true,
      value: {
        url: "https://s.example/d",
        downloadable: false,
        watermark: "D · view only",
      },
    }),
  ),
  requestAccessAction: vi.fn(() =>
    Promise.resolve({ ok: true, value: undefined }),
  ),
  decideRequestAction: vi.fn(() =>
    Promise.resolve({ ok: true, value: undefined }),
  ),
  setLevelAction: vi.fn(() => Promise.resolve({ ok: true, value: undefined })),
  confirmReadingAction: vi.fn(() =>
    Promise.resolve({ ok: true, value: undefined }),
  ),
  reviewSectionAction: vi.fn(() =>
    Promise.resolve({ ok: true, value: undefined }),
  ),
  readAgainAction: vi.fn(() =>
    Promise.resolve({ ok: true, value: { left: 1 } }),
  ),
  newRequestKey: vi.fn(() => Promise.resolve("dr-key-0001")),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

const { InvestorDataRoom, OwnerDataRoom } =
  await import("../src/features/company/material/data-room");
const { DeckCarousel } =
  await import("../src/features/company/material/deck-sections");
const { DeckCoach, DeckForReaders } =
  await import("../src/features/company/material/deck");
const fixtures =
  await import("../src/features/company/material/review-fixtures");

afterEach(cleanup);

describe("the investor's data room", () => {
  it("lists only what the API sent, with each level in words", () => {
    render(
      <InvestorDataRoom
        companyId={fixtures.REVIEW_COMPANY_ID}
        companyName="Kora Health"
        view={fixtures.reviewInvestorRoom()}
      />,
    );
    expect(screen.getByText("Cap table summary")).toBeTruthy();
    expect(screen.queryByText(/Litigation/)).toBeNull();
    expect(screen.getAllByText("On request").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Shared with you").length).toBeGreaterThan(0);
    // A waiting request is not offered twice.
    expect(screen.getByText("Requested")).toBeTruthy();
  });

  it("filters to what is open to them", () => {
    render(
      <InvestorDataRoom
        companyId={fixtures.REVIEW_COMPANY_ID}
        companyName="Kora Health"
        view={fixtures.reviewInvestorRoom()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open to you" }));
    expect(screen.queryByText("Memorandum and articles")).toBeNull();
    expect(screen.getByText("One-page summary")).toBeTruthy();
  });

  it("says plainly when nothing is open to them", () => {
    render(
      <InvestorDataRoom
        companyId={fixtures.REVIEW_COMPANY_ID}
        companyName="Kora Health"
        view={fixtures.reviewInvestorRoom(true)}
      />,
    );
    expect(
      screen.getByText(/Nothing in Kora Health’s data room is open to you yet/),
    ).toBeTruthy();
  });
});

describe("the founder's data room", () => {
  it("shows the checklist for their stage, the waiting request, and four levels per document", () => {
    render(
      <OwnerDataRoom
        companyId={fixtures.REVIEW_COMPANY_ID}
        view={fixtures.reviewOwnerRoom()}
      />,
    );
    expect(
      screen.getByText(/16 of 18 recommended for a seed round/),
    ).toBeTruthy();
    expect(screen.getByText("Daniel Reyes, Northbound Capital")).toBeTruthy();
    const group = screen.getByRole("radiogroup", {
      name: "Who can see One-page summary",
    });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Public", "On request", "Shared only", "Private"]);
    expect(
      within(group)
        .getByRole("radio", { name: "Public" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });
});

describe("Q's read of the deck", () => {
  const sections = fixtures.reviewDeck("INVESTOR").extraction?.sections ?? [];

  it("is twelve sections in the standard order, with arrows and keys", () => {
    const onIndex = vi.fn();
    render(
      <DeckCarousel
        sections={sections}
        downloadable={false}
        companyName="Kora Health"
        index={0}
        onIndex={onIndex}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(12);
    expect(tabs[0]?.textContent).toBe("Problem");
    expect(tabs[11]?.textContent).toBe("Team");
    expect(screen.getAllByRole("group", { name: /of 12$/ })).toHaveLength(
      DECK_SECTIONS.length,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next section" }));
    expect(onIndex).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(
      screen.getAllByRole("group", { name: /of 12$/ })[0]
        ?.parentElement as HTMLElement,
      { key: "ArrowRight" },
    );
    expect(onIndex).toHaveBeenCalled();
  });

  it("says a missing section honestly, never as zero, and labels each figure as the founder's claim with its slide", () => {
    render(
      <DeckCarousel
        sections={sections}
        downloadable={false}
        companyName="Kora Health"
        index={0}
        onIndex={() => undefined}
      />,
    );
    const competition = screen.getByRole("article", { name: "Competition" });
    expect(competition.textContent).toContain("Not in the deck yet");
    expect(competition.textContent).not.toMatch(/\b0\b/);
    const problem = screen.getByRole("article", { name: "Problem" });
    expect(problem.textContent).toContain("Founder's claim · Slide 2");
    expect(problem.textContent).toContain("deck is view only");
  });

  it("shows investors coverage only, never the rubric, whether or not the deck downloads", () => {
    for (const state of ["full", "downloadable"] as const) {
      const { container, unmount } = render(
        <DeckForReaders
          companyId={fixtures.REVIEW_COMPANY_ID}
          companyName="Kora Health"
          view={fixtures.reviewDeck("INVESTOR", state)}
        />,
      );
      expect(container.textContent).toContain("Q’s read of the deck");
      expect(container.textContent).toContain(
        state === "downloadable" ? "Can be downloaded" : "View only",
      );
      expect(container.textContent).not.toMatch(
        /Basic|Strong|Sections at standard/,
      );
      unmount();
    }
  });
});

describe("deck coaching", () => {
  it("lists sections weakest first and names what blocks the minimum standard", () => {
    const view = fixtures.reviewDeck("OWNER");
    if (view.coaching === null) throw new Error("coaching");
    const { container } = render(
      <DeckCoach
        companyId={fixtures.REVIEW_COMPANY_ID}
        view={view}
        coaching={view.coaching}
      />,
    );
    expect(screen.getByText("One step from the minimum standard")).toBeTruthy();
    const order = Array.from(
      container.querySelectorAll("[data-coach-section]"),
    ).map((node) => node.getAttribute("data-coach-section"));
    expect(order[0]).toBe("COMPETITION");
    expect(order.at(-1)).not.toBe("COMPETITION");
    expect(
      screen.getAllByRole("link", { name: "Let Q draft it" }).length,
    ).toBeGreaterThan(0);
    // The reading is not shown to investors until the founder confirms it.
    expect(
      screen.getByRole("button", { name: "Confirm all and show" }),
    ).toBeTruthy();
  });

  it("F26: one section can be marked wrong without holding back the rest, and Q can read again", async () => {
    const view = fixtures.reviewDeck("OWNER");
    if (view.coaching === null || view.extraction === null)
      throw new Error("fixture");
    render(
      <DeckCoach
        companyId={fixtures.REVIEW_COMPANY_ID}
        view={view}
        coaching={view.coaching}
      />,
    );
    const first = document.querySelector("[data-review-section]");
    expect(first).not.toBeNull();
    const wrong = within(first as HTMLElement).getByRole("button", {
      name: "This is wrong",
    });
    fireEvent.click(wrong);
    await waitFor(() =>
      expect(
        within(first as HTMLElement).getByText(/Marked as wrong/),
      ).toBeTruthy(),
    );
    const again = screen.getByRole("button", { name: "Ask Q to read again" });
    await waitFor(() =>
      expect((again as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(again);
    await waitFor(() =>
      expect(screen.getByText(/reading your deck again/)).toBeTruthy(),
    );
  });
});
