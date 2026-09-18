import { describe, expect, it } from "vitest";

import {
  COMPANY_REPRESENTATION_VERSION,
  INVESTOR_REPRESENTATION_VERSION,
  REPRESENTATION_PURPOSE,
} from "../src/semantic/contracts.js";
import {
  buildCompanyInvestmentRepresentation,
  buildInvestorMandateRepresentation,
  REPRESENTATION_MAX_CHARACTERS,
  type CompanyRepresentationInput,
} from "../src/semantic/representation.js";

/**
 * The representation builders are pure and deterministic (CQ-REC-003
 * §11–§12): same canonical snapshot, same version, same text and hash;
 * a canonical change is a different hash; the input type has no field a
 * private source could fill.
 */

const MARKER = "REC003_PRIVATE_FOUNDER_SEMANTIC_MARKER_DO_NOT_EMBED";

const company: CompanyRepresentationInput = {
  companyId: "55555555-0000-4000-8000-000000000001",
  sourceVersion: 3,
  canonicalName: "  Kobo   Logistics  ",
  shortDescription:
    "Workflow software for   freight forwarders and distributors across West Africa.",
  currentStageCode: "series_a",
  headquartersCountry: "ng",
  classifications: [
    {
      vocabularyCode: "industry",
      canonicalCode: "logistics",
      displayName: "Logistics",
    },
    {
      vocabularyCode: "geography",
      canonicalCode: "west_africa",
      displayName: "West Africa",
    },
    {
      vocabularyCode: "industry",
      canonicalCode: "enterprise_software",
      displayName: "Enterprise software",
    },
  ],
};

describe("company investment representation", () => {
  it("is a compact labelled projection of investor-visible fields, in a fixed order", () => {
    const built = buildCompanyInvestmentRepresentation(company);
    expect(built.purpose).toBe(REPRESENTATION_PURPOSE);
    expect(built.representationVersion).toBe(COMPANY_REPRESENTATION_VERSION);
    expect(built.text).toBe(
      [
        "Company: Kobo Logistics",
        "Stage: series a",
        "Headquarters: NG",
        "Markets: West Africa",
        "Sector: Enterprise software, Logistics",
        "Summary: Workflow software for freight forwarders and distributors across West Africa.",
      ].join("\n"),
    );
  });

  it("is deterministic: same snapshot, same text, same hashes, regardless of classification order", () => {
    const a = buildCompanyInvestmentRepresentation(company);
    const b = buildCompanyInvestmentRepresentation({
      ...company,
      classifications: [...company.classifications].reverse(),
    });
    expect(b.text).toBe(a.text);
    expect(b.contentSha256).toBe(a.contentSha256);
    expect(b.sourceFingerprint).toBe(a.sourceFingerprint);
    expect(a.contentSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("unknown stays unknown: an absent field has no line, never a placeholder", () => {
    const built = buildCompanyInvestmentRepresentation({
      ...company,
      currentStageCode: null,
      headquartersCountry: null,
      shortDescription: "   ",
      classifications: [],
    });
    expect(built.text).toBe("Company: Kobo Logistics");
    expect(built.text).not.toMatch(/unknown|null|undefined/i);
  });

  it("a network-visible change changes the text and the content hash (§10)", () => {
    const before = buildCompanyInvestmentRepresentation(company);
    const summary = buildCompanyInvestmentRepresentation({
      ...company,
      shortDescription: "Now a fintech lending platform for SMEs.",
    });
    const taxonomy = buildCompanyInvestmentRepresentation({
      ...company,
      classifications: [
        ...company.classifications,
        {
          vocabularyCode: "industry",
          canonicalCode: "fintech",
          displayName: "Fintech",
        },
      ],
    });
    expect(summary.contentSha256).not.toBe(before.contentSha256);
    expect(taxonomy.contentSha256).not.toBe(before.contentSha256);
    expect(taxonomy.sourceFingerprint).not.toBe(before.sourceFingerprint);
  });

  it("the source fingerprint follows the canonical row version, so staleness needs no text", () => {
    const v3 = buildCompanyInvestmentRepresentation(company);
    const v4 = buildCompanyInvestmentRepresentation({
      ...company,
      sourceVersion: 4,
    });
    expect(v4.sourceFingerprint).not.toBe(v3.sourceFingerprint);
    // Same text, though: a version bump without a visible change is not a
    // new embedding (the content hash decides that).
    expect(v4.contentSha256).toBe(v3.contentSha256);
  });

  it("stays under the embedding runtime's input ceiling", () => {
    const built = buildCompanyInvestmentRepresentation({
      ...company,
      shortDescription: "x".repeat(10_000),
    });
    expect(built.text.length).toBeLessThanOrEqual(
      REPRESENTATION_MAX_CHARACTERS,
    );
  });

  it("has no field through which private context could arrive (§8, §9)", () => {
    // The only free text is the network-visible short description. A
    // private marker placed anywhere it could conceivably be smuggled —
    // whitespace, a name, a code — is a canonical change and would be a
    // visible one; there is no memory, conversation, document, evidence,
    // research or Q-summary input at all.
    const keys = Object.keys(company).sort();
    expect(keys).toEqual([
      "canonicalName",
      "classifications",
      "companyId",
      "currentStageCode",
      "headquartersCountry",
      "shortDescription",
      "sourceVersion",
    ]);
    const built = buildCompanyInvestmentRepresentation(company);
    expect(built.text).not.toContain(MARKER);
    expect(JSON.stringify(built)).not.toContain(MARKER);
  });
});

describe("investor mandate representation", () => {
  const investor = {
    mandateId: "33333333-0000-4000-8000-000000000031",
    mandateVersion: 2,
    name: "Seed Africa",
    rawMandateText:
      "We back  early-stage enterprise logistics software in African markets.",
    stageCodes: ["series_a", "seed"],
    countryCodes: ["ng", "GH"],
    preferences: [
      {
        vocabularyCode: "industry",
        canonicalCode: "logistics",
        displayName: "Logistics",
      },
      {
        vocabularyCode: "geography",
        canonicalCode: "west_africa",
        displayName: "West Africa",
      },
    ],
  };

  it("renders the declared mandate, positive intent only, in a fixed order", () => {
    const built = buildInvestorMandateRepresentation(investor);
    expect(built.representationVersion).toBe(INVESTOR_REPRESENTATION_VERSION);
    expect(built.text).toBe(
      [
        "Mandate: Seed Africa",
        "Thesis: We back early-stage enterprise logistics software in African markets.",
        "Stages: seed, series a",
        "Countries: GH, NG",
        "Markets: West Africa",
        "Sector: Logistics",
      ].join("\n"),
    );
  });

  it("an ACTIVE mandate change changes the representation; the fingerprint follows the mandate version (§13, J)", () => {
    const before = buildInvestorMandateRepresentation(investor);
    const after = buildInvestorMandateRepresentation({
      ...investor,
      mandateVersion: 3,
      rawMandateText: "Now: climate hardware in Europe.",
    });
    expect(after.contentSha256).not.toBe(before.contentSha256);
    expect(after.sourceFingerprint).not.toBe(before.sourceFingerprint);
  });

  it("a mandate with no narrative and no intent is still a representation, never empty", () => {
    const built = buildInvestorMandateRepresentation({
      ...investor,
      rawMandateText: null,
      stageCodes: [],
      countryCodes: [],
      preferences: [],
    });
    expect(built.text).toBe("Mandate: Seed Africa");
  });
});
