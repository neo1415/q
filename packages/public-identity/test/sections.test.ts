import { describe, expect, it } from "vitest";

import { CardDetailSchema } from "@capital-q/contracts";

import {
  companySections,
  createSubjectDirectory,
  fitFieldScopes,
  projectCardFields,
  readStoredScopes,
  type CompanySectionInputs,
  type SectionClaim,
} from "../src/index.js";

/**
 * The Q Card's richer sections (owner 2026-10-21, Q Story S6), pure: what
 * each audience may see of a company's numbers, raise, Q's reading,
 * relationships, team and documents. Every positive case has its
 * cross-scope negative beside it.
 */

const COMPANY_ID = "00000000-0000-4000-8000-000000000001";

function claim(overrides: Partial<SectionClaim>): SectionClaim {
  return {
    claimKey: "financial.arr",
    statement: "ARR is $1.2m",
    structuredValue: { kind: "MONEY", amount: 1200000, currency: "USD" },
    validFrom: null,
    validTo: "2025-03-31T00:00:00.000Z",
    truthClass: "USER_CLAIM",
    evidenceStatus: "DOCUMENT_SUPPORTED",
    visibilityScope: "public_external",
    ...overrides,
  };
}

function inputs(overrides: Partial<CompanySectionInputs> = {}) {
  return {
    claims: [],
    raise: null,
    investability: null,
    pipeline: {},
    team: [],
    documents: [],
    ...overrides,
  } satisfies CompanySectionInputs;
}

const ALL_ON = {
  canonicalName: "public_external",
  tractionMetrics: "public_external",
  currentRaise: "public_external",
  relationshipSummary: "public_external",
  investabilitySummary: "network_visible",
  team: "network_visible",
  documentsOnRequest: "network_visible",
} as const;

function project(
  sectionInputs: CompanySectionInputs,
  audience: "PUBLIC" | "PARTICIPANT",
  scopes: Parameters<typeof projectCardFields>[1] = ALL_ON,
) {
  const sections = companySections(sectionInputs);
  return projectCardFields(
    "COMPANY",
    scopes,
    sections.facts,
    audience,
    sections.details,
  );
}

describe("numbers", () => {
  it("keeps each number's exact amount, currency, truth class and evidence status", () => {
    const [field] = project(inputs({ claims: [claim({})] }), "PUBLIC");
    expect(field?.key).toBe("tractionMetrics");
    expect(field?.detail).toEqual({
      kind: "METRICS",
      metrics: [
        {
          label: "ARR",
          amount: "1200000",
          currency: "USD",
          unit: null,
          period: "As of Mar 2025",
          truthClass: "USER_CLAIM",
          evidenceStatus: "DOCUMENT_SUPPORTED",
        },
      ],
    });
    expect(CardDetailSchema.safeParse(field?.detail).success).toBe(true);
  });

  it("never shows a members-only number on a public section, but shows it to members", () => {
    const claims = [
      claim({}),
      claim({
        claimKey: "traction.customer_count",
        structuredValue: { kind: "COUNT", value: 140 },
        visibilityScope: "network_visible",
      }),
    ];
    const publicLabels = project(inputs({ claims }), "PUBLIC").flatMap((f) =>
      f.detail?.kind === "METRICS" ? f.detail.metrics.map((m) => m.label) : [],
    );
    expect(publicLabels).toEqual(["ARR"]);

    // A members' section built for members carries both.
    const members = project(inputs({ claims }), "PARTICIPANT", {
      canonicalName: "public_external",
      tractionMetrics: "network_visible",
    });
    expect(
      members[0]?.detail?.kind === "METRICS"
        ? members[0].detail.metrics.map((m) => m.label)
        : [],
    ).toEqual(["ARR", "Customers"]);
  });

  it("drops a public section whose only numbers are members-only, rather than showing it empty", () => {
    const fields = project(
      inputs({ claims: [claim({ visibilityScope: "network_visible" })] }),
      "PUBLIC",
    );
    expect(fields.some((f) => f.key === "tractionMetrics")).toBe(false);
  });

  it("never reads a private claim, burn, cash, runway or a forecast onto a card", () => {
    const claims = [
      claim({ visibilityScope: "founder_private" }),
      claim({ visibilityScope: "organisation_private" }),
      claim({ claimKey: "financial.burn_rate" }),
      claim({ claimKey: "financial.cash" }),
      claim({ claimKey: "financial.runway_months" }),
      claim({ statement: "Projected ARR of $5m next year" }),
      claim({
        structuredValue: {
          kind: "MONEY",
          amount: 1,
          currency: "USD",
          forecast: true,
        },
      }),
    ];
    const sections = companySections(inputs({ claims }));
    expect(sections.facts["tractionMetrics"]).toBeNull();
    expect(sections.details["tractionMetrics"]).toEqual({
      public_external: null,
      network_visible: null,
    });
  });

  it("shows contradicting readings side by side, never just the favourable one", () => {
    const claims = [
      claim({}),
      claim({
        structuredValue: { kind: "MONEY", amount: 900000, currency: "USD" },
        evidenceStatus: "SELF_REPORTED",
      }),
    ];
    const [field] = project(inputs({ claims }), "PUBLIC");
    expect(
      field?.detail?.kind === "METRICS"
        ? field.detail.metrics.map((m) => m.amount)
        : [],
    ).toEqual(["1200000", "900000"]);
  });

  it("leaves an unreadable amount out instead of inventing zero", () => {
    const sections = companySections(
      inputs({
        claims: [
          claim({
            structuredValue: { kind: "MONEY", amount: "lots", currency: "USD" },
          }),
          claim({
            structuredValue: { kind: "MONEY", amount: 5, currency: "dollars" },
          }),
          claim({ structuredValue: null }),
        ],
      }),
    );
    expect(sections.facts["tractionMetrics"]).toBeNull();
  });
});

