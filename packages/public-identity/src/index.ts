/**
 * @capital-q/public-identity
 *
 * Owns: global handles (display routes, never identifiers) and the Q Card
 * (the owner's choice of which declared fields are public_external or
 * network_visible), plus first-party aggregate scan counts.
 * Does not own: any profile data. A subject's declared facts come from
 * the companies or investors context through `SubjectDirectory`.
 *
 * Server-side only.
 */

export {
  CARD_FIELDS,
  DEFAULT_FIELD_SCOPES,
  NAME_FIELD,
  fitFieldScopes,
  projectCardFields,
  readStoredScopes,
  type CardAudience,
  type CardScopesReading,
} from "./domain/card.js";
export {
  HANDLE_REFUSALS,
  HandleUnavailableError,
  PROFILE_IMAGE_REFUSALS,
  ProfileImageRejectedError,
  ProfileImageStorageUnavailableError,
  ProfileImageUploadNotFoundError,
  QCardFieldNotAllowedError,
  QCardNotFoundError,
  QCardSubjectNotFoundError,
  QCardVersionConflictError,
  type HandleRefusal,
  type ProfileImageRefusal,
} from "./domain/errors.js";
export {
  holdUntil,
  newPublicCode,
  normaliseHandle,
  renamedAwayStatus,
  type HandleReading,
} from "./domain/handle.js";
export type {
  CardRow,
  HandleRow,
  HandleStatus,
  PublicIdentityRepository,
  QCardSubject,
  SubjectDirectory,
  SubjectFacts,
} from "./application/ports.js";
export {
  createPublicIdentityService,
  HANDLE_MANAGE,
  type PublicIdentityService,
  type PublicIdentityServiceDependencies,
} from "./application/service.js";
export {
  createProfileImageService,
  PROFILE_IMAGE_BUCKET,
  PROFILE_IMAGE_READ_TTL_SECONDS,
  type ProcessedImage,
  type ProfileImageProcessor,
  type ProfileImageRepository,
  type ProfileImageRow,
  type ProfileImageService,
  type ProfileImageServiceDependencies,
  type ProfileImageStorage,
  type ProfileImageSubject,
} from "./application/profile-images.js";
export {
  createNamedImageReader,
  namedByRelationshipLink,
  namedImageKey,
  photoLookup,
  type NamedImageReader,
  type NamedImages,
  type NamedImageStore,
  type NamedImageSubject,
} from "./application/named-images.js";
export {
  createPostgresNamedImageStore,
  createPostgresProfileImageRepository,
} from "./infrastructure/postgres-profile-images.js";
export { createSharpImageProcessor } from "./infrastructure/sharp-image-processor.js";
export { createPostgresPublicIdentityRepository } from "./infrastructure/postgres-repository.js";
export {
  createSubjectDirectory,
  type InvestorMandateCardFacts,
  type CompanyProfileRead,
  type InvestorProfileRead,
  type SubjectDirectoryPorts,
} from "./infrastructure/subject-directory.js";

export const PACKAGE_NAME = "@capital-q/public-identity" as const;
