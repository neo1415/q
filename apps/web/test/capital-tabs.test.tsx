// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CapitalLedgerDto, ReadinessDto } from "@capital-q/contracts";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/capital",
  useRouter: () => ({ replace, refresh: () => undefined, push: vi.fn() }),
}));

const loads = vi.hoisted(() => ({
  ledger: vi.fn(),
  readiness: vi.fn(),
  relationships: vi.fn(),
  objective: vi.fn(),
  blueprint: vi.fn(),
}));
vi.mock("../src/features/q/context", () => ({
  apiSession: vi.fn(() => Promise.resolve(null)),
  resolveOwnContext: vi.fn(),
}));
vi.mock("../src/features/readiness/readiness-data", () => ({
  ownReadiness: loads.readiness,
}));
vi.mock("../src/features/relationships/relationship-data", () => ({
  ownRelationships: loads.relationships,
}));
vi.mock("../src/features/capital/capital-book", () => ({
  founderLedger: loads.ledger,
  investorCommitments: vi.fn(),
  draftFrom: vi.fn(),
  FounderBook: () => null,
  InvestorBook: () => null,
  CapitalSkeleton: () => null,
}));
vi.mock("@capital-q/api-client", () => ({
  ApiProblemError: class extends Error {},
  getCurrentCapitalObjective: loads.objective,
}));
vi.mock("../src/features/capital/readiness-blueprint", () => ({
  horizonFrom: () => 6,
  ReadinessBlueprintSection: loads.blueprint,
}));

import {
  nextSteps,
  needsYouCount,
  NextSteps,
  nowCount,
  RaiseSummary,
} from "../src/features/capital/capital-overview";
import { FounderTab } from "../src/features/capital/capital-screen";
import {
  CapitalTabBar,
  TabBadge,
} from "../src/features/capital/capital-tab-bar";
import {
  CAPITAL_TABS,
  capitalTabFrom,
  capitalTabHref,
  type CapitalTab,
  tabForHash,
} from "../src/features/capital/capital-tabs";

/** capital-tabs (founder 2026-10-08): one URL per tab, data per tab. */

const COMPANY = "11111111-1111-4111-8111-111111111111";

function action(
  key: string,
  priority: "NOW" | "NEXT" | "LATER",
  state: ReadinessDto["actions"][number]["state"] = "OPEN",
): ReadinessDto["actions"][number] {
  return {
    key,
    pillar: "INVESTMENT_READINESS",
    closesGapId: `gap.${key}`,
    priority,
    title: `Step ${key}`,
    why: "Why it matters.",
    next: `Do ${key}.`,
    doneWhen: "It is done.",
    owner: "FOUNDER",
    ownerLabel: "You",
    state,
    doneAt: null,
    href: null,
    askQ: null,
  };
}

const READINESS: ReadinessDto = {
  companyId: COMPANY,
  rulesVersion: "readiness-rules/v1",
  revision: 1,
  assessedAt: "2026-10-07T00:00:00.000Z",
  stageCode: "seed",
  pillars: [],
  blockers: [
    {
      id: "raise.use-of-funds",
      pillar: "INVESTMENT_READINESS",
      kind: "MISSING",
      title: "No use of funds",
      why: "A target with no plan reads as unfinished.",
      actionKey: "a",
    },
  ],
  actions: [
    action("later", "LATER"),
    action("next", "NEXT"),
    action("done", "NOW", "DONE_BY_EVIDENCE"),
    action("now", "NOW"),
    action("next2", "NEXT"),
  ],
  followUps: [],
  uncertainty: [],
};

describe("which tab a URL opens", () => {
  it("reads ?tab=, and anything unknown is Overview", () => {
    expect(capitalTabFrom({ tab: "action-plan" })).toBe("action-plan");
    expect(capitalTabFrom({ tab: "readiness" })).toBe("readiness");
    expect(capitalTabFrom({ tab: "nope" })).toBe("overview");
    expect(capitalTabFrom({})).toBe("overview");
  });

  it("keeps older links on their tab: ?round= is Raise, ?horizon= the plan", () => {
    expect(capitalTabFrom({ round: "abc" })).toBe("raise");
    expect(capitalTabFrom({ horizon: "12" })).toBe("plan");
    expect(capitalTabFrom({ tab: "readiness", round: "abc" })).toBe(
      "readiness",
    );
  });

  it("builds each tab's address; Overview is the page itself", () => {
    expect(capitalTabHref("overview")).toBe("/capital");
    expect(capitalTabHref("action-plan")).toBe("/capital?tab=action-plan");
    expect(capitalTabHref("plan", { horizon: "12" })).toBe(
      "/capital?tab=plan&horizon=12",
    );
  });

  it("maps the page's old anchors to their tabs", () => {
    expect(tabForHash("#action-plan")).toBe("action-plan");
    expect(tabForHash("#readiness")).toBe("readiness");
    expect(tabForHash("#readiness-blueprint")).toBe("plan");
    expect(tabForHash(`#round-${COMPANY}`)).toBe("raise");
    expect(tabForHash("#relationships")).toBe("investors");
    expect(tabForHash("")).toBeNull();
  });
});

