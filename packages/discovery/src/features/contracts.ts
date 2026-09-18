import { MessageSensitivitySchema } from "@capital-q/contracts";
import { z } from "zod";

import {
  STRUCTURED_GENERATOR_VERSION,
  CandidateReasonCodeSchema,
} from "../candidates/contracts.js";
import {
  ELIGIBILITY_POLICY_VERSION,
  EligibilityDecisionSchema,
  RECOMMENDATION_MODES,
  RecommendationContextSchema,
  RecommendationModeSchema,
} from "../eligibility/contracts.js";
import {
  COMPANY_REPRESENTATION_VERSION,
  INVESTOR_REPRESENTATION_VERSION,
  SEMANTIC_GENERATOR_VERSION,
} from "../semantic/contracts.js";

/**
 * The recommendation feature registry (doc 19 §38–§42, §92, §111,
 * §144–§147; doc 25 CQ-REC-004): the governed, typed, versioned list of
 * signals a ranker is allowed to read, and the typed values a feature
 * snapshot carries.
 *
 * Kept apart, permanently:
 *
 *   feature value ≠ feature weight ≠ score ≠ rank      (REC-005 owns weights)
 *   feature snapshot ≠ candidate provenance ≠ explanation (REC-007)
 *   eligibility gate ≠ soft score                       (REC-001 decides)
 *   MISSING ≠ zero;  NOT_APPLICABLE ≠ no match;  unknown stays unknown
 *   internal feature ≠ founder-visible fact ≠ public "match %"
 *
 * A feature is identified by meaning, not by code location; changing its
 * meaning, interpretation, normalisation or source semantics is a new
 * version. The registry is frozen data: nothing at runtime adds, widens or
 * relabels a definition, and a definition allows a context only by naming
 * it. Default: not allowed.
 */

/** The aggregate schema a ranker binds to. Separate from every other version. */
export const FEATURE_SCHEMA_VERSION = "recommendation-features.v1" as const;

/** Doc 19 §38. The vocabulary may know a group before any feature uses it. */
export const FEATURE_GROUPS = [
  "ELIGIBILITY",
  "DECLARED_FIT",
  "SEMANTIC_FIT",
  "COMPANY_STATE",
  "EVIDENCE_CONFIDENCE",
  "PORTFOLIO_STRATEGIC",
  "BEHAVIOR",
  "RELATIONSHIP",
  "FRESHNESS",
  "EXPLORATION",
  "EXPOSURE",
] as const;
export const FeatureGroupSchema = z.enum(FEATURE_GROUPS);
export type FeatureGroup = z.infer<typeof FeatureGroupSchema>;

/** Doc 19 §146. */
export const FEATURE_DATA_TYPES = [
  "number",
  "boolean",
  "category",
  "vector",
] as const;
export const FeatureDataTypeSchema = z.enum(FEATURE_DATA_TYPES);
export type FeatureDataType = z.infer<typeof FeatureDataTypeSchema>;

/**
 * Where a feature's inputs may legitimately come from (doc 19 §41–§42,
 * §145). A definition lists the classes it accepts; a projection carries
 * the class it is; the service refuses any other pairing. The private
 * classes that must never feed an investor-facing feature are deliberately
 * NOT in this vocabulary: they cannot be named, so they cannot be allowed.
 */
export const FEATURE_SOURCE_CLASSES = [
  /** The investor's own ACTIVE mandate: declared constraints, stage range, cheque, taxonomy preferences. */
  "DECLARED_MANDATE",
  /** core.companies canonical fields of a discoverable company (stage, headquarters, status, version). */
  "CANONICAL_COMPANY_STATE",
  /** ACTIVE, person-declared canonical classifications of the company. */
  "CANONICAL_TAXONOMY",
  /** The reference hierarchy (descendants of a declared node). */
  "TAXONOMY_REFERENCE_HIERARCHY",
  /** REC-002's provenance for the candidate. */
  "STRUCTURED_CANDIDATE_PROVENANCE",
  /** REC-003's provenance for the candidate: the similarity already computed. */
  "SEMANTIC_CANDIDATE_PROVENANCE",
  /** REC-001's result for the candidate. */
  "ELIGIBILITY_RESULT",
  /** Reserved for REC-008: the investor's own observed behaviour, own feed only. Unused in V1. */
  "INVESTOR_PRIVATE_BEHAVIOR",
  /** Reserved: the Network context's relationship projection. Unused in V1. */
  "RELATIONSHIP_STATE",
] as const;
export const FeatureSourceClassSchema = z.enum(FEATURE_SOURCE_CLASSES);
export type FeatureSourceClass = z.infer<typeof FeatureSourceClassSchema>;

