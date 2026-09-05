import { z } from "zod";

import { UtcTimestampSchema } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import {
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
} from "@capital-q/security";

import type {
  DocumentUploadRequestStore,
  DocumentUploadSessionRepository,
} from "../application/upload-ports.js";
import {
  DocumentIdSchema,
  DocumentVersionIdSchema,
} from "../contracts/index.js";
import {
  DocumentUploadFailureCodeSchema,
  DocumentUploadSessionIdSchema,
  DocumentUploadSessionStatusSchema,
  UploadAuthorisingCapabilitySchema,
  type DocumentUploadSession,
} from "../contracts/upload.js";

/**
 * Postgres persistence for upload sessions. Parameterised SQL only, tenant
 * named on every statement, and no dynamic identifiers. Rows are visible
 * only through the owning organisation, so a guessed session id from
 * another tenant reads as absent.
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
  id: DocumentUploadSessionIdSchema,
  tenant_id: TenantIdSchema,
  owner_organisation_id: OrganisationIdSchema,
  created_by_user_id: UserIdSchema,
  document_id: DocumentIdSchema,
  storage_bucket: z.string(),
  storage_key: z.string(),
  original_filename: z.string(),
  declared_mime_type: z.string(),
  declared_size_bytes: z.union([z.number(), z.string()]).transform(Number),
  authorising_capability: UploadAuthorisingCapabilitySchema,
  status: DocumentUploadSessionStatusSchema,
  expires_at: Timestamp,
  finalized_at: Timestamp.nullable(),
  document_version_id: DocumentVersionIdSchema.nullable(),
  failure_code: DocumentUploadFailureCodeSchema.nullable(),
  cleanup_pending: z.boolean(),
  created_at: Timestamp,
  updated_at: Timestamp,
  version: z.number().int().min(1),
});

function toSession(row: unknown): DocumentUploadSession {
  const parsed = SessionRow.parse(row);
  return {
    id: parsed.id,
    tenantId: parsed.tenant_id,
    ownerOrganisationId: parsed.owner_organisation_id,
    createdByUserId: parsed.created_by_user_id,
    documentId: parsed.document_id,
    storageBucket: parsed.storage_bucket,
    storageKey: parsed.storage_key,
    originalFilename: parsed.original_filename,
    declaredMimeType: parsed.declared_mime_type,
    declaredSizeBytes: parsed.declared_size_bytes,
    authorisingCapability: parsed.authorising_capability,
    status: parsed.status,
    expiresAt: parsed.expires_at,
    finalizedAt: parsed.finalized_at,
    documentVersionId: parsed.document_version_id,
    failureCode: parsed.failure_code,
    cleanupPending: parsed.cleanup_pending,
    createdAt: parsed.created_at,
    updatedAt: parsed.updated_at,
    version: parsed.version,
  };
}

function selectSessions(executor: DatabaseExecutor) {
  return executor`
    select s.id, s.tenant_id, s.owner_organisation_id, s.created_by_user_id,
           s.document_id, s.storage_bucket, s.storage_key, s.original_filename,
           s.declared_mime_type, s.declared_size_bytes, s.authorising_capability,
           s.status, s.expires_at, s.finalized_at, s.document_version_id,
           s.failure_code, s.cleanup_pending, s.created_at, s.updated_at, s.version
      from evidence.document_upload_sessions s`;
}

export function createPostgresDocumentUploadSessionRepository(): DocumentUploadSessionRepository {
  const findById: DocumentUploadSessionRepository["findById"] = async (
    executor,
    tenantId,
    ownerOrganisationId,
    sessionId,
  ) => {
    const rows = await executor`
      ${selectSessions(executor)}
       where s.id = ${sessionId}
         and s.tenant_id = ${tenantId}
         and s.owner_organisation_id = ${ownerOrganisationId}`;
    return rows.length === 0 ? null : toSession(rows[0]);
  };

  return {
    insert: async (tx, input) => {
      const rows = await tx.sql`
        insert into evidence.document_upload_sessions
          (tenant_id, owner_organisation_id, created_by_user_id, document_id,
           storage_bucket, storage_key, original_filename, declared_mime_type,
           declared_size_bytes, authorising_capability, expires_at)
        values (${input.tenantId}, ${input.ownerOrganisationId}, ${input.createdByUserId},
                ${input.documentId}, ${input.storageBucket}, ${input.storageKey},
                ${input.originalFilename}, ${input.declaredMimeType},
                ${input.declaredSizeBytes}, ${input.authorisingCapability},
                ${input.expiresAt})
        returning id`;
      const { id } = z
        .object({ id: DocumentUploadSessionIdSchema })
        .parse(rows[0]);
      const created = await findById(
        tx.sql,
        input.tenantId,
        input.ownerOrganisationId,
        id,
      );
      if (created === null) {
        throw new Error("upload session insert did not return a row");
      }
      return created;
    },
    findById,
    lockById: async (tx, tenantId, ownerOrganisationId, sessionId) => {
      const rows = await tx.sql`
        ${selectSessions(tx.sql)}
         where s.id = ${sessionId}
           and s.tenant_id = ${tenantId}
           and s.owner_organisation_id = ${ownerOrganisationId}
         for update`;
      return rows.length === 0 ? null : toSession(rows[0]);
    },
    countOpen: async (executor, tenantId, ownerOrganisationId) => {
      const rows = await executor`
        select count(*)::int as open
          from evidence.document_upload_sessions
         where tenant_id = ${tenantId}
           and owner_organisation_id = ${ownerOrganisationId}
           and status in ('PENDING_AUTHORIZATION', 'AUTHORIZED', 'FINALIZING')
           and expires_at > now()`;
      return z.object({ open: z.number().int() }).parse(rows[0]).open;
    },
    update: async (tx, input) => {
      const { changes } = input;
      const rows = await tx.sql`
        update evidence.document_upload_sessions s
           set status = ${changes.status},
               failure_code = coalesce(${changes.failureCode ?? null}, s.failure_code),
               document_version_id = coalesce(${changes.documentVersionId ?? null}, s.document_version_id),
               finalized_at = coalesce(${changes.finalizedAt ?? null}, s.finalized_at),
               cleanup_pending = coalesce(${changes.cleanupPending ?? null}, s.cleanup_pending),
               version = s.version + 1
         where s.id = ${input.sessionId}
           and s.tenant_id = ${input.tenantId}
           and s.version = ${input.expectedVersion}
        returning s.id`;
      if (rows.length === 0) return null;
      const updated = await tx.sql`
        ${selectSessions(tx.sql)}
         where s.id = ${input.sessionId} and s.tenant_id = ${input.tenantId}`;
      return updated.length === 0 ? null : toSession(updated[0]);
    },
  };
}

export function createPostgresDocumentUploadRequestStore(): DocumentUploadRequestStore {
  return {
    lock: async (tx, userId, organisationId, idempotencyKeyHash) => {
      await tx.sql`
        select pg_advisory_xact_lock(
          hashtext(${userId}::text || ':' || ${organisationId}::text),
          hashtext(${idempotencyKeyHash}))`;
    },
    find: async (tx, userId, organisationId, idempotencyKeyHash) => {
      const rows = await tx.sql`
        select request_hash, upload_session_id
          from evidence.document_upload_requests
         where user_id = ${userId}
           and organisation_id = ${organisationId}
           and idempotency_key_hash = ${idempotencyKeyHash}`;
      if (rows.length === 0) return null;
      const parsed = z
        .object({
          request_hash: z.string(),
          upload_session_id: DocumentUploadSessionIdSchema,
        })
        .parse(rows[0]);
      return {
        requestHash: parsed.request_hash,
        uploadSessionId: parsed.upload_session_id,
      };
    },
    record: async (tx, input) => {
      await tx.sql`
        insert into evidence.document_upload_requests
          (user_id, organisation_id, tenant_id, idempotency_key_hash,
           request_hash, upload_session_id)
        values (${input.userId}, ${input.organisationId}, ${input.tenantId},
                ${input.idempotencyKeyHash}, ${input.requestHash},
                ${input.uploadSessionId})`;
    },
  };
}
