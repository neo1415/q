import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import {
  createCursorPageSchema,
  CursorSchema,
  PageSizeSchema,
} from "../common/pagination.js";

/**
 * `/v1/taxonomy` -- the canonical Capital Q taxonomy, read-only.
 *
 * Taxonomy is a platform capability, not a UI enum: one versioned,
 * multi-vocabulary, multi-label classification language shared by
 * companies, investor mandates, search, discovery, recommendations and Q.
 * These contracts expose reference reads only. There is no classification
 * or search endpoint here (CQ-TAX-002), no assignment route (owning product
 * workflows) and no editor (reference data changes by reviewed migration).
 *
 * Identity is `TaxonomyNodeId` + `canonicalCode`; a display name may change
 * without either moving.
 */

export const TAXONOMY_PATH = "/v1/taxonomy";
export const TAXONOMY_VOCABULARIES_SEGMENT = "/vocabularies";
export const TAXONOMY_NODES_SEGMENT = "/nodes";

/** A vocabulary code: `industry`, `product_category`, `geography`. */
export const TaxonomyVocabularyCodeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]*$/, "expected a lower_snake_case vocabulary code")
  .max(64);
export type TaxonomyVocabularyCode = z.infer<
  typeof TaxonomyVocabularyCodeSchema
>;

/**
 * A stable canonical node code, unique within its vocabulary. Conservative
 * on purpose: no display punctuation, no locale, no case.
 */
export const TaxonomyCanonicalCodeSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9._-]{0,127}$/,
    "expected a canonical code such as payment_infrastructure",
  );
export type TaxonomyCanonicalCode = z.infer<typeof TaxonomyCanonicalCodeSchema>;

export const TAXONOMY_VOCABULARY_STATUSES = ["ACTIVE", "RETIRED"] as const;
export const TaxonomyVocabularyStatusSchema = z.enum(
  TAXONOMY_VOCABULARY_STATUSES,
);
export type TaxonomyVocabularyStatus = z.infer<
  typeof TaxonomyVocabularyStatusSchema
>;

/** A deprecated node stays loadable and historically interpretable; it is not offered as a new selection. */
export const TAXONOMY_NODE_STATUSES = ["ACTIVE", "DEPRECATED"] as const;
export const TaxonomyNodeStatusSchema = z.enum(TAXONOMY_NODE_STATUSES);
export type TaxonomyNodeStatus = z.infer<typeof TaxonomyNodeStatusSchema>;

export const TAXONOMY_ALIAS_TYPES = [
  "SYNONYM",
  "ABBREVIATION",
  "COLLOQUIAL",
  "LEGACY",
] as const;
export const TaxonomyAliasTypeSchema = z.enum(TAXONOMY_ALIAS_TYPES);
export type TaxonomyAliasType = z.infer<typeof TaxonomyAliasTypeSchema>;

/** BCP-47-shaped, lowercase, bounded. Full internationalisation is not built here. */
export const TaxonomyLocaleSchema = z
  .string()
  .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/, "expected a lowercase BCP-47 tag")
  .max(35);

export const TaxonomyVocabularyDtoSchema = z.object({
  id: UuidSchema,
  code: TaxonomyVocabularyCodeSchema,
  name: z.string(),
  description: z.string().nullable(),
  version: z.number().int().min(1),
  status: TaxonomyVocabularyStatusSchema,
});
export type TaxonomyVocabularyDto = z.infer<typeof TaxonomyVocabularyDtoSchema>;

export const ListTaxonomyVocabulariesResponseSchema = z.object({
  items: z.array(TaxonomyVocabularyDtoSchema),
});
export type ListTaxonomyVocabulariesResponse = z.infer<
  typeof ListTaxonomyVocabulariesResponseSchema
>;

export const TaxonomyNodeDtoSchema = z.object({
  id: UuidSchema,
  vocabularyCode: TaxonomyVocabularyCodeSchema,
  canonicalCode: TaxonomyCanonicalCodeSchema,
  displayName: z.string(),
  description: z.string().nullable(),
  parentNodeId: UuidSchema.nullable(),
  depth: z.number().int().min(0),
  status: TaxonomyNodeStatusSchema,
});
export type TaxonomyNodeDto = z.infer<typeof TaxonomyNodeDtoSchema>;

