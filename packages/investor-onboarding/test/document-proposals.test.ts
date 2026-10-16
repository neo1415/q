import { describe, expect, it } from "vitest";

import {
  createMandateReview,
  portfolioNames,
  splitNameList,
} from "../src/integration/mandate-review-service.js";
import type { MandateSynthesis } from "../src/intelligence/contracts.js";

/**
 * ob2 2026-10-16 (live check 4 on release Z): what a firm's fund deck or
 * thesis may propose.
 *   1. A list of countries is resolved country by country into ONE
 *      proposal; names that match nothing are named on it, never dropped.
 *   2. Business models, customer types, custom criteria and portfolio are
 *      proposed too, through the same mechanism and citation.
 * Everything stays a proposal: the only write is createSuggestion.
 */

const TENANT = "a0000000-0000-4000-8000-000000000001";
const USER = "b0000000-0000-4000-8000-000000000001";
const SESSION = "f0000000-0000-4000-8000-000000000001";
const FIRM = "c0000000-0000-4000-8000-000000000001";
const DOCUMENT = "d0000000-0000-4000-8000-000000000001";
const CITATION = [{ sourceType: "EVIDENCE_DOCUMENT", sourceId: DOCUMENT }];

/** Single names resolve; a whole list as one phrase does not (as live). */
const NODES: Readonly<Record<string, string>> = {
  "geography:kenya": "geo-ke",
  "geography:nigeria": "geo-ng",
  "geography:ghana": "geo-gh",
  "geography:tanzania": "geo-tz",
  "geography:uganda": "geo-ug",
  "business_model:b2b software": "bm-b2b",
  "business_model:marketplaces": "bm-market",
  "customer_type:smes": "ct-sme",
};

function constraint(dimension: string, value: string) {
  return {
    dimension,
    constraintDimension: null,
    value,
    quote: value,
    preferenceClass: "PREFERENCE",
    proposesExclusion: false,
    confidence: "0.8",
  };
}

function world(options: {
  readonly constraints?: readonly unknown[];
  readonly taxonomy?: readonly unknown[];
  readonly text?: string;
}) {
  const proposed: {
    stepKey: string;
    value: unknown;
    sourceRefs: unknown;
    rationale: unknown;
  }[] = [];
  const reading = {
    constraints: options.constraints ?? [],
    taxonomy: options.taxonomy ?? [],
    columns: [],
    ambiguities: [],
    inferences: [],
    tensions: [],
    refused: [],
    missing: [],
    summary: "",
    blocked: null,
    telemetry: { providerCode: "test" },
  } as unknown as MandateSynthesis;
  const review = createMandateReview({
    sql: {} as never,
    sessions: {
      findById: () =>
        Promise.resolve({
          id: SESSION,
          userId: USER,
          tenantId: TENANT,
          organisationId: FIRM,
          journeyType: "investor",
          status: "ACTIVE",
          version: 4,
        }),
      findLatestActive: () => Promise.resolve({ id: SESSION }),
    } as never,
    responses: { listCurrent: () => Promise.resolve([]) } as never,
    suggestions: { listPending: () => Promise.resolve([]) } as never,
    synthesis: { synthesise: () => Promise.resolve(reading) },
    taxonomy: {
      resolve: (phrase, vocabularies) => {
        const id = vocabularies
          .map((v) => NODES[`${v}:${phrase.trim().toLowerCase()}`])
          .find((found) => found !== undefined);
        return Promise.resolve(id === undefined ? [] : [id]);
      },
    },
    createSuggestion: (command) => {
      proposed.push({
        stepKey: command.stepKey,
        value: command.suggestedValue,
        sourceRefs: command.sourceRefs,
        rationale: command.rationale ?? null,
      });
      return Promise.resolve(null);
    },
    recordQuestions: () => Promise.resolve(null),
    documents: {
      findInTenant: () =>
        Promise.resolve({
          documentType: "FUND_DECK",
          sensitivityClass: "CONFIDENTIAL",
          companyId: null,
          ownerOrganisationId: FIRM,
          createdByUserId: USER,
        }),
    },
    pages: {
      listByVersion: () =>
        Promise.resolve([{ text: options.text ?? "Baobab Fund I." }]),
    },
  });
  const read = () =>
    review.onDocumentReady({
      tenantId: TENANT,
      documentId: DOCUMENT,
      documentVersionId: "e0000000-0000-4000-8000-000000000001",
    });
  return { read, proposed };
}

describe("splitNameList", () => {
  it.each([
    ["Kenya, Nigeria and Ghana", ["Kenya", "Nigeria", "Ghana"]],
    ["East Africa: Kenya, Tanzania, Uganda", ["Kenya", "Tanzania", "Uganda"]],
    ["companies based in Kenya", ["Kenya"]],
    ["Kenya; Ghana & Nigeria.", ["Kenya", "Ghana", "Nigeria"]],
    ["Kenya, kenya", ["Kenya"]],
  ])("%s", (value, names) => {
    expect(splitNameList(value)).toEqual(names);
  });
});

