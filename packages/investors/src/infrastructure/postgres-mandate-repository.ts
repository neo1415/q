import { z } from "zod";

import {
  DiscoveryModeSchema,
  InvestorMandateStatusSchema,
  MandateConstraintDimensionSchema,
  MandateConstraintOperatorSchema,
  MandateConstraintValueSchema,
  MandatePreferenceClassSchema,
  UtcTimestampSchema,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import { TenantIdSchema, UserIdSchema } from "@capital-q/security";
import {
  createPostgresMandateTaxonomyPreferencePort,
  type MandateTaxonomyPreference,
  type MandateTaxonomyPreferencePort,
} from "@capital-q/taxonomy";

import { InvestorOrganisationIdSchema } from "../contracts/index.js";
import {
  chequeRangeOf,
  InvestorMandateConstraintIdSchema,
  InvestorMandateIdSchema,
  type InvestorMandate,
  type InvestorMandateConstraint,
  type InvestorMandateSnapshot,
  type InvestorMandateSummary,
} from "../contracts/mandate.js";
import { automatedUseOf } from "../domain/mandate-registry.js";
import type {
  InvestorMandateCreationRecord,
  InvestorMandateCreationRequestStore,
  InvestorMandateQueryPort,
  InvestorMandateRepository,
  InvestorMandateScalarChanges,
  NewMandateConstraint,
} from "../application/mandate-ports.js";

/**
 * PostgreSQL adapters for the declared-mandate ports. Parameterised SQL
 * only: dimension, operator and value are bound as data and validated back
 * through the contract schemas on read. Money columns are bound and read as
 * text so no amount ever passes through a JavaScript number. This module
 * is never handed to Q.
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

/** Microsecond-precision text, exactly as the cursor must reproduce it. */
const CURSOR_TIME_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

const MandateRow = z.object({
  id: InvestorMandateIdSchema,
  tenant_id: TenantIdSchema,
  investor_organisation_id: InvestorOrganisationIdSchema,
  name: z.string(),
  status: InvestorMandateStatusSchema,
  effective_from: Timestamp.nullable(),
  effective_to: Timestamp.nullable(),
  discovery_mode: DiscoveryModeSchema.nullable(),
  min_cheque: z.string().nullable(),
  max_cheque: z.string().nullable(),
  currency_code: z.string().nullable(),
  min_stage_code: z.string().nullable(),
  max_stage_code: z.string().nullable(),
  raw_mandate_text: z.string().nullable(),
  created_by_user_id: UserIdSchema,
  version: z.number().int().min(1),
  created_at: Timestamp,
  updated_at: Timestamp,
});

const ConstraintRow = z.object({
  id: InvestorMandateConstraintIdSchema,
  tenant_id: TenantIdSchema,
  mandate_id: InvestorMandateIdSchema,
  dimension: MandateConstraintDimensionSchema,
  operator: MandateConstraintOperatorSchema,
  value_jsonb: MandateConstraintValueSchema,
  importance: MandatePreferenceClassSchema,
  is_hard_exclusion: z.boolean(),
});

const SummaryRow = z.object({
  id: InvestorMandateIdSchema,
  tenant_id: TenantIdSchema,
  investor_organisation_id: InvestorOrganisationIdSchema,
  name: z.string(),
  status: InvestorMandateStatusSchema,
  discovery_mode: DiscoveryModeSchema.nullable(),
  effective_from: Timestamp.nullable(),
  effective_to: Timestamp.nullable(),
  version: z.number().int().min(1),
  created_at_cursor: UtcTimestampSchema,
});

function toConstraint(row: unknown): InvestorMandateConstraint {
  const r = ConstraintRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    mandateId: r.mandate_id,
    dimension: r.dimension,
    operator: r.operator,
    value: r.value_jsonb,
    importance: r.importance,
    isHardExclusion: r.is_hard_exclusion,
  };
}

function toMandate(
  row: unknown,
  constraints: readonly InvestorMandateConstraint[],
  taxonomyPreferences: readonly MandateTaxonomyPreference[],
): InvestorMandate {
  const r = MandateRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    investorOrganisationId: r.investor_organisation_id,
    name: r.name,
    status: r.status,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    discoveryMode: r.discovery_mode,
    minCheque: r.min_cheque,
    maxCheque: r.max_cheque,
    currencyCode: r.currency_code,
    minStageCode: r.min_stage_code,
    maxStageCode: r.max_stage_code,
    rawMandateText: r.raw_mandate_text,
    createdByUserId: r.created_by_user_id,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    constraints,
    taxonomyPreferences,
  };
}

