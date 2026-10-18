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
  "customer_type:sme": "ct-sme",
};

function constraint(dimension: string, value: string, quote = value) {
  return {
    dimension,
    constraintDimension: null,
    value,
    quote,
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
  const asked: {
    stepKey: string;
    reason: string;
    readings: readonly string[];
    question: string;
    sourceRefs: unknown;
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
    recordQuestions: (command) => {
      for (const q of command.questions) {
        asked.push({
          stepKey: q.stepKey,
          reason: q.reason,
          readings: q.readings,
          question: q.question,
          sourceRefs: q.sourceRefs,
        });
      }
      return Promise.resolve(null);
    },
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
  return { read, proposed, asked };
}

describe("splitNameList", () => {
  it.each([
    ["Kenya, Nigeria and Ghana", ["Kenya", "Nigeria", "Ghana"]],
    ["East Africa: Kenya, Tanzania, Uganda", ["Kenya", "Tanzania", "Uganda"]],
    ["companies based in Kenya", ["Kenya"]],
    ["Kenya; Ghana & Nigeria.", ["Kenya", "Ghana", "Nigeria"]],
    ["Kenya, kenya", ["Kenya"]],
    ["companies that sell to SMEs", ["SMEs"]],
    ["software for SMEs and mid-market firms", ["SMEs", "mid-market firms"]],
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

  it("proposes nothing when no country matches, and asks with the words it read", async () => {
    const { read, proposed, asked } = world({
      constraints: [constraint("geography", "Atlantis and Narnia")],
    });
    await read();
    expect(proposed).toEqual([]);
    expect(asked).toEqual([
      expect.objectContaining({
        stepKey: "I3.geography",
        reason: "MATERIAL_GAP",
        readings: ["Atlantis", "Narnia"],
        sourceRefs: CITATION,
      }),
    ]);
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
      text: "We look for founders who know their market first-hand.\nPortfolio (fictional): Kijani Ledger, Savanna Freight Desk.",
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

describe("customer types and criteria a fund deck states (ob2, release AB)", () => {
  it("'companies that sell to SMEs' is the SME customer type", async () => {
    const { read, proposed, asked } = world({
      constraints: [
        constraint("customer_types", "companies that sell to SMEs"),
      ],
    });
    await read();
    expect(proposed.map((p) => [p.stepKey, p.value])).toEqual([
      [
        "I4.customer_types",
        {
          type: "RESOURCE_REFERENCE",
          resourceType: "TAXONOMY_NODE",
          resourceIds: ["ct-sme"],
        },
      ],
    ]);
    expect(asked).toEqual([]);
  });

  it("a customer phrase that matches nothing is asked about by name, citing the deck", async () => {
    const { read, proposed, asked } = world({
      constraints: [constraint("customer_types", "Martian co-operatives")],
    });
    await read();
    expect(proposed).toEqual([]);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      stepKey: "I4.customer_types",
      reason: "MATERIAL_GAP",
      readings: ["Martian co-operatives"],
      sourceRefs: CITATION,
    });
    expect(asked[0]?.question).toContain('"Martian co-operatives"');
  });

  it("founder, team and traction criteria become custom criteria in the deck's words, never founder preferences", async () => {
    const { read, proposed } = world({
      constraints: [
        constraint(
          "founder_preferences",
          "Founder-market fit",
          "founders who know their market first-hand",
        ),
        constraint("green_flags", "repeat customers", "repeat customers"),
        constraint(
          "revenue_state",
          "early revenue",
          "early revenue or paying pilots",
        ),
      ],
      text: "We look for founders who know their market first-hand. Green flags: repeat customers. We prefer early revenue or paying pilots.",
    });
    await read();
    expect(proposed.map((p) => p.stepKey)).toEqual(["I6.custom_criteria"]);
    expect(proposed[0]).toMatchObject({
      value: {
        type: "TEXT",
        text: "founders who know their market first-hand\nrepeat customers\nearly revenue or paying pilots",
      },
      sourceRefs: CITATION,
    });
    expect(proposed.some((p) => p.stepKey === "I5.founder_preferences")).toBe(
      false,
    );
  });

  it("a criterion the deck does not say verbatim is not offered", async () => {
    const { read, proposed } = world({
      constraints: [
        constraint(
          "founder_preferences",
          "Strong technical founders",
          "strong technical founders",
        ),
      ],
      text: "We back teams with engineering depth.",
    });
    await read();
    expect(proposed).toEqual([]);
  });
});