describe("the raise", () => {
  it("shows the owner's active objective as money plus currency, self-reported", () => {
    const [field] = project(
      inputs({
        raise: {
          stageCode: "seed",
          instrumentCode: "safe",
          target: { amount: "1500000.00", currency: "USD" },
          useOfFunds: "Hiring and two new corridors.",
          targetCloseDate: "2026-12-31",
        },
      }),
      "PUBLIC",
    );
    expect(field?.detail).toMatchObject({
      kind: "RAISE",
      target: { amount: "1500000.00", currency: "USD" },
      truthClass: "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
    });
  });

  it("shows nothing until the owner puts the section on the card", () => {
    const fields = project(
      inputs({
        raise: {
          stageCode: null,
          instrumentCode: null,
          target: { amount: "1500000", currency: "USD" },
          useOfFunds: null,
          targetCloseDate: null,
        },
      }),
      "PARTICIPANT",
      { canonicalName: "public_external" },
    );
    expect(fields).toEqual([]);
  });
});

describe("members-only sections", () => {
  const rich = inputs({
    investability: {
      status: "SCORED",
      band: "Investable",
      confidence: "Moderate confidence",
      strengths: ["Traction", "Team"],
      areasScored: 9,
      areasTotal: 12,
      method: "FDN InvestIQ v1",
      assessedAt: null,
    },
    team: [{ name: "Amina Otieno", role: "CEO" }],
    documents: [
      { title: "Pitch deck", category: "Company", level: "PUBLIC" },
      { title: "Financial model", category: "Finance", level: "ON_REQUEST" },
      { title: "Cap table", category: "Legal", level: "SHARED_ONLY" },
      { title: "Board notes", category: null, level: "PRIVATE" },
    ],
  });

  it("never reach an anonymous visitor, even when the stored scope says public", () => {
    const leaked = {
      canonicalName: "public_external",
      investabilitySummary: "public_external",
      team: "public_external",
      documentsOnRequest: "public_external",
    } as const;
    expect(project(rich, "PUBLIC", leaked)).toEqual([]);
    expect(project(rich, "PARTICIPANT", leaked)).toEqual([]);
  });

  it("reach a signed-in participant when the owner shares them with members", () => {
    const keys = project(rich, "PARTICIPANT").map((f) => f.key);
    expect(keys).toEqual([
      "investabilitySummary",
      "team",
      "documentsOnRequest",
    ]);
    expect(project(rich, "PUBLIC")).toEqual([]);
  });

  it("list only titles investors may know of: PUBLIC and ON_REQUEST, never shared-only or private", () => {
    const docs = project(rich, "PARTICIPANT").find(
      (f) => f.key === "documentsOnRequest",
    );
    expect(
      docs?.detail?.kind === "DOCUMENTS"
        ? docs.detail.documents.map((d) => d.title)
        : [],
    ).toEqual(["Pitch deck", "Financial model"]);
  });

  it("say 'not enough evidence' as unknown, with no band", () => {
    const sections = companySections(
      inputs({
        investability: {
          status: "INSUFFICIENT_EVIDENCE",
          band: "Early",
          confidence: "Low confidence",
          strengths: [],
          areasScored: 1,
          areasTotal: 12,
          method: "FDN InvestIQ v1",
          assessedAt: null,
        },
      }),
    );
    expect(
      sections.details["investabilitySummary"]?.network_visible,
    ).toMatchObject({
      status: "INSUFFICIENT_EVIDENCE",
      band: null,
      confidence: null,
    });
    const notAssessed = companySections(
      inputs({
        investability: {
          status: "NOT_ASSESSED",
          band: null,
          confidence: null,
          strengths: [],
          areasScored: 0,
          areasTotal: 0,
          method: "FDN InvestIQ v1",
          assessedAt: null,
        },
      }),
    );
    expect(notAssessed.facts["investabilitySummary"]).toBeNull();
  });
});