function toSummary(row: unknown): InvestorMandateSummary {
  const r = SummaryRow.parse(row);
  return {
    id: r.id,
    tenantId: r.tenant_id,
    investorOrganisationId: r.investor_organisation_id,
    name: r.name,
    status: r.status,
    discoveryMode: r.discovery_mode,
    effectiveFrom: r.effective_from,
    effectiveTo: r.effective_to,
    version: r.version,
    createdAt: r.created_at_cursor,
  };
}

function mandateSelect(executor: DatabaseExecutor) {
  return executor`
    select m.id, m.tenant_id, m.investor_organisation_id, m.name, m.status,
           m.effective_from, m.effective_to, m.discovery_mode,
           m.min_cheque::text as min_cheque, m.max_cheque::text as max_cheque, m.currency_code,
           m.min_stage_code, m.max_stage_code, m.raw_mandate_text, m.created_by_user_id,
           m.version, m.created_at, m.updated_at
      from core.investor_mandates m`;
}

async function loadConstraints(
  executor: DatabaseExecutor,
  tenantId: string,
  mandateId: string,
): Promise<InvestorMandateConstraint[]> {
  const rows = await executor`
    select c.id, c.tenant_id, c.mandate_id, c.dimension, c.operator, c.value_jsonb,
           c.importance, c.is_hard_exclusion
      from core.investor_mandate_constraints c
     where c.mandate_id = ${mandateId} and c.tenant_id = ${tenantId}
     order by c.created_at, c.id`;
  return rows.map(toConstraint);
}

async function insertConstraints(
  tx: TransactionContext,
  tenantId: string,
  mandateId: string,
  constraints: readonly NewMandateConstraint[],
): Promise<void> {
  for (const constraint of constraints) {
    await tx.sql`
      insert into core.investor_mandate_constraints
        (tenant_id, mandate_id, dimension, operator, value_jsonb, importance, is_hard_exclusion)
      values (${tenantId}, ${mandateId}, ${constraint.dimension}, ${constraint.operator},
              ${JSON.stringify(constraint.value)}::text::jsonb, ${constraint.importance},
              ${constraint.isHardExclusion})`;
  }
}

const COLUMN_BY_FIELD: Readonly<
  Record<keyof InvestorMandateScalarChanges, string>
> = {
  name: "name",
  discoveryMode: "discovery_mode",
  minCheque: "min_cheque",
  maxCheque: "max_cheque",
  currencyCode: "currency_code",
  minStageCode: "min_stage_code",
  maxStageCode: "max_stage_code",
  rawMandateText: "raw_mandate_text",
};

export type PostgresInvestorMandateRepositoryOptions = {
  /** Reads declared taxonomy preferences through the Taxonomy public port. */
  readonly taxonomyPreferences?: MandateTaxonomyPreferencePort | undefined;
};