/** Breadcrumb entry: identity and label only. */
export const TaxonomyNodeRefDtoSchema = z.object({
  id: UuidSchema,
  canonicalCode: TaxonomyCanonicalCodeSchema,
  displayName: z.string(),
  depth: z.number().int().min(0),
});
export type TaxonomyNodeRefDto = z.infer<typeof TaxonomyNodeRefDtoSchema>;

export const TaxonomyAliasDtoSchema = z.object({
  id: UuidSchema,
  alias: z.string(),
  locale: TaxonomyLocaleSchema,
  aliasType: TaxonomyAliasTypeSchema,
});
export type TaxonomyAliasDto = z.infer<typeof TaxonomyAliasDtoSchema>;

/** One node with its primary ancestry (root first) and its aliases. */
export const TaxonomyNodeDetailDtoSchema = TaxonomyNodeDtoSchema.extend({
  ancestors: z.array(TaxonomyNodeRefDtoSchema),
  aliases: z.array(TaxonomyAliasDtoSchema),
});
export type TaxonomyNodeDetailDto = z.infer<typeof TaxonomyNodeDetailDtoSchema>;

/**
 * Node listing within one vocabulary. `roots=true` lists depth-0 nodes;
 * `parentNodeId` lists direct children; neither lists the whole vocabulary
 * page by page. `status` defaults to ACTIVE so deprecated nodes are never
 * offered as new selections by default.
 */
export const ListTaxonomyNodesQuerySchema = z
  .object({
    parentNodeId: UuidSchema.optional(),
    roots: z.enum(["true", "false"]).optional(),
    status: TaxonomyNodeStatusSchema.optional(),
    cursor: CursorSchema.optional(),
    limit: z.coerce.number().pipe(PageSizeSchema).optional(),
  })
  .strict()
  .refine(
    (value) => !(value.parentNodeId !== undefined && value.roots === "true"),
    { message: "parentNodeId and roots=true are mutually exclusive" },
  );
export type ListTaxonomyNodesQuery = z.infer<
  typeof ListTaxonomyNodesQuerySchema
>;

export const ListTaxonomyNodesResponseSchema = createCursorPageSchema(
  TaxonomyNodeDtoSchema,
);
export type ListTaxonomyNodesResponse = z.infer<
  typeof ListTaxonomyNodesResponseSchema
>;

// ---------------------------------------------------------------------------
// Candidate lookup (CQ-TAX-002) -- `POST /v1/taxonomy/candidates`
// ---------------------------------------------------------------------------

/**
 * Language -> canonical taxonomy candidates. Read/compute only: the
 * endpoint persists nothing, so autocomplete and onboarding suggestions do
 * not create classification runs. A candidate says "this node may represent
 * the supplied language"; it is never a canonical assignment, never a
 * verified fact and never a calibrated probability.
 */
export const TAXONOMY_CANDIDATES_SEGMENT = "/candidates";

/** Direct candidate lookup is bounded; long documents belong to Evidence processing. */
export const TAXONOMY_CLASSIFICATION_TEXT_MAX_LENGTH = 2048;
export const TAXONOMY_CANDIDATE_DEFAULT_LIMIT = 5;
export const TAXONOMY_CANDIDATE_MAX_LIMIT = 20;
export const TAXONOMY_CANDIDATE_MAX_VOCABULARIES = 16;

/**
 * Strategy vocabulary. Only EXACT, LEXICAL and AUTO are implemented in V1;
 * SEMANTIC and MODEL are reserved for later adapters and are refused with a
 * typed error today. Lexical search is never presented as semantic.
 */
export const TAXONOMY_CLASSIFICATION_STRATEGIES = [
  "AUTO",
  "EXACT",
  "LEXICAL",
  "SEMANTIC",
  "MODEL",
] as const;
export const TaxonomyClassificationStrategySchema = z.enum(
  TAXONOMY_CLASSIFICATION_STRATEGIES,
);
export type TaxonomyClassificationStrategy = z.infer<
  typeof TaxonomyClassificationStrategySchema
>;

