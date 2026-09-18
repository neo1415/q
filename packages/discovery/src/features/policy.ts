import { createHash } from "node:crypto";

import { deriveStructuredIntent } from "../candidates/structured.js";
import { DECLARED_TAXONOMY_SOURCES } from "../eligibility/policy.js";
import type { MandateSnapshotForEligibility } from "../eligibility/ports.js";
import type { RecommendationMode } from "../eligibility/contracts.js";
import {
  FEATURE_SCHEMA_VERSION,
  FeatureValueSchema,
  RECOMMENDATION_FEATURES,
  SnapshotCandidateProvenanceSchema,
  type FeatureMissingReason,
  type FeatureSensitivity,
  type FeatureSourceClass,
  type FeatureValue,
  type RecommendationFeatureDefinition,
  type RecommendationFeatureSnapshot,
  type SnapshotCandidateProvenance,
} from "./contracts.js";

/**
 * The registry as executable policy, and the pure feature computations.
 *
 * Everything here is deterministic over typed, source-classed projections:
 * no clock, no randomness, no model, no query. A projection names the
 * class it is; a definition names the classes it accepts; the two are
 * checked here, so a stage read from anywhere but canonical company state
 * cannot satisfy the stage feature — it yields MISSING with
 * SOURCE_NOT_AUTHORISED and counts as a scope violation.
 */

// ---------------------------------------------------------------------------
// Registry access (doc 19 §145–§146; CQ-REC-004 §12–§13)
// ---------------------------------------------------------------------------

export class FeatureContextNotAllowedError extends Error {
  readonly mode: RecommendationMode;
  readonly featureId: string | null;
  constructor(mode: RecommendationMode, featureId: string | null) {
    super(
      featureId === null
        ? `no recommendation feature is allowed in context ${mode}`
        : `feature ${featureId} is not allowed in context ${mode}`,
    );
    this.name = "FeatureContextNotAllowedError";
    this.mode = mode;
    this.featureId = featureId;
  }
}

export type FeatureRegistry = {
  readonly schemaVersion: typeof FEATURE_SCHEMA_VERSION;
  /** Every active definition, in registry order. */
  readonly definitions: () => readonly RecommendationFeatureDefinition[];
  /** Only the definitions that name the context. Fails closed for a context nothing names. */
  readonly featuresFor: (
    mode: RecommendationMode,
  ) => readonly RecommendationFeatureDefinition[];
  /** The definition, or a typed refusal when the context is not named. */
  readonly require: (
    featureId: string,
    mode: RecommendationMode,
  ) => RecommendationFeatureDefinition;
  /** A snapshot's values conform to the schema this registry describes. */
  readonly validateSnapshot: (
    snapshot: RecommendationFeatureSnapshot,
  ) => readonly string[];
};

export function createFeatureRegistry(
  definitions: readonly RecommendationFeatureDefinition[] = RECOMMENDATION_FEATURES,
): FeatureRegistry {
  const byId = new Map(definitions.map((d) => [d.id, d] as const));
  return {
    schemaVersion: FEATURE_SCHEMA_VERSION,
    definitions: () => definitions,
    featuresFor: (mode) => {
      const allowed = definitions.filter((d) =>
        d.allowedContexts.includes(mode),
      );
      if (allowed.length === 0)
        throw new FeatureContextNotAllowedError(mode, null);
      return allowed;
    },
    require: (featureId, mode) => {
      const definition = byId.get(featureId);
      if (
        definition === undefined ||
        !definition.allowedContexts.includes(mode)
      ) {
        throw new FeatureContextNotAllowedError(mode, featureId);
      }
      return definition;
    },
    validateSnapshot: (snapshot) => {
      // The schema version is a literal in the snapshot contract; a snapshot
      // of another schema cannot be parsed into this type at all.
      const problems: string[] = [];
      const expected = definitions.filter((d) =>
        d.allowedContexts.includes(snapshot.context.mode),
      );
      const ids = snapshot.features.map((f) => f.featureId);
      if (ids.join("|") !== expected.map((d) => d.id).join("|")) {
        problems.push(
          "feature values are not the allowed definitions in registry order",
        );
      }
      for (const value of snapshot.features) {
        const definition = byId.get(value.featureId);
        if (definition === undefined) {
          problems.push(`${value.featureId}: unknown feature`);
          continue;
        }
        problems.push(
          ...checkValue(definition, value).map(
            (p) => `${value.featureId}: ${p}`,
          ),
        );
      }
      return problems;
    },
  };
}

