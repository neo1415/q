/**
 * @capital-q/capital
 *
 * Owns: the company's canonical Capital Objective -- target amount and
 * currency, target stage, financing instrument where applicable, target
 * close date, use-of-funds summary, lifecycle (ACTIVE, ACHIEVED,
 * CLOSED_BY_FOUNDER, DISCONTINUED, REPLACED) and the append-only
 * goal-evolution history in core.capital_objective_events.
 *
 * Does not own: the company (reached only through CompanyQueryPort),
 * readiness or InvestIQ, Blueprint, confirmed or soft commitments,
 * relationships and investment outcomes, valuation and term sheets, the Data
 * Room, recommendations, Q reasoning, or any public raise projection. Zero
 * LLM calls; Q has no write path.
 *
 *   Company ≠ Capital Objective ≠ Readiness ≠ Progress ≠ Outcome ≠ Q Inference
 *
 * Server-side only. Browser consumers use the wire DTOs in
 * @capital-q/contracts and the typed API client.
 */

export {
  CapitalObjectiveHistoryEventIdSchema,
  CapitalObjectiveIdSchema,
  toCapitalObjectiveDto,
  toCapitalObjectiveSnapshot,
  type CapitalObjective,
  type CapitalObjectiveHistoryEventId,
  type CapitalObjectiveId,
  type CapitalObjectiveSnapshot,
} from "./contracts/index.js";
export {
  ActiveCapitalObjectiveExistsError,
  CapitalObjectiveCreationConflictError,
  CapitalObjectiveLifecycleError,
  CapitalObjectiveNotFoundError,
  CapitalObjectiveVersionConflictError,
} from "./domain/errors.js";
export {
  CAPITAL_CHANGE_KINDS,
  CAPITAL_HISTORY_EVENT_TYPES,
  CAPITAL_HISTORY_PAYLOAD_MAX_BYTES,
  CapitalChangeKindSchema,
  CapitalHistoryEventTypeSchema,
  CapitalHistoryPayloadSchema,
  serializeHistoryPayload,
  type CapitalCanonicalValues,
  type CapitalChangeKind,
  type CapitalHistoryEventType,
  type CapitalHistoryPayload,
} from "./domain/history.js";
export {
  hashCapitalObjectiveIdempotencyKey,
  hashCreateCapitalObjectiveRequest,
} from "./domain/idempotency.js";

export type {
  CapitalObjectiveChanges,
  CapitalObjectiveCreationRecord,
  CapitalObjectiveCreationRequestStore,
  CapitalObjectiveHistoryWriter,
  CapitalObjectiveOwnershipFacts,
  CapitalObjectiveQueryPort,
  CapitalObjectiveRepository,
  NewCapitalObjective,
} from "./application/ports.js";
export type { CapitalServiceDependencies } from "./application/dependencies.js";
export {
  CAPITAL_OBJECTIVE_CLOSE,
  CAPITAL_OBJECTIVE_CREATE,
  CAPITAL_OBJECTIVE_EDIT,
  CAPITAL_OBJECTIVE_VIEW,
  createCloseCapitalObjective,
  createCreateCapitalObjective,
  createGetCapitalObjective,
  createGetCurrentCapitalObjective,
  createListCapitalObjectives,
  createReplaceCapitalObjective,
  createUpdateCapitalObjective,
  type CapitalObjectivePage,
  type CloseCapitalObjectiveCommand,
  type CreateCapitalObjectiveCommand,
  type GetCapitalObjectiveQuery,
  type GetCurrentCapitalObjectiveQuery,
  type ListCapitalObjectivesQuery,
  type ReplaceCapitalObjectiveCommand,
  type ReplacedCapitalObjective,
  type UpdateCapitalObjectiveCommand,
} from "./application/use-cases.js";
export {
  createCapitalService,
  type CapitalService,
  type CapitalServiceOptions,
} from "./application/service.js";

export {
  createPostgresCapitalObjectiveCreationRequestStore,
  createPostgresCapitalObjectiveHistoryWriter,
  createPostgresCapitalObjectiveQueryPort,
  createPostgresCapitalObjectiveRepository,
} from "./infrastructure/postgres-repositories.js";

export const PACKAGE_NAME = "@capital-q/capital" as const;
