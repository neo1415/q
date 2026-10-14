import { createHash } from "node:crypto";
import { z } from "zod";
import type { CorrelationId } from "@capital-q/contracts";
import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import { TenantIdSchema } from "@capital-q/security";
import {
  DocumentIdSchema,
  DocumentVersionIdSchema,
} from "../contracts/index.js";
import {
  DocumentUploadCreationConflictError,
  DocumentUploadRejectedError,
  DocumentUploadStateError,
  EvidenceRuleError,
} from "../domain/errors.js";
import { createDocumentStorageKey } from "../domain/storage-identity.js";
import {
  checkClaimedType,
  sanitiseOriginalFilename,
} from "../domain/upload-policy.js";
import { applicationDocumentVersionCreatedEvent } from "../events/index.js";
import type { DocumentUploadLimits } from "./dependencies.js";
import type {
  DirectUploadAuthorization,
  PrivateDocumentStorageProvider,
} from "./storage-port.js";
import { validateUploadedDocument } from "./upload-validation.js";

export const GateQApplicationEvidenceScopeSchema = z
  .object({
    tenantId: TenantIdSchema,
    applicationId: z.string().uuid(),
    sessionId: z.string().uuid(),
    expiresAt: z.string().datetime(),
    open: z.boolean(),
    contactConfirmed: z.literal(true),
  })
  .strict();
export type GateQApplicationEvidenceScope = z.infer<
  typeof GateQApplicationEvidenceScopeSchema
>;
export class GateQApplicationEvidenceScopeError extends Error {
  constructor() {
    super("SESSION_INVALID");
    this.name = "GateQApplicationEvidenceScopeError";
  }
}
export type GateQApplicationEvidenceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly storage: PrivateDocumentStorageProvider;
  readonly outbox: OutboxWriter;
  readonly uploads: DocumentUploadLimits;
  readonly maxDocuments: number;
  readonly maxTotalBytes: number;
  /** Verify session, contact proof and open application; ownership is never request input. */
  readonly authorise: (
    credential: string,
  ) => Promise<GateQApplicationEvidenceScope>;
};
const CreateInput = z
  .object({
    filename: z.string().min(1).max(1024),
    declaredMimeType: z.string().min(3).max(129),
    declaredSizeBytes: z.number().int().positive(),
    clientRequestId: z.string().min(1).max(200),
  })
  .strict();
const SessionRow = z.object({
  id: z.string().uuid(),
  document_id: DocumentIdSchema,
  storage_bucket: z.string(),
  storage_key: z.string(),
  original_filename: z.string(),
  declared_mime_type: z.string(),
  declared_size_bytes: z.coerce.number(),
  status: z.string(),
  expires_at: z.coerce.date(),
  document_version_id: DocumentVersionIdSchema.nullable(),
  guest_request_hash: z.string(),
});
export type GateQApplicationEvidenceItem = {
  readonly documentId: string;
  readonly versionId: string | null;
  readonly fileName: string;
  readonly status: "PROCESSING" | "READY" | "BLOCKED" | "FAILED";
  readonly uploadStatus: string;
  readonly byteSize: number;
  readonly pages: number | null;
  readonly malwareStatus: string | null;
  readonly extractionStatus: string | null;
  readonly sha256: string | null;
  readonly instructionRiskSignals: number;
};
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

