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
  QCardFieldNotAllowedError,
  QCardNotFoundError,
  QCardSubjectNotFoundError,
  QCardVersionConflictError,
  type HandleRefusal,
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
export { createPostgresPublicIdentityRepository } from "./infrastructure/postgres-repository.js";
export {
  createSubjectDirectory,
  type CompanyProfileRead,
  type InvestorProfileRead,
  type SubjectDirectoryPorts,
} from "./infrastructure/subject-directory.js";

export const PACKAGE_NAME = "@capital-q/public-identity" as const;