describe("the tab bar", () => {
  beforeEach(() => {
    replace.mockClear();
    window.location.hash = "";
  });

  it("is an ARIA tablist with one selected, focusable tab", () => {
    render(<CapitalTabBar active="readiness" hadTabParam />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(
      CAPITAL_TABS.map((tab) => tab.label),
    );
    const selected = screen.getByRole("tab", { selected: true });
    expect(selected.textContent).toBe("Readiness");
    expect(selected.getAttribute("tabindex")).toBe("0");
    expect(selected.getAttribute("href")).toBe("/capital?tab=readiness");
    expect(
      tabs.filter((tab) => tab.getAttribute("tabindex") === "-1"),
    ).toHaveLength(5);
  });

  it("moves focus with the arrow keys, Home and End", () => {
    render(<CapitalTabBar active="overview" hadTabParam />);
    const tabs = screen.getAllByRole("tab");
    tabs[0]?.focus();
    fireEvent.keyDown(tabs[0] as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(tabs[1]);
    fireEvent.keyDown(tabs[1] as HTMLElement, { key: "End" });
    expect(document.activeElement).toBe(tabs[5]);
    fireEvent.keyDown(tabs[5] as HTMLElement, { key: "ArrowRight" });
    expect(document.activeElement).toBe(tabs[0]);
    fireEvent.keyDown(tabs[0] as HTMLElement, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tabs[5]);
    fireEvent.keyDown(tabs[5] as HTMLElement, { key: "Home" });
    expect(document.activeElement).toBe(tabs[0]);
  });

  it("shows badges with words for screen readers", () => {
    render(
      <CapitalTabBar
        active="overview"
        hadTabParam
        badges={{
          "action-plan": <TabBadge text="Now 1" spoken="1 step to do now" />,
        }}
      />,
    );
    const plan = screen.getByRole("tab", { name: /Action plan/u });
    expect(plan.textContent).toContain("Now 1");
    expect(plan.textContent).toContain("1 step to do now");
  });

  it("sends an old #anchor link to its tab, once, without a tab named", () => {
    window.location.hash = "#action-plan";
    render(<CapitalTabBar active="overview" hadTabParam={false} />);
    expect(replace).toHaveBeenCalledWith(
      "/capital?tab=action-plan#action-plan",
      { scroll: false },
    );
  });

  it("leaves a URL that names its tab alone", () => {
    window.location.hash = "#action-plan";
    render(<CapitalTabBar active="readiness" hadTabParam />);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("Overview", () => {
  it("puts open Now steps first, then Next, three at most", () => {
    expect(nextSteps(READINESS).map((step) => step.key)).toEqual([
      "now",
      "next",
      "next2",
    ]);
    expect(nowCount(READINESS)).toBe(1);
  });

  it("lists the next steps with the way to the board", () => {
    render(<NextSteps readiness={READINESS} />);
    expect(screen.getByText("Step now", { exact: false })).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open the action plan" }),
    ).toHaveProperty("pathname", "/capital");
  });

  it("says so in one sentence when the raise could not load", () => {
    render(<RaiseSummary ledger={null} />);
    expect(screen.getByText("Your rounds couldn't load.")).toBeTruthy();
  });

  it("counts commitments that wait on the founder", () => {
    const commitment = (
      id: string,
      next: "CONFIRM_AMOUNT" | null,
    ): CapitalLedgerDto["commitments"][number] => ({
      id,
      relationshipId: COMPANY,
      counterpartId: COMPANY,
      counterpartName: "Harbour Ventures",
      amount: "150000",
      currencyCode: "USD",
      level: "SOFT",
      status: "STATED",
      source: "PERSON",
      quote: null,
      roundId: null,
      statedByYourSide: false,
      transferReference: null,
      at: "2026-10-07T00:00:00.000Z",
      next,
    });
    const ledger: CapitalLedgerDto = {
      rounds: [],
      currentRoundId: null,
      totals: [],
      commitments: [
        commitment("22222222-2222-4222-8222-222222222222", "CONFIRM_AMOUNT"),
        commitment("33333333-3333-4333-8333-333333333333", null),
      ],
    };
    expect(needsYouCount(ledger)).toBe(1);
  });
});

describe("each tab reads only its own data", () => {
  const context = {
    kind: "FOUNDER",
    companyId: COMPANY,
    label: null,
  } as const;

  beforeEach(() => {
    for (const load of Object.values(loads)) {
      load.mockReset();
      load.mockResolvedValue(null);
    }
    loads.relationships.mockResolvedValue([]);
    loads.blueprint.mockReturnValue(null);
  });

  const cases: readonly (readonly [
    CapitalTab,
    readonly (keyof typeof loads)[],
  ])[] = [
    ["overview", ["ledger", "readiness"]],
    ["raise", ["ledger", "relationships"]],
    ["readiness", ["readiness"]],
    ["action-plan", ["readiness"]],
    ["investors", ["relationships"]],
    ["plan", []],
  ];

  it.each(cases)("%s", async (tab, expected) => {
    await FounderTab({ tab, context, horizon: 6 });
    for (const name of ["ledger", "readiness", "relationships"] as const) {
      expect(loads[name].mock.calls.length > 0, name).toBe(
        expected.includes(name),
      );
    }
  });
});
