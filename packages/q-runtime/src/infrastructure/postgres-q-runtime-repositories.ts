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
  QScreenContextSchema,
  QViewingMomentSchema,
  QVisibleStageSchema,
  UtcTimestampSchema,
  parseQResultBlocks,
} from "@capital-q/contracts";
import {
  cachedInRun,
  type DatabaseExecutor,
  type TransactionContext,
} from "@capital-q/database";
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
import {
  UTTERANCE_REF_PATTERN,
  withoutSupersededUtterances,
} from "../domain/utterances.js";

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
  title: z.string().nullable(),
  summary: z.string().nullable(),
  summary_through: Timestamp.nullable(),
  last_message_at: Timestamp.nullable(),
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
    title: r.title,
    summary: r.summary,
    summaryThrough: r.summary_through,
    lastMessageAt: r.last_message_at,
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
  viewing: QViewingMomentSchema.nullable(),
  // Absent from rows read before the column existed in a query's list.
  screen: QScreenContextSchema.nullable().default(null),
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
    viewing: r.viewing,
    screen: r.screen,
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
  /**
   * Re-validated on read, not trusted because it is in our own table
   * (CQ-Q-BLOCKS-HISTORY-001). A row written by an older build, or by
   * anything that ever bypassed the write path, must not become a
   * structured object a client renders and acts on. A payload the public
   * contract refuses is dropped and the answer is served as prose, which
   * is the safe direction to fail in.
   */
  result_blocks: z
    .unknown()
    .nullable()
    .transform((value) =>
      // RECOVERY E-07: a stored answer keeps its valid blocks when one is
      // invalid (e.g. written before a contract change), never loses all.
      value === null ? undefined : parseQResultBlocks(value).blocks,
    ),
  provider_message_ref: z.string().nullable(),
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
    ...(r.result_blocks === undefined ? {} : { blocks: r.result_blocks }),
    ...(r.provider_message_ref === null
      ? {}
      : { utteranceRef: r.provider_message_ref }),
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
           c.subject_refs, c.title, c.summary, c.summary_through,
           c.last_message_at, c.created_at, c.archived_at
      from q_runtime.conversations c`;
}

function selectRun(executor: DatabaseExecutor) {
  return executor`
    select r.id, r.tenant_id, r.actor_user_id, r.actor_organisation_id,
           r.conversation_id, r.objective, r.capability, r.consequence_class,
           r.status, r.subject_refs, r.viewing, r.screen, r.orchestration_version,
           r.prompt_bundle_version, r.model_policy_version, r.correlation_id,
           r.created_at, r.started_at, r.completed_at, r.failure_code,
           r.version, r.last_event_sequence
      from q_runtime.runs r`;
}

function selectMessage(executor: DatabaseExecutor) {
  return executor`
    select m.id, m.tenant_id, m.conversation_id, m.run_id, m.role, m.content,
           m.content_type, m.result_blocks, m.provider_message_ref,
           m.created_at
      from q_runtime.conversation_messages m`;
}

/**
 * A run whose spoken words a later message of the same utterance extended
 * (founder fixture failure #9; domain/utterances.ts). Applied in SQL, before
 * the limit, so fourteen growing fragments of one dictation are one turn
 * and do not crowd the rest of the conversation out of the window (live
 * 2026-10-01). Nothing is deleted.
 */
function notSupersededRun(executor: DatabaseExecutor) {
  return executor`
    not exists (
      select 1
        from q_runtime.conversation_messages u1
        join q_runtime.conversation_messages u2
          on u2.tenant_id = u1.tenant_id
         and u2.conversation_id = u1.conversation_id
         and u2.provider_message_ref = u1.provider_message_ref
         and u2.role = 'USER'
         and (u2.created_at, u2.id) > (u1.created_at, u1.id)
       where u1.run_id = m.run_id
         and u1.tenant_id = m.tenant_id
         and u1.role = 'USER'
         and u1.provider_message_ref is not null)`;
}

function selectEvent(executor: DatabaseExecutor) {
  return executor`
    select e.id, e.tenant_id, e.run_id, e.sequence, e.event_type,
           e.visible_stage, e.payload, e.occurred_at
      from q_runtime.run_events e`;
}

const EVENTS_PAGE_DEFAULT = 200;
const EVENTS_PAGE_MAX = 1000;

/**
 * R5: the conversation history a run reads, fetched once per run at the
 * largest window any reader takes; each reader gets its own newest slice.
 */
const RECENT_OF_RUN_WINDOW = 64;
const RECENT_OF_RUN_TABLES = [
  "q_runtime.conversation_messages",
  "q_runtime.conversation_message_marks",
  // Superseded runs' lines are left out of the history read.
  "q_runtime.runs",
] as const;

export function createPostgresQRuntimeRepositories(
  options: {
    /**
     * R5: reads made on exactly this executor (the request client, never a
     * transaction) may be served from the run read cache.
     */
    readonly runCacheRoot?: DatabaseExecutor | undefined;
  } = {},
): QRuntimeRepositories {
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
      setSubjects: async (tx, tenantId, conversationId, subjects) => {
        await tx.sql`
          update q_runtime.conversations
             set subject_refs = ${JSON.stringify(subjects)}::text::jsonb
           where id = ${conversationId} and tenant_id = ${tenantId}`;
      },
      listForOwner: async (executor, tenantId, userId, page) => {
        const before = page.before ?? null;
        const rows = await executor`
          ${selectConversation(executor)}
           where c.tenant_id = ${tenantId}
             and c.user_id = ${userId}
             and c.archived_at is null
             and (${before}::timestamptz is null
                  or coalesce(c.last_message_at, c.created_at) < ${before}::timestamptz)
           order by coalesce(c.last_message_at, c.created_at) desc, c.id desc
           limit ${page.limit}`;
        return rows.map(toConversation);
      },
      setDigest: async (tx, tenantId, conversationId, digest) => {
        await tx.sql`
          update q_runtime.conversations
             set title = coalesce(${digest.title}, title),
                 summary = ${digest.summary},
                 summary_through = ${digest.summaryThrough}
           where id = ${conversationId} and tenant_id = ${tenantId}`;
      },
      archiveForOwner: async (tx, tenantId, userId, conversationId) => {
        await tx.sql`
          update q_runtime.conversations
             set archived_at = coalesce(archived_at, now())
           where id = ${conversationId}
             and tenant_id = ${tenantId}
             and user_id = ${userId}`;
        return findConversationForOwner(
          tx.sql,
          tenantId,
          userId,
          conversationId,
        );
      },
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
             objective, capability, consequence_class, subject_refs, viewing,
             screen, correlation_id)
          values (${input.tenantId}, ${input.actorUserId}, ${input.actorOrganisationId},
                  ${input.conversationId}, ${input.objective}, ${input.capability},
                  ${input.consequenceClass}, ${JSON.stringify(input.subjects)}::text::jsonb,
                  ${input.viewing == null ? null : JSON.stringify(input.viewing)}::text::jsonb,
                  ${input.screen == null ? null : JSON.stringify(input.screen)}::text::jsonb,
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
      findLatestForConversation: async (
        executor,
        tenantId,
        userId,
        conversationId,
      ) => {
        const rows = await executor`
          ${selectRun(executor)}
           where r.tenant_id = ${tenantId}
             and r.actor_user_id = ${userId}
             and r.conversation_id = ${conversationId}
           order by r.created_at desc, r.id desc
           limit 1`;
        return rows.length === 0 ? null : toRun(rows[0]);
      },
      listStale: async (executor, input) => {
        // A run's last sign of life is its newest durable event, else its
        // start, else its creation. A paused run waits on a person and no
        // engine; an in-flight one is held by whichever process runs it.
        // G-D24: a run whose engine heartbeats is judged by the heartbeat
        // alone, over the short engine window: a live engine touches it
        // every few seconds however quiet the run is, so a heartbeat that
        // stopped means the process is gone. A run no heartbeating engine
        // ever held keeps the event-silence rule below.
        const engineSilentSince =
          input.engineSilentSince ?? input.inFlightSilentSince;
        const rows = await executor`
          ${selectRun(executor)}
           where r.status not in ('COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED')
             and (
               (r.engine_heartbeat_at is not null
                and r.status not in ('AWAITING_INPUT', 'AWAITING_APPROVAL')
                and r.engine_heartbeat_at < ${engineSilentSince}::timestamptz)
               or
             ((r.engine_heartbeat_at is null or r.status in ('AWAITING_INPUT', 'AWAITING_APPROVAL'))
             and coalesce(
                   (select max(e.occurred_at)
                      from q_runtime.run_events e
                     where e.tenant_id = r.tenant_id
                       and e.run_id = r.id),
                   r.started_at,
                   r.created_at
                 ) < case
                       when r.status in ('AWAITING_INPUT', 'AWAITING_APPROVAL')
                         then ${input.pausedSilentSince}::timestamptz
                       else ${input.inFlightSilentSince}::timestamptz
                     end))
           order by r.created_at
           limit ${input.limit}`;
        return rows.map(toRun);
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
          returning r.id, r.tenant_id, r.actor_user_id, r.actor_organisation_id,
                    r.conversation_id, r.objective, r.capability, r.consequence_class,
                    r.status, r.subject_refs, r.viewing, r.screen, r.orchestration_version,
                    r.prompt_bundle_version, r.model_policy_version, r.correlation_id,
                    r.created_at, r.started_at, r.completed_at, r.failure_code,
                    r.version, r.last_event_sequence`;
        // SUB-SECOND: the moved row comes back from the UPDATE itself (the
        // same columns selectRun reads), not from a second SELECT.
        return rows.length === 0 ? null : toRun(rows[0]);
      },
      moveChain: async (executor, input) => {
        // S2: the whole lifecycle move and its event in ONE statement (it
        // was BEGIN, lock, update, latest-stage read, event insert, COMMIT).
        // The UPDATE takes the row lock and its predicate (actor, tenant,
        // status in the legal-from set) is re-checked under that lock, so a
        // concurrent mover or a replay makes it match nothing. The event
        // takes the next sequence from the same UPDATE, exactly as
        // appendNext does, and is notified the same way. An event meant
        // only when the stage changes compares against the latest visible
        // stage as of this statement, which the lock makes the latest.
        const event = input.event;
        const stage = event?.visibleStage ?? null;
        const rows = await executor`
          with wants as (
            select (${event !== undefined}::boolean
                    and (not ${event?.onlyIfStageDiffers ?? false}::boolean
                         or (select e.visible_stage
                               from q_runtime.run_events e
                              where e.run_id = ${input.runId}
                                and e.tenant_id = ${input.tenantId}
                                and e.visible_stage is not null
                              order by e.sequence desc
                              limit 1) is distinct from ${stage}::text)
                   ) as appended
          ),
          moved as (
            update q_runtime.runs r
               set status = ${input.status},
                   started_at = coalesce(${input.startedAt ?? null}::timestamptz, r.started_at),
                   completed_at = ${input.completedAt ?? null}::timestamptz,
                   failure_code = ${input.failureCode ?? null},
                   orchestration_version = coalesce(${input.orchestrationVersion ?? null}, r.orchestration_version),
                   model_policy_version = coalesce(${input.modelPolicyVersion ?? null}, r.model_policy_version),
                   prompt_bundle_version = coalesce(${input.promptBundleVersion ?? null}, r.prompt_bundle_version),
                   version = r.version + ${input.steps},
                   last_event_sequence = r.last_event_sequence
                     + case when (select appended from wants) then 1 else 0 end
             where r.id = ${input.runId}
               and r.tenant_id = ${input.tenantId}
               and r.actor_user_id = ${input.actorUserId}
               and r.status = any(${[...input.allowedFrom]}::text[])
            returning r.id, r.tenant_id, r.actor_user_id, r.actor_organisation_id,
                      r.conversation_id, r.objective, r.capability, r.consequence_class,
                      r.status, r.subject_refs, r.viewing, r.screen, r.orchestration_version,
                      r.prompt_bundle_version, r.model_policy_version, r.correlation_id,
                      r.created_at, r.started_at, r.completed_at, r.failure_code,
                      r.version, r.last_event_sequence
          ),
          inserted as (
            insert into q_runtime.run_events
              (tenant_id, run_id, sequence, event_type, visible_stage, payload)
            select m.tenant_id, m.id, m.last_event_sequence,
                   ${event?.eventType ?? null}, ${stage},
                   ${JSON.stringify(event?.payload ?? null)}::text::jsonb
              from moved m
             where (select appended from wants)
            returning run_id, sequence
          )
          select m.*,
                 (select count(pg_notify(${Q_RUN_EVENTS_CHANNEL},
                           json_build_object('runId', i.run_id, 'sequence', i.sequence)::text))
                    from inserted i) as notified
            from moved m`;
        return rows.length === 0 ? null : toRun(rows[0]);
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
        // Parsed before it is written, never after. The public contract
        // is the allowlist: anything it cannot express -- internal state,
        // a provider payload, a private evidence reference -- cannot
        // reach this column at all.
        // Only a person's spoken turn names an utterance, and only an id
        // of the reserved column's own shape is written.
        const utteranceRef =
          input.role === "USER" &&
          input.utteranceRef !== undefined &&
          UTTERANCE_REF_PATTERN.test(input.utteranceRef)
            ? input.utteranceRef
            : null;
        const blocks =
          input.blocks === undefined || input.blocks.length === 0
            ? null
            : (() => {
                const valid = parseQResultBlocks(input.blocks).blocks;
                return valid.length === 0 ? null : valid;
              })();
        // S2: the insert, the row as stored and the conversation's own
        // clock in ONE statement (they were an insert, a re-select and an
        // update). The conversation clock moves to the stored row's time,
        // exactly as before.
        const rows = await tx.sql`
          with inserted as (
            insert into q_runtime.conversation_messages
              (id, tenant_id, conversation_id, run_id, role, content, result_blocks,
               provider_message_ref)
            values (coalesce(${input.id ?? null}::uuid, gen_random_uuid()),
                    ${input.tenantId}, ${input.conversationId}, ${input.runId},
                    ${input.role}, ${input.content},
                    ${blocks === null ? null : JSON.stringify(blocks)}::text::jsonb,
                    ${utteranceRef})
            returning id, tenant_id, conversation_id, run_id, role, content,
                      content_type, result_blocks, provider_message_ref, created_at
          ),
          clocked as (
            update q_runtime.conversations c
               set last_message_at = greatest(coalesce(c.last_message_at, c.created_at),
                                              (select i.created_at from inserted i))
             where c.id = ${input.conversationId} and c.tenant_id = ${input.tenantId}
            returning c.id
          )
          select i.*, (select count(*) from clocked) as clocked
            from inserted i`;
        const first = rows[0];
        if (first === undefined) {
          throw new Error("q message insert did not return a row");
        }
        return toMessage(first);
      },
      findById: findMessageById,
      mark: async (tx, input) => {
        await tx.sql`
          insert into q_runtime.conversation_message_marks
            (tenant_id, conversation_id, message_id, mark, marked_by, run_id)
          select m.tenant_id, m.conversation_id, m.id, ${input.mark},
                 ${input.markedBy}, ${input.runId ?? null}::uuid
            from q_runtime.conversation_messages m
           where m.tenant_id = ${input.tenantId}
             and m.conversation_id = ${input.conversationId}
             and m.id = any(${input.messageIds}::uuid[])
          on conflict (message_id, mark) do nothing`;
      },
      listForRun: async (executor, tenantId, runId, limit) => {
        const rows = await executor`
          ${selectMessage(executor)}
           where m.run_id = ${runId} and m.tenant_id = ${tenantId}
           order by m.created_at asc, m.id asc
           limit ${limit}`;
        return rows.map(toMessage);
      },
      listRecentForConversation: async (
        executor,
        tenantId,
        conversationId,
        limit,
        options = {},
      ) => {
        const readBack = options.readBack === true;
        const rows = await executor`
          ${selectMessage(executor)}
           where m.tenant_id = ${tenantId}
             and m.conversation_id = ${conversationId}
             and (${!readBack} or not exists (
               select 1 from q_runtime.conversation_message_marks k
                where k.message_id = m.id and k.tenant_id = m.tenant_id))
             and ${notSupersededRun(executor)}
           order by m.created_at desc, m.id desc
           limit ${limit}`;
        return withoutSupersededUtterances(rows.map(toMessage).reverse());
      },
      listRecentForConversationOfRun: async (
        executor,
        tenantId,
        runId,
        limit,
      ) => {
        // The newest `limit` of the conversation, then put back in the
        // order they were said. Taking the OLDEST would hand a long
        // conversation its opening and hide the part being talked about.
        const newestFirst = async (
          window: number,
        ): Promise<readonly unknown[]> =>
          await executor`
          ${selectMessage(executor)}
           where m.tenant_id = ${tenantId}
             and m.conversation_id = (
               select c.conversation_id
                 from q_runtime.conversation_messages c
                where c.run_id = ${runId} and c.tenant_id = ${tenantId}
                limit 1)
             -- A marked line is not read back (20261110030000): speech
             -- meant for someone else, or a line the person hid. This
             -- run's own message is read before any mark exists for it.
             and not exists (
               select 1 from q_runtime.conversation_message_marks k
                where k.message_id = m.id and k.tenant_id = m.tenant_id)
             and ${notSupersededRun(executor)}
           order by m.created_at desc, m.id desc
           limit ${window}`;
        // R5: one read per run at the widest window; a narrower reader
        // takes the newest `limit` of it, the same rows its own query
        // would have returned (same order, same predicates).
        const rows =
          options.runCacheRoot !== undefined &&
          executor === options.runCacheRoot &&
          limit <= RECENT_OF_RUN_WINDOW
            ? (
                await cachedInRun(
                  {
                    aggregate: "conversation-recent-of-run",
                    tables: RECENT_OF_RUN_TABLES,
                    actor: tenantId,
                    fingerprint: runId,
                  },
                  () => newestFirst(RECENT_OF_RUN_WINDOW),
                )
              ).slice(0, limit)
            : await newestFirst(limit);
        return withoutSupersededUtterances(rows.map(toMessage).reverse());
      },
    },

    runEvents: {
      append: async (tx, input) => {
        // Wake live readers (CQ-Q-009) in the same statement as the insert
        // (SUB-SECOND: one round trip, not two). Postgres delivers the
        // notice on commit, so a rolled-back event is never announced.
        // Identifiers only: the reader re-reads the row it is told about.
        // pg_notify sits in the select list over the inserted row, so it
        // runs exactly once, for exactly that row.
        const rows = await tx.sql`
          with inserted as (
            insert into q_runtime.run_events
              (tenant_id, run_id, sequence, event_type, visible_stage, payload)
            values (${input.tenantId}, ${input.runId}, ${input.sequence},
                    ${input.eventType}, ${input.visibleStage},
                    ${JSON.stringify(input.payload)}::text::jsonb)
            returning id, tenant_id, run_id, sequence, event_type, visible_stage,
                      payload, occurred_at
          )
          select i.*,
                 pg_notify(${Q_RUN_EVENTS_CHANNEL},
                           json_build_object('runId', i.run_id, 'sequence', i.sequence)::text)
                   as notified
            from inserted i`;
        return toEvent(rows[0]);
      },
      appendNext: async (tx, input) => {
        // R5: allocate and append in one statement. The UPDATE takes the
        // run's row lock first, so a concurrent appender waits and then
        // gets the next number: consecutive, as allocateEventSequence +
        // append were, and the unique (run_id, sequence) constraint still
        // arbitrates. No run, no row: nothing is inserted.
        const rows = await tx.sql`
          with allocated as (
            update q_runtime.runs r
               set last_event_sequence = r.last_event_sequence + 1
             where r.id = ${input.runId} and r.tenant_id = ${input.tenantId}
            returning r.last_event_sequence
          ),
          inserted as (
            insert into q_runtime.run_events
              (tenant_id, run_id, sequence, event_type, visible_stage, payload)
            select ${input.tenantId}, ${input.runId}, a.last_event_sequence,
                   ${input.eventType}, ${input.visibleStage},
                   ${JSON.stringify(input.payload)}::text::jsonb
              from allocated a
            returning id, tenant_id, run_id, sequence, event_type, visible_stage,
                      payload, occurred_at
          )
          select i.*,
                 pg_notify(${Q_RUN_EVENTS_CHANNEL},
                           json_build_object('runId', i.run_id, 'sequence', i.sequence)::text)
                   as notified
            from inserted i`;
        return rows.length === 0 ? null : toEvent(rows[0]);
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
