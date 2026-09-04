import { z } from "zod";

import {
  OnboardingJourneyTypeSchema,
  OnboardingResponseTypeSchema,
  OnboardingResponseValueSchema,
  OnboardingSessionStatusSchema,
  OnboardingSourceModalitySchema,
  OnboardingStepKeySchema,
  OnboardingStepStateStatusSchema,
  OnboardingSubjectTypeSchema,
  OnboardingSuggestionStatusSchema,
  UtcTimestampSchema,
  UuidSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import {
  OnboardingDefinitionVersionIdSchema,
  OnboardingResponseIdSchema,
  OnboardingSessionIdSchema,
  OnboardingSourceRefsSchema,
  OnboardingSuggestionIdSchema,
  type OnboardingResponse,
  type OnboardingSession,
  type OnboardingStepState,
  type OnboardingSuggestion,
} from "../contracts/index.js";
import { ONBOARDING_MUTATION_OPERATIONS } from "../domain/idempotency.js";
import { OnboardingSessionVersionConflictError } from "../domain/errors.js";
import type {
  OnboardingIdempotencyRepository,
  OnboardingResponseRepository,
  OnboardingSessionRepository,
  OnboardingStepStateRepository,
  OnboardingSuggestionRepository,
} from "../application/ports.js";

/**
 * PostgreSQL adapters for journey state. Parameterised SQL only. Session
 * reads for a person are filtered by user_id in SQL (enumeration-safe);
 * every mutation carries the expected version so a concurrent tab loses
 * cleanly with VERSION_CONFLICT instead of silently overwriting. Response
 * content is never updated; the database trigger backs that up.
 */

const Timestamp = z
  .union([z.date(), z.string()])
  .transform((value) =>
    UtcTimestampSchema.parse(
      value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString(),
    ),
  );

const SessionRow = z.object({
  id: OnboardingSessionIdSchema,
  tenant_id: TenantIdSchema.nullable(),
  user_id: UserIdSchema,
  organisation_id: OrganisationIdSchema.nullable(),
  journey_type: OnboardingJourneyTypeSchema,
  definition_version_id: OnboardingDefinitionVersionIdSchema,
  subject_type: OnboardingSubjectTypeSchema.nullable(),
  subject_id: UuidSchema.nullable(),
  status: OnboardingSessionStatusSchema,
  current_step_key: OnboardingStepKeySchema.nullable(),
  started_at: Timestamp,
  last_activity_at: Timestamp,
  completed_at: Timestamp.nullable(),
  version: z.number().int().min(1),
});

function toSession(row: unknown): OnboardingSession {
  const r = SessionRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    userId: r.user_id,
    organisationId: r.organisation_id,
    journeyType: r.journey_type,
    definitionVersionId: r.definition_version_id,
    subject:
      r.subject_type === null || r.subject_id === null
        ? null
        : { subjectType: r.subject_type, subjectId: r.subject_id },
    status: r.status,
    currentStepKey: r.current_step_key,
    startedAt: r.started_at,
    lastActivityAt: r.last_activity_at,
    completedAt: r.completed_at,
    version: r.version,
  };
}

function sessionSelect(executor: DatabaseExecutor) {
  return executor`
    select s.id, s.tenant_id, s.user_id, s.organisation_id, s.journey_type, s.definition_version_id,
           s.subject_type, s.subject_id, s.status, s.current_step_key, s.started_at, s.last_activity_at,
           s.completed_at, s.version
      from onboarding.sessions s`;
}