describe("relationships", () => {
  it("are counts by stage, never names, and never passes or declines", () => {
    const sections = companySections(
      inputs({
        pipeline: {
          CONNECTED: 3,
          IN_DILIGENCE: 1,
          PASSED: 4,
          DECLINED: 2,
          DISCOVERED: 9,
        },
      }),
    );
    expect(sections.details["relationshipSummary"]?.public_external).toEqual({
      kind: "RELATIONSHIPS",
      stages: [
        { label: "Connected", count: 3 },
        { label: "In diligence", count: 1 },
      ],
    });
  });

  it("are absent, not zero, when nothing is in progress", () => {
    expect(
      companySections(inputs({ pipeline: { PASSED: 2 } })).facts[
        "relationshipSummary"
      ],
    ).toBeNull();
  });
});

describe("owner controls (server-enforced)", () => {
  it("refuses everyone-with-the-link for a members-only section", () => {
    expect(fitFieldScopes("COMPANY", { team: "public_external" })).toEqual({
      ok: false,
      fields: ["team"],
    });
    expect(
      fitFieldScopes("COMPANY", {
        investabilitySummary: "public_external",
        documentsOnRequest: "public_external",
      }),
    ).toEqual({
      ok: false,
      fields: ["investabilitySummary", "documentsOnRequest"],
    });
    expect(fitFieldScopes("COMPANY", { team: "network_visible" }).ok).toBe(
      true,
    );
    expect(
      fitFieldScopes("COMPANY", { tractionMetrics: "public_external" }).ok,
    ).toBe(true);
  });

  it("reads a stored public scope on a members-only section back as members-only", () => {
    expect(
      readStoredScopes("COMPANY", { documentsOnRequest: "public_external" })
        .documentsOnRequest,
    ).toBe("network_visible");
  });
});

describe("the subject directory", () => {
  it("hands sections to the card only through the section port, and survives its failure", async () => {
    const company = {
      tenantId: "t",
      organisationId: "o",
      canonicalName: "Kivu Freight",
      shortDescription: null,
      currentStageCode: null,
      headquartersCity: null,
      headquartersCountry: null,
      websiteUrl: null,
      foundedDate: null,
    };
    const base = {
      findCompany: () => Promise.resolve(company),
      findInvestor: () => Promise.resolve(null),
      companyVerification: () =>
        Promise.resolve({ organisation: false, founderIdentity: false }),
    };
    const ok = await createSubjectDirectory({
      ...base,
      findCompanySections: () =>
        Promise.resolve(inputs({ claims: [claim({})] })),
    }).find({ subjectType: "COMPANY", subjectId: COMPANY_ID });
    expect(ok?.facts["tractionMetrics"]).toBe("ARR");
    expect(ok?.details?.["tractionMetrics"]?.public_external).not.toBeNull();

    const failed = await createSubjectDirectory({
      ...base,
      findCompanySections: () => Promise.reject(new Error("down")),
    }).find({ subjectType: "COMPANY", subjectId: COMPANY_ID });
    expect(failed?.name).toBe("Kivu Freight");
    expect(failed?.details).toBeUndefined();
  });
});
