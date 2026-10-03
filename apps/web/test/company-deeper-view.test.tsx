// @vitest-environment jsdom
import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CompanyNetworkFact,
  RecommendationExplanationDto,
} from "@capital-q/contracts";

/**
 * The company profile's deeper view (CQ-WEB-024).
 *
 * What this suite holds the page to: the three ADR-001 axes stay three
 * separate statements, unknown reads as unknown rather than a zero,
 * disagreeing statements sit side by side with none chosen, "Ask Q" opens
 * the one global Q with the fact as a draft, and "why it's in your feed"
 * reads the feed's remembered slate without ever moving it — Back must
 * still land on the same card.
 *
 * The explanation action is mocked at its module boundary: it is a
 * `"use server"` file and the real one needs a session and the Q API.
 */

type ExplanationResult =
  | { readonly kind: "EXPLAINED"; readonly value: RecommendationExplanationDto }
  | { readonly kind: "UNAVAILABLE" };

const explainRecommendationAction =
  vi.fn<(slateId: string, companyId: string) => Promise<ExplanationResult>>();
const askAbout = vi.fn<(seed: string) => void>();

vi.mock("../src/features/company/explanation-action", () => ({
  explainRecommendationAction: (slateId: string, companyId: string) =>
    explainRecommendationAction(slateId, companyId),
}));

vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ open: false, setOpen: vi.fn(), askAbout }),
}));

const { CompanyDeeperView, factQuestion } =
  await import("../src/features/company/company-deeper-view");

configure({ asyncUtilTimeout: 10_000 });

const COMPANY_ID = "f0000000-0000-4000-8000-000000000001";
const SLATE_ID = "a1000000-0000-4000-8000-000000000001";
const POSITION_KEY = "cq.discover.feed.position";

const declared = {
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  lifecycleStatus: "CURRENT",
  source: "COMPANY_PROFILE",
} as const;

const FACTS: CompanyNetworkFact[] = [
  { key: "currentStageCode", statements: [{ value: "seed", ...declared }] },
  { key: "headquartersCountry", statements: [{ value: "NG", ...declared }] },
  { key: "headquartersCity", statements: [] },
  { key: "foundedDate", statements: [] },
  { key: "legalName", statements: [] },
  {
    key: "websiteUrl",
    statements: [{ value: "https://kivu.example", ...declared }],
  },
];

function openDisclosure(name: "why" | "evidence"): HTMLElement {
  const details = document.querySelector<HTMLDetailsElement>(
    `[data-deeper-view="${name}"]`,
  );
  if (details === null) throw new Error(`no ${name} disclosure`);
  details.open = true;
  fireEvent(details, new Event("toggle"));
  return details;
}

