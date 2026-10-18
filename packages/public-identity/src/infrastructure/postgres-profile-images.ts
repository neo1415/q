import { z } from "zod";

import {
  ProfileImageKindSchema,
  ProfileImageSubjectTypeSchema,
} from "@capital-q/contracts";

import type {
  NamedImageStore,
  NamedImageSubject,
} from "../application/named-images.js";
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

const ReadyImageSchema = z.object({
  subject_type: ProfileImageSubjectTypeSchema,
  subject_id: z.string().uuid(),
  kind: ProfileImageKindSchema,
  object_key: z.string().min(1),
});

/**
 * The named-images read (named-images.ts): every current image of a list's
 * subjects in one query on the one-READY index, and the organisations'
 * active card scopes in another.
 */
export function createPostgresNamedImageStore(): NamedImageStore {
  const columns = (subjects: readonly NamedImageSubject[]) => ({
    types: subjects.map((subject) => subject.subjectType),
    ids: subjects.map((subject) => subject.subjectId),
  });
  return {
    readyImages: async (sql, subjects) => {
      if (subjects.length === 0) return [];
      const { types, ids } = columns(subjects);
      const rows = await sql`
        select i.subject_type, i.subject_id, i.kind, i.object_key
          from core.profile_images i
          join unnest(${types}::text[], ${ids}::uuid[]) as s (subject_type, subject_id)
            on s.subject_type = i.subject_type and s.subject_id = i.subject_id
         where i.status = 'READY' and i.object_key is not null`;
      return rows.map((row) => {
        const parsed = ReadyImageSchema.parse(row);
        return {
          subject: {
            subjectType: parsed.subject_type,
            subjectId: parsed.subject_id,
          },
          kind: parsed.kind,
          objectKey: parsed.object_key,
        };
      });
    },

    activeCardScopes: async (sql, subjects) => {
      const organisations = subjects.filter(
        (subject) => subject.subjectType !== "PERSON",
      );
      if (organisations.length === 0) return new Map();
      const { types, ids } = columns(organisations);
      const rows = await sql`
        select c.subject_type, c.subject_id, c.field_scopes
          from core.shareable_identities c
          join unnest(${types}::text[], ${ids}::uuid[]) as s (subject_type, subject_id)
            on s.subject_type = c.subject_type and s.subject_id = c.subject_id
         where c.status = 'ACTIVE'`;
      const out = new Map<string, unknown>();
      for (const row of rows as readonly {
        subject_type?: unknown;
        subject_id?: unknown;
        field_scopes?: unknown;
      }[]) {
        if (
          typeof row.subject_type === "string" &&
          typeof row.subject_id === "string"
        ) {
          out.set(`${row.subject_type}:${row.subject_id}`, row.field_scopes);
        }
      }
      return out;
    },
  };
}
