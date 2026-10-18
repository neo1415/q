import type {
  EmbeddingBatchResult,
  EmbeddingExecutionContext,
  EmbeddingProviderDescriptor,
  EmbeddingQueryTask,
  EmbeddingResult,
} from "@capital-q/q-embeddings";

/**
 * What semantic retrieval reads and writes. Each port speaks in canonical
 * identifiers, canonical codes and the investor-visible profile; none can
 * express a memory, a conversation, a document, an evidence passage, a
 * research finding or a Q summary. A port that cannot express private
 * material cannot embed it (doc 19 §204.8/§204.9; doc 15 §20).
 */

/** The investor-visible investment facts of one discoverable company. */
export type CompanyInvestmentFacts = {
  readonly companyId: string;
  readonly tenantId: string;
  readonly organisationId: string;
  readonly canonicalName: string;
  readonly shortDescription: string | null;
  readonly currentStageCode: string | null;
  readonly headquartersCountry: string | null;
  /** The canonical row version; changes whenever a profile field does. */
  readonly sourceVersion: number;
  /** ACTIVE canonical classifications, read under the company's own tenant. */
  readonly classifications: readonly {
    readonly nodeId: string;
    readonly vocabularyCode: string;
    readonly canonicalCode: string;
  }[];
};

export type CompanyInvestmentFactsPort = {
  /**
   * Active, discovery-classified companies only: the named ids (a private
   * or closed company is simply absent) or, with null, a bounded id-ordered
   * slice of every discoverable company. Cross-tenant by design.
   */
  readonly listDiscoverable: (input: {
    readonly companyIds: readonly string[] | null;
    readonly limit: number;
  }) => Promise<readonly CompanyInvestmentFacts[]>;
};

/** The declared narrative of the investor's own mandate. Investor-private. */
export type InvestorMandateNarrative = {
  readonly mandateId: string;
  readonly version: number;
  readonly name: string;
  readonly rawMandateText: string | null;
};

export type InvestorMandateNarrativePort = {
  /** Tenant- and organisation-scoped: another investor's mandate resolves as absent. */
  readonly narrativeFor: (input: {
    readonly tenantId: string;
    readonly investorOrganisationId: string;
    readonly mandateId: string;
  }) => Promise<InvestorMandateNarrative | null>;
};

/** A canonical taxonomy node, named for a reader. */
export type DescribedNode = {
  readonly nodeId: string;
  readonly vocabularyCode: string;
  readonly canonicalCode: string;
  readonly displayName: string;
};

export type VocabularyDescriptionPort = {
  /** Reference data; missing ids are simply absent. */
  readonly describeNodes: (
    nodeIds: readonly string[],
  ) => Promise<readonly DescribedNode[]>;
};

export type StoredRepresentation = {
  readonly id: string;
  readonly contentSha256: string;
  readonly sourceFingerprint: string;
};

/** One vector's identity, as the embedding provider reports it. */
export type VectorIdentity = {
  readonly providerCode: string;
  readonly modelCode: string;
  readonly modelRevision: string | null;
  readonly configurationVersion: string;
  readonly instructionVersion: string;
  readonly dimension: number;
};

export type SemanticNearestHit = {
  readonly companyId: string;
  readonly tenantId: string;
  readonly organisationId: string;
  /** Cosine distance, as pgvector computed it. */
  readonly distance: number;
};

/**
 * The derived store (schema `recommendation`). Rows are written by the
 * refresh and the generator only; nothing a client sends reaches it.
 */
export type SemanticRepresentationStore = {
  readonly currentCompanyRepresentation: (input: {
    readonly companyId: string;
    readonly purpose: string;
    readonly representationVersion: string;
  }) => Promise<StoredRepresentation | null>;
  readonly supersedeCompanyRepresentation: (id: string) => Promise<void>;
  readonly insertCompanyRepresentation: (input: {
    readonly tenantId: string;
    readonly companyId: string;
    readonly purpose: string;
    readonly representationVersion: string;
    readonly sourceFingerprint: string;
    readonly contentSha256: string;
    readonly content: string;
  }) => Promise<StoredRepresentation>;
  /** Whether a vector already exists for this representation under this identity. */
  readonly hasCompanyEmbedding: (input: {
    readonly representationId: string;
    readonly identity: VectorIdentity;
  }) => Promise<boolean>;
  /**
   * A vector this company already holds for identical content under the
   * same identity (a superseded row rebuilt to the same text). Same
   * company, same tenant: deduplication never crosses an ownership line.
   */
  readonly findReusableCompanyVector: (input: {
    readonly companyId: string;
    readonly contentSha256: string;
    readonly identity: VectorIdentity;
  }) => Promise<readonly number[] | null>;
  readonly insertCompanyEmbedding: (input: {
    readonly tenantId: string;
    readonly representationId: string;
    readonly companyId: string;
    readonly contentSha256: string;
    readonly identity: VectorIdentity;
    readonly vector: readonly number[];
  }) => Promise<void>;

  readonly currentMandateRepresentation: (input: {
    readonly mandateId: string;
    readonly purpose: string;
    readonly representationVersion: string;
  }) => Promise<StoredRepresentation | null>;
  readonly supersedeMandateRepresentation: (id: string) => Promise<void>;
  readonly insertMandateRepresentation: (input: {
    readonly tenantId: string;
    readonly investorOrganisationId: string;
    readonly mandateId: string;
    readonly mandateVersion: number;
    readonly purpose: string;
    readonly representationVersion: string;
    readonly sourceFingerprint: string;
    readonly contentSha256: string;
    readonly content: string;
  }) => Promise<StoredRepresentation>;
  readonly findMandateVector: (input: {
    readonly representationId: string;
    readonly identity: VectorIdentity;
  }) => Promise<readonly number[] | null>;
  readonly insertMandateEmbedding: (input: {
    readonly tenantId: string;
    readonly representationId: string;
    readonly investorOrganisationId: string;
    readonly contentSha256: string;
    readonly identity: VectorIdentity;
    readonly vector: readonly number[];
  }) => Promise<void>;

  /**
   * Bounded nearest neighbours over CURRENT company representations under
   * one embedding configuration, joined to the company's CURRENT
   * discoverability (active; network_visible / public_external) so a stale
   * vector of a company that went private or closed never returns.
   * Ordered by distance, then canonical id.
   */
  readonly nearestCompanies: (input: {
    readonly queryVector: readonly number[];
    readonly purpose: string;
    readonly representationVersion: string;
    readonly configurationVersion: string;
    readonly documentInstructionVersion: string;
    readonly limit: number;
  }) => Promise<readonly SemanticNearestHit[]>;
};

/**
 * The slice of `@capital-q/q-embeddings`'s EmbeddingService this generator
 * uses. Local runtime behind an adapter; documents without an instruction,
 * queries under a registered task. Nothing here chooses a provider.
 */
export type SemanticEmbedder = {
  readonly describe: () => EmbeddingProviderDescriptor;
  readonly embedDocuments: (
    inputs: readonly string[],
    context?: EmbeddingExecutionContext,
  ) => Promise<EmbeddingBatchResult>;
  readonly embedQuery: (
    query: string,
    task: EmbeddingQueryTask,
    context?: EmbeddingExecutionContext,
  ) => Promise<EmbeddingResult>;
};