export function createPostgresInvestorMandateRepository(
  options: PostgresInvestorMandateRepositoryOptions = {},
): InvestorMandateRepository {
  const taxonomy =
    options.taxonomyPreferences ??
    createPostgresMandateTaxonomyPreferencePort();
  return {
    insert: async (tx, input) => {
      // Money is bound as text and cast in SQL; the driver never sees a number.
      const rows = await tx.sql`
        insert into core.investor_mandates
          (tenant_id, investor_organisation_id, name, discovery_mode, min_cheque, max_cheque,
           currency_code, min_stage_code, max_stage_code, raw_mandate_text, created_by_user_id)
        values
          (${input.tenantId}, ${input.investorOrganisationId}, ${input.name}, ${input.discoveryMode},
           ${input.minCheque}::text::numeric, ${input.maxCheque}::text::numeric, ${input.currencyCode},
           ${input.minStageCode}, ${input.maxStageCode}, ${input.rawMandateText}, ${input.createdByUserId})
        returning id`;
      const inserted = z.object({ id: InvestorMandateIdSchema }).parse(rows[0]);
      await insertConstraints(
        tx,
        input.tenantId,
        inserted.id,
        input.constraints,
      );
      const created = await tx.sql`
        ${mandateSelect(tx.sql)}
         where m.id = ${inserted.id} and m.tenant_id = ${input.tenantId}`;
      return toMandate(
        created[0],
        await loadConstraints(tx.sql, input.tenantId, inserted.id),
        await taxonomy.list(tx.sql, input.tenantId, inserted.id),
      );
    },

    findById: async (executor, tenantId, investorOrganisationId, mandateId) => {
      const rows = await executor`
        ${mandateSelect(executor)}
         where m.id = ${mandateId}
           and m.tenant_id = ${tenantId}
           and m.investor_organisation_id = ${investorOrganisationId}`;
      if (rows.length === 0) {
        return null;
      }
      return toMandate(
        rows[0],
        await loadConstraints(executor, tenantId, mandateId),
        await taxonomy.list(executor, tenantId, mandateId),
      );
    },

    lockById: async (tx, tenantId, investorOrganisationId, mandateId) => {
      const rows = await tx.sql`
        ${mandateSelect(tx.sql)}
         where m.id = ${mandateId}
           and m.tenant_id = ${tenantId}
           and m.investor_organisation_id = ${investorOrganisationId}
           for update`;
      if (rows.length === 0) {
        return null;
      }
      return toMandate(
        rows[0],
        await loadConstraints(tx.sql, tenantId, mandateId),
        await taxonomy.list(tx.sql, tenantId, mandateId),
      );
    },

    list: async (executor, tenantId, investorOrganisationId, page) => {
      // Keyset on (created_at desc, id desc); the cursor time is bound as
      // text so its microseconds survive the round trip.
      const rows = await executor`
        select m.id, m.tenant_id, m.investor_organisation_id, m.name, m.status, m.discovery_mode,
               m.effective_from, m.effective_to, m.version,
               to_char(m.created_at at time zone 'UTC', ${CURSOR_TIME_FORMAT}) as created_at_cursor
          from core.investor_mandates m
         where m.tenant_id = ${tenantId}
           and m.investor_organisation_id = ${investorOrganisationId}
           and (${page.status ?? null}::text is null or m.status = ${page.status ?? null})
           and (${page.after?.createdAt ?? null}::text is null
                or (m.created_at, m.id) < (${page.after?.createdAt ?? null}::text::timestamptz, ${page.after?.id ?? null}::uuid))
         order by m.created_at desc, m.id desc
         limit ${page.limit}`;
      return rows.map(toSummary);
    },

    updateScalars: async (tx, input) => {
      const columns: Record<string, string | null> = {};
      for (const field of Object.keys(
        COLUMN_BY_FIELD,
      ) as (keyof InvestorMandateScalarChanges)[]) {
        const value = input.changes[field];
        if (value !== undefined) {
          columns[COLUMN_BY_FIELD[field]] = value;
        }
      }
      // Numeric columns are cast from text; everything else is text.
      const {
        min_cheque: minCheque,
        max_cheque: maxCheque,
        ...textColumns
      } = columns;
      const hasText = Object.keys(textColumns).length > 0;
      const hasMoney = minCheque !== undefined || maxCheque !== undefined;
      const updated = hasMoney
        ? hasText
          ? await tx.sql`
              update core.investor_mandates m
                 set ${tx.sql(textColumns)},
                     min_cheque = ${minCheque ?? null}::text::numeric,
                     max_cheque = ${maxCheque ?? null}::text::numeric,
                     version = m.version + 1
               where m.id = ${input.mandateId}
                 and m.tenant_id = ${input.tenantId}
                 and m.investor_organisation_id = ${input.investorOrganisationId}
                 and m.version = ${input.expectedVersion}
              returning m.id`
          : await tx.sql`
              update core.investor_mandates m
                 set min_cheque = ${minCheque ?? null}::text::numeric,
                     max_cheque = ${maxCheque ?? null}::text::numeric,
                     version = m.version + 1
               where m.id = ${input.mandateId}
                 and m.tenant_id = ${input.tenantId}
                 and m.investor_organisation_id = ${input.investorOrganisationId}
                 and m.version = ${input.expectedVersion}
              returning m.id`
        : hasText
          ? await tx.sql`
              update core.investor_mandates m
                 set ${tx.sql(textColumns)},
                     version = m.version + 1
               where m.id = ${input.mandateId}
                 and m.tenant_id = ${input.tenantId}
                 and m.investor_organisation_id = ${input.investorOrganisationId}
                 and m.version = ${input.expectedVersion}
              returning m.id`
          : await tx.sql`
              update core.investor_mandates m
                 set version = m.version + 1
               where m.id = ${input.mandateId}
                 and m.tenant_id = ${input.tenantId}
                 and m.investor_organisation_id = ${input.investorOrganisationId}
                 and m.version = ${input.expectedVersion}
              returning m.id`;
      return updated.length > 0;
    },

    replaceConstraints: async (tx, input) => {
      if (input.removeIds.length > 0) {
        await tx.sql`
          delete from core.investor_mandate_constraints c
           where c.mandate_id = ${input.mandateId}
             and c.tenant_id = ${input.tenantId}
             and c.id = any(${[...input.removeIds]}::uuid[])`;
      }
      await insertConstraints(tx, input.tenantId, input.mandateId, input.add);
    },

    transition: async (tx, input) => {
      const rows =
        input.to === "ACTIVE"
          ? await tx.sql`
              update core.investor_mandates m
                 set status = 'ACTIVE',
                     effective_from = coalesce(m.effective_from, clock_timestamp()),
                     version = m.version + 1
               where m.id = ${input.mandateId}
                 and m.tenant_id = ${input.tenantId}
                 and m.investor_organisation_id = ${input.investorOrganisationId}
                 and m.version = ${input.expectedVersion}
              returning m.effective_from as effective`
          : await tx.sql`
              update core.investor_mandates m
                 set status = 'CLOSED',
                     effective_to = clock_timestamp(),
                     version = m.version + 1
               where m.id = ${input.mandateId}
                 and m.tenant_id = ${input.tenantId}
                 and m.investor_organisation_id = ${input.investorOrganisationId}
                 and m.version = ${input.expectedVersion}
              returning m.effective_to as effective`;
      if (rows.length === 0) {
        return null;
      }
      return z.object({ effective: Timestamp }).parse(rows[0]).effective;
    },
  };
}