export function createPostgresOnboardingSessionRepository(): OnboardingSessionRepository {
  const reload = async (executor: DatabaseExecutor, sessionId: string) => {
    const rows =
      await executor`${sessionSelect(executor)} where s.id = ${sessionId}`;
    return toSession(rows[0]);
  };
  return {
    findById: async (executor, sessionId) => {
      const rows =
        await executor`${sessionSelect(executor)} where s.id = ${sessionId}`;
      return rows.length === 0 ? null : toSession(rows[0]);
    },
    findByIdForUser: async (executor, sessionId, userId) => {
      const rows = await executor`
        ${sessionSelect(executor)} where s.id = ${sessionId} and s.user_id = ${userId}`;
      return rows.length === 0 ? null : toSession(rows[0]);
    },
    findActive: async (executor, userId, journeyType, subject) => {
      const rows = await executor`
        ${sessionSelect(executor)}
         where s.user_id = ${userId}
           and s.journey_type = ${journeyType}
           and s.status = 'ACTIVE'
           and (${subject?.subjectType ?? null}::text is null
                or (s.subject_type = ${subject?.subjectType ?? null} and s.subject_id = ${subject?.subjectId ?? null}::uuid))
           and (${subject?.subjectType ?? null}::text is not null or s.subject_id is null)
         order by s.started_at desc
         limit 1`;
      return rows.length === 0 ? null : toSession(rows[0]);
    },
    findLatestActive: async (executor, userId, journeyType) => {
      const rows = await executor`
        ${sessionSelect(executor)}
         where s.user_id = ${userId}
           and s.journey_type = ${journeyType}
           and s.status = 'ACTIVE'
         order by s.started_at desc
         limit 1`;
      return rows.length === 0 ? null : toSession(rows[0]);
    },
    findLatest: async (executor, userId, journeyType) => {
      const rows = await executor`
        ${sessionSelect(executor)}
         where s.user_id = ${userId}
           and s.journey_type = ${journeyType}
           and s.status in ('ACTIVE', 'COMPLETED')
         order by s.started_at desc
         limit 1`;
      return rows.length === 0 ? null : toSession(rows[0]);
    },
    lockStart: async (tx, userId, journeyType, subject) => {
      await tx.sql`
        select pg_advisory_xact_lock(
          hashtext('onboarding.sessions:' || ${userId}::text || ':' || ${journeyType}::text),
          hashtext(${subject === null ? "unbound" : `${subject.subjectType}:${subject.subjectId}`}))`;
    },
    insert: async (tx, input) => {
      const rows = await tx.sql`
        insert into onboarding.sessions
          (tenant_id, user_id, organisation_id, journey_type, definition_version_id, subject_type, subject_id, current_step_key)
        values
          (${input.tenantId}, ${input.userId}, ${input.organisationId}, ${input.journeyType}, ${input.definitionVersionId},
           ${input.subject?.subjectType ?? null}, ${input.subject?.subjectId ?? null}, ${input.currentStepKey})
        returning id`;
      return reload(
        tx.sql,
        z.object({ id: OnboardingSessionIdSchema }).parse(rows[0]).id,
      );
    },
    lockForUpdate: async (tx, sessionId, userId) => {
      const rows = await tx.sql`
        ${sessionSelect(tx.sql)} where s.id = ${sessionId} and s.user_id = ${userId} for update`;
      return rows.length === 0 ? null : toSession(rows[0]);
    },
    commit: async (tx, sessionId, expectedVersion, update) => {
      const rows = await tx.sql`
        update onboarding.sessions s
           set current_step_key = case when ${update.currentStepKey !== undefined} then ${update.currentStepKey ?? null} else s.current_step_key end,
               status = coalesce(${update.status ?? null}, s.status),
               completed_at = case when ${update.completedAt !== undefined} then ${update.completedAt ?? null}::text::timestamptz else s.completed_at end,
               version = s.version + 1,
               last_activity_at = clock_timestamp()
         where s.id = ${sessionId} and s.version = ${expectedVersion}
        returning s.id`;
      if (rows.length === 0) {
        throw new OnboardingSessionVersionConflictError();
      }
      return reload(tx.sql, sessionId);
    },
    bindContext: async (tx, sessionId, expectedVersion, binding) => {
      const rows = await tx.sql`
        update onboarding.sessions s
           set tenant_id = ${binding.tenantId},
               organisation_id = ${binding.organisationId},
               subject_type = ${binding.subject.subjectType},
               subject_id = ${binding.subject.subjectId},
               version = s.version + 1,
               last_activity_at = clock_timestamp()
         where s.id = ${sessionId} and s.version = ${expectedVersion}
        returning s.id`;
      if (rows.length === 0) {
        throw new OnboardingSessionVersionConflictError();
      }
      return reload(tx.sql, sessionId);
    },
  };
}

// ---------------------------------------------------------------------------
// Step states
// ---------------------------------------------------------------------------

const StateRow = z.object({
  session_id: OnboardingSessionIdSchema,
  step_key: OnboardingStepKeySchema,
  status: OnboardingStepStateStatusSchema,
  entered_at: Timestamp,
  completed_at: Timestamp.nullable(),
  skipped_at: Timestamp.nullable(),
});

function toState(row: unknown): OnboardingStepState {
  const r = StateRow.parse(row);
  return {
    sessionId: r.session_id,
    stepKey: r.step_key,
    status: r.status,
    enteredAt: r.entered_at,
    completedAt: r.completed_at,
    skippedAt: r.skipped_at,
  };
}