/** Type safety (CQ-REC-004 §70): the value matches the declared type, exactly. */
export function checkValue(
  definition: RecommendationFeatureDefinition,
  value: FeatureValue,
): readonly string[] {
  const problems: string[] = [];
  if (value.featureVersion !== definition.version) {
    problems.push(
      `version ${value.featureVersion} is not ${definition.version}`,
    );
  }
  for (const source of value.sourceClasses) {
    if (!definition.sourceClasses.includes(source)) {
      problems.push(`source ${source} is not accepted`);
    }
  }
  if (value.sensitivity !== definition.sensitivity) {
    problems.push(
      `sensitivity ${value.sensitivity} is not ${definition.sensitivity}`,
    );
  }
  if (value.status !== "PRESENT") return problems;
  const v = value.value;
  switch (definition.dataType) {
    case "number":
      if (typeof v !== "number" || !Number.isFinite(v)) {
        problems.push("a number feature holds a finite number");
      } else if (
        definition.range !== null &&
        (v < definition.range.min || v > definition.range.max)
      ) {
        problems.push("value is outside the declared range");
      }
      break;
    case "boolean":
      if (typeof v !== "boolean")
        problems.push("a boolean feature holds a boolean");
      break;
    case "category":
      if (typeof v !== "string" || !definition.categories.includes(v)) {
        problems.push(
          "a category feature holds one of its declared categories",
        );
      }
      break;
    case "vector":
      problems.push("vector features are not computed in V1");
      break;
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Typed projections (doc 19 §42): what feature computation may read
// ---------------------------------------------------------------------------

/** Canonical company fields, tagged with the class they are. */
export type CompanyStateProjection = {
  readonly sourceClass: "CANONICAL_COMPANY_STATE";
  readonly companyId: string;
  readonly tenantId: string;
  readonly currentStageCode: string | null;
  readonly headquartersCountry: string | null;
  /** The canonical row version the projection was read at. */
  readonly version: number;
};

/** ACTIVE classifications with their provenance, tagged. */
export type CompanyTaxonomyProjection = {
  readonly sourceClass: "CANONICAL_TAXONOMY";
  readonly classifications: readonly {
    readonly nodeId: string;
    readonly vocabularyCode: string;
    /** user_selected | admin_curated | q_inferred | document_extracted | integration */
    readonly source: string;
  }[];
};

/** Positive preference nodes expanded through the reference hierarchy, tagged. */
export type PreferenceHierarchyProjection = {
  readonly sourceClass: "TAXONOMY_REFERENCE_HIERARCHY";
  readonly nodes: readonly {
    readonly preferredNodeId: string;
    readonly vocabularyCode: string;
    readonly unrestricted: boolean;
    readonly descendantNodeIds: readonly string[];
  }[];
};

/** REC-002 and REC-003 provenance for the candidate, as the hybrid pool carries it. */
export type CandidateProvenanceProjection = {
  readonly structured: {
    readonly sourceClass: "STRUCTURED_CANDIDATE_PROVENANCE";
    readonly generatorVersion: string;
    readonly reasonCodes: readonly string[];
  } | null;
  readonly semantic: {
    readonly sourceClass: "SEMANTIC_CANDIDATE_PROVENANCE";
    readonly generatorVersion: string;
    readonly companyRepresentationVersion: string;
    readonly investorRepresentationVersion: string;
    readonly configurationVersion: string;
    readonly similarity: number;
  } | null;
};

export type FeatureInputs = {
  readonly mandate: MandateSnapshotForEligibility & {
    readonly sourceClass: "DECLARED_MANDATE";
    readonly stage?:
      | {
          readonly minStageCode: string | null;
          readonly maxStageCode: string | null;
        }
      | undefined;
  };
  readonly company: CompanyStateProjection;
  readonly taxonomy: CompanyTaxonomyProjection;
  readonly hierarchy: PreferenceHierarchyProjection;
  readonly candidate: CandidateProvenanceProjection;
  readonly eligibility: {
    readonly sourceClass: "ELIGIBILITY_RESULT";
    readonly decision: "ELIGIBLE" | "INELIGIBLE" | "UNDETERMINED";
    readonly policyVersion: string;
  };
};

export type ComputedFeature = {
  readonly value: FeatureValue;
  /** True when a projection carried a class the definition does not accept. */
  readonly scopeViolation: boolean;
};

const GEOGRAPHY = "geography";

function present(
  d: RecommendationFeatureDefinition,
  value: number | boolean | string,
  sourceClasses: readonly FeatureSourceClass[],
  provenance: Record<string, string | number | boolean> = {},
): FeatureValue {
  return FeatureValueSchema.parse({
    featureId: d.id,
    featureVersion: d.version,
    status: "PRESENT",
    value,
    missingReason: null,
    sourceClasses: [...sourceClasses],
    sensitivity: d.sensitivity,
    provenance,
  });
}

function absent(
  d: RecommendationFeatureDefinition,
  status: "MISSING" | "NOT_APPLICABLE",
  reason: FeatureMissingReason,
  sourceClasses: readonly FeatureSourceClass[],
  provenance: Record<string, string | number | boolean> = {},
): FeatureValue {
  return FeatureValueSchema.parse({
    featureId: d.id,
    featureVersion: d.version,
    status,
    value: null,
    missingReason: reason,
    sourceClasses: [...sourceClasses],
    sensitivity: d.sensitivity,
    provenance,
  });
}

/** A projection whose tag the definition does not accept satisfies nothing. */
function authorised(
  d: RecommendationFeatureDefinition,
  tags: readonly string[],
): boolean {
  return tags.every((t) => (d.sourceClasses as readonly string[]).includes(t));
}

function declaredClassifications(taxonomy: CompanyTaxonomyProjection) {
  return taxonomy.classifications.filter((c) =>
    (DECLARED_TAXONOMY_SOURCES as readonly string[]).includes(c.source),
  );
}

function computeOne(
  d: RecommendationFeatureDefinition,
  input: FeatureInputs,
): ComputedFeature {
  const intent = deriveStructuredIntent(input.mandate);
  switch (d.id) {
    case "eligibility.hard_gate": {
      if (!authorised(d, [input.eligibility.sourceClass])) {
        return {
          value: absent(d, "MISSING", "SOURCE_NOT_AUTHORISED", []),
          scopeViolation: true,
        };
      }
      return {
        value: present(
          d,
          input.eligibility.decision === "ELIGIBLE",
          ["ELIGIBILITY_RESULT"],
          {
            policyVersion: input.eligibility.policyVersion,
          },
        ),
        scopeViolation: false,
      };
    }
    case "declared_fit.stage": {
      if (
        !authorised(d, [input.mandate.sourceClass, input.company.sourceClass])
      ) {
        return {
          value: absent(d, "MISSING", "SOURCE_NOT_AUTHORISED", []),
          scopeViolation: true,
        };
      }
      const sources: FeatureSourceClass[] = [
        "DECLARED_MANDATE",
        "CANONICAL_COMPANY_STATE",
      ];
      if (intent.stageCodes.length === 0) {
        return {
          value: absent(d, "NOT_APPLICABLE", "NO_DECLARED_PREFERENCE", sources),
          scopeViolation: false,
        };
      }
      if (input.company.currentStageCode === null) {
        return {
          value: absent(d, "MISSING", "COMPANY_STAGE_UNKNOWN", sources),
          scopeViolation: false,
        };
      }
      const match = intent.stageCodes.includes(input.company.currentStageCode);
      return {
        value: present(d, match ? "MATCH" : "NO_MATCH", sources, {
          companyStageCode: input.company.currentStageCode,
          declaredStageCount: intent.stageCodes.length,
        }),
        scopeViolation: false,
      };
    }
    case "declared_fit.geography": {
      if (
        !authorised(d, [
          input.mandate.sourceClass,
          input.company.sourceClass,
          input.taxonomy.sourceClass,
          input.hierarchy.sourceClass,
        ])
      ) {
        return {
          value: absent(d, "MISSING", "SOURCE_NOT_AUTHORISED", []),
          scopeViolation: true,
        };
      }
      const sources: FeatureSourceClass[] = [
        "DECLARED_MANDATE",
        "CANONICAL_COMPANY_STATE",
        "CANONICAL_TAXONOMY",
        "TAXONOMY_REFERENCE_HIERARCHY",
      ];
      const regionNodes = input.hierarchy.nodes.filter(
        (n) =>
          n.vocabularyCode === GEOGRAPHY &&
          intent.taxonomyNodeIds.includes(n.preferredNodeId),
      );
      const narrowing = regionNodes.filter((n) => !n.unrestricted);
      if (intent.countryCodes.length === 0 && regionNodes.length === 0) {
        return {
          value: absent(d, "NOT_APPLICABLE", "NO_DECLARED_PREFERENCE", sources),
          scopeViolation: false,
        };
      }
      if (intent.countryCodes.length === 0 && narrowing.length === 0) {
        return {
          value: absent(
            d,
            "NOT_APPLICABLE",
            "UNRESTRICTED_PREFERENCE",
            sources,
          ),
          scopeViolation: false,
        };
      }
      const country = input.company.headquartersCountry;
      if (
        country !== null &&
        intent.countryCodes.includes(country.toUpperCase())
      ) {
        return {
          value: present(d, "COUNTRY_MATCH", sources, {
            headquartersCountry: country.toUpperCase(),
          }),
          scopeViolation: false,
        };
      }
      const geographyClassifications = declaredClassifications(
        input.taxonomy,
      ).filter((c) => c.vocabularyCode === GEOGRAPHY);
      for (const node of narrowing) {
        const asked = new Set([
          node.preferredNodeId,
          ...node.descendantNodeIds,
        ]);
        const hit = geographyClassifications.find((c) => asked.has(c.nodeId));
        if (hit !== undefined) {
          return {
            value: present(d, "REGION_MATCH", sources, {
              preferredNodeId: node.preferredNodeId,
              matchedNodeId: hit.nodeId,
              exact: hit.nodeId === node.preferredNodeId,
            }),
            scopeViolation: false,
          };
        }
      }
      if (country === null && geographyClassifications.length === 0) {
        return {
          value: absent(d, "MISSING", "COMPANY_GEOGRAPHY_UNKNOWN", sources),
          scopeViolation: false,
        };
      }
      return { value: present(d, "NO_MATCH", sources), scopeViolation: false };
    }
    case "declared_fit.taxonomy": {
      if (
        !authorised(d, [
          input.mandate.sourceClass,
          input.taxonomy.sourceClass,
          input.hierarchy.sourceClass,
        ])
      ) {
        return {
          value: absent(d, "MISSING", "SOURCE_NOT_AUTHORISED", []),
          scopeViolation: true,
        };
      }
      const sources: FeatureSourceClass[] = [
        "DECLARED_MANDATE",
        "CANONICAL_TAXONOMY",
        "TAXONOMY_REFERENCE_HIERARCHY",
      ];
      const preferred = input.hierarchy.nodes.filter(
        (n) =>
          n.vocabularyCode !== GEOGRAPHY &&
          intent.taxonomyNodeIds.includes(n.preferredNodeId),
      );
      if (preferred.length === 0) {
        return {
          value: absent(d, "NOT_APPLICABLE", "NO_DECLARED_PREFERENCE", sources),
          scopeViolation: false,
        };
      }
      const declared = declaredClassifications(input.taxonomy);
      const carried = new Set(declared.map((c) => c.nodeId));
      const exact = preferred.find((n) => carried.has(n.preferredNodeId));
      if (exact !== undefined) {
        return {
          value: present(d, "EXACT_OVERLAP", sources, {
            preferredNodeId: exact.preferredNodeId,
            matchedNodeId: exact.preferredNodeId,
            vocabularyCode: exact.vocabularyCode,
          }),
          scopeViolation: false,
        };
      }
      for (const node of [...preferred].sort((a, b) =>
        a.preferredNodeId.localeCompare(b.preferredNodeId),
      )) {
        const hit = [...node.descendantNodeIds]
          .sort()
          .find((id) => carried.has(id));
        if (hit !== undefined) {
          return {
            value: present(d, "DESCENDANT_OVERLAP", sources, {
              preferredNodeId: node.preferredNodeId,
              matchedNodeId: hit,
              vocabularyCode: node.vocabularyCode,
            }),
            scopeViolation: false,
          };
        }
      }
      // A vocabulary the mandate asks about that the company has no declared
      // classification in is unknown, not a no-match.
      const askedVocabularies = new Set(preferred.map((n) => n.vocabularyCode));
      const knownVocabularies = new Set(declared.map((c) => c.vocabularyCode));
      const unanswered = [...askedVocabularies].some(
        (v) => !knownVocabularies.has(v),
      );
      if (unanswered) {
        return {
          value: absent(d, "MISSING", "COMPANY_TAXONOMY_UNKNOWN", sources),
          scopeViolation: false,
        };
      }
      return {
        value: present(d, "NO_OVERLAP", sources),
        scopeViolation: false,
      };
    }
    case "declared_fit.cheque": {
      if (
        !authorised(d, [input.mandate.sourceClass, input.company.sourceClass])
      ) {
        return {
          value: absent(d, "MISSING", "SOURCE_NOT_AUTHORISED", []),
          scopeViolation: true,
        };
      }
      // No discovery-safe raise projection exists in V1: the honest value.
      return {
        value: absent(d, "MISSING", "CHEQUE_NOT_COMPUTABLE", [
          "DECLARED_MANDATE",
          "CANONICAL_COMPANY_STATE",
        ]),
        scopeViolation: false,
      };
    }
    case "semantic_fit.mandate_similarity": {
      const semantic = input.candidate.semantic;
      if (semantic === null) {
        return {
          value: absent(d, "MISSING", "SEMANTIC_NOT_RETRIEVED", [
            "SEMANTIC_CANDIDATE_PROVENANCE",
          ]),
          scopeViolation: false,
        };
      }
      if (!authorised(d, [semantic.sourceClass])) {
        return {
          value: absent(d, "MISSING", "SOURCE_NOT_AUTHORISED", []),
          scopeViolation: true,
        };
      }
      return {
        value: present(
          d,
          semantic.similarity,
          ["SEMANTIC_CANDIDATE_PROVENANCE"],
          {
            generatorVersion: semantic.generatorVersion,
            companyRepresentationVersion: semantic.companyRepresentationVersion,
            investorRepresentationVersion:
              semantic.investorRepresentationVersion,
            configurationVersion: semantic.configurationVersion,
          },
        ),
        scopeViolation: false,
      };
    }
    default:
      throw new Error(`no computation registered for feature ${d.id}`);
  }
}

/**
 * Every allowed feature for the context, in registry order. Pure.
 */
export function computeFeatureValues(
  definitions: readonly RecommendationFeatureDefinition[],
  input: FeatureInputs,
): {
  readonly values: readonly FeatureValue[];
  readonly scopeViolations: number;
} {
  const values: FeatureValue[] = [];
  let scopeViolations = 0;
  for (const definition of definitions) {
    const computed = computeOne(definition, input);
    const problems = checkValue(definition, computed.value);
    if (problems.length > 0) {
      throw new Error(`${definition.id}: ${problems.join("; ")}`);
    }
    values.push(computed.value);
    if (computed.scopeViolation) scopeViolations += 1;
  }
  return { values, scopeViolations };
}

const SENSITIVITY_ORDER: readonly FeatureSensitivity[] = [
  "PUBLIC",
  "NETWORK_VISIBLE",
  "INTERNAL",
  "CONFIDENTIAL",
  "HIGHLY_CONFIDENTIAL",
  "RESTRICTED",
];

/** The artifact's class is its most sensitive input's class; never lower. */
export function snapshotSensitivity(
  values: readonly FeatureValue[],
): FeatureSensitivity {
  let highest = 0;
  for (const v of values) {
    highest = Math.max(highest, SENSITIVITY_ORDER.indexOf(v.sensitivity));
  }
  return SENSITIVITY_ORDER[highest] ?? "RESTRICTED";
}

/**
 * The semantic fingerprint (CQ-REC-004 §53): the schema, every definition
 * id and version, the context, mandate and version, the company projection
 * version, the taxonomy version, the candidate provenance versions, the
 * eligibility policy, and the values themselves. Never computedAt, never
 * an artifact id, never raw text.
 */
export function snapshotFingerprint(input: {
  readonly definitions: readonly RecommendationFeatureDefinition[];
  readonly snapshot: Omit<
    RecommendationFeatureSnapshot,
    "fingerprint" | "computedAt"
  >;
}): string {
  const s = input.snapshot;
  const canonical = JSON.stringify([
    s.featureSchemaVersion,
    input.definitions.map((d) => `${d.id}@${d.version}`),
    s.context.mode,
    s.context.tenantId,
    s.context.investorOrganisationId,
    s.mandateId,
    s.mandateVersion,
    s.companyId,
    s.companyTenantId,
    s.companyProjectionVersion,
    s.context.taxonomyVersion === null
      ? null
      : Object.entries(s.context.taxonomyVersion).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
    s.eligibilityPolicyVersion,
    s.eligibilityDecision,
    s.candidateProvenance,
    s.features.map((f) => [
      f.featureId,
      f.featureVersion,
      f.status,
      f.value,
      f.missingReason,
      f.sourceClasses,
      f.sensitivity,
      Object.entries(f.provenance).sort(([a], [b]) => a.localeCompare(b)),
    ]),
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/** Convenience for readers: the candidate provenance in snapshot form. */
export function toSnapshotCandidateProvenance(
  candidate: CandidateProvenanceProjection,
): SnapshotCandidateProvenance {
  // Validated, not asserted: an unknown generator or representation version
  // is refused here rather than carried into an artifact.
  return SnapshotCandidateProvenanceSchema.parse({
    structured:
      candidate.structured === null
        ? null
        : {
            generatorVersion: candidate.structured.generatorVersion,
            reasonCodes: [...candidate.structured.reasonCodes].sort(),
          },
    semantic:
      candidate.semantic === null
        ? null
        : {
            generatorVersion: candidate.semantic.generatorVersion,
            companyRepresentationVersion:
              candidate.semantic.companyRepresentationVersion,
            investorRepresentationVersion:
              candidate.semantic.investorRepresentationVersion,
            configurationVersion: candidate.semantic.configurationVersion,
          },
  });
}
