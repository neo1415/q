/**
 * @capital-q/q-presence — a subject's public presence (CQ-Q-PRESENCE-001).
 *
 * Owns: the order in which the public web is read at arrival and
 * refreshed; the bounded excerpts handed to a model; the understandings
 * proposed through the Knowledge Write Gate; the log of attempts.
 *
 * Does not own: what may leave in a query (Research), what may be recorded
 * (Evidence), what may be held (the Write Gate), which model runs (the
 * Model Gateway), or any store of its own beyond the attempt log.
 *
 * Invariants: a public page is data and never instruction; nothing here is
 * truth, and every understanding is Q's reading of a cited page; observed
 * signals are not a personality score and are excluded from ranking; only
 * a subject the actor already owns can be read.
 */

export {
  isRankingEligiblePresenceKey,
  PRESENCE_BOUNDS,
  PRESENCE_BUILD_STALE_AFTER_MS,
  PRESENCE_BUILD_STATUSES,
  PRESENCE_KEYS,
  PRESENCE_KEYS_EXCLUDED_FROM_RANKING,
  PRESENCE_REFRESH_AFTER_MS,
  PRESENCE_SUBJECT_TYPES,
  PresenceBuildStatusSchema,
  PresenceIdentitySchema,
  PresenceKeySchema,
  PresenceSubjectSchema,
  PresenceSubjectTypeSchema,
  type PresenceBuild,
  type PresenceBuildStatus,
  type PresenceIdentity,
  type PresenceKey,
  type PresenceOutcome,
  type PresenceSubject,
  type PresenceSubjectType,
} from "./contracts.js";

export type {
  PresenceBuildLog,
  PresenceEvidencePort,
  PresenceKnowledgePort,
  PresenceReaderPort,
  PresenceReaderRequest,
  PresenceReadPort,
  PresenceReadRequest,
  PresenceSource,
  ProposedUnderstanding,
} from "./ports.js";

export {
  createPresenceService,
  type BuildPresenceCommand,
  type BuildPresenceDependencies,
  type PresenceService,
} from "./application/build-presence.js";

export {
  distinctiveTerms,
  domainLabel,
  pageNamesSubject,
} from "./domain/subject-match.js";

export { createPostgresPresenceBuildLog } from "./infrastructure/postgres-presence-build-log.js";

export const PACKAGE_NAME = "@capital-q/q-presence" as const;