describe("portfolioNames", () => {
  it("reads the names after 'portfolio', verbatim, up to five", () => {
    expect(
      portfolioNames(
        "Portfolio (fictional): Kijani Ledger, Savanna Freight Desk.\nOther text.",
      ),
    ).toEqual(["Kijani Ledger", "Savanna Freight Desk"]);
    expect(
      portfolioNames("Our portfolio includes Asa, Bo, Cee, Dee, Eve and Fay."),
    ).toEqual(["Asa", "Bo", "Cee", "Dee", "Eve"]);
  });

  it("keeps a company's own name whole", () => {
    expect(portfolioNames("Portfolio: Made in Africa Ltd, Kijani.")).toEqual([
      "Made in Africa Ltd",
      "Kijani",
    ]);
  });

  it("finds nothing where no names are listed", () => {
    expect(portfolioNames("A portfolio-level view of risk.")).toEqual([]);
    expect(portfolioNames("We build a diversified portfolio.")).toEqual([]);
  });
});

describe("a fund deck's country list (ob2)", () => {
  it("resolves every country into one proposal, citing the deck", async () => {
    const { read, proposed } = world({
      constraints: [constraint("geography", "Kenya, Nigeria and Ghana")],
    });
    await expect(read()).resolves.toMatchObject({
      kind: "PREPARED",
      suggestionsCreated: 1,
    });
    expect(proposed).toEqual([
      {
        stepKey: "I3.geography",
        value: {
          type: "RESOURCE_REFERENCE",
          resourceType: "TAXONOMY_NODE",
          resourceIds: ["geo-ke", "geo-ng", "geo-gh"],
        },
        sourceRefs: CITATION,
        rationale: null,
      },
    ]);
  });

  it("merges several geography readings into one proposal", async () => {
    const { read, proposed } = world({
      constraints: [
        constraint("geography", "East Africa: Kenya, Tanzania, Uganda"),
        constraint("geography", "Nigeria"),
      ],
    });
    await read();
    expect(proposed).toHaveLength(1);
    expect(proposed[0]?.value).toMatchObject({
      resourceIds: ["geo-ke", "geo-tz", "geo-ug", "geo-ng"],
    });
  });

  it("proposes what matched and names what did not", async () => {
    const { read, proposed } = world({
      constraints: [constraint("geography", "Kenya, Atlantis and Ghana")],
    });
    await read();
    expect(proposed).toHaveLength(1);
    expect(proposed[0]?.value).toMatchObject({
      resourceIds: ["geo-ke", "geo-gh"],
    });
    expect(proposed[0]?.rationale).toBe(
      "Not matched to Capital Q's list, so not included: Atlantis.",
    );
  });

  it("proposes nothing when no country matches", async () => {
    const { read, proposed } = world({
      constraints: [constraint("geography", "Atlantis and Narnia")],
    });
    await read();
    expect(proposed).toEqual([]);
  });
});

describe("a fund deck's business models, customers, criteria and portfolio (ob2)", () => {
  it("proposes each through the same mechanism, citing the deck", async () => {
    const { read, proposed } = world({
      constraints: [
        constraint("business_models", "B2B software and marketplaces"),
        constraint("customer_types", "SMEs"),
        constraint(
          "custom_criteria",
          "Founders who know their market first-hand",
        ),
      ],
      text: "Portfolio (fictional): Kijani Ledger, Savanna Freight Desk.",
    });
    await expect(read()).resolves.toMatchObject({
      kind: "PREPARED",
      suggestionsCreated: 4,
    });
    const byStep = new Map(proposed.map((p) => [p.stepKey, p]));
    expect(byStep.get("I4.business_models")?.value).toEqual({
      type: "RESOURCE_REFERENCE",
      resourceType: "TAXONOMY_NODE",
      resourceIds: ["bm-b2b", "bm-market"],
    });
    expect(byStep.get("I4.customer_types")?.value).toMatchObject({
      resourceIds: ["ct-sme"],
    });
    expect(byStep.get("I6.custom_criteria")?.value).toEqual({
      type: "TEXT",
      text: "Founders who know their market first-hand",
    });
    expect(byStep.get("I8.portfolio")?.value).toEqual({
      type: "TEXT",
      text: "Kijani Ledger\nSavanna Freight Desk",
    });
    for (const proposal of proposed) {
      expect(proposal.sourceRefs).toEqual(CITATION);
    }
  });

  it("offers a 'sector' that is really a business model as a business model", async () => {
    const { read, proposed } = world({
      taxonomy: [
        {
          phrase: "marketplaces",
          preferenceClass: "PREFERENCE",
          proposesExclusion: false,
          nodeIds: [],
        },
      ],
    });
    await read();
    expect(proposed.map((p) => [p.stepKey, p.value])).toEqual([
      [
        "I4.business_models",
        {
          type: "RESOURCE_REFERENCE",
          resourceType: "TAXONOMY_NODE",
          resourceIds: ["bm-market"],
        },
      ],
    ]);
  });
});