/**
 * What a MISSING value means to a reader. PRESERVE_MISSING is the only
 * policy a V1 feature uses: the ranker must not impute. The others exist
 * so a future definition can declare a deterministic default explicitly
 * rather than a reader inventing one.
 */
export const FEATURE_MISSING_POLICIES = [
  "PRESERVE_MISSING",
  "DEFAULT_FALSE",
  "DEFAULT_ZERO",
] as const;
export const FeatureMissingPolicySchema = z.enum(FEATURE_MISSING_POLICIES);
export type FeatureMissingPolicy = z.infer<typeof FeatureMissingPolicySchema>;

/** The canonical six-class sensitivity vocabulary; never a new one. */
export const FeatureSensitivitySchema = MessageSensitivitySchema;
export type FeatureSensitivity = z.infer<typeof FeatureSensitivitySchema>;

export const FeatureIdSchema = z
  .string()
  .regex(/^[a-z][a-z_]*\.[a-z][a-z_]*$/)
  .max(64);
export const FeatureVersionSchema = z.string().regex(/^v[0-9]+$/);

/** Doc 19 §146, with the range/direction §111 asks a number to declare. */
export const RecommendationFeatureDefinitionSchema = z
  .object({
    id: FeatureIdSchema,
    version: FeatureVersionSchema,
    featureGroup: FeatureGroupSchema,
    dataType: FeatureDataTypeSchema,
    /** Explicit, non-empty. A mode not named here cannot receive the feature. */
    allowedContexts: z.array(RecommendationModeSchema).min(1),
    /** Every class that may contribute; nothing else can satisfy the feature. */
    sourceClasses: z.array(FeatureSourceClassSchema).min(1),
    sensitivity: FeatureSensitivitySchema,
    missingPolicy: FeatureMissingPolicySchema,
    description: z.string().min(1).max(600),
    /** For `category`: the closed set of values. Empty for other types. */
    categories: z.array(z.string().regex(/^[A-Z][A-Z_]*$/)).max(16),
    /** For `number`: the declared range and reading direction. Null otherwise. */
    range: z
      .object({
        min: z.number().finite(),
        max: z.number().finite(),
        /** HIGHER_IS_CLOSER: larger means nearer the mandate. NONE: no ordering meaning. */
        direction: z.enum(["HIGHER_IS_CLOSER", "NONE"]),
      })
      .strict()
      .nullable(),
  })
  .strict();
export type RecommendationFeatureDefinition = z.infer<
  typeof RecommendationFeatureDefinitionSchema
>;

// ---------------------------------------------------------------------------
// Feature values and snapshots
// ---------------------------------------------------------------------------

export const FEATURE_VALUE_STATUSES = [
  "PRESENT",
  "MISSING",
  "NOT_APPLICABLE",
] as const;
export const FeatureValueStatusSchema = z.enum(FEATURE_VALUE_STATUSES);
export type FeatureValueStatus = z.infer<typeof FeatureValueStatusSchema>;

