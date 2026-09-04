/**
 * @capital-q/taxonomy
 *
 * Owns: the canonical Capital Q taxonomy as a platform capability --
 * versioned vocabularies (taxonomy.vocabularies), stable multi-label nodes
 * with a primary hierarchy (taxonomy.nodes), non-tree semantic edges
 * (taxonomy.node_edges), normalised aliases (taxonomy.aliases), confirmed
 * entity classification with history and raw language
 * (taxonomy.entity_assignments), declared mandate taxonomy preferences
 * (taxonomy.mandate_preferences), the reference taxonomy, the query port,
 * hierarchy queries and the company assignment commands.
 *
 * Does not own: companies, investor mandates, evidence, onboarding, Q,
 * recommendations or search. It reaches the company through its public
 * query port; the Investor domain calls the mandate preference port inside
 * its own versioned transaction. Classification (CQ-TAX-002) is
 * deterministic: exact + bounded lexical candidates, provenance runs,
 * human confirmation. Zero model calls, no embeddings, no ranking weights.
 *
 *   Company classification ≠ Investor preference (same TaxonomyNodeId)
 *   canonical_code / id = identity; display_name ≠ identity
 *   raw_source_text = what was said; node = what Capital Q mapped it to
 *   Taxonomy = classification, never assessment
 *
 * After this packet, product code must not introduce feature-local
 * category enums (SectorEnum, IndustryEnum ...); categories come from here.
 */

export * from "./contracts/index.js";
export {
  TAXONOMY_NODE_NOT_SELECTABLE_REASONS,
  TaxonomyHierarchyError,
  TaxonomyNodeNotFoundError,
  TaxonomyNodeNotSelectableError,
  TaxonomySubjectNotFoundError,
  TaxonomyVocabularyNotFoundError,
  type TaxonomyNodeNotSelectableReason,
} from "./domain/errors.js";
export {
  normalizeTaxonomyAlias,
  TAXONOMY_ALIAS_MAX_LENGTH,
} from "./domain/normalize-alias.js";
export {
  stableAliasId,
  stableNodeId,
  stableVocabularyId,
  TAXONOMY_REFERENCE_NAMESPACE,
  uuidV5,
} from "./domain/stable-id.js";
export {
  TAXONOMY_MAX_DEPTH,
  validateHierarchy,
  type HierarchyNodeLike,
} from "./domain/hierarchy.js";
export {
  decodeTaxonomyNodeCursor,
  encodeTaxonomyNodeCursor,
} from "./domain/cursor.js";

export type {
  MandateTaxonomyPreferenceChange,
  MandateTaxonomyPreferencePort,
  NewTaxonomyAssignment,
  NodeListPage,
  TaxonomyAssignmentRepository,
  TaxonomyReferenceRepository,
  TaxonomySubjectResolver,
} from "./application/ports.js";
export {
  createTaxonomyQueryPort,
  TAXONOMY_DESCENDANTS_MAX_DEPTH,
  type ListTaxonomyNodesInput,
  type TaxonomyNodeDetail,
  type TaxonomyNodePage,
  type TaxonomyQueryPort,
} from "./application/query.js";
export {
  createCompanyTaxonomySubjectResolver,
  createTaxonomySubjectResolverRegistry,
  type TaxonomySubjectResolverRegistry,
} from "./application/subject-resolvers.js";
export {
  COMPANY_EDIT,
  COMPANY_VIEW,
  createListCompanyAssignments,
  createReplaceCompanyAssignments,
  recordCompanyAssignmentChange,
  requireSelectableNodes,
  requireVisibleCompany,
  type CompanyAssignmentChange,
  type CompanyAssignmentDependencies,
  type ListCompanyAssignmentsQuery,
  type ReplaceCompanyAssignmentsCommand,
  type ReplaceCompanyAssignmentsResult,
} from "./application/company-assignments.js";
export {
  createMandateTaxonomyPreferencePort,
  preferenceKey,
  type MandateTaxonomyPreferenceRow,
  type MandateTaxonomyPreferenceStore,
} from "./application/mandate-preferences.js";
export {
  createTaxonomyService,
  type TaxonomyClassificationService,
  type TaxonomyService,
  type TaxonomyServiceOptions,
} from "./application/service.js";

export * from "./classification/index.js";

export { createPostgresTaxonomyReferenceRepository } from "./infrastructure/postgres-taxonomy-repository.js";
export { createPostgresTaxonomyAssignmentRepository } from "./infrastructure/postgres-assignment-repository.js";
export {
  createPostgresMandateTaxonomyPreferencePort,
  createPostgresMandateTaxonomyPreferenceStore,
} from "./infrastructure/postgres-mandate-preference-repository.js";

export {
  REFERENCE_LOCALE,
  REFERENCE_TAXONOMY,
  referenceNode,
  type ReferenceAlias,
  type ReferenceEdge,
  type ReferenceNode,
  type ReferenceTaxonomy,
  type ReferenceVocabulary,
} from "./reference-data/index.js";
export { renderReferenceTaxonomySql } from "./reference-data/sql.js";

export const PACKAGE_NAME = "@capital-q/taxonomy" as const;
