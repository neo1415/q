import { describe, expect, it } from "vitest";

import {
  createEventRegistry,
  TaxonomyCanonicalCodeSchema,
  type CorrelationId,
} from "@capital-q/contracts";

import {
  TAXONOMY_ASSIGNMENT_SOURCES,
  TAXONOMY_EDGE_TYPES,
  TAXONOMY_SUBJECT_TYPES,
  TaxonomyConfidenceSchema,
  TaxonomyNodeMetadataSchema,
} from "../src/contracts/index.js";
import {
  decodeTaxonomyNodeCursor,
  encodeTaxonomyNodeCursor,
} from "../src/domain/cursor.js";
import { TaxonomyHierarchyError } from "../src/domain/errors.js";
import { validateHierarchy } from "../src/domain/hierarchy.js";
import { normalizeTaxonomyAlias } from "../src/domain/normalize-alias.js";
import {
  stableNodeId,
  stableVocabularyId,
  uuidV5,
} from "../src/domain/stable-id.js";
import {
  entityAssignmentsChangedEvent,
  TAXONOMY_EVENTS,
} from "../src/events/index.js";
import * as taxonomy from "../src/index.js";
import {
  REFERENCE_TAXONOMY,
  referenceNode,
} from "../src/reference-data/index.js";
import { renderReferenceTaxonomySql } from "../src/reference-data/sql.js";

