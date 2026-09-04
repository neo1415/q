import { z } from "zod";

import {
  createUuidIdSchema,
  DecimalStringSchema,
  TaxonomyAliasTypeSchema,
  TaxonomyCanonicalCodeSchema,
  TaxonomyLocaleSchema,
  TaxonomyNodeStatusSchema,
  TaxonomyVocabularyCodeSchema,
  TaxonomyVocabularyStatusSchema,
  UuidSchema,
  type MandatePreferenceClass,
  type TaxonomyAliasDto,
  type TaxonomyAliasType,
  type TaxonomyCanonicalCode,
  type TaxonomyNodeDetailDto,
  type TaxonomyNodeDto,
  type TaxonomyNodeRefDto,
  type TaxonomyNodeStatus,
  type TaxonomyVocabularyCode,
  type TaxonomyVocabularyDto,
  type TaxonomyVocabularyStatus,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type { OrganisationId, TenantId, UserId } from "@capital-q/security";

/**
 * @capital-q/taxonomy/contracts
 *
 * The safe public surface of the Taxonomy platform capability: branded
 * identifiers, closed vocabularies, the reference entities, the
 * classification (assignment) and preference entities, the version set and
 * the DTO mappings. No persistence, no classification, no ranking.
 *
 *   Taxonomy is classification, not assessment: a node says what a company
 *   is, never how good it is. Company classification ≠ Investor preference,
 *   even though both reference the same TaxonomyNodeId.
 */

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export const TaxonomyVocabularyIdSchema = createUuidIdSchema(
  "TaxonomyVocabularyId",
);
export type TaxonomyVocabularyId = z.infer<typeof TaxonomyVocabularyIdSchema>;

/** The stable identity of a concept. A display name may change; this never does. */
export const TaxonomyNodeIdSchema = createUuidIdSchema("TaxonomyNodeId");
export type TaxonomyNodeId = z.infer<typeof TaxonomyNodeIdSchema>;

export const TaxonomyAliasIdSchema = createUuidIdSchema("TaxonomyAliasId");
export type TaxonomyAliasId = z.infer<typeof TaxonomyAliasIdSchema>;

export const TaxonomyAssignmentIdSchema = createUuidIdSchema(
  "TaxonomyAssignmentId",
);
export type TaxonomyAssignmentId = z.infer<typeof TaxonomyAssignmentIdSchema>;

export const MandateTaxonomyPreferenceIdSchema = createUuidIdSchema(
  "MandateTaxonomyPreferenceId",
);
export type MandateTaxonomyPreferenceId = z.infer<
  typeof MandateTaxonomyPreferenceIdSchema
>;

export {
  TaxonomyAliasTypeSchema,
  TaxonomyCanonicalCodeSchema,
  TaxonomyLocaleSchema,
  TaxonomyNodeStatusSchema,
  TaxonomyVocabularyCodeSchema,
  TaxonomyVocabularyStatusSchema,
  type TaxonomyAliasType,
  type TaxonomyCanonicalCode,
  type TaxonomyNodeStatus,
  type TaxonomyVocabularyCode,
  type TaxonomyVocabularyStatus,
};

// ---------------------------------------------------------------------------
// Closed vocabularies
// ---------------------------------------------------------------------------

/**
 * Non-tree relationships. Semantics only; a `related_to` edge is never a
 * ranking bonus. `successor_of` runs from the replacement to the deprecated
 * concept: (from = successor, to = predecessor).
 */
export const TAXONOMY_EDGE_TYPES = [
  "broader_than",
  "related_to",
  "overlaps",
  "commonly_co_occurs",
  "successor_of",
] as const;
export const TaxonomyEdgeTypeSchema = z.enum(TAXONOMY_EDGE_TYPES);
export type TaxonomyEdgeType = z.infer<typeof TaxonomyEdgeTypeSchema>;

/** How a mapping entered Capital Q. Never a statement of verification. */
export const TAXONOMY_ASSIGNMENT_SOURCES = [
  "user_selected",
  "q_inferred",
  "document_extracted",
  "admin_curated",
  "integration",
] as const;
export const TaxonomyAssignmentSourceSchema = z.enum(
  TAXONOMY_ASSIGNMENT_SOURCES,
);
export type TaxonomyAssignmentSource = z.infer<
  typeof TaxonomyAssignmentSourceSchema
>;

/** Current vs history. Unconfirmed suggestions are CQ-TAX-002 candidates, never rows here. */
export const TAXONOMY_ASSIGNMENT_STATUSES = ["ACTIVE", "SUPERSEDED"] as const;
export const TaxonomyAssignmentStatusSchema = z.enum(
  TAXONOMY_ASSIGNMENT_STATUSES,
);
export type TaxonomyAssignmentStatus = z.infer<
  typeof TaxonomyAssignmentStatusSchema
>;

/** Typed subjects with a legitimate resolver. Never an arbitrary table name. */
export const TAXONOMY_SUBJECT_TYPES = ["COMPANY"] as const;
export const TaxonomySubjectTypeSchema = z.enum(TAXONOMY_SUBJECT_TYPES);
export type TaxonomySubjectType = z.infer<typeof TaxonomySubjectTypeSchema>;

export const TAXONOMY_RAW_SOURCE_TEXT_MAX_LENGTH = 4000;

/** Exact decimal string in [0, 1]. Never a company quality. */
export const TaxonomyConfidenceSchema = DecimalStringSchema.refine(
  (value) => {
    const parsed = Number(value);
    return parsed >= 0 && parsed <= 1;
  },
  { message: "confidence must be between 0 and 1" },
);

/**
 * Sparse, bounded node metadata. Interoperability hooks only (an ISO
 * country code, future external standard codes) -- never rules, prompts,
 * weights or translations.
 */
export const TaxonomyNodeMetadataSchema = z
  .object({
    iso3166Alpha2: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    externalCodes: z
      .record(
        z
          .string()
          .regex(/^[a-z][a-z0-9_]*$/)
          .max(32),
        z.string().max(64),
      )
      .optional(),
  })
  .strict();
export type TaxonomyNodeMetadata = z.infer<typeof TaxonomyNodeMetadataSchema>;

// ---------------------------------------------------------------------------
// Reference entities
// ---------------------------------------------------------------------------

export type TaxonomyVocabulary = {
  readonly id: TaxonomyVocabularyId;
  readonly code: TaxonomyVocabularyCode;
  readonly name: string;
  readonly description: string | null;
  /** Semantic/reference version of this vocabulary. Integer, ≥ 1. */
  readonly version: number;
  readonly status: TaxonomyVocabularyStatus;
  readonly createdAt: UtcTimestamp;
};

export type TaxonomyNode = {
  readonly id: TaxonomyNodeId;
  readonly vocabularyId: TaxonomyVocabularyId;
  readonly vocabularyCode: TaxonomyVocabularyCode;
  readonly canonicalCode: TaxonomyCanonicalCode;
  readonly displayName: string;
  readonly description: string | null;
  /** Primary hierarchy. Always within the same vocabulary. */
  readonly parentNodeId: TaxonomyNodeId | null;
  readonly depth: number;
  readonly status: TaxonomyNodeStatus;
  readonly validFrom: UtcTimestamp | null;
  readonly validTo: UtcTimestamp | null;
  readonly metadata: TaxonomyNodeMetadata;
};

export type TaxonomyNodeEdge = {
  readonly fromNodeId: TaxonomyNodeId;
  readonly toNodeId: TaxonomyNodeId;
  readonly edgeType: TaxonomyEdgeType;
};

export type TaxonomyAlias = {
  readonly id: TaxonomyAliasId;
  readonly nodeId: TaxonomyNodeId;
  readonly alias: string;
  readonly locale: string;
  readonly aliasType: TaxonomyAliasType;
  readonly normalizedAlias: string;
};

/**
 * The exact vocabulary versions in force: `vocabulary code → version`.
 * Classification runs and recommendation experiments record this so their
 * results stay interpretable after the taxonomy evolves.
 */
export type TaxonomyVersionSet = Readonly<
  Record<TaxonomyVocabularyCode, number>
>;

// ---------------------------------------------------------------------------
// Classification and preference entities
// ---------------------------------------------------------------------------

/** A resolved, trusted subject: tenant and owning organisation come from the canonical entity. */
export type TaxonomySubjectDescriptor = {
  readonly subjectType: TaxonomySubjectType;
  readonly subjectId: string;
  readonly tenantId: TenantId;
  readonly organisationId: OrganisationId;
};

/**
 * "Capital Q currently considers this canonical node applicable to this
 * entity in this context." Not a verified fact; not a quality signal. The
 * raw source text is what the user actually said and is never rewritten.
 */
export type TaxonomyEntityAssignment = {
  readonly id: TaxonomyAssignmentId;
  readonly tenantId: TenantId;
  readonly subjectType: TaxonomySubjectType;
  readonly subjectId: string;
  readonly nodeId: TaxonomyNodeId;
  readonly vocabularyCode: TaxonomyVocabularyCode;
  readonly canonicalCode: TaxonomyCanonicalCode;
  readonly assignmentSource: TaxonomyAssignmentSource;
  /** Exact decimal string in [0, 1], or null where not meaningful. */
  readonly confidence: string | null;
  readonly status: TaxonomyAssignmentStatus;
  readonly rawSourceText: string | null;
  readonly sourceId: string | null;
  readonly classificationRunId: string | null;
  readonly confirmedByUserId: UserId | null;
  readonly confirmedAt: UtcTimestamp | null;
  readonly validFrom: UtcTimestamp;
  readonly validTo: UtcTimestamp | null;
  readonly createdAt: UtcTimestamp;
};

/** Declared investor preference for one node. Same node namespace as company classification. */
export type MandateTaxonomyPreference = {
  readonly nodeId: TaxonomyNodeId;
  readonly vocabularyCode: TaxonomyVocabularyCode;
  readonly canonicalCode: TaxonomyCanonicalCode;
  readonly preferenceStrength: MandatePreferenceClass;
  /** HARD_EXCLUSION ⇔ true. AVOID is soft and never becomes an exclusion. */
  readonly isExclusion: boolean;
  readonly source: TaxonomyAssignmentSource;
  readonly confidence: string | null;
};

export type MandateTaxonomyPreferenceInput = {
  readonly nodeId: string;
  readonly preferenceStrength: MandatePreferenceClass;
  readonly isExclusion: boolean;
};

// ---------------------------------------------------------------------------
// DTO mappings
// ---------------------------------------------------------------------------

export function toTaxonomyVocabularyDto(
  vocabulary: TaxonomyVocabulary,
): TaxonomyVocabularyDto {
  return {
    id: vocabulary.id,
    code: vocabulary.code,
    name: vocabulary.name,
    description: vocabulary.description,
    version: vocabulary.version,
    status: vocabulary.status,
  };
}

/** Wire shape. Validity windows and metadata stay server-side. */
export function toTaxonomyNodeDto(node: TaxonomyNode): TaxonomyNodeDto {
  return {
    id: node.id,
    vocabularyCode: node.vocabularyCode,
    canonicalCode: node.canonicalCode,
    displayName: node.displayName,
    description: node.description,
    parentNodeId: node.parentNodeId,
    depth: node.depth,
    status: node.status,
  };
}

export function toTaxonomyNodeRefDto(node: TaxonomyNode): TaxonomyNodeRefDto {
  return {
    id: node.id,
    canonicalCode: node.canonicalCode,
    displayName: node.displayName,
    depth: node.depth,
  };
}

/** The normalised form is retrieval assistance and stays server-side. */
export function toTaxonomyAliasDto(alias: TaxonomyAlias): TaxonomyAliasDto {
  return {
    id: alias.id,
    alias: alias.alias,
    locale: alias.locale,
    aliasType: alias.aliasType,
  };
}

export function toTaxonomyNodeDetailDto(
  node: TaxonomyNode,
  ancestors: readonly TaxonomyNode[],
  aliases: readonly TaxonomyAlias[],
): TaxonomyNodeDetailDto {
  return {
    ...toTaxonomyNodeDto(node),
    ancestors: ancestors.map(toTaxonomyNodeRefDto),
    aliases: aliases.map(toTaxonomyAliasDto),
  };
}

export { UuidSchema };
