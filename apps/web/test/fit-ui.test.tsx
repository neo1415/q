// @vitest-environment jsdom
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Fit with your mandate on screen (brief B1-B4; ADR 0052): words, never a
 * number; every parameter a glyph and a word; unknown neutral; Q's view
 * labelled and separate; the card opens the profile; every state says
 * what it is.
 */

vi.mock("../src/features/fit/fit-actions", () => ({
  fitProfilesAction: () => Promise.resolve(null),
  fitQViewAction: () => Promise.resolve(null),
  fitTopAction: () => Promise.resolve(null),
}));
vi.mock("../src/features/network/connection-actions", () => ({
  answerConnectionRequestAction: () => Promise.reject(new Error("injected")),
}));

const fixtures = await import("../app/dev/match/fixtures");
const { FitScore } = await import("../src/features/fit/fit-breakdown");
const { CompanyRequestCard } =
  await import("../src/features/fit/company-request-card");
const { FitPanel } = await import("../src/features/fit/fit-panel");
const { FitComparisonView } =
  await import("../src/features/fit/fit-comparison");
const { FitTopView } = await import("../src/features/fit/fit-top-view");
const { RelationshipFitChips } =
  await import("../src/features/fit/relationship-fit-chips");
const { ConnectionRequestsInbox } =
  await import("../src/features/network/connection-requests-inbox");
const { askedAgo, cardReasons, compareByFit } =
  await import("../src/features/fit/fit-words");

configure({ asyncUtilTimeout: 8000 });
afterEach(() => cleanup());

const NOW = Date.parse("2026-10-05T21:40:00.000Z");
const { KORA, HARVEST, FREIGHTLY, SUNLINE, TOP3, FITS, VIEWS } = fixtures;

describe("the fit score", () => {
  it("is the band and confidence in words, never a number", () => {
    const { container } = render(
      <FitScore
        name="Kora Health"
        companyId={KORA.fit.companyId}
        profile={KORA.fit.profile}
      />,
    );
    const button = screen.getByRole("button", {
      name: /Good fit, medium confidence, 1 unknown/,
    });
    expect(button.textContent).toContain("Good fit");
    expect(button.textContent).toContain("Medium confidence");
    expect(container.textContent).not.toMatch(/\d+\s*%|\/\s*10|score/i);
    expect(container.querySelectorAll("[data-fit-glyph]")).toHaveLength(9);
  });

  it("opens every parameter with its word and reason; unknown is neutral, not a mismatch", () => {
    render(
      <FitScore
        name="Kora Health"
        companyId={KORA.fit.companyId}
        profile={KORA.fit.profile}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Show why/ }));
    const sheet = document.querySelector("[data-fit-breakdown]");
    expect(sheet).not.toBeNull();
    const rows = sheet?.querySelectorAll("[data-fit-parameter]") ?? [];
    expect(rows).toHaveLength(9);
    const round = sheet?.querySelector('[data-fit-parameter="ROUND_TERMS"]');
    expect(round?.textContent).toContain("Unknown");
    expect(round?.textContent).toContain("Round terms not shared.");
    expect(
      round?.querySelector("[data-fit-glyph]")?.getAttribute("data-fit-glyph"),
    ).toBe("UNKNOWN");
    expect(sheet?.textContent).toContain(
      "Unknown never counts against a company",
    );
    expect(sheet?.textContent).toContain("Fit rules version 4");
  });
});