/** How a node was found. Provenance of the suggestion, not of the company. */
export const TAXONOMY_MATCH_TYPES = [
  "CANONICAL_CODE_EXACT",
  "ALIAS_EXACT",
  "DISPLAY_NAME_EXACT",
  "LEXICAL",
] as const;
export const TaxonomyMatchTypeSchema = z.enum(TAXONOMY_MATCH_TYPES);
export type TaxonomyMatchType = z.infer<typeof TaxonomyMatchTypeSchema>;

export const TAXONOMY_CLASSIFICATION_RESOLUTIONS = [
  "EXACT",
  "CANDIDATES",
  "AMBIGUOUS",
  "ABSTAINED",
] as const;
export const TaxonomyClassificationResolutionSchema = z.enum(
  TAXONOMY_CLASSIFICATION_RESOLUTIONS,
);
export type TaxonomyClassificationResolution = z.infer<
  typeof TaxonomyClassificationResolutionSchema
>;

/** Bounded, deterministic reasons. Abstention is a correct outcome, not a failure. */
export const TAXONOMY_ABSTENTION_REASONS = [
  "NO_CANDIDATES",
  "LOW_CONFIDENCE",
  "AMBIGUOUS_CANDIDATES",
  "NO_ACTIVE_VOCABULARY",
  "UNSUPPORTED_STRATEGY",
] as const;
export const TaxonomyAbstentionReasonSchema = z.enum(
  TAXONOMY_ABSTENTION_REASONS,
);
export type TaxonomyAbstentionReason = z.infer<
  typeof TaxonomyAbstentionReasonSchema
>;

/** Exact decimal string in [0, 1] with four places, e.g. "0.9500". */
export const TaxonomyCandidateConfidenceSchema = z
  .string()
  .regex(/^(?:0\.\d{4}|1\.0000)$/, "expected a confidence such as 0.8500");

export const TaxonomyCandidateRequestSchema = z
  .object({
    text: z
      .string()
      .max(TAXONOMY_CLASSIFICATION_TEXT_MAX_LENGTH)
      .refine((value) => value.trim().length > 0, {
        message: "text must not be empty",
      }),
    vocabularyCodes: z
      .array(TaxonomyVocabularyCodeSchema)
      .min(1)
      .max(TAXONOMY_CANDIDATE_MAX_VOCABULARIES)
      .refine((codes) => new Set(codes).size === codes.length, {
        message: "vocabularyCodes must be unique",
      })
      .optional(),
    strategy: TaxonomyClassificationStrategySchema.optional(),
    limit: z.number().int().min(1).max(TAXONOMY_CANDIDATE_MAX_LIMIT).optional(),
  })
  .strict();
export type TaxonomyCandidateRequest = z.infer<
  typeof TaxonomyCandidateRequestSchema
>;

export const TaxonomyClassificationCandidateDtoSchema = z.object({
  nodeId: UuidSchema,
  vocabularyCode: TaxonomyVocabularyCodeSchema,
  canonicalCode: TaxonomyCanonicalCodeSchema,
  displayName: z.string(),
  /** 1-based, unique within the response. */
  rank: z.number().int().min(1),
  /** Deterministic classification indicator. NOT a calibrated probability. */
  confidence: TaxonomyCandidateConfidenceSchema,
  matchTypes: z.array(TaxonomyMatchTypeSchema).min(1),
  /** Short observable reason. Never hidden reasoning. */
  rationaleSummary: z.string().max(300),
});
export type TaxonomyClassificationCandidateDto = z.infer<
  typeof TaxonomyClassificationCandidateDtoSchema
>;

export const TaxonomyClassifierIdentitySchema = z.object({
  provider: z.literal("capital_q"),
  model: z.literal("deterministic_lexical"),
  version: z.string().max(64),
});
export type TaxonomyClassifierIdentity = z.infer<
  typeof TaxonomyClassifierIdentitySchema
>;

export const TaxonomyCandidateResponseSchema = z.object({
  resolution: TaxonomyClassificationResolutionSchema,
  candidates: z.array(TaxonomyClassificationCandidateDtoSchema),
  abstentionReason: TaxonomyAbstentionReasonSchema.optional(),
  /** The exact vocabulary versions the candidates were computed against. */
  taxonomyVersions: z.record(TaxonomyVocabularyCodeSchema, z.number().int()),
  classifier: TaxonomyClassifierIdentitySchema,
});
export type TaxonomyCandidateResponse = z.infer<
  typeof TaxonomyCandidateResponseSchema
>;
