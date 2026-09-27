import { afterEach, describe, expect, it, vi } from "vitest";

import type { OnboardingNudgeView } from "@capital-q/contracts";

import {
  composeBriefing,
  setupNudgeItems,
  type BriefingFacts,
} from "../src/features/home/briefing";
import {
  readBriefingFacts,
  type BriefingReads,
} from "../src/features/home/briefing-facts";
import {
  decideBriefing,
  resetBriefingDecisions,
} from "../src/features/home/briefing-gate";

/**
 * The setup reminder in Q's briefing (founder directive 2026-09-27): one
 * quiet card with progress and the way back in, only on the days the
 * server's policy gives one, and at most once a day on screen.
 */

const NOW = new Date("2026-09-27T09:00:00.000Z");
const COMPANY = "c0000000-0000-4000-8000-000000000001";
const INVESTOR_ORG = "d0000000-0000-4000-8000-000000000001";

function nudge(
  journeyType: "founder" | "investor",
  overrides: Partial<OnboardingNudgeView> = {},
): OnboardingNudgeView {
  return {
    policyVersion: "onboarding-nudge/test",
    journeyType,
    emphasis: "STRONG",
    requiredCount: 9,
    doneCount: 4,
    minutesLeft: 3,
    remainingTopics: ["Your raise"],
    day: "2026-09-27",
    ...overrides,
  };
}

function reads(view: OnboardingNudgeView | null): BriefingReads {
  return {
    pendingApprovals: () =>
      Promise.resolve({ contractVersion: 1 as const, items: [] }),
    investorRelationships: () => Promise.resolve({ items: [] }),
    companyRelationships: () => Promise.resolve({ items: [] }),
    incomingInterest: () => Promise.resolve({ items: [] }),
    readiness: () => Promise.reject(new Error("not assessed")),
    companySlate: () =>
      Promise.resolve({
        slateId: null,
        rankingVersion: "v1",
        items: [],
        notes: [],
        nextCursor: null,
      }),
    setupNudge: () => Promise.resolve({ nudge: view }),
  };
}

const CONTEXTS = {
  founder: { kind: "FOUNDER", companyId: COMPANY, label: "Acme" },
  investor: {
    kind: "INVESTOR",
    investorOrganisationId: INVESTOR_ORG,
    label: "Northwind",
  },
} as const;

describe("setup reminder card", () => {
  afterEach(() => {
    resetBriefingDecisions();
    vi.unstubAllGlobals();
  });

  for (const journey of ["founder", "investor"] as const) {
    it(`${journey}: one quiet card with progress, Continue and Later`, async () => {
      const facts = await readBriefingFacts(
        CONTEXTS[journey],
        reads(nudge(journey)),
        NOW,
      );
      const briefing = composeBriefing(facts as BriefingFacts);
      const cards = briefing?.items.filter((item) =>
        item.id.startsWith("setup-nudge:"),
      );
      expect(cards).toEqual([
        {
          id: "setup-nudge:2026-09-27",
          title: "Setup: 4 of 9 done — about 3 minutes left",
          description: expect.stringMatching(/when you're ready/) as unknown,
          href: `/onboarding/${journey}?from=home`,
          later: true,
        },
      ]);
    });

    it(`${journey}: no card on a day the policy gives none`, async () => {
      const facts = await readBriefingFacts(
        CONTEXTS[journey],
        reads(null),
        NOW,
      );
      expect(composeBriefing(facts as BriefingFacts)).toBeNull();
    });

    it(`${journey}: a failed reminder read says nothing`, async () => {
      const failing = {
        ...reads(null),
        setupNudge: () => Promise.reject(new Error("down")),
      };
      const facts = await readBriefingFacts(CONTEXTS[journey], failing, NOW);
      expect(facts?.setupNudge).toBeUndefined();
    });
  }

  it("says 'about a minute' for one minute, and nothing once complete", () => {
    expect(
      setupNudgeItems({
        journeyType: "founder",
        doneCount: 8,
        requiredCount: 9,
        minutesLeft: 1,
        day: "2026-09-27",
      })[0]?.title,
    ).toBe("Setup: 8 of 9 done — about a minute left");
    expect(
      setupNudgeItems({
        journeyType: "founder",
        doneCount: 9,
        requiredCount: 9,
        minutesLeft: 1,
        day: "2026-09-27",
      }),
    ).toEqual([]);
  });

  it("appears on screen at most once a day, even if the page asks again", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, v),
      },
    });
    const today = composeBriefing({
      role: "INVESTOR",
      since: NOW.toISOString(),
      setupNudge: {
        journeyType: "investor",
        doneCount: 4,
        requiredCount: 9,
        minutesLeft: 3,
        day: "2026-09-27",
      },
    });
    expect(decideBriefing(today, NOW)).toBe(today);
    resetBriefingDecisions();
    // The server returns the same day's card on a re-render: not shown again.
    expect(decideBriefing(today, new Date("2026-09-27T18:00:00Z"))).toBeNull();
    resetBriefingDecisions();
    const tomorrow = composeBriefing({
      role: "INVESTOR",
      since: NOW.toISOString(),
      setupNudge: {
        journeyType: "investor",
        doneCount: 4,
        requiredCount: 9,
        minutesLeft: 3,
        day: "2026-09-28",
      },
    });
    expect(decideBriefing(tomorrow, new Date("2026-09-28T09:00:00Z"))).toBe(
      tomorrow,
    );
  });
});