describe("a Company request card", () => {
  it("shows the score, the top reasons, the main mismatch, Q's view and opens the profile", () => {
    render(
      <CompanyRequestCard
        companyId={FREIGHTLY.fit.companyId}
        name="Freightly"
        requestedAt="2026-09-30T21:40:00.000Z"
        fit={FREIGHTLY.fit}
        qView={FREIGHTLY.view}
        now={NOW}
        outcome={<button type="button">Accept</button>}
      />,
    );
    const why = screen.getByRole("list", { name: "Why" });
    expect(
      within(why).getByText(
        "Raising Series A; your mandate is pre-seed to seed.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Q's view: Probably not\./)).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Open Freightly's profile" })
        .getAttribute("href"),
    ).toBe(`/company/${FREIGHTLY.fit.companyId}`);
    expect(screen.getByText("Asked 5 days ago")).toBeTruthy();
  });

  it("without a fit, says why instead of showing a poor one", () => {
    render(
      <CompanyRequestCard
        companyId={KORA.fit.companyId}
        name="Kora Health"
        requestedAt="2026-10-05T10:00:00.000Z"
        fit={null}
        now={NOW}
        outcome={null}
      />,
    );
    expect(screen.getByText(/Fit shows once your mandate is set/)).toBeTruthy();
    expect(screen.queryByText(/Q's view/)).toBeNull();
  });

  it("puts the unknown it should ask about third when nothing mismatches", () => {
    expect(cardReasons(HARVEST.fit.profile).map((r) => r.outcome)).toEqual([
      "STRONG",
      "STRONG",
      "UNKNOWN",
    ]);
    expect(cardReasons(FREIGHTLY.fit.profile).at(-1)?.outcome).toBe("MISMATCH");
  });
});

describe("Company requests", () => {
  it("sorts by best fit first, then newest or waiting longest on request", () => {
    render(
      <ConnectionRequestsInbox
        items={fixtures.requests(NOW)}
        fits={FITS}
        qViews={VIEWS}
        now={NOW}
      />,
    );
    const names = () =>
      [...document.querySelectorAll("[data-company-request] h2")].map(
        (h) => h.textContent,
      );
    expect(names()).toEqual([
      "Sunline Energy",
      "Kora Health",
      "Harvest Ledger",
      "Freightly",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Waiting longest" }));
    expect(names()[0]).toBe("Harvest Ledger");
    expect(screen.getByText(/waiting longest/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Newest" }));
    expect(names()[0]).toBe("Sunline Energy");
    expect(screen.getByText("4 waiting")).toBeTruthy();
  });

  it("a member who cannot answer reads but cannot accept", () => {
    render(
      <ConnectionRequestsInbox
        items={fixtures.requests(NOW)}
        fits={FITS}
        qViews={VIEWS}
        answerable={false}
        now={NOW}
      />,
    );
    for (const button of screen.getAllByRole("button", { name: "Accept" })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("orders a company without a fit last, never first", () => {
    expect(compareByFit(null, SUNLINE.fit.profile)).toBeGreaterThan(0);
    expect(compareByFit(SUNLINE.fit.profile, KORA.fit.profile)).toBeLessThan(0);
    expect(askedAgo("2026-09-27T21:40:00.000Z", NOW)).toBe("Asked 1 week ago");
  });
});

describe("the fit panel (profile)", () => {
  it("loading, nothing to show, and ready", () => {
    const { rerender, container } = render(
      <FitPanel
        companyId={KORA.fit.companyId}
        name="Kora Health"
        fit={{ status: "LOADING" }}
        qView={null}
      />,
    );
    expect(
      container.querySelector('[data-fit-panel="LOADING"]'),
    ).not.toBeNull();
    rerender(
      <FitPanel
        companyId={KORA.fit.companyId}
        name="Kora Health"
        fit={{ status: "NONE" }}
        qView={null}
      />,
    );
    expect(container.textContent).toBe("");
    rerender(
      <FitPanel
        companyId={KORA.fit.companyId}
        name="Kora Health"
        fit={{ status: "READY", fit: KORA.fit }}
        qView={KORA.view}
      />,
    );
    expect(screen.getByText("Fit with your mandate")).toBeTruthy();
    expect(screen.getByText("Q's view, not a verified fact")).toBeTruthy();
    expect(container.querySelectorAll("[data-fit-glyph]")).toHaveLength(9);
  });
});

describe("top N side by side", () => {
  it("renders every entry in the model's order with Q's view beside it", () => {
    render(<FitComparisonView comparison={TOP3} qViews={VIEWS} />);
    const table = screen.getByRole("table", { name: "Top 3 side by side" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent ?? "")
        .join(" "),
    ).toMatch(/1.*Sunline Energy.*2.*Tally Pay.*3.*Kora Health/);
    expect(
      within(table)
        .getAllByRole("rowheader")
        .map((h) => h.textContent),
    ).toContain("Q's view");
    expect(screen.queryByText(/Best/)).toBeNull();
  });

  it("marks a best only where the model says one is strictly better", () => {
    const withBest = {
      ...TOP3,
      entries: TOP3.entries.map((e, j) =>
        j === 0 ? { ...e, bestOn: ["TEAM" as const] } : e,
      ),
    };
    render(<FitComparisonView comparison={withBest} qViews={VIEWS} />);
    expect(screen.getAllByText("Best of 3").length).toBeGreaterThan(0);
  });

  it("says each state in words", () => {
    const { rerender } = render(<FitTopView state={{ kind: "NO_MANDATE" }} />);
    expect(screen.getByText("Set your mandate to see fit")).toBeTruthy();
    rerender(<FitTopView state={{ kind: "ERROR" }} />);
    expect(screen.getByText("The comparison didn't load")).toBeTruthy();
    rerender(
      <FitTopView
        state={{ kind: "READY", comparison: { ...TOP3, entries: [] } }}
      />,
    );
    expect(screen.getByText("No companies fit your mandate yet")).toBeTruthy();
    rerender(
      <FitTopView state={{ kind: "READY", comparison: TOP3 }} qViews={VIEWS} />,
    );
    expect(
      screen.getByRole("heading", { name: "Your top three right now" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Why these three?" }));
    expect(
      screen.getByText("left out by rules you set in your mandate"),
    ).toBeTruthy();
  });
});

describe("relationship fit chips", () => {
  it("band and confidence, up to three strong parameters and the first unknown", () => {
    const { container } = render(
      <RelationshipFitChips profile={KORA.fit.profile} />,
    );
    expect(container.textContent).toContain("Good fit · medium confidence");
    expect(container.textContent).toContain("Round unknown");
    expect(
      container.querySelectorAll('[data-fit-glyph="STRONG"]'),
    ).toHaveLength(3);
  });

  it("says fit is not set up when there is no mandate", () => {
    render(<RelationshipFitChips profile={null} />);
    expect(screen.getByText("Fit not set up")).toBeTruthy();
  });
});
