import { describe, expect, it } from "vitest";

import { composePitchDeck } from "@capital-q/q-specialists";

import {
  storyText,
  tractionSignalOf,
} from "../src/dev/fictional-world/accounts.js";
import { FICTIONAL_COMPANIES } from "../src/dev/fictional-world/companies.js";
import {
  FICTIONAL_INTERESTS,
  FICTIONAL_INVESTORS,
} from "../src/dev/fictional-world/investors.js";
import { intelligenceFrom } from "../src/dev/fictional-world/records.js";

/**
 * The fictional demo world's content invariants (SEED). Deterministic: no
 * database, no model. What is checked is what makes the seed honest —
 * clearly fictional, money as decimal strings with a currency, unknowns
 * left unknown, contradictions kept — and that every deck composes.
 */

const COMPANY = "a0000000-0000-4000-8000-000000000001";
const RUN = "b0000000-0000-4000-8000-000000000001";
const DECIMAL = /^\d+(\.\d+)?$/;
const CODE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;

describe("fictional world content", () => {
  it("has twelve companies and eight investors with unique keys and names", () => {
    expect(FICTIONAL_COMPANIES).toHaveLength(12);
    expect(FICTIONAL_INVESTORS).toHaveLength(8);
    const keys = [...FICTIONAL_COMPANIES, ...FICTIONAL_INVESTORS].map(
      (e) => e.key,
    );
    expect(new Set(keys).size).toBe(keys.length);
    const names = FICTIONAL_COMPANIES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("marks every company fictional and fits the profile contract", () => {
    for (const company of FICTIONAL_COMPANIES) {
      const story = storyText(company);
      expect(story.startsWith("Fictional demo company.")).toBe(true);
      expect(story.length).toBeLessThanOrEqual(8000);
      expect(company.shortDescription.length).toBeLessThanOrEqual(400);
      // Reserved TLD: no fictional website can resolve to a real one.
      expect(new URL(company.website).hostname.endsWith(".example")).toBe(true);
      expect(company.legalName).toContain("fictional");
    }
    for (const investor of FICTIONAL_INVESTORS) {
      expect(investor.name).toContain("(fictional)");
      expect(investor.person.headline).toContain("fictional");
    }
  });

  it("keeps money as decimal strings with an ISO currency", () => {
    for (const company of FICTIONAL_COMPANIES) {
      expect(company.raise.target.amount).toMatch(DECIMAL);
      expect(company.raise.target.currency).toMatch(/^[A-Z]{3}$/);
      expect(company.raise.currencyOption.toUpperCase()).toBe(
        company.raise.target.currency,
      );
      for (const claim of company.claims) {
        const value = claim.structuredValue;
        if (value?.["kind"] === "MONEY") {
          expect(String(value["amount"])).toMatch(DECIMAL);
          expect(String(value["currency"])).toMatch(/^[A-Z]{3}$/);
        }
      }
    }
    for (const investor of FICTIONAL_INVESTORS) {
      const { min, typical, max } = investor.cheque;
      for (const amount of [min, typical, max]) expect(amount).toMatch(DECIMAL);
      expect(Number(min)).toBeLessThanOrEqual(Number(typical));
      expect(Number(typical)).toBeLessThanOrEqual(Number(max));
    }
  });

  it("is honest about evidence: no VERIFIED, unknowns stay unknown, a contradiction is kept", () => {
    let documentSupported = 0;
    let contradictions = 0;
    for (const company of FICTIONAL_COMPANIES) {
      const keys = company.claims.map((c) => c.claimKey);
      expect(new Set(keys).size).toBe(keys.length);
      for (const claim of company.claims) {
        expect(claim.claimKey).toMatch(CODE);
        expect(claim.claimType).toMatch(CODE);
        expect(claim.truthClass).not.toBe("VERIFIED");
        if (claim.truthClass === "UNKNOWN") {
          expect(claim.evidenceStatus).toBe("NO_EVIDENCE");
          expect(claim.structuredValue).toBeUndefined();
        }
        if (claim.evidenceStatus === "DOCUMENT_SUPPORTED") {
          documentSupported += 1;
          expect(claim.documentTitle).toMatch(/fictional/);
        }
      }
      expect(company.claims.some((c) => c.truthClass === "UNKNOWN")).toBe(true);
      expect(company.story.unknowns.length).toBeGreaterThan(0);
      const contradictory = company.claims.filter(
        (c) => c.lifecycleStatus === "CONTRADICTORY",
      );
      expect([0, 2]).toContain(contradictory.length);
      if (contradictory.length === 2) contradictions += 1;
    }
    expect(documentSupported).toBeGreaterThanOrEqual(3);
    expect(contradictions).toBeGreaterThanOrEqual(1);
  });

  it("composes every deck through the product's composer, contradictions set apart", () => {
    for (const company of FICTIONAL_COMPANIES) {
      const composed = composePitchDeck({
        companyName: company.name,
        result: intelligenceFrom(COMPANY, company, RUN),
      });
      expect(composed, company.name).not.toBeNull();
      expect(composed?.content.deck?.slides.length ?? 0).toBeGreaterThanOrEqual(
        4,
      );
      expect(composed?.title).toBe(`${company.name} — investor deck`);
      const unreconciled = composed?.content.sections.some(
        (s) => s.heading === "Unreconciled figures",
      );
      const contradictory = company.claims.some(
        (c) => c.lifecycleStatus === "CONTRADICTORY",
      );
      expect(unreconciled).toBe(contradictory);
    }
  });

  it("only names seeded parties in interests", () => {
    const companies = new Set(FICTIONAL_COMPANIES.map((c) => c.key));
    const investors = new Set(FICTIONAL_INVESTORS.map((i) => i.key));
    for (const interest of FICTIONAL_INTERESTS) {
      expect(companies.has(interest.companyKey)).toBe(true);
      expect(investors.has(interest.investorKey)).toBe(true);
    }
  });
});

describe("the seeded traction answer (R30 #10)", () => {
  it("never says 'nothing measurable' for a company whose story has customers or pilots", () => {
    for (const company of FICTIONAL_COMPANIES) {
      const hasTraction =
        company.customers !== undefined ||
        company.revenueStatus !== undefined ||
        company.pilots !== undefined;
      if (hasTraction) {
        expect(tractionSignalOf(company), company.key).not.toBe("none");
      }
    }
  });
});