/** Why a value is MISSING or NOT_APPLICABLE. Bounded; never a source excerpt. */
export const FEATURE_MISSING_REASONS = [
  "COMPANY_STAGE_UNKNOWN",
  "COMPANY_GEOGRAPHY_UNKNOWN",
  "COMPANY_TAXONOMY_UNKNOWN",
  /** The mandate declares no positive intent on this dimension. */
  "NO_DECLARED_PREFERENCE",
  /** The mandate's geography preference is the unrestricted node: no narrowing signal. */
  "UNRESTRICTED_PREFERENCE",
  /** No canonical, discovery-safe raise projection exists (REC-002/REC-003). */
  "CHEQUE_NOT_COMPUTABLE",
  /** The candidate was not produced by the semantic generator; nothing is invented. */
  "SEMANTIC_NOT_RETRIEVED",
  /** A projection carried a source class the definition does not accept. */
  "SOURCE_NOT_AUTHORISED",
] as const;
export const FeatureMissingReasonSchema = z.enum(FEATURE_MISSING_REASONS);
export type FeatureMissingReason = z.infer<typeof FeatureMissingReasonSchema>;

/**
 * Bounded provenance: identifiers, codes and versions only. Never a
 * declared value the investor typed, never a company field, never text.
 */
export const FeatureProvenanceSchema = z
  .record(
    z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9]*$/)
      .max(48),
    z.union([z.string().max(128), z.number().finite(), z.boolean()]),
  )
  .refine((r) => Object.keys(r).length <= 12, {
    message: "provenance is bounded",
  });
export type FeatureProvenance = z.infer<typeof FeatureProvenanceSchema>;

export const FeatureValueSchema = z
  .object({
    featureId: FeatureIdSchema,
    featureVersion: FeatureVersionSchema,
    status: FeatureValueStatusSchema,
    /** Typed by the definition; null unless PRESENT. Validated, never coerced. */
    value: z.union([z.number().finite(), z.boolean(), z.string()]).nullable(),
    missingReason: FeatureMissingReasonSchema.nullable(),
    /** The classes that actually contributed (PRESENT) or were consulted. */
    sourceClasses: z.array(FeatureSourceClassSchema).max(8),
    sensitivity: FeatureSensitivitySchema,
    provenance: FeatureProvenanceSchema,
  })
  .strict()
  .refine(
    (v) =>
      (v.status === "PRESENT") === (v.value !== null) &&
      (v.status !== "PRESENT") === (v.missingReason !== null),
    {
      message:
        "a PRESENT value has a value and no reason; otherwise a reason and no value",
    },
  );
export type FeatureValue = z.infer<typeof FeatureValueSchema>;

