import { z } from "zod";

import {
  ProfileImageKindSchema,
  ProfileImageSubjectTypeSchema,
} from "@capital-q/contracts";

import type {
  ProfileImageRepository,
  ProfileImageRow,
} from "../application/profile-images.js";

/**
 * PostgreSQL adapter for core.profile_images. Parameterised SQL on the
 * executor or transaction the caller supplies. Rows are never deleted: an
 * image ends as SUPERSEDED, REMOVED or FAILED (the table's trigger holds
 * that line too).
 */

const TimestampSchema = z
  .union([z.date(), z.string()])
  .transform((value) => (value instanceof Date ? value : new Date(value)));

const RowSchema = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  organisation_id: z.string().uuid().nullable(),
  subject_type: ProfileImageSubjectTypeSchema,
  subject_id: z.string().uuid(),
  kind: ProfileImageKindSchema,
  status: z.enum(["PENDING", "READY", "SUPERSEDED", "REMOVED", "FAILED"]),
  upload_key: z.string(),
  declared_content_type: z.string(),
  declared_byte_size: z.number().int(),
  object_key: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  created_by_user_id: z.string().uuid(),
  upload_expires_at: TimestampSchema,
  ready_at: TimestampSchema.nullable(),
});

function toRow(row: unknown): ProfileImageRow {
  const parsed = RowSchema.parse(row);
  return {
    id: parsed.id,
    tenantId: parsed.tenant_id,
    organisationId: parsed.organisation_id,
    subjectType: parsed.subject_type,
    subjectId: parsed.subject_id,
    kind: parsed.kind,
    status: parsed.status,
    uploadKey: parsed.upload_key,
    declaredContentType: parsed.declared_content_type,
    declaredByteSize: parsed.declared_byte_size,
    objectKey: parsed.object_key,
    width: parsed.width,
    height: parsed.height,
    createdByUserId: parsed.created_by_user_id,
    uploadExpiresAt: parsed.upload_expires_at,
    readyAt: parsed.ready_at?.toISOString() ?? null,
  };
}

export function createPostgresProfileImageRepository(): ProfileImageRepository {
  return {
    countRecentPending: async (sql, userId, since) => {
      const [row] = await sql`
        select count(*)::int as n
          from core.profile_images
         where created_by_user_id = ${userId}
           and created_at >= ${since.toISOString()}::timestamptz`;
      const n: unknown = (row as { n?: unknown } | undefined)?.n;
      return typeof n === "number" ? n : 0;
    },

    insertPending: async (sql, row) => {
      await sql`
        insert into core.profile_images
          (id, tenant_id, organisation_id, subject_type, subject_id, kind,
           upload_key, declared_content_type, declared_byte_size,
           created_by_user_id, upload_expires_at)
        values
          (${row.id}, ${row.tenantId}, ${row.organisationId},
           ${row.subject.subjectType}, ${row.subject.subjectId}, ${row.kind},
           ${row.uploadKey}, ${row.contentType}, ${row.byteSize},
           ${row.createdByUserId}, ${row.uploadExpiresAt.toISOString()}::timestamptz)`;
    },

    find: async (sql, id) => {
      const [row] = await sql`
        select * from core.profile_images where id = ${id}`;
      return row === undefined ? null : toRow(row);
    },

    lockReady: async (tx, subject, kind) => {
      const [row] = await tx.sql`
        select * from core.profile_images
         where subject_type = ${subject.subjectType}
           and subject_id = ${subject.subjectId}
           and kind = ${kind}
           and status = 'READY'
           for update`;
      return row === undefined ? null : toRow(row);
    },

    findReady: async (sql, subject) => {
      const rows = await sql`
        select * from core.profile_images
         where subject_type = ${subject.subjectType}
           and subject_id = ${subject.subjectId}
           and status = 'READY'`;
      return rows.map(toRow);
    },

    end: async (tx, id, status) => {
      await tx.sql`
        update core.profile_images
           set status = ${status}, ended_at = clock_timestamp()
         where id = ${id} and status = 'READY'`;
    },

    markFailed: async (sql, id) => {
      await sql`
        update core.profile_images
           set status = 'FAILED', ended_at = clock_timestamp()
         where id = ${id} and status = 'PENDING'`;
    },

    markReady: async (tx, id, rendition) => {
      const [row] = await tx.sql`
        update core.profile_images
           set status = 'READY',
               object_key = ${rendition.objectKey},
               width = ${rendition.width},
               height = ${rendition.height},
               byte_size = ${rendition.byteSize},
               ready_at = clock_timestamp()
         where id = ${id} and status = 'PENDING'
     returning *`;
      return row === undefined ? null : toRow(row);
    },
  };
}
