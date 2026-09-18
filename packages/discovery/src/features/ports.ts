import type { RecommendationFeatureSnapshot } from "./contracts.js";
import type {
  CompanyStateProjection,
  CompanyTaxonomyProjection,
  PreferenceHierarchyProjection,
} from "./policy.js";

/**
 * What feature computation reads and writes (doc 19 §42): typed, tagged
 * projections from the owning contexts, and the derived snapshot store.
 * There is no port to a conversation, a memory, a document, an evidence
 * passage, a research finding, an onboarding answer or a transcript. A
 * projection that cannot be expressed cannot be computed on.
 */

/** One batch read for a candidate set: state and declared taxonomy per company. */
export type CompanyFeatureProjection = {
  readonly state: CompanyStateProjection;
  readonly taxonomy: CompanyTaxonomyProjection;
};

export type CompanyFeatureProjectionPort = {
  /**
   * Discoverable companies only (a private or closed company is absent),
   * cross-tenant by design, bounded, one round trip for the state and one
   * bounded read per company's own tenant for its classifications.
   */
  readonly projectMany: (
    companyIds: readonly string[],
  ) => Promise<ReadonlyMap<string, CompanyFeatureProjection>>;
};

export type PreferenceHierarchyPort = {
  /** Every declared positive preference node, expanded once per run. */
  readonly expand: (
    nodeIds: readonly string[],
  ) => Promise<PreferenceHierarchyProjection>;
};

export type StoredFeatureSnapshotRef = {
  readonly id: string;
  readonly fingerprint: string;
};

/**
 * The derived store (`recommendation.feature_snapshots`). One CURRENT row
 * per investor organisation, mandate, company, context and schema
 * version; an identical fingerprint is reused, a different one supersedes.
 */
export type FeatureSnapshotStore = {
  readonly currentFor: (input: {
    readonly tenantId: string;
    readonly investorOrganisationId: string;
    readonly mandateId: string;
    readonly mode: string;
    readonly featureSchemaVersion: string;
    readonly companyIds: readonly string[];
  }) => Promise<ReadonlyMap<string, StoredFeatureSnapshotRef>>;
  readonly supersede: (ids: readonly string[]) => Promise<void>;
  readonly insertMany: (
    snapshots: readonly RecommendationFeatureSnapshot[],
  ) => Promise<readonly StoredFeatureSnapshotRef[]>;
};