/** Candidate provenance as the snapshot retains it: versions and codes only. */
export const SnapshotCandidateProvenanceSchema = z
  .object({
    structured: z
      .object({
        generatorVersion: z.literal(STRUCTURED_GENERATOR_VERSION),
        reasonCodes: z.array(CandidateReasonCodeSchema).max(8),
      })
      .strict()
      .nullable(),
    semantic: z
      .object({
        generatorVersion: z.literal(SEMANTIC_GENERATOR_VERSION),
        companyRepresentationVersion: z.literal(COMPANY_REPRESENTATION_VERSION),
        investorRepresentationVersion: z.literal(
          INVESTOR_REPRESENTATION_VERSION,
        ),
        configurationVersion: z.string().min(1).max(64),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .refine((p) => p.structured !== null || p.semantic !== null, {
    message: "a candidate carries at least one provenance",
  });
export type SnapshotCandidateProvenance = z.infer<
  typeof SnapshotCandidateProvenanceSchema
>;

/** Bounded above by the registry: one value per active definition. */
export const FEATURE_SNAPSHOT_VALUES_MAX = 64;

/**
 * Doc 19 §147: a derived, versioned, immutable artifact. Not company truth,
 * not investor truth, not an explanation. Enough identity to answer later
 * which definitions, mandate, company projection, taxonomy, generators and
 * eligibility policy produced it.
 */
export const RecommendationFeatureSnapshotSchema = z
  .object({
    featureSchemaVersion: z.literal(FEATURE_SCHEMA_VERSION),
    context: RecommendationContextSchema,
    mandateId: z.string().uuid(),
    mandateVersion: z.number().int().min(1),
    companyId: z.string().uuid(),
    companyTenantId: z.string().uuid(),
    /** The canonical company row version the projection was read at. */
    companyProjectionVersion: z.number().int().min(1),
    eligibilityPolicyVersion: z.literal(ELIGIBILITY_POLICY_VERSION),
    eligibilityDecision: EligibilityDecisionSchema,
    candidateProvenance: SnapshotCandidateProvenanceSchema,
    /** The highest sensitivity among the values; the artifact's own class. */
    sensitivity: FeatureSensitivitySchema,
    /** Registry order. */
    features: z.array(FeatureValueSchema).max(FEATURE_SNAPSHOT_VALUES_MAX),
    /** sha256 over the semantic inputs; never over computedAt or an id. */
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    computedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type RecommendationFeatureSnapshot = z.infer<
  typeof RecommendationFeatureSnapshotSchema
>;

// ---------------------------------------------------------------------------
// The V1 registry (doc 19 §145–§146; CQ-REC-004 §28)
// ---------------------------------------------------------------------------

const INVESTOR_ONLY = ["INVESTOR_DISCOVER"] as const;

/**
 * Only features whose inputs exist today, in canonical, discovery-safe
 * form. Every other group (company state, evidence/confidence, portfolio,
 * behaviour, relationship, freshness, exploration, exposure) is deferred:
 * a missing group is not a zero-valued group.
 */
export const RECOMMENDATION_FEATURES: readonly RecommendationFeatureDefinition[] =
  Object.freeze(
    [
      {
        id: "eligibility.hard_gate",
        version: "v1",
        featureGroup: "ELIGIBILITY",
        dataType: "boolean",
        allowedContexts: INVESTOR_ONLY,
        sourceClasses: ["ELIGIBILITY_RESULT"],
        sensitivity: "INTERNAL",
        missingPolicy: "PRESERVE_MISSING",
        description:
          "REC-001 said ELIGIBLE for this investor, mandate and company. A gate reference kept for reproducibility: always true for a rankable candidate, never a score and never weighted.",
        categories: [],
        range: null,
      },
      {
        id: "declared_fit.stage",
        version: "v1",
        featureGroup: "DECLARED_FIT",
        dataType: "category",
        allowedContexts: INVESTOR_ONLY,
        sourceClasses: ["DECLARED_MANDATE", "CANONICAL_COMPANY_STATE"],
        sensitivity: "CONFIDENTIAL",
        missingPolicy: "PRESERVE_MISSING",
        description:
          "Whether the company's canonical stage is inside the mandate's positive stage intent (declared stage constraints and range). MATCH / NO_MATCH when both sides are known; NOT_APPLICABLE when the mandate declares no positive stage intent; MISSING when the company's stage is unknown. Never inferred from a document, a memory or a model.",
        categories: ["MATCH", "NO_MATCH"],
        range: null,
      },
      {
        id: "declared_fit.geography",
        version: "v1",
        featureGroup: "DECLARED_FIT",
        dataType: "category",
        allowedContexts: INVESTOR_ONLY,
        sourceClasses: [
          "DECLARED_MANDATE",
          "CANONICAL_COMPANY_STATE",
          "CANONICAL_TAXONOMY",
          "TAXONOMY_REFERENCE_HIERARCHY",
        ],
        sensitivity: "CONFIDENTIAL",
        missingPolicy: "PRESERVE_MISSING",
        description:
          "COUNTRY_MATCH when the headquarters country is in the mandate's positive country intent; REGION_MATCH when a declared geography classification equals or descends from a positive geography preference node; NO_MATCH when neither holds and the company's geography is known; NOT_APPLICABLE when the mandate declares no positive geography intent or only the unrestricted node; MISSING when neither the country nor a geography classification is known.",
        categories: ["COUNTRY_MATCH", "REGION_MATCH", "NO_MATCH"],
        range: null,
      },
      {
        id: "declared_fit.taxonomy",
        version: "v1",
        featureGroup: "DECLARED_FIT",
        dataType: "category",
        allowedContexts: INVESTOR_ONLY,
        sourceClasses: [
          "DECLARED_MANDATE",
          "CANONICAL_TAXONOMY",
          "TAXONOMY_REFERENCE_HIERARCHY",
        ],
        sensitivity: "CONFIDENTIAL",
        missingPolicy: "PRESERVE_MISSING",
        description:
          "EXACT_OVERLAP when a declared company classification equals a positive non-geography preference node; DESCENDANT_OVERLAP when it descends from one; NO_OVERLAP when the company is classified in every vocabulary the preferences name and none overlaps; NOT_APPLICABLE when the mandate declares no positive non-geography taxonomy preference; MISSING when the company has no declared classification in a vocabulary the preferences name. Q-proposed classifications are not authoritative and do not count.",
        categories: ["EXACT_OVERLAP", "DESCENDANT_OVERLAP", "NO_OVERLAP"],
        range: null,
      },
      {
        id: "declared_fit.cheque",
        version: "v1",
        featureGroup: "DECLARED_FIT",
        dataType: "number",
        allowedContexts: INVESTOR_ONLY,
        sourceClasses: ["DECLARED_MANDATE", "CANONICAL_COMPANY_STATE"],
        sensitivity: "CONFIDENTIAL",
        missingPolicy: "PRESERVE_MISSING",
        description:
          "Cheque compatibility in [0, 1] between the mandate's cheque range and the company's disclosure-safe round target, in one currency. No such projection exists in V1 (the capital objective is organisation-internal), so the value is always MISSING with CHEQUE_NOT_COMPUTABLE. Never zero, never read from a private objective, deck or memory.",
        categories: [],
        range: { min: 0, max: 1, direction: "HIGHER_IS_CLOSER" },
      },
      {
        id: "semantic_fit.mandate_similarity",
        version: "v1",
        featureGroup: "SEMANTIC_FIT",
        dataType: "number",
        allowedContexts: INVESTOR_ONLY,
        sourceClasses: ["SEMANTIC_CANDIDATE_PROVENANCE"],
        sensitivity: "CONFIDENTIAL",
        missingPolicy: "PRESERVE_MISSING",
        description:
          "The cosine similarity REC-003 computed between the investor's mandate representation and the company's investment representation, in [-1, 1], under the versions its provenance names. Reused, never recomputed. PRESENT only when the semantic generator retrieved the company; otherwise MISSING with SEMANTIC_NOT_RETRIEVED. An internal retrieval number, not a match percentage, a probability or a quality.",
        categories: [],
        range: { min: -1, max: 1, direction: "HIGHER_IS_CLOSER" },
      },
    ].map((d) => Object.freeze(RecommendationFeatureDefinitionSchema.parse(d))),
  );

/** Registry order is the serialisation order of every snapshot. */
export const FEATURE_ORDER: readonly string[] = RECOMMENDATION_FEATURES.map(
  (d) => d.id,
);

/**
 * Fail fast on a malformed registry (CQ-REC-004 §69). Run at module load and
 * in tests; a definition that violates this never reaches a ranker.
 */
export function validateFeatureRegistry(
  definitions: readonly RecommendationFeatureDefinition[],
): void {
  const seen = new Set<string>();
  for (const d of definitions) {
    RecommendationFeatureDefinitionSchema.parse(d);
    const key = `${d.id}@${d.version}`;
    if (seen.has(key)) throw new Error(`duplicate feature definition ${key}`);
    seen.add(key);
    if (d.dataType === "category" && d.categories.length === 0) {
      throw new Error(`${key}: a category feature declares its categories`);
    }
    if (d.dataType !== "category" && d.categories.length > 0) {
      throw new Error(`${key}: only a category feature declares categories`);
    }
    if (d.dataType === "number" && d.range === null) {
      throw new Error(`${key}: a number feature declares its range`);
    }
    if (d.dataType !== "number" && d.range !== null) {
      throw new Error(`${key}: only a number feature declares a range`);
    }
    if (d.range !== null && d.range.min >= d.range.max) {
      throw new Error(`${key}: range min must be below max`);
    }
    for (const mode of d.allowedContexts) {
      if (!(RECOMMENDATION_MODES as readonly string[]).includes(mode)) {
        throw new Error(`${key}: unknown context ${mode}`);
      }
    }
  }
  const ids = definitions.map((d) => d.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("one active definition per feature id");
  }
}

validateFeatureRegistry(RECOMMENDATION_FEATURES);