const CreationRow = z.object({
  request_hash: z.string(),
  mandate_id: InvestorMandateIdSchema,
  tenant_id: TenantIdSchema,
});

export function createPostgresInvestorMandateCreationRequestStore(): InvestorMandateCreationRequestStore {
  return {
    lock: async (tx, userId, investorOrganisationId, idempotencyKeyHash) => {
      await tx.sql`
        select pg_advisory_xact_lock(
          hashtext(${userId}::text || ':mandate:' || ${investorOrganisationId}::text),
          hashtext(${idempotencyKeyHash}))`;
    },
    find: async (tx, userId, investorOrganisationId, idempotencyKeyHash) => {
      const rows = await tx.sql`
        select r.request_hash, r.mandate_id, r.tenant_id
          from core.investor_mandate_creation_requests r
         where r.user_id = ${userId}
           and r.investor_organisation_id = ${investorOrganisationId}
           and r.idempotency_key_hash = ${idempotencyKeyHash}`;
      if (rows.length === 0) {
        return null;
      }
      const parsed = CreationRow.parse(rows[0]);
      const record: InvestorMandateCreationRecord = {
        requestHash: parsed.request_hash,
        mandateId: parsed.mandate_id,
        tenantId: parsed.tenant_id,
      };
      return record;
    },
    record: async (tx, input) => {
      await tx.sql`
        insert into core.investor_mandate_creation_requests
          (user_id, investor_organisation_id, idempotency_key_hash, request_hash, mandate_id, tenant_id)
        values (${input.userId}, ${input.investorOrganisationId}, ${input.idempotencyKeyHash},
                ${input.requestHash}, ${input.mandateId}, ${input.tenantId})`;
    },
  };
}

/**
 * Permission-neutral read port for recommendation, onboarding and Q. The
 * snapshot carries typed policy and each constraint's automated-use
 * eligibility; it never carries the raw narrative.
 */
export function createPostgresInvestorMandateQueryPort(options: {
  readonly sql: DatabaseExecutor;
}): InvestorMandateQueryPort {
  const { sql } = options;
  const repository = createPostgresInvestorMandateRepository();
  return {
    findCanonicalInvestorMandate: async (mandateId) => {
      const rows = await sql`
        select m.id, m.tenant_id, m.investor_organisation_id, m.status
          from core.investor_mandates m
         where m.id = ${mandateId}`;
      if (rows.length === 0) {
        return null;
      }
      const parsed = MandateRow.pick({
        id: true,
        tenant_id: true,
        investor_organisation_id: true,
        status: true,
      }).parse(rows[0]);
      return {
        id: parsed.id,
        tenantId: parsed.tenant_id,
        investorOrganisationId: parsed.investor_organisation_id,
        status: parsed.status,
      };
    },
    getMandate: async (tenantId, investorOrganisationId, mandateId) => {
      const mandate = await repository.findById(
        sql,
        tenantId,
        investorOrganisationId,
        mandateId,
      );
      if (mandate === null) {
        return null;
      }
      const snapshot: InvestorMandateSnapshot = {
        mandateId: mandate.id,
        tenantId: mandate.tenantId,
        investorOrganisationId: mandate.investorOrganisationId,
        version: mandate.version,
        status: mandate.status,
        discoveryMode: mandate.discoveryMode,
        cheque: chequeRangeOf(mandate),
        stage: {
          minStageCode: mandate.minStageCode,
          maxStageCode: mandate.maxStageCode,
        },
        constraints: mandate.constraints.map((constraint) => ({
          ...constraint,
          automatedUse: automatedUseOf(constraint.dimension),
        })),
        taxonomyPreferences: mandate.taxonomyPreferences,
      };
      return snapshot;
    },
    listActiveMandates: (tenantId, investorOrganisationId) =>
      repository.list(sql, tenantId, investorOrganisationId, {
        status: "ACTIVE",
        limit: 100,
      }),
  };
}
