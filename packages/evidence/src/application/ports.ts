import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { OrganisationId, TenantId, UserId } from "@capital-q/security";

import type {
  Claim,
  ClaimAsserterType,
  ClaimEvidenceLink,
  ClaimEvidenceRelationship,
  ClaimId,
  ClaimRevision,
  DisclosureScope,
  Document,
  DocumentId,
  DocumentProcessingRun,
  DocumentStatus,
  DocumentType,
  DocumentVersion,
  DocumentVersionId,
  EvidenceItem,
  EvidenceItemId,
  EvidenceLocator,
  EvidenceSource,
  EvidenceSourceId,
  EvidenceSourceType,
  EvidenceStatus,
  EvidenceSubjectRef,
  EvidenceSubjectType,
  LifecycleStatus,
  MalwareScanStatus,
  ProcessingRunStatus,
  ProcessingStatus,
  ReliabilityClass,
  SensitivityClass,
  SourceMetadata,
  StructuredValue,
  TextExtractionStatus,
  TruthClass,
} from "../contracts/index.js";
import type {
  DocumentUploadRequestStore,
  DocumentUploadSessionRepository,
} from "./upload-ports.js";

/**
 * Repository ports. Writes take the transaction, reads take an executor,
 * and every call names the tenant explicitly: no ambient context, no
 * dynamic table names, parameterised SQL only. Rows outside the named
 * tenant are invisible to every method.
 */

export type NewEvidenceSource = {
  readonly tenantId: TenantId;
  readonly sourceType: EvidenceSourceType;
  readonly subjectType: EvidenceSubjectType;
  readonly subjectId: string;
  readonly provider: string | null;
  readonly externalReference: string | null;
  readonly title: string | null;
  readonly sourceUrl: string | null;
  readonly createdByUserId: UserId | null;
  readonly retrievedAt: string | null;
  readonly publishedAt: string | null;
  readonly reliabilityClass: ReliabilityClass | null;
  readonly visibilityScope: DisclosureScope;
  readonly sensitivityClass: SensitivityClass;
  readonly metadata: SourceMetadata;
};

export type EvidenceSourceRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: NewEvidenceSource,
  ) => Promise<EvidenceSource>;
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    sourceId: EvidenceSourceId,
  ) => Promise<EvidenceSource | null>;
  readonly listBySubject: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    subject: EvidenceSubjectRef,
  ) => Promise<readonly EvidenceSource[]>;
};

export type NewDocument = {
  readonly tenantId: TenantId;
  readonly companyId: string | null;
  readonly ownerOrganisationId: OrganisationId;
  readonly documentType: DocumentType;
  readonly title: string;
  readonly visibilityScope: DisclosureScope;
  readonly sensitivityClass: SensitivityClass;
  readonly createdByUserId: UserId;
};

export type DocumentDetailChanges = {
  readonly title?: string;
  readonly documentType?: DocumentType;
  readonly sensitivityClass?: SensitivityClass;
  readonly status?: DocumentStatus;
};

export type DocumentRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: NewDocument,
  ) => Promise<Document>;
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    ownerOrganisationId: OrganisationId,
    documentId: DocumentId,
  ) => Promise<Document | null>;
  /** Tenant-scoped lookup for the read port; ownership is returned, not filtered. */
  readonly findInTenant: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    documentId: DocumentId,
  ) => Promise<Document | null>;
  /** Row lock for a version registration; same visibility rule as findById. */
  readonly lockById: (
    tx: TransactionContext,
    tenantId: TenantId,
    ownerOrganisationId: OrganisationId,
    documentId: DocumentId,
  ) => Promise<Document | null>;
  readonly listByOwner: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    ownerOrganisationId: OrganisationId,
    filter: { readonly companyId?: string | undefined },
  ) => Promise<readonly Document[]>;
  /** False when `expectedVersion` no longer matches. */
  readonly setCurrentVersion: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly documentId: DocumentId;
      readonly expectedVersion: number;
      readonly currentVersionId: DocumentVersionId;
    },
  ) => Promise<boolean>;
  readonly updateDetails: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly documentId: DocumentId;
      readonly expectedVersion: number;
      readonly changes: DocumentDetailChanges;
    },
  ) => Promise<boolean>;
};

export type NewDocumentVersion = {
  readonly tenantId: TenantId;
  readonly documentId: DocumentId;
  readonly versionNumber: number;
  readonly storageBucket: string;
  readonly storageKey: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly uploadedByUserId: UserId;
  readonly supersedesVersionId: DocumentVersionId | null;
};

