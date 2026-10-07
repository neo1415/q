import type { QWorkPagePort } from "@capital-q/app-actions";
import {
  auditActorFromContext,
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  createAuditEventId,
  occurredNow,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import type {
  DatabaseExecutor,
  TransactionManager,
} from "@capital-q/database";

const DELEGATION_ENABLED = AuditActionTypeSchema.parse(
  "q.delegation.enabled",
);
const DELEGATION_REVOKED = AuditActionTypeSchema.parse(
  "q.delegation.revoked",
);
const DELEGATION_RESOURCE = AuditResourceTypeSchema.parse(
  "instruction_delegation",
);

/**
 * WORK-58: the Work page's own writes, the person's own rows only (every
 * predicate is their user and tenant). Pausing clears the next firing, as
 * stopping does; resuming makes it due at once and the instruction sweep's
 * claim restores its cadence. A budget pause is not resumed here: its
 * approval card does that (ADR 0043 S5). The same rules as q-api's
 * instruction store, which Q's `stop_q_work` tool (mode PAUSE or RESUME) goes through.
 */
export function createQWorkPagePort(
  sql: DatabaseExecutor,
  /**
   * Scoped delegation: switching it on or off is written with its audit
   * record in one transaction. Absent, the switch is not offered.
   */
  audited?: {
    readonly transactions: TransactionManager;
    readonly audit: MaterialActionAuditWriter;
  },
): QWorkPagePort {
  return {
    ...(audited === undefined
      ? {}
      : {
          /**
           * The person's own live instruction only (every predicate theirs).
           * On: a new delegation unless one is live. Off: the live one is
           * revoked at once. Each change is audited as the person's act.
           */
          setDelegation: async (actor, id, enabled) =>
            audited.transactions.run(async (tx) => {
              const rows = enabled
                ? await tx.sql<{ id: string }[]>`
                    insert into q_runtime.instruction_delegations
                      (tenant_id, user_id, instruction_id, scope)
                    select i.tenant_id, i.user_id, i.id, 'RELATIONSHIP_ROUTINE'
                      from q_runtime.standing_instructions i
                     where i.id = ${id} and i.user_id = ${actor.userId}
                       and i.tenant_id = ${actor.tenantId}
                       and i.status in ('ACTIVE', 'PAUSED')
                       and not exists (
                         select 1 from q_runtime.instruction_delegations d
                          where d.instruction_id = i.id and d.revoked_at is null)
                    returning id`
                : await tx.sql<{ id: string }[]>`
                    update q_runtime.instruction_delegations
                       set revoked_at = clock_timestamp()
                     where instruction_id = ${id} and user_id = ${actor.userId}
                       and tenant_id = ${actor.tenantId} and revoked_at is null
                    returning id`;
              const row = rows[0];
              if (row === undefined) return false;
              await audited.audit.record(tx, {
                ...auditActorFromContext(actor),
                auditEventId: createAuditEventId(),
                actionType: enabled ? DELEGATION_ENABLED : DELEGATION_REVOKED,
                resourceType: DELEGATION_RESOURCE,
                resourceId: row.id,
                occurredAt: occurredNow(),
                outcome: "SUCCEEDED",
                metadata: {
                  instructionId: id,
                  scope: "RELATIONSHIP_ROUTINE",
                },
              });
              return true;
            }),
        }),
    pause: async (actor, id) =>
      (
        await sql<{ id: string }[]>`
          update q_runtime.standing_instructions
             set status = 'PAUSED', pause_reason = 'PAUSED_BY_YOU',
                 next_fire_at = null, updated_at = clock_timestamp()
           where id = ${id} and user_id = ${actor.userId}
             and tenant_id = ${actor.tenantId} and status = 'ACTIVE'
          returning id`
      ).length > 0,
    resume: async (actor, id) =>
      (
        await sql<{ id: string }[]>`
          update q_runtime.standing_instructions
             set status = 'ACTIVE', pause_reason = null,
                 next_fire_at = clock_timestamp(), updated_at = clock_timestamp()
           where id = ${id} and user_id = ${actor.userId}
             and tenant_id = ${actor.tenantId} and status = 'PAUSED'
             and pause_reason = 'PAUSED_BY_YOU'
             and (expires_at is null or expires_at > clock_timestamp())
          returning id`
      ).length > 0,
    dismiss: async (actor, key) => {
      await sql`
        insert into q_runtime.work_suggestion_dismissals (tenant_id, user_id, suggestion_key)
        values (${actor.tenantId}, ${actor.userId}, ${key})
        on conflict (user_id, suggestion_key) do nothing`;
    },
  };
}
