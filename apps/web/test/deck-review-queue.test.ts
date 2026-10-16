import { describe, expect, it } from "vitest";

import type { CompanyDeckView } from "@capital-q/contracts";

import {
  DECK_REVIEW_TITLE,
  deckReviewHref,
  deckReviewLine,
  pendingDeckSections,
} from "../src/features/company/material/deck-pending";
import { pendingCount } from "../src/features/briefing/opener";
import { needsYouCards } from "../src/features/relationships/relationships-view";

/**
 * Lead 2026-10-16: a founder whose deck has sections Q read but they have
 * not checked sees one "Confirm Q's reading of your deck" item in Needs you
 * and in Home's waiting count, saying how many and what it changes.
 */

const COMPANY = "00000000-0000-4000-8000-000000000001";

function view(
  states: Record<string, "PENDING" | "CONFIRMED" | "DISMISSED">,
): CompanyDeckView {
  const sections = Object.keys(states).map((section) => ({
    section,
    status: "PRESENT",
    summary: "s",
    pages: [],
    facts: [],
    confidence: "MEDIUM",
  }));
  return {
    viewer: "OWNER",
    companyId: COMPANY,
    deck: null,
    extraction: {
      extractionId: "00000000-0000-4000-8000-000000000002",
      readAt: "2026-10-10T00:00:00.000Z",
      versionNumber: 1,
      confirmed: false,
      sections,
      readingNumber: 1,
      sectionStates: Object.entries(states).map(([section, state]) => ({
        section,
        state,
      })),
    },
    coaching: null,
  } as unknown as CompanyDeckView;
}

describe("deck review for founders", () => {
  it("counts only present sections still not checked", () => {
    expect(
      pendingDeckSections(
        view({
          PROBLEM: "PENDING",
          TEAM: "DISMISSED",
          TRACTION: "CONFIRMED",
          MARKET: "PENDING",
        }),
      ),
    ).toBe(2);
    expect(pendingDeckSections(null)).toBe(0);
    expect(deckReviewHref(COMPANY)).toBe(
      `/company/${COMPANY}?tab=deck#check-read`,
    );
    expect(deckReviewLine(6)).toMatch(/^Confirm 6 deck sections/u);
  });

  it("puts one item first in a founder's Needs you, none for investors", () => {
    const base = { notices: [], reminders: [], items: [], now: Date.now() };
    const review = { pending: 6, href: "/x", at: new Date().toISOString() };
    const founder = needsYouCards({
      ...base,
      side: "COMPANY",
      deckReview: review,
    });
    expect(founder[0]?.title).toBe(DECK_REVIEW_TITLE);
    expect(founder[0]?.detail).toMatch(/Confirm 6 deck sections/u);
    expect(founder[0]?.step).toBe(true);
    expect(
      needsYouCards({ ...base, side: "INVESTOR", deckReview: review }),
    ).toHaveLength(0);
    expect(
      needsYouCards({ ...base, side: "COMPANY", deckReview: null }),
    ).toHaveLength(0);
  });

  it("is one thing waiting on Home", () => {
    const data = {
      firstName: null,
      timeZone: null,
      activity: null,
      hoursAway: null,
      cards: [],
    };
    expect(pendingCount(data)).toBe(0);
    expect(
      pendingCount({ ...data, deckReview: { pending: 6, href: "/x" } }),
    ).toBe(1);
    expect(
      pendingCount({ ...data, deckReview: { pending: 0, href: "/x" } }),
    ).toBe(0);
  });
});