/** Application-private custody over the same documents, versions and ingestion pipeline. */
export function createGateQApplicationEvidenceService(
  deps: GateQApplicationEvidenceDependencies,
) {
  if (
    ![deps.maxDocuments, deps.maxTotalBytes].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    )
  )
    throw new EvidenceRuleError(
      "application upload limits must be positive integers",
    );
  async function scope(credential: string, write = false) {
    const result = GateQApplicationEvidenceScopeSchema.safeParse(
      await deps.authorise(credential),
    );
    if (
      !result.success ||
      Date.parse(result.data.expiresAt) <= Date.now() ||
      (write && !result.data.open)
    )
      throw new GateQApplicationEvidenceScopeError();
    return result.data;
  }
  async function lockScope(
    tx: TransactionContext,
    s: GateQApplicationEvidenceScope,
  ) {
    // The lock shares the submission boundary. A proof checked before a storage
    // call cannot authorise a write after submission or session revocation.
    const rows = await tx.sql`
      select a.id from gateq.applications a join gateq.application_sessions s on s.application_id=a.id and s.tenant_id=a.tenant_id
      join gateq.application_contacts c on c.application_id=a.id and c.tenant_id=a.tenant_id
      where a.id=${s.applicationId} and a.tenant_id=${s.tenantId} and s.id=${s.sessionId}
      and s.revoked_at is null and s.expires_at > now() and c.email_confirmed_at is not null
      and a.status in ('IN_PROGRESS','READY_TO_SUBMIT') for update of a`;
    if (rows.length !== 1) throw new GateQApplicationEvidenceScopeError();
  }
  async function session(
    executor: DatabaseExecutor,
    s: GateQApplicationEvidenceScope,
    documentId: string,
    lock = false,
  ) {
    const rows = lock
      ? await executor`
      select * from evidence.document_upload_sessions where tenant_id=${s.tenantId} and gateq_application_id=${s.applicationId} and gateq_session_id=${s.sessionId} and document_id=${documentId} for update`
      : await executor`select * from evidence.document_upload_sessions where tenant_id=${s.tenantId} and gateq_application_id=${s.applicationId} and gateq_session_id=${s.sessionId} and document_id=${documentId}`;
    if (rows.length !== 1) throw new GateQApplicationEvidenceScopeError();
    return SessionRow.parse(rows[0]);
  }
  async function create(command: {
    readonly credential: string;
    readonly input: z.input<typeof CreateInput>;
  }): Promise<{
    readonly documentId: string;
    readonly uploadSessionId: string;
    readonly expiresAt: string;
    readonly upload: DirectUploadAuthorization | undefined;
  }> {
    const s = await scope(command.credential, true);
    const input = CreateInput.parse(command.input);
    const filename = sanitiseOriginalFilename(input.filename);
    if (!filename.ok)
      throw new DocumentUploadRejectedError(filename.failureCode);
    const claimed = checkClaimedType({
      filename: filename.filename,
      declaredMimeType: input.declaredMimeType,
    });
    if (!claimed.ok) throw new DocumentUploadRejectedError(claimed.failureCode);
    if (input.declaredSizeBytes > deps.uploads.maxBytes)
      throw new DocumentUploadRejectedError("FILE_TOO_LARGE");
    const requestKey = hash(input.clientRequestId);
    const requestHash = hash(
      JSON.stringify([
        filename.filename,
        input.declaredMimeType.toLowerCase(),
        input.declaredSizeBytes,
      ]),
    );
    const result = await deps.transactions.run(async (tx) => {
      await lockScope(tx, s);
      const previous =
        await tx.sql`select * from evidence.document_upload_sessions where tenant_id=${s.tenantId} and gateq_application_id=${s.applicationId} and gateq_session_id=${s.sessionId} and guest_idempotency_hash=${requestKey}`;
      if (previous.length !== 0) {
        const replay = SessionRow.parse(previous[0]);
        if (replay.guest_request_hash !== requestHash)
          throw new DocumentUploadCreationConflictError();
        return replay;
      }
      const counts = z
        .object({
          count: z.coerce.number(),
          bytes: z.coerce.number(),
          open: z.coerce.number(),
        })
        .parse(
          (
            await tx.sql`
        select count(*) as count, coalesce(sum(declared_size_bytes),0) as bytes,
        count(*) filter (where status in ('PENDING_AUTHORIZATION','AUTHORIZED','FINALIZING')) as open
        from evidence.document_upload_sessions where tenant_id=${s.tenantId} and gateq_application_id=${s.applicationId}`
          )[0],
        );
      if (
        counts.count >= deps.maxDocuments ||
        counts.bytes + input.declaredSizeBytes > deps.maxTotalBytes ||
        counts.open >= deps.uploads.maxOpenSessions
      )
        throw new EvidenceRuleError("application upload limit reached");
      const document = z.object({ id: DocumentIdSchema }).parse(
        (
          await tx.sql`
        insert into evidence.documents (tenant_id,owner_kind,gateq_application_id,gateq_session_id,owner_organisation_id,created_by_user_id,title,visibility_scope,sensitivity_class)
        values (${s.tenantId},'GATEQ_APPLICATION',${s.applicationId},${s.sessionId},null,null,${filename.filename.slice(0, 200)},'personal_private','CONFIDENTIAL') returning id`
        )[0],
      );
      const expiry = new Date(
        Math.min(
          Date.parse(s.expiresAt),
          Date.now() + deps.uploads.sessionTtlSeconds * 1000,
        ),
      ).toISOString();
      return SessionRow.parse(
        (
          await tx.sql`
        insert into evidence.document_upload_sessions (tenant_id,owner_organisation_id,created_by_user_id,gateq_application_id,gateq_session_id,guest_idempotency_hash,guest_request_hash,document_id,storage_bucket,storage_key,original_filename,declared_mime_type,declared_size_bytes,authorising_capability,expires_at)
        values (${s.tenantId},null,null,${s.applicationId},${s.sessionId},${requestKey},${requestHash},${document.id},${deps.uploads.bucket},${createDocumentStorageKey(s.tenantId)},${filename.filename},${input.declaredMimeType.toLowerCase()},${input.declaredSizeBytes},'gateq.application.upload',${expiry}) returning *`
        )[0],
      );
    });
    if (!["PENDING_AUTHORIZATION", "AUTHORIZED"].includes(result.status))
      return {
        documentId: result.document_id,
        uploadSessionId: result.id,
        expiresAt: result.expires_at.toISOString(),
        upload: undefined,
      };
    if (result.expires_at.getTime() <= Date.now())
      throw new DocumentUploadStateError("this upload has expired");
    const upload = await deps.storage.createUploadAuthorization({
      object: { bucket: result.storage_bucket, key: result.storage_key },
      contentType: result.declared_mime_type,
      maxBytes: Math.min(deps.uploads.maxBytes, result.declared_size_bytes),
    });
    await deps.transactions.run(async (tx) => {
      await lockScope(tx, s);
      await tx.sql`update evidence.document_upload_sessions set status='AUTHORIZED',version=version+1 where id=${result.id} and tenant_id=${s.tenantId} and status='PENDING_AUTHORIZATION'`;
    });
    return {
      documentId: result.document_id,
      uploadSessionId: result.id,
      expiresAt: result.expires_at.toISOString(),
      upload,
    };
  }
  async function complete(command: {
    readonly credential: string;
    readonly documentId: string;
    readonly correlationId: CorrelationId;
    readonly clientSha256?: string;
  }): Promise<{
    readonly documentId: string;
    readonly versionId: string;
    readonly status: "PROCESSING";
  }> {
    const s = await scope(command.credential, true);
    const documentId = DocumentIdSchema.parse(command.documentId);
    const current = await session(deps.sql, s, documentId);
    if (current.status === "COMPLETED" && current.document_version_id !== null)
      return {
        documentId,
        versionId: current.document_version_id,
        status: "PROCESSING",
      };
    if (!["AUTHORIZED", "FINALIZING"].includes(current.status))
      throw new DocumentUploadStateError("this upload cannot be completed");
    const object = { bucket: current.storage_bucket, key: current.storage_key };
    const refuse = async (
      code: import("../contracts/upload.js").DocumentUploadFailureCode,
    ) => {
      // Refuse under the shared lock before deleting: a racing successful
      // completion must never have its immutable object's bytes removed.
      const refused = await deps.transactions.run(async (tx) => {
        await lockScope(tx, s);
        const locked = await session(tx.sql, s, documentId, true);
        if (locked.status === "COMPLETED") return false;
        await tx.sql`update evidence.document_upload_sessions set status=${code === "UPLOAD_EXPIRED" ? "EXPIRED" : "REJECTED"},failure_code=${code},cleanup_pending=true,version=version+1 where id=${locked.id} and tenant_id=${s.tenantId}`;
        return true;
      });
      if (refused) {
        try {
          await deps.storage.deleteObject(object);
          await deps.sql`update evidence.document_upload_sessions set cleanup_pending=false where id=${current.id} and tenant_id=${s.tenantId} and gateq_application_id=${s.applicationId} and status in ('REJECTED','EXPIRED')`;
        } catch {
          /* Private, refused bytes remain recorded as cleanup debt. */
        }
      }
      return new DocumentUploadRejectedError(code);
    };
    if (current.expires_at.getTime() <= Date.now())
      throw await refuse("UPLOAD_EXPIRED");
    await deps.transactions.run(async (tx) => {
      await lockScope(tx, s);
      await tx.sql`update evidence.document_upload_sessions set status='FINALIZING',version=version+1 where id=${current.id} and tenant_id=${s.tenantId} and status='AUTHORIZED'`;
    });
    const verified = await validateUploadedDocument({
      storage: deps.storage,
      object,
      maxBytes: Math.min(deps.uploads.maxBytes, current.declared_size_bytes),
      filename: current.original_filename,
      declaredMimeType: current.declared_mime_type,
      clientSha256: command.clientSha256,
      refuse,
    });
    if (verified.sizeBytes !== current.declared_size_bytes)
      throw await refuse("SIZE_MISMATCH");
    return deps.transactions.run(async (tx) => {
      await lockScope(tx, s);
      const locked = await session(tx.sql, s, documentId, true);
      if (locked.status === "COMPLETED" && locked.document_version_id !== null)
        return {
          documentId,
          versionId: locked.document_version_id,
          status: "PROCESSING" as const,
        };
      if (
        locked.status !== "FINALIZING" ||
        locked.expires_at.getTime() <= Date.now()
      )
        throw new DocumentUploadStateError("this upload cannot be completed");
      const version = z.object({ id: DocumentVersionIdSchema }).parse(
        (
          await tx.sql`
        insert into evidence.document_versions (tenant_id,document_id,version_number,storage_bucket,storage_key,original_filename,mime_type,size_bytes,sha256,uploaded_by_user_id,gateq_session_id)
        values (${s.tenantId},${documentId},1,${locked.storage_bucket},${locked.storage_key},${locked.original_filename},${verified.mimeType},${verified.sizeBytes},${verified.sha256},null,${s.sessionId}) returning id`
        )[0],
      );
      await tx.sql`update evidence.documents set current_version_id=${version.id},version=version+1 where id=${documentId} and tenant_id=${s.tenantId} and gateq_application_id=${s.applicationId}`;
      await tx.sql`update evidence.document_upload_sessions set status='COMPLETED',document_version_id=${version.id},finalized_at=now(),version=version+1 where id=${locked.id} and tenant_id=${s.tenantId}`;
      await deps.outbox.enqueue(
        tx,
        applicationDocumentVersionCreatedEvent(
          { tenantId: s.tenantId, correlationId: command.correlationId },
          {
            documentId,
            documentVersionId: version.id,
            versionNumber: 1,
            supersedesVersionId: null,
          },
        ),
      );
      return {
        documentId,
        versionId: version.id,
        status: "PROCESSING" as const,
      };
    });
  }
  async function list(command: {
    readonly credential: string;
  }): Promise<readonly GateQApplicationEvidenceItem[]> {
    const s = await scope(command.credential);
    const rows = await deps.sql`
      select d.id as document_id,v.id as version_id,u.original_filename,u.status as upload_status,u.declared_size_bytes,
      v.processing_status,v.malware_scan_status,v.text_extraction_status,v.sha256,
      x.page_count,x.instruction_risk_signals
      from evidence.documents d join evidence.document_upload_sessions u on u.document_id=d.id and u.tenant_id=d.tenant_id
      left join evidence.document_versions v on v.id=d.current_version_id and v.tenant_id=d.tenant_id
      left join lateral (select page_count,instruction_risk_signals from evidence.document_extractions where document_version_id=v.id and tenant_id=d.tenant_id order by created_at desc limit 1) x on true
      where d.tenant_id=${s.tenantId} and d.gateq_application_id=${s.applicationId} and d.gateq_session_id=${s.sessionId} and d.status='ACTIVE' order by d.created_at,d.id`;
    return rows.map((row) => {
      const r = z
        .object({
          document_id: z.string().uuid(),
          version_id: z.string().uuid().nullable(),
          original_filename: z.string(),
          upload_status: z.string(),
          declared_size_bytes: z.coerce.number(),
          processing_status: z.string().nullable(),
          malware_scan_status: z.string().nullable(),
          text_extraction_status: z.string().nullable(),
          sha256: z.string().nullable(),
          page_count: z.number().nullable(),
          instruction_risk_signals: z.number().nullable(),
        })
        .parse(row);
      const status =
        r.malware_scan_status === "BLOCKED"
          ? "BLOCKED"
          : ["REJECTED", "EXPIRED", "CANCELLED"].includes(r.upload_status) ||
              r.processing_status === "FAILED" ||
              r.malware_scan_status === "ERROR"
            ? "FAILED"
            : r.processing_status === "COMPLETED" &&
                r.text_extraction_status === "COMPLETED" &&
                ["CLEAN", "NOT_SCANNED"].includes(r.malware_scan_status ?? "")
              ? "READY"
              : "PROCESSING";
      return {
        documentId: r.document_id,
        versionId: r.version_id,
        fileName: r.original_filename,
        status,
        uploadStatus: r.upload_status,
        byteSize: r.declared_size_bytes,
        pages: r.page_count,
        malwareStatus: r.malware_scan_status,
        extractionStatus: r.text_extraction_status,
        sha256: r.sha256,
        instructionRiskSignals: r.instruction_risk_signals ?? 0,
      };
    });
  }
  /** Server-only Q data bridge. Selected IDs are filtered before any text
   * leaves Evidence; processing/blocked/instruction-risk material is withheld. */
  async function readReadyPages(command: {
    readonly credential: string;
    readonly documentIds: readonly string[];
  }): Promise<
    readonly {
      readonly documentId: string;
      readonly versionId: string;
      readonly fileName: string;
      readonly sha256: string;
      readonly page: number;
      readonly text: string;
      readonly truncated: boolean;
      readonly malwareStatus: "CLEAN" | "NOT_SCANNED";
      readonly extractionStatus: "COMPLETED";
    }[]
  > {
    const s = await scope(command.credential);
    const ids = z
      .array(DocumentIdSchema)
      .max(deps.maxDocuments)
      .parse(command.documentIds);
    if (ids.length === 0) return [];
    const rows = await deps.sql`
      select d.id as document_id,v.id as version_id,v.original_filename,v.sha256,v.malware_scan_status,p.page_number,
      left(p.text,1000) as text,(char_length(p.text)>1000) as truncated
      from evidence.documents d join evidence.document_versions v on v.id=d.current_version_id and v.tenant_id=d.tenant_id
      join lateral (select id,instruction_risk_signals from evidence.document_extractions x where x.document_version_id=v.id and x.tenant_id=d.tenant_id order by x.created_at desc limit 1) x on true
      join evidence.document_pages p on p.extraction_id=x.id and p.document_version_id=v.id and p.tenant_id=d.tenant_id
      where d.tenant_id=${s.tenantId} and d.gateq_application_id=${s.applicationId} and d.gateq_session_id=${s.sessionId}
      and d.id=any(${deps.sql.array(ids)}::uuid[]) and x.instruction_risk_signals=0 and d.status='ACTIVE' and d.custody_cleanup_started_at is null
      and v.processing_status='COMPLETED' and v.text_extraction_status='COMPLETED' and v.malware_scan_status in ('CLEAN','NOT_SCANNED')
      order by d.id,p.page_number limit 24`;
    return rows.map((row) => {
      const r = z
        .object({
          document_id: DocumentIdSchema,
          version_id: DocumentVersionIdSchema,
          original_filename: z.string(),
          sha256: z.string().regex(/^[0-9a-f]{64}$/),
          malware_scan_status: z.enum(["CLEAN", "NOT_SCANNED"]),
          page_number: z.number().int().positive(),
          text: z.string().max(1000),
          truncated: z.boolean(),
        })
        .parse(row);
      return {
        documentId: r.document_id,
        versionId: r.version_id,
        fileName: r.original_filename,
        sha256: r.sha256,
        page: r.page_number,
        text: r.text,
        truncated: r.truncated,
        malwareStatus: r.malware_scan_status,
        extractionStatus: "COMPLETED" as const,
      };
    });
  }
  /** Trusted worker retention, not a guest HTTP operation. No valid session
   * and no submitted disclosure may exist when cleanup begins. */
  async function cleanupExpired(command: {
    readonly limit: number;
  }): Promise<{ readonly deleted: number; readonly pending: number }> {
    const limit = z.number().int().min(1).max(50).parse(command.limit);
    const candidates = await deps.sql`
      select d.id,d.tenant_id,d.gateq_application_id from evidence.documents d
      join gateq.applications a on a.id=d.gateq_application_id and a.tenant_id=d.tenant_id
      where d.owner_kind='GATEQ_APPLICATION' and d.custody_deleted_at is null and a.status <> 'SUBMITTED'
      and not exists (select 1 from gateq.application_sessions s where s.application_id=a.id and s.tenant_id=a.tenant_id and s.revoked_at is null and s.expires_at > now())
      order by d.created_at,d.id limit ${limit}`;
    let deleted = 0;
    let pending = 0;
    for (const candidate of candidates) {
      const c = z
        .object({
          id: DocumentIdSchema,
          tenant_id: TenantIdSchema,
          gateq_application_id: z.string().uuid(),
        })
        .parse(candidate);
      const objects = await deps.transactions.run(async (tx) => {
        const permitted = await tx.sql`
          select a.id from gateq.applications a where a.id=${c.gateq_application_id} and a.tenant_id=${c.tenant_id} and a.status <> 'SUBMITTED'
          and not exists(select 1 from gateq.application_sessions s where s.application_id=a.id and s.tenant_id=a.tenant_id and s.revoked_at is null and s.expires_at > now()) for update`;
        if (permitted.length !== 1) return null;
        await tx.sql`update evidence.documents set status='ARCHIVED',custody_cleanup_started_at=coalesce(custody_cleanup_started_at,now()),version=version+1 where id=${c.id} and tenant_id=${c.tenant_id} and owner_kind='GATEQ_APPLICATION'`;
        return tx.sql`
          select storage_bucket as bucket,storage_key as key from evidence.document_upload_sessions where document_id=${c.id} and tenant_id=${c.tenant_id}
          union select artifact_bucket as bucket,artifact_key as key from evidence.document_extractions where document_id=${c.id} and tenant_id=${c.tenant_id}`;
      });
      if (objects === null) continue;
      try {
        for (const object of objects)
          await deps.storage.deleteObject(
            z.object({ bucket: z.string(), key: z.string() }).parse(object),
          );
        await deps.transactions.run(async (tx) => {
          await tx.sql`update evidence.documents set custody_deleted_at=now(),version=version+1 where id=${c.id} and tenant_id=${c.tenant_id} and custody_cleanup_started_at is not null`;
          await tx.sql`delete from evidence.document_pages where document_id=${c.id} and tenant_id=${c.tenant_id}`;
        });
        deleted += 1;
      } catch {
        pending += 1;
      }
    }
    return { deleted, pending };
  }
  return { create, complete, list, readReadyPages, cleanupExpired };
}
export type GateQApplicationEvidenceService = ReturnType<
  typeof createGateQApplicationEvidenceService
>;