beforeEach(() => {
  window.sessionStorage.clear();
  explainRecommendationAction.mockReset();
  askAbout.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("what is known, and how well supported", () => {
  it("is open on arrival", () => {
    render(
      <CompanyDeeperView
        companyId={COMPANY_ID}
        companyName="Kivu Freight"
        facts={FACTS}
      />,
    );
    expect(
      document.querySelector<HTMLDetailsElement>(
        '[data-deeper-view="evidence"]',
      )?.open,
    ).toBe(true);
  });

  it("keeps the three axes and the source separate, in words", () => {
    render(
      <CompanyDeeperView
        companyId={COMPANY_ID}
        companyName="Kivu Freight"
        facts={FACTS}
      />,
    );
    openDisclosure("evidence");

    const stage = document.querySelector<HTMLElement>(
      '[data-fact="currentStageCode"]',
    );
    if (stage === null) throw new Error("no stage fact");
    expect(stage.getAttribute("data-fact-state")).toBe("stated");
    // The declared code is labelled, never shown as a code.
    expect(within(stage).queryByText("seed")).toBeNull();

    const axes = [...stage.querySelectorAll("[data-axis]")].map((node) => [
      node.getAttribute("data-axis"),
      node.getAttribute("data-value"),
      node.querySelector("dd")?.textContent,
    ]);
    expect(axes).toEqual([
      ["claim", "USER_CLAIM", "The company's own claim"],
      ["support", "SELF_REPORTED", "Self-reported"],
      ["status", "CURRENT", "Current"],
      ["source", "COMPANY_PROFILE", "The company's profile"],
    ]);
    // Declared is never presented as verified.
    expect(stage.textContent).not.toMatch(/verified/i);
  });

  it("shows an undeclared fact as unknown — never a zero, a blank or a negative", () => {
    render(
      <CompanyDeeperView
        companyId={COMPANY_ID}
        companyName="Kivu Freight"
        facts={FACTS}
      />,
    );
    openDisclosure("evidence");
    const founded = document.querySelector<HTMLElement>(
      '[data-fact="foundedDate"]',
    );
    if (founded === null) throw new Error("no founded fact");
    expect(founded.getAttribute("data-fact-state")).toBe("unknown");
    expect(within(founded).getByText("Unknown")).toBeTruthy();
    expect(founded.textContent).not.toMatch(/\b0\b|none|n\/a/i);
    expect(founded.querySelectorAll("[data-axis]")).toHaveLength(0);
  });

  it("puts disagreeing statements side by side and chooses neither", () => {
    const disputed: CompanyNetworkFact = {
      key: "foundedDate",
      statements: [
        { value: "2021-03-01", ...declared },
        {
          value: "2019-06-01",
          ...declared,
          lifecycleStatus: "CONTRADICTORY",
        },
      ],
    };
    render(
      <CompanyDeeperView
        companyId={COMPANY_ID}
        companyName="Kivu Freight"
        facts={[disputed]}
      />,
    );
    openDisclosure("evidence");
    const founded = document.querySelector<HTMLElement>(
      '[data-fact="foundedDate"]',
    );
    if (founded === null) throw new Error("no founded fact");
    expect(founded.getAttribute("data-fact-state")).toBe("contradictory");
    expect(within(founded).getByText("2021-03-01")).toBeTruthy();
    expect(within(founded).getByText("2019-06-01")).toBeTruthy();
    expect(within(founded).getByText(/Neither has been chosen/)).toBeTruthy();
    expect(within(founded).getByText("Contradicted")).toBeTruthy();
    expect(factQuestion("Kivu Freight", disputed)).toContain(
      '"2021-03-01" and "2019-06-01"',
    );
  });

  it("asks the one global Q about a fact, with the fact as a draft", () => {
    render(
      <CompanyDeeperView
        companyId={COMPANY_ID}
        companyName="Kivu Freight"
        facts={FACTS}
      />,
    );
    openDisclosure("evidence");
    fireEvent.click(screen.getByRole("button", { name: "Ask Q about stage" }));
    expect(askAbout).toHaveBeenCalledTimes(1);
    const seed = askAbout.mock.calls[0]?.[0] ?? "";
    expect(seed).toContain("Kivu Freight");
    expect(seed).toContain("stage");
    expect(seed).toContain("self-reported");

    fireEvent.click(
      screen.getByRole("button", { name: "Ask Q about founded" }),
    );
    expect(askAbout.mock.calls[1]?.[0]).toContain("hasn't declared");
  });
});

describe("why it's in your feed", () => {
  const EXPLANATION: RecommendationExplanationDto = {
    slateId: SLATE_ID,
    companyId: COMPANY_ID,
    rank: 2,
    summary: "It is at the stage and in the country your mandate names.",
    matchedFactors: [
      {
        dimension: "STAGE",
        outcome: "MATCH",
        label: "Seed, in your stage range",
        reasonCode: "STAGE_ALIGNED",
      },
    ],
    mismatchedFactors: [],
    uncertainties: [
      {
        dimension: "CHEQUE",
        outcome: "UNKNOWN",
        label: "Raise size not declared",
        reasonCode: "CHEQUE_UNKNOWN",
      },
    ],
    generatedFromRankingVersion: "ranker.v1/config.v1",
    source: "DETERMINISTIC",
  };

  it("is absent when the reader did not come from their feed", () => {
    render(
      <CompanyDeeperView
        companyId={COMPANY_ID}
        companyName="Kivu Freight"
        facts={FACTS}
      />,
    );
    expect(document.querySelector('[data-deeper-view="why"]')).toBeNull();
    expect(explainRecommendationAction).not.toHaveBeenCalled();
  });

  it("a connected company (live 2026-10-02, Zino and Nixo): no feed explanation, a way to the relationship instead", () => {
    // Even arriving from the feed: Discover no longer serves a company
    // they are connected with, so there is nothing of the feed to explain.
    window.sessionStorage.setItem(
      POSITION_KEY,
      JSON.stringify({ slateId: SLATE_ID, companyId: COMPANY_ID }),
    );
    render(
      <CompanyDeeperView
        companyId={COMPANY_ID}
        companyName="Kivu Freight"
        facts={FACTS}
        connected
      />,
    );
    expect(document.querySelector('[data-deeper-view="why"]')).toBeNull();
    expect(screen.queryByText("Why it's in your feed")).toBeNull();
    const link = screen.getByRole("link", { name: "See your relationship" });
    expect(link.getAttribute("href")).toBe(
      `/relationships/company/${COMPANY_ID}`,
    );
    expect(explainRecommendationAction).not.toHaveBeenCalled();
  });

  it("explains from the feed's own slate on first open, and never moves the feed position", async () => {
    const position = JSON.stringify({
      slateId: SLATE_ID,
      companyId: "b2000000-0000-4000-8000-000000000002",
    });
    window.sessionStorage.setItem(POSITION_KEY, position);
    explainRecommendationAction.mockResolvedValue({
      kind: "EXPLAINED",
      value: EXPLANATION,
    });

    render(
      <CompanyDeeperView
        companyId={COMPANY_ID}
        companyName="Kivu Freight"
        facts={FACTS}
      />,
    );
    // Nothing is asked until the reader opens it.
    expect(explainRecommendationAction).not.toHaveBeenCalled();
    const why = openDisclosure("why");
    openDisclosure("why");

    expect(await within(why).findByText(EXPLANATION.summary)).toBeTruthy();
    expect(explainRecommendationAction).toHaveBeenCalledTimes(1);
    expect(explainRecommendationAction).toHaveBeenCalledWith(
      SLATE_ID,
      COMPANY_ID,
    );
    expect(within(why).getByText("Matches your mandate")).toBeTruthy();
    expect(within(why).getByText("Seed, in your stage range")).toBeTruthy();
    // Unknown is its own group, and is not counted as a mismatch.
    expect(
      within(why).getByText("Not known yet — not counted against it"),
    ).toBeTruthy();
    expect(within(why).queryByText("Doesn't match")).toBeNull();
    // No score reaches the reader.
    expect(why.textContent).not.toMatch(/%|score|rank/i);

    // The feed's remembered place is exactly as it was: Back restores it.
    expect(window.sessionStorage.getItem(POSITION_KEY)).toBe(position);
  });

  it("says plainly when there is nothing to explain", async () => {
    window.sessionStorage.setItem(
      POSITION_KEY,
      JSON.stringify({ slateId: SLATE_ID, companyId: COMPANY_ID }),
    );
    explainRecommendationAction.mockResolvedValue({ kind: "UNAVAILABLE" });
    render(
      <CompanyDeeperView
        companyId={COMPANY_ID}
        companyName="Kivu Freight"
        facts={FACTS}
      />,
    );
    const why = openDisclosure("why");
    expect(
      await within(why).findByText(/no recommendation to explain/),
    ).toBeTruthy();
  });
});
