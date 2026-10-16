import { describe, expect, it } from "vitest";

import { QOpenRecordPageIntentSchema } from "@capital-q/contracts";

import {
  resolveFastNavigation,
  type OpenRecordIntent,
} from "../src/fast-navigation.js";
import { pageRequestOf } from "../src/page-request.js";
import {
  PROFILE_SECTION_WORDS,
  screenTabTarget,
  tabAskOf,
  tabPlace,
} from "../src/tab-request.js";

/**
 * Lane ov 2026-10-16: the company profile's Overview is the founder
 * profile's standard sections, and Diligence is its own tab. Q reads "show
 * me Harbourline's market", "go to the go-to-market section" and "open the
 * diligence tab" by code, to the exact tab and section, with no model.
 * The CRM is reachable by its name and its tabs.
 */

const HARBOURLINE = "6f0c1e8a-2b3d-4c5e-9f70-8a1b2c3d4e5f";

describe("overview sections, read by code", () => {
  it.each([
    ["Show me Harbourline's market", "opportunity", "Harbourline"],
    ["go to the go-to-market section", "go_to_market", null],
    ["open the moats section", "moats", null],
    ["take me to the why now section", "why_us_why_now", null],
    ["open Harbourline's business model", "business_model", "Harbourline"],
    ["show me the roadmap section for Harbourline", "roadmap", "Harbourline"],
    ["open the competitive landscape section", "competition", null],
    ["go to their ask section", "ask", null],
  ])("%s", (said, section, name) => {
    const ask = tabAskOf(said);
    expect(ask).toMatchObject({ tab: "overview", section, name });
    expect(ask === null ? "" : tabPlace(ask)).toBe(
      "that section of the overview",
    );
  });

  it("keeps the deck's own sections on the deck, and tabs as tabs", () => {
    expect(tabAskOf("show the traction section of the deck")).toMatchObject({
      tab: "deck",
      subTab: "TRACTION",
    });
    expect(tabAskOf("open their team tab")).toMatchObject({ tab: "team" });
    expect(tabAskOf("open Harbourline's team")).toMatchObject({
      tab: "team",
      name: "Harbourline",
    });
  });

  it("does not read a bare topic as a place", () => {
    expect(tabAskOf("show me the market")).toBeNull();
    expect(tabAskOf("what is the market like")).toBeNull();
  });

  it("has one key per profile section, every word list matching itself", () => {
    const keys = PROFILE_SECTION_WORDS.map(([key]) => key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(14);
  });
});

describe("the diligence tab", () => {
  it("is the profile's own tab on a company's page", () => {
    const ask = tabAskOf("open the diligence tab");
    expect(ask).toMatchObject({ tab: "diligence", name: null });
    expect(
      screenTabTarget({ route: "COMPANY", companyId: HARBOURLINE }, {
        tab: "diligence",
      }),
    ).toEqual({ page: "COMPANY", id: HARBOURLINE });
  });

  it("stays the relationship's on a relationship page", () => {
    expect(
      screenTabTarget(
        { route: "RELATIONSHIP_COMPANY", companyId: HARBOURLINE },
        { tab: "diligence" },
      ),
    ).toEqual({ page: "RELATIONSHIP_COMPANY", id: HARBOURLINE });
  });

  it("is a tab the company page has in the contract", () => {
    expect(
      QOpenRecordPageIntentSchema.safeParse({
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY",
        id: HARBOURLINE,
        tab: "diligence",
      }).success,
    ).toBe(true);
    expect(
      QOpenRecordPageIntentSchema.safeParse({
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY",
        id: HARBOURLINE,
        tab: "deck",
        section: "opportunity",
      }).success,
    ).toBe(false);
  });
});

describe("the fast path moves straight to the section", () => {
  it("opens Harbourline's overview at its market section, no model", async () => {
    const opened: string[] = [];
    const result = await resolveFastNavigation({
      text: "Show me Harbourline's market",
      side: "INVESTOR",
      counterpartNames: () => Promise.resolve(["Harbourline Cargo"]),
      open: (page, name): Promise<OpenRecordIntent | null> => {
        opened.push(`${page}:${name}`);
        return Promise.resolve(
          page === "COMPANY"
            ? { kind: "OPEN_RECORD_PAGE", page, id: HARBOURLINE }
            : null,
        );
      },
    });
    expect(result).toEqual({
      kind: "NAVIGATE",
      intent: {
        kind: "OPEN_RECORD_PAGE",
        page: "COMPANY",
        id: HARBOURLINE,
        tab: "overview",
        section: "opportunity",
      },
    });
    expect(opened[0]).toBe("COMPANY:Harbourline Cargo");
  });
});

describe("the CRM by its name and tabs", () => {
  it.each([
    ["open the CRM", "RELATIONSHIPS"],
    ["take me to the CRM overview", "RELATIONSHIPS"],
    ["open the pipeline", "CRM_PIPELINE"],
    ["go to the pipeline in the CRM", "CRM_PIPELINE"],
    ["open the capital tab in the CRM", "CAPITAL"],
  ])("%s", (said, destination) => {
    expect(pageRequestOf(said)).toEqual({
      kind: "PAGE",
      target: { kind: "DESTINATION", destination },
    });
  });

  it("opens one CRM record: the relationship with that company", async () => {
    const result = await resolveFastNavigation({
      text: "open Harbourline's CRM record",
      side: "INVESTOR",
      counterpartNames: () => Promise.resolve(["Harbourline Cargo"]),
      open: (page): Promise<OpenRecordIntent | null> =>
        Promise.resolve({ kind: "OPEN_RECORD_PAGE", page, id: HARBOURLINE }),
    });
    expect(result).toMatchObject({
      kind: "NAVIGATE",
      intent: { page: "RELATIONSHIP_COMPANY", id: HARBOURLINE },
    });
  });
});
