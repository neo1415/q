import { describe, expect, it } from "vitest";

import type { ActorContext } from "@capital-q/security";

import { FIT_CONFIG_CURRENT } from "../src/fit/config.js";
import { observeFit, type FitFeatureSource } from "../src/fit/observe.js";
import { createFitInputSource } from "../src/infrastructure/fit-inputs.js";
import {
  COMPANY_REPRESENTATION_VERSION,
  INVESTOR_REPRESENTATION_VERSION,
  SEMANTIC_GENERATOR_ID,
  SEMANTIC_GENERATOR_VERSION,
  SEMANTIC_SIMILARITY_METRIC,
  type SemanticProvenance,
} from "../src/semantic/contracts.js";

/**
 * Live 17 Nov 2026 (Zino, investor organisation 9c73b384): the v2 drift
 * rebuild rewrote only the companies in the new Discover pool, so 43
 * CURRENT snapshots of companies outside it kept semantic_generator_version
 * null and the similarity MISSING / SEMANTIC_NOT_RETRIEVED, although both
 * vectors existed. Q's fit ranking reads those snapshots and said "thesis
 * isn't known". This replays one of them as stored (the Tensorgate row,
 * features verbatim) through the fit read.
 */

const INVESTOR_ORG = "9c73b384-876c-45a9-a564-d498d1a3fe22";
const MANDATE = "3fb15755-893a-41c3-ac62-3765099b4e30";
const COMPANY = "bf55d6e1-567a-470b-954d-054ae05990e2";
const NOW = new Date("2026-11-17T20:00:00.000Z");

const actor = {
  userId: "00000000-0000-4000-8000-000000000100",
  tenantId: "ef57af63-5a6c-484c-964b-ab66ac5c63a3",
  actorType: "USER",
} as unknown as ActorContext;

const SIMILARITY_MISSING = {
  value: null,
  status: "MISSING",
  featureId: "semantic_fit.mandate_similarity",
  provenance: {},
  sensitivity: "CONFIDENTIAL",
  missingReason: "SEMANTIC_NOT_RETRIEVED",
  sourceClasses: ["SEMANTIC_CANDIDATE_PROVENANCE"],
  featureVersion: "v1",
} as const;

/** Before 5b4bd13a2: the category MISSING and no sector overlap recorded. */
const SECTOR_NOT_RECORDED = {
  value: null,
  status: "MISSING",
  featureId: "declared_fit.taxonomy",
  provenance: {},
  sensitivity: "CONFIDENTIAL",
  missingReason: "COMPANY_TAXONOMY_UNKNOWN",
  sourceClasses: [
    "DECLARED_MANDATE",
    "CANONICAL_TAXONOMY",
    "TAXONOMY_REFERENCE_HIERARCHY",
  ],
  featureVersion: "v1",
} as const;

/** The stored row (recommendation.feature_snapshots, computed 07:21:37). */
function storedRow(
  taxonomy: Readonly<Record<string, unknown>> = {
    value: "EXACT_OVERLAP",
    status: "PRESENT",
    featureId: "declared_fit.taxonomy",
    provenance: {
      matchedNodeId: "82aa1770-1df4-592e-9eed-4759c0cf273f",
      sectorOverlap: "EXACT",
      vocabularyCode: "business_model",
      preferredNodeId: "82aa1770-1df4-592e-9eed-4759c0cf273f",
    },
    sensitivity: "CONFIDENTIAL",
    missingReason: null,
    sourceClasses: [
      "DECLARED_MANDATE",
      "CANONICAL_TAXONOMY",
      "TAXONOMY_REFERENCE_HIERARCHY",
    ],
    featureVersion: "v1",
  },
) {
  return {
    tenant_id: "ef57af63-5a6c-484c-964b-ab66ac5c63a3",
    investor_organisation_id: INVESTOR_ORG,
    mandate_id: MANDATE,
    mandate_version: 23,
    company_id: COMPANY,
    company_tenant_id: "3965fb62-6225-48f2-8daf-480a8c6cb05b",
    company_projection_version: 13,
    mode: "INVESTOR_DISCOVER",
    feature_schema_version: "recommendation-features.v1",
    eligibility_policy_version: "eligibility.v6",
    eligibility_decision: "ELIGIBLE",
    structured_generator_version: "structured-mandate.v7",
    semantic_generator_version: null,
    taxonomy_version: {
      industry: 2,
      geography: 5,
      technology: 1,
      impact_theme: 1,
      company_stage: 1,
      customer_type: 1,
      business_model: 1,
      product_category: 1,
      regulatory_profile: 1,
    },
    candidate_provenance: {
      semantic: null,
      structured: {
        reasonCodes: ["GEOGRAPHY_OVERLAP", "STAGE_OVERLAP", "TAXONOMY_OVERLAP"],
        generatorVersion: "structured-mandate.v7",
      },
    },
    sensitivity: "CONFIDENTIAL",
    features: [
      {
        value: true,
        status: "PRESENT",
        featureId: "eligibility.hard_gate",
        provenance: { policyVersion: "eligibility.v6" },
        sensitivity: "INTERNAL",
        missingReason: null,
        sourceClasses: ["ELIGIBILITY_RESULT"],
        featureVersion: "v1",
      },
      {
        value: "MATCH",
        status: "PRESENT",
        featureId: "declared_fit.stage",
        provenance: { companyStageCode: "seed", declaredStageCount: 3 },
        sensitivity: "CONFIDENTIAL",
        missingReason: null,
        sourceClasses: ["DECLARED_MANDATE", "CANONICAL_COMPANY_STATE"],
        featureVersion: "v2",
      },
      {
        value: "COUNTRY_MATCH",
        status: "PRESENT",
        featureId: "declared_fit.geography",
        provenance: {
          preferredNodeId: "6511206c-6b77-5172-9e1b-ac0eca583611",
          headquartersCountry: "US",
        },
        sensitivity: "CONFIDENTIAL",
        missingReason: null,
        sourceClasses: [
          "DECLARED_MANDATE",
          "CANONICAL_COMPANY_STATE",
          "CANONICAL_TAXONOMY",
          "TAXONOMY_REFERENCE_HIERARCHY",
        ],
        featureVersion: "v2",
      },
      taxonomy,
      {
        value: null,
        status: "MISSING",
        featureId: "declared_fit.cheque",
        provenance: { chequeFitPolicyVersion: "cheque-fit.v1" },
        sensitivity: "CONFIDENTIAL",
        missingReason: "ROUND_TARGET_NOT_SHARED",
        sourceClasses: ["DECLARED_MANDATE"],
        featureVersion: "v2",
      },
      SIMILARITY_MISSING,
    ],
    fingerprint:
      "fdec29c370cb31c74ffe15d6da2b2c957f8c80b4b2bae4f7ba22941468b8d69b",
    // The driver returns timestamptz as a Date.
    computed_at: new Date("2026-11-17T07:21:37.041Z"),
  };
}

