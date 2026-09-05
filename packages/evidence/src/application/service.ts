import { createPostgresEvidenceRepositories } from "../infrastructure/postgres-repositories.js";
import {
  createCreateClaim,
  createGetClaim,
  createLinkClaimEvidence,
  createListClaims,
  createReviseClaim,
} from "./claim-use-cases.js";
import type {
  EvidenceProcessingDependencies,
  EvidenceServiceDependencies,
} from "./dependencies.js";
import type { EvidenceRepositories } from "./ports.js";
import {
  createCreateDocument,
  createGetDocument,
  createGetDocumentVersion,
  createGetDocumentWithVersion,
  createListDocuments,
  createListDocumentsWithVersions,
  createListDocumentVersions,
  createRegisterDocumentVersion,
} from "./document-use-cases.js";
import {
  createFindDocumentExtraction,
  createRecordDocumentExtraction,
} from "./extraction-use-cases.js";
import {
  createCreateEvidenceItem,
  createGetEvidenceItem,
  createListEvidenceItems,
} from "./evidence-item-use-cases.js";
import {
  createAdvanceVersionProcessingState,
  createCompleteDocumentProcessing,
  createRegisterProcessingRun,
  createResolveProcessingTarget,
  createTransitionProcessingRun,
} from "./processing-use-cases.js";
import {
  createGetEvidenceSource,
  createListEvidenceSources,
  createRegisterEvidenceSource,
} from "./source-use-cases.js";
import {
  createCancelDocumentUploadSession,
  createCleanupExpiredUploadSession,
  createCompleteDocumentUploadSession,
  createCreateDocumentUploadSession,
  createGetDocumentUploadSession,
} from "./upload-use-cases.js";

/** The Evidence application surface: bound use cases, nothing else. */
export type EvidenceService = {
  readonly registerEvidenceSource: ReturnType<
    typeof createRegisterEvidenceSource
  >;
  readonly getEvidenceSource: ReturnType<typeof createGetEvidenceSource>;
  readonly listEvidenceSources: ReturnType<typeof createListEvidenceSources>;
  readonly createDocument: ReturnType<typeof createCreateDocument>;
  readonly registerDocumentVersion: ReturnType<
    typeof createRegisterDocumentVersion
  >;
  readonly getDocument: ReturnType<typeof createGetDocument>;
  readonly listDocuments: ReturnType<typeof createListDocuments>;
  readonly listDocumentVersions: ReturnType<typeof createListDocumentVersions>;
  readonly getDocumentVersion: ReturnType<typeof createGetDocumentVersion>;
  readonly getDocumentWithVersion: ReturnType<
    typeof createGetDocumentWithVersion
  >;
  readonly listDocumentsWithVersions: ReturnType<
    typeof createListDocumentsWithVersions
  >;
  readonly registerProcessingRun: ReturnType<
    typeof createRegisterProcessingRun
  >;
  readonly transitionProcessingRun: ReturnType<
    typeof createTransitionProcessingRun
  >;
  readonly advanceVersionProcessingState: ReturnType<
    typeof createAdvanceVersionProcessingState
  >;
  readonly resolveProcessingTarget: ReturnType<
    typeof createResolveProcessingTarget
  >;
  readonly completeDocumentProcessing: ReturnType<
    typeof createCompleteDocumentProcessing
  >;
  readonly createClaim: ReturnType<typeof createCreateClaim>;
  readonly reviseClaim: ReturnType<typeof createReviseClaim>;
  readonly linkClaimEvidence: ReturnType<typeof createLinkClaimEvidence>;
  readonly getClaim: ReturnType<typeof createGetClaim>;
  readonly listClaims: ReturnType<typeof createListClaims>;
  readonly createEvidenceItem: ReturnType<typeof createCreateEvidenceItem>;
  readonly getEvidenceItem: ReturnType<typeof createGetEvidenceItem>;
  readonly listEvidenceItems: ReturnType<typeof createListEvidenceItems>;
  readonly createDocumentUploadSession: ReturnType<
    typeof createCreateDocumentUploadSession
  >;
  readonly completeDocumentUploadSession: ReturnType<
    typeof createCompleteDocumentUploadSession
  >;
  readonly cancelDocumentUploadSession: ReturnType<
    typeof createCancelDocumentUploadSession
  >;
  readonly getDocumentUploadSession: ReturnType<
    typeof createGetDocumentUploadSession
  >;
  readonly cleanupExpiredUploadSession: ReturnType<
    typeof createCleanupExpiredUploadSession
  >;
  readonly recordDocumentExtraction: ReturnType<
    typeof createRecordDocumentExtraction
  >;
  readonly findDocumentExtraction: ReturnType<
    typeof createFindDocumentExtraction
  >;
};

