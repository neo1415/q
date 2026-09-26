import { z } from "zod";

import { QCardSubjectTypeSchema } from "@capital-q/contracts";

import type {
  CardRow,
  HandleRow,
  PublicIdentityRepository,
} from "../application/ports.js";

/**
 * PostgreSQL adapter for handles and cards. Parameterised SQL on the
 * executor or transaction the caller supplies; no pool is opened here.
 */

const TimestampSchema = z
  .union([z.date(), z.string()])
  .transform((value) => (value instanceof Date ? value : new Date(value)));

const HandleRowSchema = z.object({
  id: z.string().uuid(),
  handle: z.string(),
  subject_type: QCardSubjectTypeSchema,
  subject_id: z.string().uuid(),
  status: z.enum(["ACTIVE", "HELD", "RETIRED", "RELEASED"]),
  hold_until: TimestampSchema.nullable(),
});

function toHandle(row: unknown): HandleRow {
  const parsed = HandleRowSchema.parse(row);
  return {
    id: parsed.id,
    handle: parsed.handle,
    subjectType: parsed.subject_type,
    subjectId: parsed.subject_id,
    status: parsed.status,
    holdUntil: parsed.hold_until,
  };
}

const CardRowSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  organisation_id: z.string().uuid(),
  subject_type: QCardSubjectTypeSchema,
  subject_id: z.string().uuid(),
  public_code: z.string(),
  field_scopes: z.unknown(),
  indexable: z.boolean(),
  status: z.enum(["ACTIVE", "REVOKED"]),
  version: z.number().int(),
  updated_at: TimestampSchema,
});

function toCard(row: unknown): CardRow {
  const parsed = CardRowSchema.parse(row);
  return {
    id: parsed.id,
    tenantId: parsed.tenant_id,
    organisationId: parsed.organisation_id,
    subjectType: parsed.subject_type,
    subjectId: parsed.subject_id,
    publicCode: parsed.public_code,
    fieldScopes: parsed.field_scopes,
    indexable: parsed.indexable,
    status: parsed.status,
    version: parsed.version,
    updatedAt: parsed.updated_at.toISOString(),
  };
}

export function createPostgresPublicIdentityRepository(): PublicIdentityRepository {
  return {
    isReserved: async (sql, handle) => {
      const rows = await sql`
        select 1 from core.reserved_handles where handle = ${handle}`;
      return rows.length > 0;
    },

    lockLive: async (tx, handle) => {
      const [row] = await tx.sql`
        select id, handle, subject_type, subject_id, status, hold_until
          from core.handles
         where handle = ${handle} and status <> 'RELEASED'
         for update`;
      return row === undefined ? null : toHandle(row);
    },

    findLive: async (sql, handle) => {
      const [row] = await sql`
        select id, handle, subject_type, subject_id, status, hold_until
          from core.handles
         where handle = ${handle} and status <> 'RELEASED'`;
      return row === undefined ? null : toHandle(row);
    },

    lockActiveForSubject: async (tx, subject) => {
      const [row] = await tx.sql`
        select id, handle, subject_type, subject_id, status, hold_until
          from core.handles
         where subject_type = ${subject.subjectType}
           and subject_id = ${subject.subjectId}
           and status = 'ACTIVE'
         for update`;
      return row === undefined ? null : toHandle(row);
    },

    findActiveForSubject: async (sql, subject) => {
      const [row] = await sql`
        select id, handle, subject_type, subject_id, status, hold_until
          from core.handles
         where subject_type = ${subject.subjectType}
           and subject_id = ${subject.subjectId}
           and status = 'ACTIVE'`;
      return row === undefined ? null : toHandle(row);
    },

    setStatus: async (tx, id, next) => {
      await tx.sql`
        update core.handles
           set status = ${next.status},
               released_at = coalesce(released_at, ${next.at}),
               hold_until = ${next.holdUntil}
         where id = ${id}`;
    },

    insertActive: async (tx, row) => {
      await tx.sql`
        insert into core.handles
          (handle, tenant_id, organisation_id, subject_type, subject_id, claimed_by_user_id)
        values
          (${row.handle}, ${row.tenantId}, ${row.organisationId},
           ${row.subject.subjectType}, ${row.subject.subjectId}, ${row.claimedByUserId})`;
    },

    findCard: async (sql, subject) => {
      const [row] = await sql`
        select id, tenant_id, organisation_id, subject_type, subject_id,
               public_code, field_scopes, indexable, status, version, updated_at
          from core.shareable_identities
         where subject_type = ${subject.subjectType}
           and subject_id = ${subject.subjectId}`;
      return row === undefined ? null : toCard(row);
    },

    insertCard: async (tx, row) => {
      await tx.sql`
        insert into core.shareable_identities
          (tenant_id, organisation_id, subject_type, subject_id, public_code,
           field_scopes, created_by_user_id)
        values
          (${row.tenantId}, ${row.organisationId}, ${row.subject.subjectType},
           ${row.subject.subjectId}, ${row.publicCode},
           ${JSON.stringify(row.fieldScopes)}::text::jsonb, ${row.createdByUserId})
        on conflict (subject_type, subject_id) do nothing`;
    },

    updateCard: async (tx, id, expectedVersion, patch) => {
      const scopes =
        patch.fieldScopes === undefined
          ? null
          : JSON.stringify(patch.fieldScopes);
      const indexable = patch.indexable ?? null;
      const [row] = await tx.sql`
        update core.shareable_identities
           set field_scopes = coalesce(${scopes}::text::jsonb, field_scopes),
               indexable = coalesce(${indexable}::boolean, indexable),
               version = version + 1
         where id = ${id} and version = ${expectedVersion}
     returning id, tenant_id, organisation_id, subject_type, subject_id,
               public_code, field_scopes, indexable, status, version, updated_at`;
      return row === undefined ? null : toCard(row);
    },

    findActiveCardByCode: async (sql, code) => {
      const [row] = await sql`
        select id, tenant_id, organisation_id, subject_type, subject_id,
               public_code, field_scopes, indexable, status, version, updated_at
          from core.shareable_identities
         where public_code = ${code} and status = 'ACTIVE'`;
      return row === undefined ? null : toCard(row);
    },

    countScan: async (sql, cardId, day) => {
      await sql`
        insert into core.shareable_identity_scans (shareable_identity_id, day, scans)
        values (${cardId}, ${day}::date, 1)
        on conflict (shareable_identity_id, day)
        do update set scans = core.shareable_identity_scans.scans + 1`;
    },

    scansSince: async (sql, cardId, day) => {
      const [row] = await sql`
        select coalesce(sum(scans), 0)::int as total
          from core.shareable_identity_scans
         where shareable_identity_id = ${cardId} and day >= ${day}::date`;
      return z.object({ total: z.number().int() }).parse(row).total;
    },
  };
}