/** The snapshot read returns the stored row; every other read returns none. */
function sqlReturning(row: ReturnType<typeof storedRow>) {
  return ((strings: TemplateStringsArray) =>
    Promise.resolve(
      strings.join("?").includes("recommendation.feature_snapshots")
        ? [row]
        : [],
    )) as never;
}

function provenance(similarity: number): SemanticProvenance {
  return {
    generatorId: SEMANTIC_GENERATOR_ID,
    generatorVersion: SEMANTIC_GENERATOR_VERSION,
    metric: SEMANTIC_SIMILARITY_METRIC,
    similarity,
    companyRepresentationVersion: COMPANY_REPRESENTATION_VERSION,
    investorRepresentationVersion: INVESTOR_REPRESENTATION_VERSION,
    configurationVersion: "embedding-config.test",
    documentInstructionVersion: "document.test",
    queryInstructionVersion: "query.test",
  };
}

function source(options: {
  readonly row: ReturnType<typeof storedRow>;
  readonly similarities?: ReadonlyMap<string, SemanticProvenance>;
  readonly view?: ReadonlyMap<string, FitFeatureSource>;
  readonly asked?: {
    thesis: (readonly string[])[];
    sector: (readonly string[])[];
    mandates: string[];
  };
}) {
  return createFitInputSource({
    sql: sqlReturning(options.row),
    eligibilityPorts: {
      mandates: {
        activeMandate: () => Promise.resolve({ kind: "NONE" as const }),
      },
      companies: { findMany: () => Promise.resolve([]) },
    },
    identities: (ids) =>
      Promise.resolve(
        new Map(ids.map((id) => [id, { name: id, shortDescription: null }])),
      ),
    ...(options.similarities === undefined
      ? {}
      : {
          mandateSimilarities: (input) => {
            options.asked?.thesis.push([...input.companyIds]);
            options.asked?.mandates.push(input.mandateId);
            return Promise.resolve(options.similarities ?? new Map());
          },
        }),
    ...(options.view === undefined
      ? {}
      : {
          viewFeatures: (input) => {
            options.asked?.sector.push([...input.companyIds]);
            return Promise.resolve(options.view ?? new Map());
          },
        }),
  });
}

async function observed(fit: ReturnType<typeof source>, purpose?: "RANK") {
  const read = await fit.read({
    actor,
    investorOrganisationId: INVESTOR_ORG,
    mandateId: MANDATE,
    companyIds: [COMPANY],
    ...(purpose === undefined ? {} : { purpose }),
  });
  const snapshot = read.get(COMPANY)?.snapshot ?? null;
  return {
    snapshot,
    fit: observeFit({
      companyId: COMPANY,
      snapshot,
      declared: {},
      eligibilityReasons: [],
      config: FIT_CONFIG_CURRENT,
      now: NOW,
    }),
  };
}

