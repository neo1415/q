import { describe, expect, it } from "vitest";

import { profileLead, researchLead } from "../src/q/early-lead.js";

/**
 * Owner 2026-10-21 (time to the first word): one grounded sentence from
 * the record as the model is asked, and what Q is doing as a web search
 * starts. Nothing is said for the sake of saying something.
 */
describe("first-word leads", () => {
  const profile = {
    companyId: "1ab2cc02-160f-4812-a6b1-8be7e43afd3e",
    canonicalName: "Northwind Ledger",
    currentStageCode: "seed",
    headquartersCity: "Nairobi",
    headquartersCountry: "KE",
    foundedDate: null,
    shortDescription: null,
  };

  it("says what the company declares, and that it is its own account", () => {
    expect(profileLead(profile)).toBe(
      "Northwind Ledger is a seed-stage company based in Nairobi, Kenya, by its own account on Capital Q.",
    );
  });

  it("says nothing when the profile declares neither stage nor place", () => {
    expect(
      profileLead({
        ...profile,
        currentStageCode: null,
        headquartersCity: null,
        headquartersCountry: null,
      }),
    ).toBeNull();
  });

  it("names what is being looked up on the web, or says it plainly", () => {
    expect(researchLead("Northwind Ledger")).toBe(
      "I'm checking what's public on Northwind Ledger now.",
    );
    expect(researchLead(null)).toBe(
      "I'm checking the public web for that now.",
    );
  });
});
