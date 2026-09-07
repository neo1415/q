import { z } from "zod";

import {
  CorrelationIdSchema,
  QCapabilitySchema,
  QConsequenceClassSchema,
  QConversationIdSchema,
  QFailureDiagnosticCodeSchema,
  QMessageIdSchema,
  QMessageRoleSchema,
  QRunIdSchema,
  QRunStatusSchema,
  QStreamEventIdSchema,
  QStreamEventTypeSchema,
  QSubjectRefsSchema,
  QVisibleStageSchema,
  UtcTimestampSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import type { QRuntimeRepositories } from "../application/ports.js";
import { Q_RUN_EVENTS_CHANNEL } from "../application/stream.js";
import {
  QConversationContextTypeSchema,
  type QConversation,
  type QConversationMessage,
  type QRunEventRecord,
  type QRunRecord,
} from "../contracts/index.js";

/**
 * PostgreSQL for the `q_runtime` schema.
 *
 * Three habits run through every statement. Tenant is always in the
 * predicate, never assumed from context. Reads on behalf of a person also
 * carry the owner. And every lifecycle mutation carries the expected
 * version, so a stale writer updates zero rows and is told so.
 *
 * Rows are parsed on the way out. A column this package did not expect
 * cannot silently become part of a record, and a malformed row fails here
 * rather than at a client.
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

/** The stored `data` of a stream event; its shape is re-validated on read. */
const JsonObject = z.record(z.string(), z.unknown());

const ConversationRow = z.object({
  id: QConversationIdSchema,
  tenant_id: TenantIdSchema,
  user_id: UserIdSchema,
  organisation_id: OrganisationIdSchema.nullable(),
  context_type: QConversationContextTypeSchema,
  subject_refs: QSubjectRefsSchema,
  created_at: Timestamp,
  archived_at: Timestamp.nullable(),
});

function toConversation(row: unknown): QConversation {
  const r = ConversationRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    userId: r.user_id,
    organisationId: r.organisation_id,
    contextType: r.context_type,
    subjects: r.subject_refs,
    createdAt: r.created_at,
    archivedAt: r.archived_at,
  };
}

const RunRow = z.object({
  id: QRunIdSchema,
  tenant_id: TenantIdSchema,
  actor_user_id: UserIdSchema,
  actor_organisation_id: OrganisationIdSchema.nullable(),
  conversation_id: QConversationIdSchema.nullable(),
  objective: z.string(),
  capability: QCapabilitySchema,
  consequence_class: QConsequenceClassSchema,
  status: QRunStatusSchema,
  subject_refs: QSubjectRefsSchema,
  orchestration_version: z.string().nullable(),
  prompt_bundle_version: z.string().nullable(),
  model_policy_version: z.string().nullable(),
  correlation_id: CorrelationIdSchema,
  created_at: Timestamp,
  started_at: Timestamp.nullable(),
  completed_at: Timestamp.nullable(),
  failure_code: QFailureDiagnosticCodeSchema.nullable(),
  version: z.number().int().min(1),
  last_event_sequence: z.number().int().min(0),
});

function toRun(row: unknown): QRunRecord {
  const r = RunRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    actorUserId: r.actor_user_id,
    actorOrganisationId: r.actor_organisation_id,
    conversationId: r.conversation_id,
    objective: r.objective,
    capability: r.capability,
    consequenceClass: r.consequence_class,
    status: r.status,
    subjects: r.subject_refs,
    orchestrationVersion: r.orchestration_version,
    promptBundleVersion: r.prompt_bundle_version,
    modelPolicyVersion: r.model_policy_version,
    correlationId: r.correlation_id,
    createdAt: r.created_at,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    failureCode: r.failure_code,
    version: r.version,
    lastEventSequence: r.last_event_sequence,
  };
}

const MessageRow = z.object({
  id: QMessageIdSchema,
  tenant_id: TenantIdSchema,
  conversation_id: QConversationIdSchema,
  run_id: QRunIdSchema,
  role: QMessageRoleSchema,
  content: z.string(),
  content_type: z.literal("TEXT"),
  created_at: Timestamp,
});

function toMessage(row: unknown): QConversationMessage {
  const r = MessageRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    conversationId: r.conversation_id,
    runId: r.run_id,
    role: r.role,
    content: r.content,
    contentType: r.content_type,
    createdAt: r.created_at,
  };
}

