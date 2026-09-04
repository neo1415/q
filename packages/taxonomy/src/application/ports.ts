import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { TenantId, UserId } from "@capital-q/security";

import type {
  MandateTaxonomyPreference,
  MandateTaxonomyPreferenceInput,
  TaxonomyAlias,
  TaxonomyAssignmentSource,
  TaxonomyEntityAssignment,
  TaxonomyNode,
  TaxonomyNodeEdge,
  TaxonomyNodeId,
  TaxonomyNodeStatus,
  TaxonomySubjectDescriptor,
  TaxonomySubjectType,
  TaxonomyVersionSet,
  TaxonomyVocabulary,
  TaxonomyVocabularyCode,
} from "../contracts/index.js";

/**
 * Application-owned ports of the Taxonomy capability. Specific to the use
 * cases; no generic repository. Reference reads take an executor; tenant
 * writes take the caller's transaction so an assignment change, its audit
 * record and its event commit together.
 */

export type NodeListPage = {
  readonly status?: TaxonomyNodeStatus | undefined;
  /** `null` = roots only; undefined = any parent. */
  readonly parentNodeId?: TaxonomyNodeId | null | undefined;
  readonly after?:
    { readonly displayName: string; readonly id: string } | undefined;
  readonly limit: number;
};

export type TaxonomyReferenceRepository = {
  readonly listVocabularies: (
    executor: DatabaseExecutor,
  ) => Promise<readonly TaxonomyVocabulary[]>;
  readonly findVocabularyByCode: (
    executor: DatabaseExecutor,
    code: TaxonomyVocabularyCode,
  ) => Promise<TaxonomyVocabulary | null>;
  readonly findNodeById: (
    executor: DatabaseExecutor,
    nodeId: TaxonomyNodeId,
  ) => Promise<TaxonomyNode | null>;
  /** Bounded batch lookup; missing ids are simply absent from the result. */
  readonly findNodesByIds: (
    executor: DatabaseExecutor,
    nodeIds: readonly TaxonomyNodeId[],
  ) => Promise<readonly TaxonomyNode[]>;
  readonly findNodeByCanonicalCode: (
    executor: DatabaseExecutor,
    vocabularyCode: TaxonomyVocabularyCode,
    canonicalCode: string,
  ) => Promise<TaxonomyNode | null>;
  readonly listNodes: (
    executor: DatabaseExecutor,
    vocabularyCode: TaxonomyVocabularyCode,
    page: NodeListPage,
  ) => Promise<readonly TaxonomyNode[]>;
  /** Primary ancestry, root first, excluding the node itself. Bounded depth. */
  readonly listAncestors: (
    executor: DatabaseExecutor,
    nodeId: TaxonomyNodeId,
  ) => Promise<readonly TaxonomyNode[]>;
  /** Primary descendants to a bounded depth (recursive CTE). */
  readonly listDescendants: (
    executor: DatabaseExecutor,
    nodeId: TaxonomyNodeId,
    maxDepth: number,
  ) => Promise<readonly TaxonomyNode[]>;
  readonly listAliases: (
    executor: DatabaseExecutor,
    nodeId: TaxonomyNodeId,
  ) => Promise<readonly TaxonomyAlias[]>;
  /** Exact normalised-alias lookup. Several nodes may share an alias. */
  readonly findNodesByNormalizedAlias: (
    executor: DatabaseExecutor,
    normalizedAlias: string,
    locale?: string,
  ) => Promise<readonly TaxonomyNode[]>;
  readonly listEdges: (
    executor: DatabaseExecutor,
    nodeId: TaxonomyNodeId,
  ) => Promise<readonly TaxonomyNodeEdge[]>;
  readonly getVersionSet: (
    executor: DatabaseExecutor,
  ) => Promise<TaxonomyVersionSet>;
};

export type NewTaxonomyAssignment = {
  readonly tenantId: TenantId;
  readonly subjectType: TaxonomySubjectType;
  readonly subjectId: string;
  readonly nodeId: TaxonomyNodeId;
  readonly assignmentSource: TaxonomyAssignmentSource;
  readonly confidence: string | null;
  readonly rawSourceText: string | null;
  readonly sourceId: string | null;
  readonly confirmedByUserId: UserId | null;
  readonly confirmedAt: string | null;
};

/**
 * Entity assignments: current rows are ACTIVE with no valid_to; removal is
 * supersession with a valid_to, never a delete. No status setter beyond
 * supersede exists.
 */
export type TaxonomyAssignmentRepository = {
  readonly lockSubject: (
    tx: TransactionContext,
    subject: Pick<TaxonomySubjectDescriptor, "subjectType" | "subjectId">,
  ) => Promise<void>;
  readonly listCurrent: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    subject: Pick<TaxonomySubjectDescriptor, "subjectType" | "subjectId">,
    vocabularyCode?: TaxonomyVocabularyCode,
  ) => Promise<readonly TaxonomyEntityAssignment[]>;
  readonly listHistory: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    subject: Pick<TaxonomySubjectDescriptor, "subjectType" | "subjectId">,
  ) => Promise<readonly TaxonomyEntityAssignment[]>;
  readonly insert: (
    tx: TransactionContext,
    input: NewTaxonomyAssignment,
  ) => Promise<TaxonomyEntityAssignment>;
  readonly supersede: (
    tx: TransactionContext,
    tenantId: TenantId,
    assignmentIds: readonly string[],
  ) => Promise<number>;
};

export type MandateTaxonomyPreferenceChange = {
  readonly added: number;
  readonly removed: number;
  readonly changedVocabularyCodes: readonly TaxonomyVocabularyCode[];
};

/**
 * The persistence primitive the Investor domain calls inside its own
 * versioned mandate transaction. It validates nodes and writes rows; it
 * never authorises, versions or publishes -- the mandate command does.
 */
export type MandateTaxonomyPreferencePort = {
  readonly list: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    mandateId: string,
  ) => Promise<readonly MandateTaxonomyPreference[]>;
  readonly replace: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly mandateId: string;
      readonly preferences: readonly MandateTaxonomyPreferenceInput[];
      readonly source: TaxonomyAssignmentSource;
    },
  ) => Promise<MandateTaxonomyPreferenceChange>;
};

/**
 * Resolves one typed subject to trusted ownership facts through the owning
 * domain's public query port, under the caller's tenant. There is no
 * dynamic table lookup: an unknown subject type has no resolver.
 */
export type TaxonomySubjectResolver = {
  readonly subjectType: TaxonomySubjectType;
  readonly resolve: (
    tenantId: TenantId,
    subjectId: string,
  ) => Promise<TaxonomySubjectDescriptor | null>;
};
