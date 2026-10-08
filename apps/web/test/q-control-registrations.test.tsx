// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QUiActIntent, ReadinessDto } from "@capital-q/contracts";

vi.mock("@/components/app-shell/global-q", () => ({
  useGlobalQ: () => ({ askAbout: vi.fn(), askNow: vi.fn() }),
}));
vi.mock("@/features/q-aperture", () => ({ QAperture: () => null }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/capital",
  useRouter: () => ({
    replace: vi.fn(),
    refresh: () => undefined,
    push: vi.fn(),
  }),
}));

import { CapitalTabBar } from "../src/features/capital/capital-tab-bar";
import { DocumentsTabBar } from "../src/features/documents/requests/documents-tab-bar";
import {
  manifestControls,
  resetControls,
} from "../src/features/q/control/registry";
import { ReadinessSection } from "../src/features/readiness/readiness-section";
import {
  noteRoute,
  performUiAct,
  resetUiActController,
} from "../src/features/q/ui-act-controller";
import { InvestorCards } from "../src/features/investors/investor-cards";

/**
 * RECOVERY-2026-10 (C1/C2): the real pages' controls, registered by their
 * own components, and Q's acts on them confirmed by what the page shows:
 * the tab selected and the router settled, the section in view, the item
 * opened. Registration changes nothing a person sees.
 */

