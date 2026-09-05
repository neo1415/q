/**
 * @capital-q/evidence
 *
 * Owns: provenance sources, logical documents and their immutable file
 * versions, document processing provenance, claims with append-only
 * revisions, evidence items and claim-evidence links (schema `evidence`).
 *
 * Does not own: companies, investors, capital objectives, Q knowledge,
 * chunks, embeddings, InvestIQ conclusions, verification identity or Data
 * Room access. It uploads no bytes, parses nothing, scans nothing, calls no
 * model and fetches no URL.
 *
 *   Source ≠ Document ≠ DocumentVersion ≠ EvidenceItem ≠ Claim
 *   Claim ≠ canonical Company state ≠ Q Knowledge object
 *   Evidence ≠ Verification;   Q knows ≠ user may know
 *
 * Server-side only.
 */

export * from "./contracts/index.js";
export {
  ClaimNotFoundError,
  ClaimRevisionConflictError,
  DocumentNotFoundError,
  DocumentVersionConflictError,
  DocumentVersionNotFoundError,
  EvidenceItemNotFoundError,
  EvidenceRuleError,
  EvidenceSourceNotFoundError,
  EvidenceSubjectNotFoundError,
} from "./domain/errors.js";
export {
  defaultDocumentSensitivity,
  isAtLeastAsSensitive,
  sensitivityRank,
  strongestSensitivity,
} from "./domain/sensitivity.js";
export {
  createCompanyEvidenceSubjectResolver,
  createEvidenceSubjectResolverRegistry,
  type EvidenceSubjectResolver,
  type EvidenceSubjectResolverRegistry,
  type ResolvedEvidenceSubject,
} from "./domain/subjects.js";
export {
  DOCUMENT_CREATE,
  DOCUMENT_DOWNLOAD,
  DOCUMENT_MANAGE,
  DOCUMENT_VIEW,
  EVIDENCE_RECORD,
  EVIDENCE_VIEW,
} from "./application/authority.js";
export type { EvidenceServiceDependencies } from "./application/dependencies.js";
export type {
  ClaimEvidenceRepository,
  ClaimQueryPort,
  ClaimRepository,
  DocumentProcessingRunRepository,
  DocumentQueryPort,
  DocumentRepository,
  DocumentVersionRepository,
  EvidenceItemQueryPort,
  EvidenceItemRepository,
  EvidenceRepositories,
  EvidenceSourceQueryPort,
  EvidenceSourceRepository,
} from "./application/ports.js";
export {
  RegisterEvidenceSourceInputSchema,
  type RegisterEvidenceSourceCommand,
  type RegisterEvidenceSourceInput,
} from "./application/source-use-cases.js";
export {
  CreateDocumentInputSchema,
  DOCUMENT_MAX_SIZE_BYTES,
  DOCUMENT_MIME_ALLOWLIST,
  RegisterDocumentVersionInputSchema,
  type CreateDocumentCommand,
  type CreateDocumentInput,
  type RegisterDocumentVersionCommand,
  type RegisterDocumentVersionInput,
  type RegisterDocumentVersionResult,
} from "./application/document-use-cases.js";
export {
  AdvanceVersionProcessingStateInputSchema,
  RegisterProcessingRunInputSchema,
  TransitionProcessingRunInputSchema,
} from "./application/processing-use-cases.js";
export {
  CreateClaimInputSchema,
  LinkClaimEvidenceInputSchema,
  ReviseClaimInputSchema,
  type CreateClaimCommand,
  type CreateClaimInput,
  type LinkClaimEvidenceCommand,
  type ReviseClaimCommand,
  type ReviseClaimInput,
} from "./application/claim-use-cases.js";
export {
  CreateEvidenceItemInputSchema,
  type CreateEvidenceItemCommand,
  type CreateEvidenceItemInput,
} from "./application/evidence-item-use-cases.js";
export {
  createEvidenceService,
  type EvidenceService,
  type EvidenceServiceOptions,
} from "./application/service.js";
export { createPostgresEvidenceRepositories } from "./infrastructure/postgres-repositories.js";
export {
  createPostgresClaimQueryPort,
  createPostgresDocumentQueryPort,
  createPostgresEvidenceItemQueryPort,
  createPostgresEvidenceSourceQueryPort,
} from "./infrastructure/postgres-query-ports.js";
export { EVIDENCE_EVENTS } from "./events/index.js";

export const PACKAGE_NAME = "@capital-q/evidence" as const;
