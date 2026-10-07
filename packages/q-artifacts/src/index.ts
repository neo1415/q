/**
 * Q artifacts (QX-003).
 *
 * What Q composes for somebody to read, keep and change. The one
 * invariant this context exists to hold:
 *
 *   generated artifact ≠ canonical truth ≠ verified evidence ≠ disclosure
 *
 * Nothing here writes to a company, an investor organisation, Evidence or
 * Knowledge, and nothing here is read by discovery, ranking or
 * qualification. Composing the content is a port, so this context never
 * calls a model and never decides what a model was allowed to see.
 */

export {
  canRevise,
  nextVersion,
  parseContent,
  toDetail,
  toSummary,
  toVersion,
  type ArtifactHistoryEntry,
  type StoredArtifact,
  type StoredArtifactVersion,
} from "./domain/artifact.js";

export type {
  ArtifactRepository,
  ComposedArtifact,
} from "./application/ports.js";

export {
  ArtifactAuthorityError,
  ArtifactCompositionFailedError,
  ArtifactNotFoundError,
  ArtifactNotRevisableError,
  createArtifactService,
  type ArtifactService,
  type PrepareArtifactInput,
  type ReviseArtifactInput,
} from "./application/service.js";

export { createPostgresArtifactRepository } from "./infrastructure/postgres-artifact-repository.js";

// Q room W5 (R8): documents made by a job; pictures for documents.
export {
  DOCUMENT_JOB_ATTEMPTS_MAX,
  DOCUMENT_JOB_KINDS,
  DocumentJobInputSchema,
  DocumentJobKindSchema,
  jobActor,
  type ClaimedDocumentJob,
  type DocumentJobInput,
  type DocumentJobKind,
  type DocumentJobProgress,
  type DocumentJobRepository,
  type DocumentJobStatus,
} from "./application/document-jobs.js";
export { createPostgresDocumentJobRepository } from "./infrastructure/postgres-document-jobs.js";
export {
  AI_IMAGES_FEATURE,
  createDocumentImages,
  createSupabaseDocumentImageStore,
  DOCUMENT_IMAGE_BUCKET,
  type DocumentIllustrationPort,
  type DocumentImageBudgets,
  type DocumentImageGateway,
  type DocumentImages,
  type DocumentImageStore,
} from "./infrastructure/document-images.js";

// DOCS block: brand kit.
export {
  BrandKitAlreadyAnsweredError,
  BrandKitAuthorityError,
  BrandKitNotFoundError,
  BrandLogoInvalidError,
  createBrandKitService,
  readLogo,
  stateOf as brandKitStateOf,
  type BrandKitService,
  type BrandLogoBytes,
  type EffectiveBrand,
} from "./application/brand-kit.js";
export {
  isBrandish,
  pairingForFamilies,
  readWebsiteBrand,
  siteOf,
  type WebsiteBrandReading,
} from "./domain/website-brand.js";