export type EvidenceServiceOptions = Omit<
  EvidenceServiceDependencies,
  "repositories"
> & {
  readonly repositories?:
    EvidenceServiceDependencies["repositories"] | undefined;
};

export function createEvidenceService(
  options: EvidenceServiceOptions,
): EvidenceService {
  const dependencies: EvidenceServiceDependencies = {
    ...options,
    repositories: options.repositories ?? createPostgresEvidenceRepositories(),
  };
  return {
    registerEvidenceSource: createRegisterEvidenceSource(dependencies),
    getEvidenceSource: createGetEvidenceSource(dependencies),
    listEvidenceSources: createListEvidenceSources(dependencies),
    createDocument: createCreateDocument(dependencies),
    registerDocumentVersion: createRegisterDocumentVersion(dependencies),
    getDocument: createGetDocument(dependencies),
    listDocuments: createListDocuments(dependencies),
    listDocumentVersions: createListDocumentVersions(dependencies),
    getDocumentVersion: createGetDocumentVersion(dependencies),
    getDocumentWithVersion: createGetDocumentWithVersion(dependencies),
    listDocumentsWithVersions: createListDocumentsWithVersions(dependencies),
    registerProcessingRun: createRegisterProcessingRun(dependencies),
    transitionProcessingRun: createTransitionProcessingRun(dependencies),
    advanceVersionProcessingState:
      createAdvanceVersionProcessingState(dependencies),
    resolveProcessingTarget: createResolveProcessingTarget(dependencies),
    completeDocumentProcessing: createCompleteDocumentProcessing(dependencies),
    createClaim: createCreateClaim(dependencies),
    reviseClaim: createReviseClaim(dependencies),
    linkClaimEvidence: createLinkClaimEvidence(dependencies),
    getClaim: createGetClaim(dependencies),
    listClaims: createListClaims(dependencies),
    createEvidenceItem: createCreateEvidenceItem(dependencies),
    getEvidenceItem: createGetEvidenceItem(dependencies),
    listEvidenceItems: createListEvidenceItems(dependencies),
    createDocumentUploadSession:
      createCreateDocumentUploadSession(dependencies),
    completeDocumentUploadSession:
      createCompleteDocumentUploadSession(dependencies),
    cancelDocumentUploadSession:
      createCancelDocumentUploadSession(dependencies),
    getDocumentUploadSession: createGetDocumentUploadSession(dependencies),
    cleanupExpiredUploadSession:
      createCleanupExpiredUploadSession(dependencies),
    recordDocumentExtraction: createRecordDocumentExtraction(dependencies),
    findDocumentExtraction: createFindDocumentExtraction(dependencies),
  };
}

/**
 * The worker's surface: the trusted server operations that move a document
 * through processing, bound to a dependency set that contains no
 * authorization service and no audit writer.
 *
 * Deliberately separate from `EvidenceService`. A queue consumer must not
 * hold the use cases that answer "may this actor do this", because there is
 * no actor in a queue message — only a claim.
 */
export type DocumentProcessingService = {
  readonly resolveProcessingTarget: ReturnType<
    typeof createResolveProcessingTarget
  >;
  readonly registerProcessingRun: ReturnType<
    typeof createRegisterProcessingRun
  >;
  readonly transitionProcessingRun: ReturnType<
    typeof createTransitionProcessingRun
  >;
  readonly advanceVersionProcessingState: ReturnType<
    typeof createAdvanceVersionProcessingState
  >;
  readonly completeDocumentProcessing: ReturnType<
    typeof createCompleteDocumentProcessing
  >;
  readonly recordDocumentExtraction: ReturnType<
    typeof createRecordDocumentExtraction
  >;
  readonly findDocumentExtraction: ReturnType<
    typeof createFindDocumentExtraction
  >;
};

export type DocumentProcessingServiceOptions = Omit<
  EvidenceProcessingDependencies,
  "repositories"
> & {
  readonly repositories?: EvidenceRepositories | undefined;
};

export function createDocumentProcessingService(
  options: DocumentProcessingServiceOptions,
): DocumentProcessingService {
  const dependencies: EvidenceProcessingDependencies = {
    ...options,
    repositories: options.repositories ?? createPostgresEvidenceRepositories(),
  };
  return {
    resolveProcessingTarget: createResolveProcessingTarget(dependencies),
    registerProcessingRun: createRegisterProcessingRun(dependencies),
    transitionProcessingRun: createTransitionProcessingRun(dependencies),
    advanceVersionProcessingState:
      createAdvanceVersionProcessingState(dependencies),
    completeDocumentProcessing: createCompleteDocumentProcessing(dependencies),
    recordDocumentExtraction: createRecordDocumentExtraction(dependencies),
    findDocumentExtraction: createFindDocumentExtraction(dependencies),
  };
}