describe("stable identity (§11-16, ADR 0005)", () => {
  it("derives RFC 4122 v5 ids deterministically from vocabulary and canonical code", () => {
    // Known vector: uuid v5 of "hello" under the DNS namespace.
    expect(uuidV5("6ba7b810-9dad-11d1-80b4-00c04fd430c8", "hello")).toBe(
      "9342d47a-1bab-5709-9869-c840b2eac501",
    );
    expect(stableNodeId("industry", "payment_infrastructure")).toBe(
      stableNodeId("industry", "payment_infrastructure"),
    );
    expect(stableNodeId("industry", "payment_infrastructure")).not.toBe(
      stableNodeId("product_category", "payment_infrastructure"),
    );
    expect(stableVocabularyId("industry")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("a display rename never changes the id or canonical code", () => {
    const node = referenceNode("industry", "payment_infrastructure");
    const renamed = { ...node, displayName: "Payments Infrastructure" };
    expect(renamed.id).toBe(node.id);
    expect(renamed.canonicalCode).toBe("payment_infrastructure");
    expect(stableNodeId(node.vocabularyCode, node.canonicalCode)).toBe(node.id);
  });
});

describe("reference taxonomy (§110-120)", () => {
  it("seeds the seven required vocabularies plus minimal impact and regulatory shells", () => {
    expect(REFERENCE_TAXONOMY.vocabularies.map((v) => v.code)).toEqual([
      "industry",
      "product_category",
      "technology",
      "business_model",
      "customer_type",
      "company_stage",
      "geography",
      "impact_theme",
      "regulatory_profile",
    ]);
    expect(REFERENCE_TAXONOMY.vocabularies.every((v) => v.version === 1)).toBe(
      true,
    );
    expect(REFERENCE_TAXONOMY.nodes.length).toBeGreaterThan(100);
    expect(REFERENCE_TAXONOMY.nodes.length).toBeLessThan(400);
    expect(REFERENCE_TAXONOMY.aliases.length).toBeGreaterThanOrEqual(40);
  });

  it("carries the documented fintech hierarchy with correct parents and depths (§170)", () => {
    const chain = [
      "financial_services",
      "fintech",
      "payments",
      "payment_infrastructure",
    ].map((code) => referenceNode("industry", code));
    expect(chain.map((n) => n.depth)).toEqual([0, 1, 2, 3]);
    expect(chain[1]?.parentNodeId).toBe(chain[0]?.id);
    expect(chain[2]?.parentNodeId).toBe(chain[1]?.id);
    expect(chain[3]?.parentNodeId).toBe(chain[2]?.id);
  });

  it("matches existing stage codes and keeps ISO codes on countries", () => {
    expect(
      REFERENCE_TAXONOMY.nodes
        .filter((n) => n.vocabularyCode === "company_stage")
        .map((n) => n.canonicalCode),
    ).toEqual(["pre_seed", "seed", "series_a", "series_b", "series_c_plus"]);
    expect(referenceNode("geography", "nigeria").metadata).toEqual({
      iso3166Alpha2: "NG",
    });
    expect(referenceNode("geography", "nigeria").parentCode).toBe(
      "west_africa",
    );
    expect(referenceNode("geography", "west_africa").parentCode).toBe("africa");
  });

  it("every canonical code is conservative and every alias is normalised", () => {
    for (const node of REFERENCE_TAXONOMY.nodes) {
      expect(
        TaxonomyCanonicalCodeSchema.safeParse(node.canonicalCode).success,
      ).toBe(true);
      expect(TaxonomyNodeMetadataSchema.safeParse(node.metadata).success).toBe(
        true,
      );
    }
    for (const alias of REFERENCE_TAXONOMY.aliases) {
      expect(alias.normalizedAlias).toBe(normalizeTaxonomyAlias(alias.alias));
    }
    validateHierarchy(REFERENCE_TAXONOMY.nodes);
  });

  it("allows the same phrase to alias nodes in different vocabularies (§174)", () => {
    const rails = REFERENCE_TAXONOMY.aliases.filter(
      (a) => a.normalizedAlias === "payments rails",
    );
    expect(rails).toHaveLength(2);
    expect(new Set(rails.map((a) => a.nodeId)).size).toBe(2);
  });

  it("renders idempotent SQL with explicit ids and parents before children", () => {
    const sql = renderReferenceTaxonomySql();
    expect(sql).toContain("on conflict (id) do nothing");
    expect(sql).toContain(referenceNode("industry", "fintech").id);
    const fs = sql.indexOf(referenceNode("industry", "financial_services").id);
    const pi = sql.indexOf(
      referenceNode("industry", "payment_infrastructure").id,
    );
    expect(fs).toBeGreaterThan(0);
    expect(pi).toBeGreaterThan(fs);
    expect(sql).not.toMatch(/weight|score|rank/i);
  });
});

describe("hierarchy validation (§27-30, §171-172)", () => {
  const base = { vocabularyCode: "industry" };
  it("rejects cross-vocabulary parents, wrong depths and cycles", () => {
    expect(() =>
      validateHierarchy([
        { id: "a", ...base, canonicalCode: "a", parentNodeId: null, depth: 0 },
        {
          id: "g",
          vocabularyCode: "geography",
          canonicalCode: "g",
          parentNodeId: null,
          depth: 0,
        },
        { id: "b", ...base, canonicalCode: "b", parentNodeId: "g", depth: 1 },
      ]),
    ).toThrow(TaxonomyHierarchyError);
    expect(() =>
      validateHierarchy([
        { id: "a", ...base, canonicalCode: "a", parentNodeId: null, depth: 0 },
        { id: "b", ...base, canonicalCode: "b", parentNodeId: "a", depth: 2 },
      ]),
    ).toThrow(/depth/);
    expect(() =>
      validateHierarchy([
        { id: "a", ...base, canonicalCode: "a", parentNodeId: "c", depth: 1 },
        { id: "b", ...base, canonicalCode: "b", parentNodeId: "a", depth: 2 },
        { id: "c", ...base, canonicalCode: "c", parentNodeId: "b", depth: 3 },
      ]),
    ).toThrow(TaxonomyHierarchyError);
    expect(() =>
      validateHierarchy([
        {
          id: "a",
          ...base,
          canonicalCode: "dup",
          parentNodeId: null,
          depth: 0,
        },
        {
          id: "b",
          ...base,
          canonicalCode: "dup",
          parentNodeId: null,
          depth: 0,
        },
      ]),
    ).toThrow(/duplicate canonical code/);
  });
});

describe("alias normalisation (§45, §173)", () => {
  it("makes formatting variants match without semantic rewriting", () => {
    expect(normalizeTaxonomyAlias("  B2B   Payment APIs ")).toBe(
      "b2b payment apis",
    );
    expect(normalizeTaxonomyAlias("AI / ML")).toBe("ai/ml");
    expect(normalizeTaxonomyAlias("Fin - tech")).toBe("fin-tech");
    expect(normalizeTaxonomyAlias("Media&Entertainment")).toBe(
      "media & entertainment",
    );
    expect(normalizeTaxonomyAlias("ﬁntech")).toBe("fintech");
    expect(normalizeTaxonomyAlias("payments rails")).toBe(
      normalizeTaxonomyAlias("Payments Rails"),
    );
    expect(normalizeTaxonomyAlias("payments")).not.toBe(
      normalizeTaxonomyAlias("payment"),
    );
  });
});

describe("closed vocabularies and primitives", () => {
  it("keeps edge types, sources, subjects and confidence bounded", () => {
    expect([...TAXONOMY_EDGE_TYPES]).toEqual([
      "broader_than",
      "related_to",
      "overlaps",
      "commonly_co_occurs",
      "successor_of",
    ]);
    expect([...TAXONOMY_ASSIGNMENT_SOURCES]).toEqual([
      "user_selected",
      "q_inferred",
      "document_extracted",
      "admin_curated",
      "integration",
    ]);
    expect([...TAXONOMY_SUBJECT_TYPES]).toEqual(["COMPANY"]);
    expect(TaxonomyConfidenceSchema.safeParse("0.94").success).toBe(true);
    expect(TaxonomyConfidenceSchema.safeParse("1.5").success).toBe(false);
    expect(
      TaxonomyNodeMetadataSchema.safeParse({ rankingWeight: 15 }).success,
    ).toBe(false);
  });

  it("node cursors round-trip and reject foreign input", () => {
    const cursor = {
      displayName: "Payments",
      id: "9e323247-8a4b-575b-acdc-6f682f0d6a7b",
    };
    expect(decodeTaxonomyNodeCursor(encodeTaxonomyNodeCursor(cursor))).toEqual(
      cursor,
    );
    expect(() => decodeTaxonomyNodeCursor("not-a-cursor")).toThrow();
  });

  it("exposes no ranking, scoring, classification-run or model surface (§185-188)", () => {
    const names = Object.keys(taxonomy);
    for (const forbidden of names.filter((name) =>
      /rank|score|weight|recommend|embedding|classif(y|ier|ication)Run|llm|model/i.test(
        name,
      ),
    )) {
      expect(forbidden, forbidden).toBe("");
    }
    expect(names).toContain("createTaxonomyService");
    expect(names).toContain("normalizeTaxonomyAlias");
  });
});

describe("domain event (§134-135)", () => {
  const registry = createEventRegistry([...TAXONOMY_EVENTS]);
  const correlationId: CorrelationId =
    "cor_123e4567-e89b-12d3-a456-426614174000";

  it("registers taxonomy.entity_assignments.changed@1 with subject and vocabulary codes only", () => {
    const definition = registry.get("taxonomy.entity_assignments.changed", 1);
    expect(definition?.owner).toBe("@capital-q/taxonomy");
    const event = entityAssignmentsChangedEvent({
      tenantId: "c0000000-0000-4000-8000-000000000001",
      organisationId: "d0000000-0000-4000-8000-000000000001",
      actorUserId: "b0000000-0000-4000-8000-000000000001",
      correlationId,
      subjectType: "COMPANY",
      subjectId: "f0000000-0000-4000-8000-000000000001",
      changedVocabularyCodes: ["technology"],
    });
    expect(registry.parse(event).ok).toBe(true);
    expect(event.data).toEqual({
      subjectType: "COMPANY",
      subjectId: "f0000000-0000-4000-8000-000000000001",
      changedVocabularyCodes: ["technology"],
    });
    expect(
      registry.parse({
        ...event,
        data: { ...event.data, rawSourceText: "PRIVATE" },
      }).ok,
    ).toBe(false);
    expect(registry.has("taxonomy.mandate_preferences.changed", 1)).toBe(false);
  });
});