const inView = new Set<Element>();
const scrollIntoView = vi.fn(function (this: Element) {
  inView.add(this);
});
function rectOf(this: Element): DOMRect {
  const top = inView.has(this) ? 10 : 5_000;
  return {
    top,
    bottom: top + 40,
    left: 0,
    right: 100,
    width: 100,
    height: 40,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

let n = 0;
const intent = (
  act: QUiActIntent["act"],
  extra: Partial<QUiActIntent> = {},
): QUiActIntent => {
  n += 1;
  return { kind: "UI_ACT", actId: `uia_reg${String(n)}xxx`, act, ...extra };
};

beforeEach(() => {
  resetControls();
  resetUiActController();
  inView.clear();
  Element.prototype.scrollIntoView = scrollIntoView;
  Element.prototype.getBoundingClientRect = rectOf;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const READINESS = {
  companyId: "11111111-1111-4111-8111-111111111111",
  rulesVersion: "readiness-rules/v1",
  revision: 2,
  assessedAt: "2026-10-07T00:00:00.000Z",
  stageCode: "seed",
  pillars: [
    {
      pillar: "FOUNDER",
      label: "Team",
      status: "STRONG",
      summary: "Founders named.",
      evidence: [],
      improve: [],
    },
    {
      pillar: "BUSINESS_ECONOMICS",
      label: "Financials",
      status: "UNKNOWN",
      summary: "No burn shared.",
      evidence: [],
      improve: ["Add monthly burn."],
    },
  ],
  blockers: [
    {
      id: "raise.use-of-funds",
      pillar: "INVESTMENT_READINESS",
      kind: "MISSING",
      title: "No use of funds",
      why: "A target with no plan reads as unfinished.",
      actionKey: "use-of-funds",
    },
    {
      id: "economics.burn",
      pillar: "BUSINESS_ECONOMICS",
      kind: "MISSING",
      title: "No burn shared",
      why: "Runway cannot be read.",
      actionKey: "burn",
    },
  ],
  actions: [],
  followUps: [],
  uncertainty: [],
} as unknown as ReadinessDto;

describe("Capital's tab bar (tab.*)", () => {
  it("registers every tab, the open one SELECTED, with no change to the bar", () => {
    render(<CapitalTabBar active="overview" hadTabParam />);
    const tabs = manifestControls().filter((c) => c.kind === "TAB");
    expect(tabs.map((c) => c.id)).toEqual([
      "tab.overview",
      "tab.raise",
      "tab.readiness",
      "tab.action-plan",
      "tab.plan",
      "tab.investors",
    ]);
    expect(tabs[0]).toEqual({
      id: "tab.overview",
      kind: "TAB",
      state: "SELECTED",
    });
    expect(screen.getAllByRole("tab")).toHaveLength(6);
  });

  it("SELECT_TAB is DONE only when the tab is selected and the router settled on /capital?tab=readiness", async () => {
    noteRoute("/capital");
    render(<CapitalTabBar active="overview" hadTabParam />);
    const pending = performUiAct(
      intent("SELECT_TAB", { target: "tab.readiness" }),
    );
    // The click marks the tab at once; DONE waits for the router.
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(
      screen
        .getByRole("tab", { name: "Readiness" })
        .getAttribute("aria-selected"),
    ).toBe("true");
    noteRoute("/capital?tab=readiness");
    expect((await act(() => pending)).status).toBe("DONE");
  });

  it("is FAILED when the router never arrives", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    noteRoute("/capital");
    render(<CapitalTabBar active="overview" hadTabParam />);
    const pending = performUiAct(intent("SELECT_TAB", { target: "tab.plan" }));
    await act(() => vi.advanceTimersByTimeAsync(7_000));
    expect((await pending).status).toBe("FAILED");
  });
});

describe("Documents' tab bar (tab.mine, tab.requested, tab.data-room)", () => {
  it("registers its three tabs with the open one SELECTED", () => {
    render(<DocumentsTabBar active="requested" counts={{}} />);
    expect(
      manifestControls()
        .filter((c) => c.kind === "TAB")
        .map((c) => [c.id, c.state ?? null]),
    ).toEqual([
      ["tab.mine", null],
      ["tab.requested", "SELECTED"],
      ["tab.data-room", null],
    ]);
  });
});

describe("Readiness (section.risks, list.risks, list.pillars)", () => {
  it("registers the risks and the pillars with their counts", () => {
    render(<ReadinessSection readiness={READINESS} />);
    expect(manifestControls()).toEqual(
      expect.arrayContaining([
        { id: "section.risks", kind: "SECTION" },
        { id: "list.risks", kind: "LIST", count: 2 },
        { id: "list.pillars", kind: "LIST", count: 2 },
      ]),
    );
  });

  it("scrolls to the risks, and 'the second one' is brought into view", async () => {
    render(<ReadinessSection readiness={READINESS} />);
    expect(
      (await performUiAct(intent("SCROLL_TO", { target: "section.risks" })))
        .status,
    ).toBe("DONE");
    const second = screen.getByText("No burn shared").closest("li");
    expect(
      (
        await performUiAct(
          intent("SELECT_ITEM", { target: "list.risks", index: 2 }),
        )
      ).status,
    ).toBe("DONE");
    expect(second !== null && inView.has(second)).toBe(true);
  });

  it("opens the second pillar through its own summary, DONE once it is open", async () => {
    render(<ReadinessSection readiness={READINESS} />);
    const receipt = await act(() =>
      performUiAct(intent("SELECT_ITEM", { target: "list.pillars", index: 2 })),
    );
    expect(receipt.status).toBe("DONE");
    expect(screen.getByText("Financials").closest("details")?.open).toBe(true);
  });
});

describe("Investor cards (list.investors items)", () => {
  it("marks each card as an item, so the nth opens that investor's own link", () => {
    render(
      <InvestorCards
        items={[1, 2].map((n) => ({
          investorOrganisationId: `a0000000-0000-4000-8000-00000000000${String(n)}`,
          displayName: `Fund ${String(n)}`,
          investorType: "VENTURE_FUND",
          websiteUrl: null,
          hqCountry: "KE",
          publicDescription: null,
          deploymentState: null,
          inboundPreference: null,
          photoUrl: null,
          coverUrl: null,
          reasons: [],
        }))}
      />,
    );
    const items = document.querySelectorAll("[data-q-item]");
    expect(items).toHaveLength(2);
    expect(items[1]?.querySelector("a")?.getAttribute("href")).toBe(
      "/investors/a0000000-0000-4000-8000-000000000002",
    );
  });
});
