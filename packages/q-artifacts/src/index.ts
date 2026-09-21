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
  ArtifactComposer,
  ArtifactRepository,
  ComposedArtifact,
} from "./application/ports.js";

export {
  ArtifactCompositionFailedError,
  ArtifactNotFoundError,
  ArtifactNotRevisableError,
  createArtifactService,
  type ArtifactService,
} from "./application/service.js";

export { createPostgresArtifactRepository } from "./infrastructure/postgres-artifact-repository.js";