describe("a stale CURRENT snapshot is scored on read (live 17 Nov 2026, Zino)", () => {
  it("replay: a null-version snapshot with vectors on both sides reads a THESIS outcome", async () => {
    const asked = { thesis: [], sector: [], mandates: [] } as {
      thesis: (readonly string[])[];
      sector: (readonly string[])[];
      mandates: string[];
    };
    const fit = source({
      row: storedRow(),
      similarities: new Map([[COMPANY, provenance(0.61)]]),
      asked,
    });
    // A rank reads it too: Q's fit ranking is where the owner heard it.
    for (const purpose of [undefined, "RANK"] as const) {
      const { snapshot, fit: result } = await observed(fit, purpose);
      expect(result.observations.THESIS.outcome).toBe("STRONG");
      const value = snapshot?.features.find(
        (f) => f.featureId === "semantic_fit.mandate_similarity",
      );
      expect(value).toMatchObject({
        status: "PRESENT",
        value: 0.61,
        missingReason: null,
        provenance: { similarityBasis: "SCORED" },
      });
      // Only the stale measure is replaced; the stored ones stand.
      expect(result.observations.STAGE.outcome).toBe("STRONG");
      expect(result.observations.SECTOR.outcome).toBe("STRONG");
    }
    // Exactly the stale company, for the mandate asked about.
    expect(asked.thesis).toEqual([[COMPANY], [COMPANY]]);
    expect(asked.mandates).toEqual([MANDATE, MANDATE]);
    // A sector already recorded is not recomputed.
    expect(asked.sector).toEqual([]);
  });

  it("no company vector: the thesis stays unknown, never zero", async () => {
    const { snapshot, fit } = await observed(
      source({ row: storedRow(), similarities: new Map() }),
    );
    expect(fit.observations.THESIS.outcome).toBe("UNKNOWN");
    expect(
      snapshot?.features.find(
        (f) => f.featureId === "semantic_fit.mandate_similarity",
      ),
    ).toMatchObject({ status: "MISSING", value: null });
  });

  it("a failed scoring read leaves the snapshot as persisted (unknown)", async () => {
    const fit = createFitInputSource({
      sql: sqlReturning(storedRow()),
      eligibilityPorts: {
        mandates: {
          activeMandate: () => Promise.resolve({ kind: "NONE" as const }),
        },
        companies: { findMany: () => Promise.resolve([]) },
      },
      identities: (ids) =>
        Promise.resolve(
          new Map(ids.map((id) => [id, { name: id, shortDescription: null }])),
        ),
      mandateSimilarities: () => Promise.reject(new Error("store down")),
    });
    const { fit: result } = await observed(fit);
    expect(result.observations.THESIS.outcome).toBe("UNKNOWN");
  });

  it("a scored snapshot is never asked again", async () => {
    const row = storedRow();
    const scored = {
      ...row,
      semantic_generator_version: SEMANTIC_GENERATOR_VERSION,
      features: row.features.map((f) =>
        f.featureId === "semantic_fit.mandate_similarity"
          ? {
              ...f,
              status: "PRESENT",
              value: 0.3,
              missingReason: null,
              provenance: { similarityBasis: "SCORED" },
            }
          : f,
      ),
    };
    const asked = { thesis: [], sector: [], mandates: [] } as {
      thesis: (readonly string[])[];
      sector: (readonly string[])[];
      mandates: string[];
    };
    const { fit } = await observed(
      source({
        row: scored as never,
        similarities: new Map([[COMPANY, provenance(0.9)]]),
        asked,
      }),
    );
    expect(fit.observations.THESIS.outcome).toBe("PARTIAL");
    expect(asked.thesis).toEqual([]);
  });

  it("sector (5b4bd13a2): a MISSING category with no recorded overlap reads the overlap computed on read", async () => {
    const asked = { thesis: [], sector: [], mandates: [] } as {
      thesis: (readonly string[])[];
      sector: (readonly string[])[];
      mandates: string[];
    };
    const recomputed: FitFeatureSource = {
      features: [
        {
          ...SECTOR_NOT_RECORDED,
          provenance: { sectorOverlap: "EXACT" },
          sourceClasses: [...SECTOR_NOT_RECORDED.sourceClasses],
        },
      ],
    };
    const fit = source({
      row: storedRow(SECTOR_NOT_RECORDED),
      view: new Map([[COMPANY, recomputed]]),
      asked,
    });
    const before = await observed(
      source({ row: storedRow(SECTOR_NOT_RECORDED) }),
      "RANK",
    );
    expect(before.fit.observations.SECTOR.outcome).toBe("UNKNOWN");
    const after = await observed(fit, "RANK");
    expect(after.fit.observations.SECTOR.outcome).toBe("STRONG");
    expect(asked.sector).toEqual([[COMPANY]]);
    // Nothing else from the view read replaces the stored values.
    expect(after.fit.observations.STAGE.outcome).toBe("STRONG");
  });
});
