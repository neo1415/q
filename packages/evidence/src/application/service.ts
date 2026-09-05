import { createPostgresEvidenceRepositories } from "../infrastructure/postgres-repositories.js";
import {
  createCreateClaim,
  createGetClaim,
  createLinkClaimEvidence,
  createListClaims,
  createReviseClaim,
} from "./claim-use-cases.js";
import type { EvidenceServiceDependencies } from "./dependencies.js";
import {
  createCreateDocument,
  createGetDocument,
  createGetDocumentVersion,
  createListDocuments,
  createListDocumentVersions,
  createRegisterDocumentVersion,
} from "./document-use-cases.js";
import {
  createCreateEvidenceItem,
  createGetEvidenceItem,
  createListEvidenceItems,
} from "./evidence-item-use-cases.js";
import {
  createAdvanceVersionProcessingState,
  createRegisterProcessingRun,
  createTransitionProcessingRun,
} from "./processing-use-cases.js";
import {
  createGetEvidenceSource,
  createListEvidenceSources,
  createRegisterEvidenceSource,
} from "./source-use-cases.js";

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
  readonly registerProcessingRun: ReturnType<
    typeof createRegisterProcessingRun
  >;
  readonly transitionProcessingRun: ReturnType<
    typeof createTransitionProcessingRun
  >;
  readonly advanceVersionProcessingState: ReturnType<
    typeof createAdvanceVersionProcessingState
  >;
  readonly createClaim: ReturnType<typeof createCreateClaim>;
  readonly reviseClaim: ReturnType<typeof createReviseClaim>;
  readonly linkClaimEvidence: ReturnType<typeof createLinkClaimEvidence>;
  readonly getClaim: ReturnType<typeof createGetClaim>;
  readonly listClaims: ReturnType<typeof createListClaims>;
  readonly createEvidenceItem: ReturnType<typeof createCreateEvidenceItem>;
  readonly getEvidenceItem: ReturnType<typeof createGetEvidenceItem>;
  readonly listEvidenceItems: ReturnType<typeof createListEvidenceItems>;
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
    registerProcessingRun: createRegisterProcessingRun(dependencies),
    transitionProcessingRun: createTransitionProcessingRun(dependencies),
    advanceVersionProcessingState:
      createAdvanceVersionProcessingState(dependencies),
    createClaim: createCreateClaim(dependencies),
    reviseClaim: createReviseClaim(dependencies),
    linkClaimEvidence: createLinkClaimEvidence(dependencies),
    getClaim: createGetClaim(dependencies),
    listClaims: createListClaims(dependencies),
    createEvidenceItem: createCreateEvidenceItem(dependencies),
    getEvidenceItem: createGetEvidenceItem(dependencies),
    listEvidenceItems: createListEvidenceItems(dependencies),
  };
}