export type DocumentVersionProcessingChanges = {
  readonly processingStatus?: ProcessingStatus;
  readonly malwareScanStatus?: MalwareScanStatus;
  readonly textExtractionStatus?: TextExtractionStatus;
};

export type DocumentVersionRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: NewDocumentVersion,
  ) => Promise<DocumentVersion>;
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    versionId: DocumentVersionId,
  ) => Promise<DocumentVersion | null>;
  readonly listByDocument: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    documentId: DocumentId,
  ) => Promise<readonly DocumentVersion[]>;
  /**
   * The current version of each of an organisation's documents, in one
   * round trip, so listing documents does not become a query per row.
   */
  readonly listCurrentByOwner: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    ownerOrganisationId: OrganisationId,
  ) => Promise<readonly DocumentVersion[]>;
  /**
   * Byte-level duplicate detection inside one organisation only. A hash is
   * never a key into another organisation's or tenant's documents.
   */
  readonly findBySha256: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    ownerOrganisationId: OrganisationId,
    sha256: string,
  ) => Promise<readonly DocumentVersion[]>;
  /** Processing state only; file identity columns are never touched. */
  readonly updateProcessingState: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly versionId: DocumentVersionId;
      readonly changes: DocumentVersionProcessingChanges;
    },
  ) => Promise<DocumentVersion | null>;
};

export type DocumentProcessingRunRepository = {
  /** One logical run per (version, pipeline); returns the existing one otherwise. */
  readonly getOrCreate: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly documentVersionId: DocumentVersionId;
      readonly pipelineVersion: string;
    },
  ) => Promise<{
    readonly run: DocumentProcessingRun;
    readonly created: boolean;
  }>;
  readonly listByVersion: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    documentVersionId: DocumentVersionId,
  ) => Promise<readonly DocumentProcessingRun[]>;
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    runId: DocumentProcessingRun["id"],
  ) => Promise<DocumentProcessingRun | null>;
  readonly transition: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly runId: DocumentProcessingRun["id"];
      readonly status: ProcessingRunStatus;
      readonly errorCode: string | null;
    },
  ) => Promise<DocumentProcessingRun | null>;
};

export type ClaimContent = {
  readonly statement: string;
  readonly structuredValue: StructuredValue | null;
  readonly truthClass: TruthClass;
  readonly evidenceStatus: EvidenceStatus;
  readonly lifecycleStatus: LifecycleStatus;
  readonly validFrom: string | null;
  readonly validTo: string | null;
};

export type NewClaim = ClaimContent & {
  readonly tenantId: TenantId;
  readonly subjectType: EvidenceSubjectType;
  readonly subjectId: string;
  readonly claimType: string;
  readonly claimKey: string;
  readonly assertedByType: ClaimAsserterType;
  readonly assertedById: string;
  readonly assertedAt: string;
  readonly visibilityScope: DisclosureScope;
  readonly sensitivityClass: SensitivityClass;
  readonly changedByType: ClaimAsserterType;
  readonly changedById: string;
  readonly sourceId: EvidenceSourceId | null;
};

export type ClaimRevisionInput = ClaimContent & {
  readonly tenantId: TenantId;
  readonly claimId: ClaimId;
  readonly expectedRevisionNumber: number;
  readonly changeReason: string | null;
  readonly changedByType: ClaimAsserterType;
  readonly changedById: string;
  readonly sourceId: EvidenceSourceId | null;
};

export type ClaimRepository = {
  /** Inserts the claim and its revision 1 together. */
  readonly insert: (tx: TransactionContext, input: NewClaim) => Promise<Claim>;
  /** Appends revision N+1 and advances the projection; null on a stale revision number. */
  readonly revise: (
    tx: TransactionContext,
    input: ClaimRevisionInput,
  ) => Promise<Claim | null>;
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    claimId: ClaimId,
  ) => Promise<Claim | null>;
  readonly lockById: (
    tx: TransactionContext,
    tenantId: TenantId,
    claimId: ClaimId,
  ) => Promise<Claim | null>;
  readonly listBySubject: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    subject: EvidenceSubjectRef,
    filter: { readonly claimKey?: string | undefined },
  ) => Promise<readonly Claim[]>;
  readonly listRevisions: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    claimId: ClaimId,
  ) => Promise<readonly ClaimRevision[]>;
};