const EventRow = z.object({
  id: QStreamEventIdSchema,
  tenant_id: TenantIdSchema,
  run_id: QRunIdSchema,
  sequence: z.number().int().min(1),
  event_type: QStreamEventTypeSchema,
  visible_stage: QVisibleStageSchema.nullable(),
  payload: JsonObject,
  occurred_at: Timestamp,
});

function toEvent(row: unknown): QRunEventRecord {
  const r = EventRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    runId: r.run_id,
    sequence: r.sequence,
    eventType: r.event_type,
    visibleStage: r.visible_stage,
    payload: r.payload,
    occurredAt: r.occurred_at,
  };
}

const IdRow = z.object({ id: z.string().uuid() });

function selectConversation(executor: DatabaseExecutor) {
  return executor`
    select c.id, c.tenant_id, c.user_id, c.organisation_id, c.context_type,
           c.subject_refs, c.created_at, c.archived_at
      from q_runtime.conversations c`;
}

function selectRun(executor: DatabaseExecutor) {
  return executor`
    select r.id, r.tenant_id, r.actor_user_id, r.actor_organisation_id,
           r.conversation_id, r.objective, r.capability, r.consequence_class,
           r.status, r.subject_refs, r.orchestration_version,
           r.prompt_bundle_version, r.model_policy_version, r.correlation_id,
           r.created_at, r.started_at, r.completed_at, r.failure_code,
           r.version, r.last_event_sequence
      from q_runtime.runs r`;
}

function selectMessage(executor: DatabaseExecutor) {
  return executor`
    select m.id, m.tenant_id, m.conversation_id, m.run_id, m.role, m.content,
           m.content_type, m.created_at
      from q_runtime.conversation_messages m`;
}

function selectEvent(executor: DatabaseExecutor) {
  return executor`
    select e.id, e.tenant_id, e.run_id, e.sequence, e.event_type,
           e.visible_stage, e.payload, e.occurred_at
      from q_runtime.run_events e`;
}

const EVENTS_PAGE_DEFAULT = 200;
const EVENTS_PAGE_MAX = 1000;

