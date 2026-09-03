import { z } from "zod";

import { CompanyIdSchema } from "@capital-q/companies";
import {
  CapitalObjectiveStatusSchema,
  CapitalObjectiveTypeSchema,
  UtcTimestampSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { TenantIdSchema, UserIdSchema } from "@capital-q/security";

import {
  CapitalObjectiveIdSchema,
  toCapitalObjectiveSnapshot,
  type CapitalObjective,
} from "../contracts/index.js";
import { serializeHistoryPayload } from "../domain/history.js";
import type {
  CapitalObjectiveCreationRecord,
  CapitalObjectiveCreationRequestStore,
  CapitalObjectiveHistoryWriter,
  CapitalObjectiveQueryPort,
  CapitalObjectiveRepository,
} from "../application/ports.js";

/**
 * PostgreSQL adapters for the capital ports. Parameterised SQL on the
 * executor or transaction the caller supplies. Money is bound and read as
 * text so no amount ever passes through a JavaScript number; the target
 * close date is bound as text and read as text so a calendar date never
 * crosses a timezone. This module is never handed to Q.
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

/** Microsecond-precision text, exactly as the list cursor must reproduce it. */
const CURSOR_TIME_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

const Row = z.object({
  id: CapitalObjectiveIdSchema,
  tenant_id: TenantIdSchema,
  company_id: CompanyIdSchema,
  objective_type: CapitalObjectiveTypeSchema,
  status: CapitalObjectiveStatusSchema,
  target_amount: z.string(),
  currency_code: z.string(),
  target_stage: z.string().nullable(),
  instrument_code: z.string().nullable(),
  target_close_date: z.iso.date().nullable(),
  use_of_funds_summary: z.string().nullable(),
  started_at: Timestamp,
  closed_at: Timestamp.nullable(),
  created_by_user_id: UserIdSchema,
  version: z.number().int().min(1),
  created_at: UtcTimestampSchema,
  updated_at: Timestamp,
});

function toObjective(row: unknown): CapitalObjective {
  const r = Row.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    companyId: r.company_id,
    objectiveType: r.objective_type,
    status: r.status,
    target: { amount: r.target_amount, currency: r.currency_code },
    targetStage: r.target_stage,
    instrumentCode: r.instrument_code,
    targetCloseDate: r.target_close_date,
    useOfFundsSummary: r.use_of_funds_summary,
    startedAt: r.started_at,
    closedAt: r.closed_at,
    createdByUserId: r.created_by_user_id,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** created_at is selected as microsecond text so the cursor round-trips exactly. */
function objectiveSelect(executor: DatabaseExecutor) {
  return executor`
    select o.id, o.tenant_id, o.company_id, o.objective_type, o.status,
           o.target_amount::text as target_amount, o.currency_code, o.target_stage,
           o.instrument_code, o.target_close_date::text as target_close_date,
           o.use_of_funds_summary, o.started_at, o.closed_at, o.created_by_user_id, o.version,
           to_char(o.created_at at time zone 'UTC', ${CURSOR_TIME_FORMAT}) as created_at,
           o.updated_at
      from core.capital_objectives o`;
}

export function createPostgresCapitalObjectiveRepository(): CapitalObjectiveRepository {
  return {
    insert: async (tx, input) => {
      const rows = await tx.sql`
        insert into core.capital_objectives
          (tenant_id, company_id, objective_type, target_amount, currency_code, target_stage,
           instrument_code, target_close_date, use_of_funds_summary, created_by_user_id)
        values
          (${input.tenantId}, ${input.companyId}, ${input.objectiveType},
           ${input.target.amount}::text::numeric, ${input.target.currency}, ${input.targetStage},
           ${input.instrumentCode}, ${input.targetCloseDate}::text::date, ${input.useOfFundsSummary},
           ${input.createdByUserId})
        returning id`;
      const inserted = z
        .object({ id: CapitalObjectiveIdSchema })
        .parse(rows[0]);
      const created = await tx.sql`
        ${objectiveSelect(tx.sql)}
         where o.id = ${inserted.id} and o.tenant_id = ${input.tenantId}`;
      return toObjective(created[0]);
    },

    findById: async (executor, tenantId, companyId, id) => {
      const rows = await executor`
        ${objectiveSelect(executor)}
         where o.id = ${id}
           and o.tenant_id = ${tenantId}
           and o.company_id = ${companyId}`;
      return rows.length === 0 ? null : toObjective(rows[0]);
    },

    findActive: async (executor, tenantId, companyId) => {
      const rows = await executor`
        ${objectiveSelect(executor)}
         where o.company_id = ${companyId}
           and o.tenant_id = ${tenantId}
           and o.status = 'ACTIVE'`;
      return rows.length === 0 ? null : toObjective(rows[0]);
    },

    lockById: async (tx, tenantId, companyId, id) => {
      const rows = await tx.sql`
        ${objectiveSelect(tx.sql)}
         where o.id = ${id}
           and o.tenant_id = ${tenantId}
           and o.company_id = ${companyId}
           for update`;
      return rows.length === 0 ? null : toObjective(rows[0]);
    },

    lockCompany: async (tx, companyId) => {
      await tx.sql`
        select pg_advisory_xact_lock(hashtext('capital_objective.create'), hashtext(${companyId}::text))`;
    },

    list: async (executor, tenantId, companyId, page) => {
      const rows = await executor`
        ${objectiveSelect(executor)}
         where o.tenant_id = ${tenantId}
           and o.company_id = ${companyId}
           and (${page.after?.createdAt ?? null}::text is null
                or (o.created_at, o.id) < (${page.after?.createdAt ?? null}::text::timestamptz, ${page.after?.id ?? null}::uuid))
         order by o.created_at desc, o.id desc
         limit ${page.limit}`;
      return rows.map(toObjective);
    },

    recalibrate: async (tx, input) => {
      const c = input.changes;
      // Every column is written from a coalesced parameter so one statement
      // covers any subset of changes without dynamic SQL; a null sentinel
      // flag distinguishes "clear" from "unchanged".
      const updated = await tx.sql`
        update core.capital_objectives o
           set target_amount = case when ${c.target !== undefined} then ${c.target?.amount ?? null}::text::numeric else o.target_amount end,
               currency_code = case when ${c.target !== undefined} then ${c.target?.currency ?? null} else o.currency_code end,
               target_stage = case when ${c.targetStage !== undefined} then ${c.targetStage ?? null} else o.target_stage end,
               instrument_code = case when ${c.instrumentCode !== undefined} then ${c.instrumentCode ?? null} else o.instrument_code end,
               target_close_date = case when ${c.targetCloseDate !== undefined} then ${c.targetCloseDate ?? null}::text::date else o.target_close_date end,
               use_of_funds_summary = case when ${c.useOfFundsSummary !== undefined} then ${c.useOfFundsSummary ?? null} else o.use_of_funds_summary end,
               version = o.version + 1
         where o.id = ${input.capitalObjectiveId}
           and o.tenant_id = ${input.tenantId}
           and o.company_id = ${input.companyId}
           and o.status = 'ACTIVE'
           and o.version = ${input.expectedVersion}
        returning o.id`;
      if (updated.length === 0) {
        return null;
      }
      const rows = await tx.sql`
        ${objectiveSelect(tx.sql)}
         where o.id = ${input.capitalObjectiveId} and o.tenant_id = ${input.tenantId}`;
      return toObjective(rows[0]);
    },

    close: async (tx, input) => {
      const updated = await tx.sql`
        update core.capital_objectives o
           set status = ${input.status},
               closed_at = clock_timestamp(),
               version = o.version + 1
         where o.id = ${input.capitalObjectiveId}
           and o.tenant_id = ${input.tenantId}
           and o.company_id = ${input.companyId}
           and o.status = 'ACTIVE'
           and o.version = ${input.expectedVersion}
        returning o.id`;
      if (updated.length === 0) {
        return null;
      }
      const rows = await tx.sql`
        ${objectiveSelect(tx.sql)}
         where o.id = ${input.capitalObjectiveId} and o.tenant_id = ${input.tenantId}`;
      return toObjective(rows[0]);
    },
  };
}

export function createPostgresCapitalObjectiveHistoryWriter(): CapitalObjectiveHistoryWriter {
  return {
    append: async (tx, input) => {
      await tx.sql`
        insert into core.capital_objective_events
          (tenant_id, capital_objective_id, event_type, actor_type, actor_id, payload)
        values (${input.tenantId}, ${input.capitalObjectiveId}, ${input.eventType},
                ${input.actorType}, ${input.actorId}, ${serializeHistoryPayload(input.payload)}::text::jsonb)`;
    },
  };
}

const CreationRow = z.object({
  request_hash: z.string(),
  capital_objective_id: CapitalObjectiveIdSchema,
  tenant_id: TenantIdSchema,
});

export function createPostgresCapitalObjectiveCreationRequestStore(): CapitalObjectiveCreationRequestStore {
  return {
    lock: async (tx, userId, companyId, idempotencyKeyHash) => {
      await tx.sql`
        select pg_advisory_xact_lock(
          hashtext(${userId}::text || ':capital:' || ${companyId}::text),
          hashtext(${idempotencyKeyHash}))`;
    },
    find: async (tx, userId, companyId, idempotencyKeyHash) => {
      const rows = await tx.sql`
        select r.request_hash, r.capital_objective_id, r.tenant_id
          from core.capital_objective_creation_requests r
         where r.user_id = ${userId}
           and r.company_id = ${companyId}
           and r.idempotency_key_hash = ${idempotencyKeyHash}`;
      if (rows.length === 0) {
        return null;
      }
      const parsed = CreationRow.parse(rows[0]);
      const record: CapitalObjectiveCreationRecord = {
        requestHash: parsed.request_hash,
        capitalObjectiveId: parsed.capital_objective_id,
        tenantId: parsed.tenant_id,
      };
      return record;
    },
    record: async (tx, input) => {
      await tx.sql`
        insert into core.capital_objective_creation_requests
          (user_id, company_id, idempotency_key_hash, request_hash, capital_objective_id, tenant_id)
        values (${input.userId}, ${input.companyId}, ${input.idempotencyKeyHash},
                ${input.requestHash}, ${input.capitalObjectiveId}, ${input.tenantId})`;
    },
  };
}

/** Permission-neutral, structured-first read port. No use-of-funds narrative. */
export function createPostgresCapitalObjectiveQueryPort(options: {
  readonly sql: DatabaseExecutor;
}): CapitalObjectiveQueryPort {
  const { sql } = options;
  const repository = createPostgresCapitalObjectiveRepository();
  return {
    getCurrentForCompany: async (tenantId, companyId) => {
      const objective = await repository.findActive(sql, tenantId, companyId);
      return objective === null ? null : toCapitalObjectiveSnapshot(objective);
    },
    getById: async (tenantId, companyId, capitalObjectiveId) => {
      const objective = await repository.findById(
        sql,
        tenantId,
        companyId,
        capitalObjectiveId,
      );
      return objective === null ? null : toCapitalObjectiveSnapshot(objective);
    },
  };
}