export type NewEvidenceItem = {
  readonly tenantId: TenantId;
  readonly sourceId: EvidenceSourceId;
  readonly subjectType: EvidenceSubjectType;
  readonly subjectId: string;
  readonly evidenceType: string;
  readonly summary: string;
  readonly structuredValue: StructuredValue | null;
  readonly locator: EvidenceLocator;
  readonly validFrom: string | null;
  readonly validTo: string | null;
  readonly evidenceStatus: EvidenceStatus;
  readonly reliabilityClass: ReliabilityClass | null;
  readonly visibilityScope: DisclosureScope;
  readonly sensitivityClass: SensitivityClass;
  readonly createdByUserId: UserId | null;
};

export type EvidenceItemRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: NewEvidenceItem,
  ) => Promise<EvidenceItem>;
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    evidenceItemId: EvidenceItemId,
  ) => Promise<EvidenceItem | null>;
  readonly listBySubject: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    subject: EvidenceSubjectRef,
  ) => Promise<readonly EvidenceItem[]>;
  readonly listBySource: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    sourceId: EvidenceSourceId,
  ) => Promise<readonly EvidenceItem[]>;
};

export type NewClaimEvidenceLink = {
  readonly tenantId: TenantId;
  readonly claimId: ClaimId;
  readonly evidenceItemId: EvidenceItemId;
  readonly relationship: ClaimEvidenceRelationship;
  readonly weight: string | null;
  readonly createdByUserId: UserId | null;
};

export type ClaimEvidenceRepository = {
  /** Idempotent on (claim, evidence item, relationship). */
  readonly link: (
    tx: TransactionContext,
    input: NewClaimEvidenceLink,
  ) => Promise<{ readonly link: ClaimEvidenceLink; readonly created: boolean }>;
  readonly listByClaim: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    claimId: ClaimId,
  ) => Promise<readonly ClaimEvidenceLink[]>;
  readonly listByEvidenceItem: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    evidenceItemId: EvidenceItemId,
  ) => Promise<readonly ClaimEvidenceLink[]>;
};

export type {
  DocumentUploadRequestRecord,
  DocumentUploadRequestStore,
  DocumentUploadSessionChanges,
  DocumentUploadSessionRepository,
} from "./upload-ports.js";

export type EvidenceRepositories = {
  readonly sources: EvidenceSourceRepository;
  readonly documents: DocumentRepository;
  readonly documentVersions: DocumentVersionRepository;
  readonly processingRuns: DocumentProcessingRunRepository;
  readonly claims: ClaimRepository;
  readonly evidenceItems: EvidenceItemRepository;
  readonly claimEvidence: ClaimEvidenceRepository;
  readonly uploadSessions: DocumentUploadSessionRepository;
  readonly uploadRequests: DocumentUploadRequestStore;
};

// ---------------------------------------------------------------------------
// Query ports: the narrow read contracts later contexts (Q, RAG, Data Room)
// depend on. Permission-neutral facts; callers authorise separately, and
// the Postgres repositories above are never imported outside this package.
// ---------------------------------------------------------------------------

export type EvidenceSourceQueryPort = {
  readonly findCanonicalSource: (
    tenantId: TenantId,
    sourceId: EvidenceSourceId,
  ) => Promise<EvidenceSource | null>;
};

export type DocumentQueryPort = {
  /** Ownership and classification facts; never storage keys. */
  readonly findCanonicalDocument: (
    tenantId: TenantId,
    documentId: DocumentId,
  ) => Promise<{
    readonly id: DocumentId;
    readonly tenantId: TenantId;
    readonly ownerOrganisationId: OrganisationId;
    readonly companyId: string | null;
    readonly visibilityScope: DisclosureScope;
    readonly sensitivityClass: SensitivityClass;
    readonly currentVersionId: DocumentVersionId | null;
    readonly status: DocumentStatus;
  } | null>;
};

export type ClaimQueryPort = {
  readonly findCanonicalClaim: (
    tenantId: TenantId,
    claimId: ClaimId,
  ) => Promise<Claim | null>;
  readonly listCurrentClaims: (
    tenantId: TenantId,
    subject: EvidenceSubjectRef,
    filter: { readonly claimKey?: string | undefined },
  ) => Promise<readonly Claim[]>;
};

export type EvidenceItemQueryPort = {
  readonly findCanonicalEvidenceItem: (
    tenantId: TenantId,
    evidenceItemId: EvidenceItemId,
  ) => Promise<EvidenceItem | null>;
  readonly listEvidenceForClaim: (
    tenantId: TenantId,
    claimId: ClaimId,
  ) => Promise<readonly ClaimEvidenceLink[]>;
};