export function createPostgresQRuntimeRepositories(): QRuntimeRepositories {
  const findRunForActor: QRuntimeRepositories["runs"]["findForActor"] = async (
    executor,
    tenantId,
    userId,
    runId,
  ) => {
    const rows = await executor`
        ${selectRun(executor)}
         where r.id = ${runId}
           and r.tenant_id = ${tenantId}
           and r.actor_user_id = ${userId}`;
    return rows.length === 0 ? null : toRun(rows[0]);
  };

  const findConversationForOwner: QRuntimeRepositories["conversations"]["findForOwner"] =
    async (executor, tenantId, userId, conversationId) => {
      const rows = await executor`
        ${selectConversation(executor)}
         where c.id = ${conversationId}
           and c.tenant_id = ${tenantId}
           and c.user_id = ${userId}`;
      return rows.length === 0 ? null : toConversation(rows[0]);
    };

  const findMessageById: QRuntimeRepositories["messages"]["findById"] = async (
    executor,
    tenantId,
    messageId,
  ) => {
    const rows = await executor`
        ${selectMessage(executor)}
         where m.id = ${messageId} and m.tenant_id = ${tenantId}`;
    return rows.length === 0 ? null : toMessage(rows[0]);
  };

  return {
    conversations: {
      insert: async (tx, input) => {
        const rows = await tx.sql`
          insert into q_runtime.conversations
            (tenant_id, user_id, organisation_id, context_type, subject_refs)
          values (${input.tenantId}, ${input.userId}, ${input.organisationId},
                  ${input.organisationId === null ? "PERSONAL" : "ORGANISATION"},
                  ${JSON.stringify(input.subjects)}::text::jsonb)
          returning id`;
        const { id } = IdRow.parse(rows[0]);
        const created = await findConversationForOwner(
          tx.sql,
          input.tenantId,
          input.userId,
          QConversationIdSchema.parse(id),
        );
        if (created === null) {
          throw new Error("q conversation insert did not return a row");
        }
        return created;
      },
      findForOwner: findConversationForOwner,
      findOwnership: async (executor, conversationId) => {
        const rows = await executor`
          select c.tenant_id, c.user_id
            from q_runtime.conversations c
           where c.id = ${conversationId}`;
        if (rows.length === 0) {
          return null;
        }
        const r = z
          .object({ tenant_id: TenantIdSchema, user_id: UserIdSchema })
          .parse(rows[0]);
        return { tenantId: r.tenant_id, userId: r.user_id };
      },
    },

    runs: {
      insert: async (tx, input) => {
        const rows = await tx.sql`
          insert into q_runtime.runs
            (tenant_id, actor_user_id, actor_organisation_id, conversation_id,
             objective, capability, consequence_class, subject_refs, correlation_id)
          values (${input.tenantId}, ${input.actorUserId}, ${input.actorOrganisationId},
                  ${input.conversationId}, ${input.objective}, ${input.capability},
                  ${input.consequenceClass}, ${JSON.stringify(input.subjects)}::text::jsonb,
                  ${input.correlationId})
          returning id`;
        const { id } = IdRow.parse(rows[0]);
        const created = await findRunForActor(
          tx.sql,
          input.tenantId,
          input.actorUserId,
          QRunIdSchema.parse(id),
        );
        if (created === null) {
          throw new Error("q run insert did not return a row");
        }
        return created;
      },
      findForActor: findRunForActor,
      findOwnership: async (executor, runId) => {
        const rows = await executor`
          select r.tenant_id, r.actor_user_id
            from q_runtime.runs r
           where r.id = ${runId}`;
        if (rows.length === 0) {
          return null;
        }
        const r = z
          .object({ tenant_id: TenantIdSchema, actor_user_id: UserIdSchema })
          .parse(rows[0]);
        return { tenantId: r.tenant_id, actorUserId: r.actor_user_id };
      },
      lockForActor: async (tx, tenantId, userId, runId) => {
        const rows = await tx.sql`
          ${selectRun(tx.sql)}
           where r.id = ${runId}
             and r.tenant_id = ${tenantId}
             and r.actor_user_id = ${userId}
           for update`;
        return rows.length === 0 ? null : toRun(rows[0]);
      },
      transition: async (tx, input) => {
        const rows = await tx.sql`
          update q_runtime.runs r
             set status = ${input.status},
                 started_at = coalesce(${input.startedAt ?? null}::timestamptz, r.started_at),
                 completed_at = ${input.completedAt ?? null}::timestamptz,
                 failure_code = ${input.failureCode ?? null},
                 orchestration_version = coalesce(${input.orchestrationVersion ?? null}, r.orchestration_version),
                 model_policy_version = coalesce(${input.modelPolicyVersion ?? null}, r.model_policy_version),
                 prompt_bundle_version = coalesce(${input.promptBundleVersion ?? null}, r.prompt_bundle_version),
                 version = r.version + 1
           where r.id = ${input.runId}
             and r.tenant_id = ${input.tenantId}
             and r.version = ${input.expectedVersion}
          returning r.actor_user_id`;
        if (rows.length === 0) {
          return null;
        }
        const { actor_user_id } = z
          .object({ actor_user_id: UserIdSchema })
          .parse(rows[0]);
        return findRunForActor(
          tx.sql,
          input.tenantId,
          actor_user_id,
          input.runId,
        );
      },
      allocateEventSequence: async (tx, tenantId, runId) => {
        // The UPDATE takes the row lock; a second allocator for the same run
        // waits and then reads the incremented value. Consecutive by
        // construction.
        const rows = await tx.sql`
          update q_runtime.runs r
             set last_event_sequence = r.last_event_sequence + 1
           where r.id = ${runId} and r.tenant_id = ${tenantId}
          returning r.last_event_sequence`;
        if (rows.length === 0) {
          return null;
        }
        return z
          .object({ last_event_sequence: z.number().int().min(1) })
          .parse(rows[0]).last_event_sequence;
      },
    },

    messages: {
      insert: async (tx, input) => {
        const rows = await tx.sql`
          insert into q_runtime.conversation_messages
            (id, tenant_id, conversation_id, run_id, role, content)
          values (coalesce(${input.id ?? null}::uuid, gen_random_uuid()),
                  ${input.tenantId}, ${input.conversationId}, ${input.runId},
                  ${input.role}, ${input.content})
          returning id`;
        const { id } = IdRow.parse(rows[0]);
        const created = await findMessageById(
          tx.sql,
          input.tenantId,
          QMessageIdSchema.parse(id),
        );
        if (created === null) {
          throw new Error("q message insert did not return a row");
        }
        return created;
      },
      findById: findMessageById,
      listForRun: async (executor, tenantId, runId, limit) => {
        const rows = await executor`
          ${selectMessage(executor)}
           where m.run_id = ${runId} and m.tenant_id = ${tenantId}
           order by m.created_at asc, m.id asc
           limit ${limit}`;
        return rows.map(toMessage);
      },
    },

    runEvents: {
      append: async (tx, input) => {
        const rows = await tx.sql`
          insert into q_runtime.run_events
            (tenant_id, run_id, sequence, event_type, visible_stage, payload)
          values (${input.tenantId}, ${input.runId}, ${input.sequence},
                  ${input.eventType}, ${input.visibleStage},
                  ${JSON.stringify(input.payload)}::text::jsonb)
          returning id, tenant_id, run_id, sequence, event_type, visible_stage,
                    payload, occurred_at`;
        // Wake live readers (CQ-Q-009). Postgres delivers the notice on
        // commit, so a rolled-back event is never announced. Identifiers
        // only: the reader re-reads the row it is told about.
        await tx.sql`select pg_notify(${Q_RUN_EVENTS_CHANNEL}, ${JSON.stringify(
          { runId: input.runId, sequence: input.sequence },
        )})`;
        return toEvent(rows[0]);
      },
      listForRun: async (executor, tenantId, runId, page = {}) => {
        const after = page.afterSequence ?? 0;
        const limit = Math.min(
          page.limit ?? EVENTS_PAGE_DEFAULT,
          EVENTS_PAGE_MAX,
        );
        const rows = await executor`
          ${selectEvent(executor)}
           where e.run_id = ${runId}
             and e.tenant_id = ${tenantId}
             and e.sequence > ${after}
           order by e.sequence asc
           limit ${limit}`;
        return rows.map(toEvent);
      },
      latestVisibleStage: async (executor, tenantId, runId) => {
        const rows = await executor`
          select e.visible_stage
            from q_runtime.run_events e
           where e.run_id = ${runId}
             and e.tenant_id = ${tenantId}
             and e.visible_stage is not null
           order by e.sequence desc
           limit 1`;
        if (rows.length === 0) {
          return null;
        }
        return z.object({ visible_stage: QVisibleStageSchema }).parse(rows[0])
          .visible_stage;
      },
    },

    runCreationRequests: {
      lock: async (tx, userId, idempotencyKeyHash) => {
        await tx.sql`
          select pg_advisory_xact_lock(
            hashtext(${userId}::text || ':q.run.create'),
            hashtext(${idempotencyKeyHash}))`;
      },
      find: async (tx, userId, idempotencyKeyHash) => {
        const rows = await tx.sql`
          select r.request_hash, r.run_id, r.tenant_id
            from q_runtime.run_creation_requests r
           where r.user_id = ${userId}
             and r.idempotency_key_hash = ${idempotencyKeyHash}`;
        if (rows.length === 0) {
          return null;
        }
        const r = z
          .object({
            request_hash: z.string(),
            run_id: QRunIdSchema,
            tenant_id: TenantIdSchema,
          })
          .parse(rows[0]);
        return {
          requestHash: r.request_hash,
          runId: r.run_id,
          tenantId: r.tenant_id,
        };
      },
      record: async (tx, input) => {
        await tx.sql`
          insert into q_runtime.run_creation_requests
            (user_id, idempotency_key_hash, request_hash, run_id, tenant_id)
          values (${input.userId}, ${input.idempotencyKeyHash}, ${input.requestHash},
                  ${input.runId}, ${input.tenantId})`;
      },
    },

    messageCreationRequests: {
      lock: async (tx, userId, runId, idempotencyKeyHash) => {
        await tx.sql`
          select pg_advisory_xact_lock(
            hashtext(${userId}::text || ':' || ${runId}::text || ':q.message'),
            hashtext(${idempotencyKeyHash}))`;
      },
      find: async (tx, userId, runId, idempotencyKeyHash) => {
        const rows = await tx.sql`
          select r.request_hash, r.message_id, r.tenant_id
            from q_runtime.message_creation_requests r
           where r.user_id = ${userId}
             and r.run_id = ${runId}
             and r.idempotency_key_hash = ${idempotencyKeyHash}`;
        if (rows.length === 0) {
          return null;
        }
        const r = z
          .object({
            request_hash: z.string(),
            message_id: QMessageIdSchema,
            tenant_id: TenantIdSchema,
          })
          .parse(rows[0]);
        return {
          requestHash: r.request_hash,
          messageId: r.message_id,
          tenantId: r.tenant_id,
        };
      },
      record: async (tx, input) => {
        await tx.sql`
          insert into q_runtime.message_creation_requests
            (user_id, run_id, idempotency_key_hash, request_hash, message_id, tenant_id)
          values (${input.userId}, ${input.runId}, ${input.idempotencyKeyHash},
                  ${input.requestHash}, ${input.messageId}, ${input.tenantId})`;
      },
    },
  };
}

export type { TransactionContext };