export function createPostgresOnboardingStepStateRepository(): OnboardingStepStateRepository {
  return {
    listBySession: async (executor, sessionId) => {
      const rows = await executor`
        select st.session_id, st.step_key, st.status, st.entered_at, st.completed_at, st.skipped_at
          from onboarding.step_states st
         where st.session_id = ${sessionId}`;
      return rows.map(toState);
    },
    upsert: async (tx, input) => {
      const completed = input.status === "COMPLETED";
      const skipped = input.status === "SKIPPED";
      const rows = await tx.sql`
        insert into onboarding.step_states (session_id, step_key, status, completed_at, skipped_at)
        values (${input.sessionId}, ${input.stepKey}, ${input.status},
                case when ${completed} then clock_timestamp() end,
                case when ${skipped} then clock_timestamp() end)
        on conflict (session_id, step_key) do update
          set status = excluded.status,
              completed_at = case when ${completed} then clock_timestamp() end,
              skipped_at = case when ${skipped} then clock_timestamp() end
        returning session_id, step_key, status, entered_at, completed_at, skipped_at`;
      return toState(rows[0]);
    },
  };
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

const ResponseRow = z.object({
  id: OnboardingResponseIdSchema,
  session_id: OnboardingSessionIdSchema,
  step_key: OnboardingStepKeySchema,
  response_type: OnboardingResponseTypeSchema,
  response_jsonb: OnboardingResponseValueSchema,
  raw_text: z.string().nullable(),
  source_modality: OnboardingSourceModalitySchema,
  created_at: Timestamp,
  superseded_by_response_id: OnboardingResponseIdSchema.nullable(),
});

function toResponse(row: unknown): OnboardingResponse {
  const r = ResponseRow.parse(row);
  return {
    id: r.id,
    sessionId: r.session_id,
    stepKey: r.step_key,
    responseType: r.response_type,
    value: r.response_jsonb,
    rawText: r.raw_text,
    sourceModality: r.source_modality,
    createdAt: r.created_at,
    supersededByResponseId: r.superseded_by_response_id,
  };
}

function responseSelect(executor: DatabaseExecutor) {
  return executor`
    select r.id, r.session_id, r.step_key, r.response_type, r.response_jsonb, r.raw_text,
           r.source_modality, r.created_at, r.superseded_by_response_id
      from onboarding.responses r`;
}

export function createPostgresOnboardingResponseRepository(): OnboardingResponseRepository {
  return {
    listCurrent: async (executor, sessionId) => {
      const rows = await executor`
        ${responseSelect(executor)}
         where r.session_id = ${sessionId} and r.superseded_by_response_id is null
         order by r.step_key`;
      return rows.map(toResponse);
    },
    listHistory: async (executor, sessionId, stepKey) => {
      const rows = await executor`
        ${responseSelect(executor)}
         where r.session_id = ${sessionId} and r.step_key = ${stepKey}
         order by r.created_at, r.id`;
      return rows.map(toResponse);
    },
    findById: async (executor, responseId) => {
      const rows =
        await executor`${responseSelect(executor)} where r.id = ${responseId}`;
      return rows.length === 0 ? null : toResponse(rows[0]);
    },
    insert: async (tx, input) => {
      const { response } = input;
      const rows = await tx.sql`
        insert into onboarding.responses
          (id, session_id, step_key, response_type, response_jsonb, raw_text, source_modality)
        values
          (${input.responseId}, ${input.sessionId}, ${response.stepKey}, ${response.responseType},
           ${JSON.stringify(response.value)}::text::jsonb, ${response.rawText}, ${response.sourceModality})
        returning id, session_id, step_key, response_type, response_jsonb, raw_text, source_modality,
                  created_at, superseded_by_response_id`;
      return toResponse(rows[0]);
    },
    supersede: async (tx, previousResponseId, replacementResponseId) => {
      await tx.sql`
        update onboarding.responses r
           set superseded_by_response_id = ${replacementResponseId}
         where r.id = ${previousResponseId} and r.superseded_by_response_id is null`;
    },
  };
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

const SuggestionRow = z.object({
  id: OnboardingSuggestionIdSchema,
  session_id: OnboardingSessionIdSchema,
  step_key: OnboardingStepKeySchema,
  target_field: z.string(),
  suggested_value: OnboardingResponseValueSchema,
  source_refs: OnboardingSourceRefsSchema,
  confidence: z.string().nullable(),
  status: OnboardingSuggestionStatusSchema,
  model_run_id: UuidSchema.nullable(),
  created_at: Timestamp,
  resolved_at: Timestamp.nullable(),
});

function toSuggestion(row: unknown): OnboardingSuggestion {
  const r = SuggestionRow.parse(row);
  return {
    id: r.id,
    sessionId: r.session_id,
    stepKey: r.step_key,
    targetField: r.target_field,
    suggestedValue: r.suggested_value,
    sourceRefs: r.source_refs,
    confidence: r.confidence,
    status: r.status,
    modelRunId: r.model_run_id,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  };
}

function suggestionSelect(executor: DatabaseExecutor) {
  return executor`
    select g.id, g.session_id, g.step_key, g.target_field, g.suggested_value, g.source_refs,
           g.confidence::text as confidence, g.status, g.model_run_id, g.created_at, g.resolved_at
      from onboarding.suggestions g`;
}

export function createPostgresOnboardingSuggestionRepository(): OnboardingSuggestionRepository {
  return {
    listPending: async (executor, sessionId) => {
      const rows = await executor`
        ${suggestionSelect(executor)}
         where g.session_id = ${sessionId} and g.status = 'PENDING'
         order by g.created_at, g.id`;
      return rows.map(toSuggestion);
    },
    findById: async (executor, sessionId, suggestionId) => {
      const rows = await executor`
        ${suggestionSelect(executor)} where g.id = ${suggestionId} and g.session_id = ${sessionId}`;
      return rows.length === 0 ? null : toSuggestion(rows[0]);
    },
    insert: async (tx, input) => {
      const rows = await tx.sql`
        insert into onboarding.suggestions
          (session_id, step_key, target_field, suggested_value, source_refs, confidence, model_run_id)
        values
          (${input.sessionId}, ${input.stepKey}, ${input.targetField},
           ${JSON.stringify(input.suggestedValue)}::text::jsonb, ${JSON.stringify(input.sourceRefs)}::text::jsonb,
           ${input.confidence}::text::numeric, ${input.modelRunId})
        returning id`;
      const id = z
        .object({ id: OnboardingSuggestionIdSchema })
        .parse(rows[0]).id;
      const created =
        await tx.sql`${suggestionSelect(tx.sql)} where g.id = ${id}`;
      return toSuggestion(created[0]);
    },
    resolve: async (tx, suggestionId, status) => {
      const rows = await tx.sql`
        update onboarding.suggestions g
           set status = ${status}, resolved_at = clock_timestamp()
         where g.id = ${suggestionId} and g.status = 'PENDING'
        returning g.id`;
      return rows.length === 1;
    },
  };
}

// ---------------------------------------------------------------------------
// Idempotency (hashes only)
// ---------------------------------------------------------------------------

export function createPostgresOnboardingIdempotencyRepository(): OnboardingIdempotencyRepository {
  return {
    lockStart: async (tx, userId, journeyType, keyHash) => {
      await tx.sql`
        select pg_advisory_xact_lock(
          hashtext('onboarding.start:' || ${userId}::text || ':' || ${journeyType}::text),
          hashtext(${keyHash}))`;
    },
    findStart: async (tx, userId, journeyType, keyHash) => {
      const rows = await tx.sql`
        select r.request_hash, r.session_id
          from onboarding.session_creation_requests r
         where r.user_id = ${userId} and r.journey_type = ${journeyType} and r.idempotency_key_hash = ${keyHash}`;
      if (rows.length === 0) {
        return null;
      }
      const row = z
        .object({
          request_hash: z.string(),
          session_id: OnboardingSessionIdSchema,
        })
        .parse(rows[0]);
      return { requestHash: row.request_hash, sessionId: row.session_id };
    },
    recordStart: async (tx, input) => {
      await tx.sql`
        insert into onboarding.session_creation_requests
          (user_id, journey_type, idempotency_key_hash, request_hash, session_id)
        values (${input.userId}, ${input.journeyType}, ${input.keyHash}, ${input.requestHash}, ${input.sessionId})`;
    },
    findMutation: async (tx, sessionId, keyHash) => {
      const rows = await tx.sql`
        select m.operation, m.request_hash, m.result_version
          from onboarding.session_mutation_requests m
         where m.session_id = ${sessionId} and m.idempotency_key_hash = ${keyHash}`;
      if (rows.length === 0) {
        return null;
      }
      const row = z
        .object({
          operation: z.enum(ONBOARDING_MUTATION_OPERATIONS),
          request_hash: z.string(),
          result_version: z.number().int(),
        })
        .parse(rows[0]);
      return {
        operation: row.operation,
        requestHash: row.request_hash,
        resultVersion: row.result_version,
      };
    },
    recordMutation: async (tx, input) => {
      await tx.sql`
        insert into onboarding.session_mutation_requests
          (session_id, idempotency_key_hash, operation, request_hash, result_version)
        values (${input.sessionId}, ${input.keyHash}, ${input.operation}, ${input.requestHash}, ${input.resultVersion})`;
    },
  };
}
