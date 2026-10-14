import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import { UtcTimestampSchema } from "@capital-q/contracts";
import { createCompleteDocumentProcessing } from "../src/application/processing-use-cases.js";
import { createPostgresEvidenceRepositories } from "../src/infrastructure/postgres-repositories.js";
import {
  DocumentIdSchema,
  DocumentVersionIdSchema,
  DocumentProcessingRunIdSchema,
  type DocumentVersion,
  type ApplicationOwnedDocument,
  type DocumentProcessingRun,
} from "../src/contracts/index.js";
import type { OutboxWriter } from "@capital-q/eventing";
import { TenantIdSchema } from "@capital-q/security";
import {
  createGateQApplicationEvidenceService,
  GateQApplicationEvidenceScopeError,
  type GateQApplicationEvidenceScope,
} from "../src/application/gateq-application-evidence.js";
import {
  DocumentUploadCreationConflictError,
  EvidenceRuleError,
} from "../src/domain/errors.js";
import { FIXTURES } from "./upload-fixtures.js";

const correlationId = `cor_${randomUUID()}` as const;
const tenantId = TenantIdSchema.parse(randomUUID());
const applicationId = randomUUID();
const sessionId = randomUUID();
const documentId = randomUUID();
const uploadId = randomUUID();
const versionId = randomUUID();
const input = {
  filename: "pitch.pdf",
  declaredMimeType: "application/pdf",
  declaredSizeBytes: FIXTURES.pdf.byteLength,
  clientRequestId: "request-one",
};
const validScope: GateQApplicationEvidenceScope = {
  tenantId,
  applicationId,
  sessionId,
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  open: true,
  contactConfirmed: true,
};
const requestHash = createHash("sha256")
  .update(
    JSON.stringify([
      input.filename,
      input.declaredMimeType,
      input.declaredSizeBytes,
    ]),
  )
  .digest("hex");
function row(status = "AUTHORIZED") {
  return {
    id: uploadId,
    document_id: documentId,
    storage_bucket: "cq-documents-private",
    storage_key: "uploads/safe.pdf",
    original_filename: input.filename,
    declared_mime_type: input.declaredMimeType,
    declared_size_bytes: input.declaredSizeBytes,
    status,
    expires_at: new Date(Date.now() + 600_000),
    document_version_id: status === "COMPLETED" ? versionId : null,
    guest_request_hash: requestHash,
  };
}
function fixture(
  handler: (
    query: string,
    values: readonly unknown[],
  ) => readonly unknown[] = () => [],
) {
  const calls: { query: string; values: readonly unknown[] }[] = [];
  const execute = vi.fn(
    (strings: TemplateStringsArray, ...values: readonly unknown[]) => {
      const query = strings.join("?").replace(/\s+/g, " ").trim();
      calls.push({ query, values });
      return Promise.resolve(handler(query, values));
    },
  );
  const sql = Object.assign(execute, {
    array: (values: readonly unknown[]) => values,
  }) as unknown as DatabaseExecutor;
  const authorise = vi.fn(() => Promise.resolve(validScope));
  const createUploadAuthorization = vi.fn(() =>
    Promise.resolve({
      method: "PUT" as const,
      url: "https://storage.invalid/upload",
      headers: {},
      providerExpiresAt: validScope.expiresAt,
    }),
  );
  const deleteObject = vi.fn(() => Promise.resolve());
  const enqueue = vi.fn<OutboxWriter["enqueue"]>(() =>
    Promise.resolve({ status: "ENQUEUED" }),
  );
  const service = createGateQApplicationEvidenceService({
    sql,
    transactions: {
      run: (work) => work({ sql: sql as TransactionContext["sql"] }),
    },
    authorise,
    storage: {
      createUploadAuthorization,
      statObject: () =>
        Promise.resolve({
          sizeBytes: FIXTURES.pdf.byteLength,
          declaredContentType: null,
        }),
      openObjectStream: () =>
        Promise.resolve({
          body: {
            [Symbol.asyncIterator]: () => ({
              next: vi
                .fn()
                .mockResolvedValueOnce({ done: false, value: FIXTURES.pdf })
                .mockResolvedValue({ done: true }),
            }),
          },
        }),
      deleteObject,
      putObject: () => Promise.resolve(),
    },
    outbox: { enqueue },
    uploads: {
      bucket: "cq-documents-private",
      maxBytes: 1024 * 1024,
      sessionTtlSeconds: 600,
      maxOpenSessions: 3,
    },
    maxDocuments: 5,
    maxTotalBytes: 3 * 1024 * 1024,
  });
  return {
    service,
    authorise,
    createUploadAuthorization,
    enqueue,
    calls,
    sql,
    deleteObject,
  };
}
describe("application-owned canonical Evidence", () => {
  it("fails closed before storage or persistence when contact proof or scope is absent", async () => {
    const f = fixture();
    f.authorise.mockRejectedValue(new GateQApplicationEvidenceScopeError());
    await expect(
      f.service.create({ credential: "opaque-session", input }),
    ).rejects.toThrow("SESSION_INVALID");
    expect(f.calls).toHaveLength(0);
    expect(f.createUploadAuthorization).not.toHaveBeenCalled();
  });
  it("refuses expired authorization before a SQL or storage call", async () => {
    const f = fixture();
    f.authorise.mockResolvedValue({
      ...validScope,
      expiresAt: "2020-01-01T00:00:00.000Z",
    });
    await expect(
      f.service.list({ credential: "opaque-session" }),
    ).rejects.toThrow("SESSION_INVALID");
    expect(f.calls).toHaveLength(0);
  });
  it("cannot complete another application/session document", async () => {
    const f = fixture();
    await expect(
      f.service.complete({
        credential: "opaque-session",
        documentId: randomUUID(),
        correlationId: correlationId,
      }),
    ).rejects.toThrow("SESSION_INVALID");
    const query = f.calls[0];
    expect(query?.query).toContain(
      "gateq_application_id=? and gateq_session_id=?",
    );
    expect(query?.values).toContain(applicationId);
    expect(query?.values).toContain(sessionId);
    expect(f.enqueue).not.toHaveBeenCalled();
  });
  it("replays the same request without charging another document or allocating another identity", async () => {
    const f = fixture((q) =>
      q.startsWith("select a.id")
        ? [{ id: applicationId }]
        : q.startsWith("select *")
          ? [row()]
          : [],
    );
    const result = await f.service.create({
      credential: "opaque-session",
      input,
    });
    expect(result.documentId).toBe(documentId);
    expect(f.calls.some((c) => c.query.startsWith("insert"))).toBe(false);
    expect(f.createUploadAuthorization).toHaveBeenCalledOnce();
    expect(f.calls[0]?.query).toContain("email_confirmed_at is not null");
  });
  it("binds the retry key to the original filename/type/size", async () => {
    const f = fixture((q) =>
      q.startsWith("select a.id")
        ? [{ id: applicationId }]
        : q.startsWith("select *")
          ? [row()]
          : [],
    );
    await expect(
      f.service.create({
        credential: "opaque-session",
        input: { ...input, filename: "different.pdf" },
      }),
    ).rejects.toBeInstanceOf(DocumentUploadCreationConflictError);
    expect(f.createUploadAuthorization).not.toHaveBeenCalled();
  });
  it("enforces shared application limits before any durable document or target is created", async () => {
    const f = fixture((q) =>
      q.startsWith("select a.id")
        ? [{ id: applicationId }]
        : q.startsWith("select count(*)")
          ? [{ count: 5, bytes: 0, open: 0 }]
          : [],
    );
    await expect(
      f.service.create({ credential: "opaque-session", input }),
    ).rejects.toBeInstanceOf(EvidenceRuleError);
    expect(f.calls.some((c) => c.query.startsWith("insert"))).toBe(false);
    expect(f.createUploadAuthorization).not.toHaveBeenCalled();
  });
  it("validates actual bytes and atomically emits the existing version fact with no invented actor or organisation", async () => {
    const f = fixture((q) =>
      q.startsWith("select a.id")
        ? [{ id: applicationId }]
        : q.startsWith("select *")
          ? [row(q.includes("for update") ? "FINALIZING" : "AUTHORIZED")]
          : q.startsWith("insert into evidence.document_versions")
            ? [{ id: versionId }]
            : [],
    );
    const result = await f.service.complete({
      credential: "opaque-session",
      documentId,
      correlationId: correlationId,
    });
    expect(result).toEqual({ documentId, versionId, status: "PROCESSING" });
    expect(f.enqueue).toHaveBeenCalledOnce();
    const event = f.enqueue.mock.calls[0]?.[1];
    expect(event).toMatchObject({
      type: "evidence.document.version_created",
      tenantId,
      data: { documentId, documentVersionId: versionId, versionNumber: 1 },
    });
    expect(event).not.toHaveProperty("organisationId");
    expect(event).not.toHaveProperty("actor");
    const insert = f.calls.find((c) =>
      c.query.startsWith("insert into evidence.document_versions"),
    );
    expect(insert?.query).toContain("uploaded_by_user_id,gateq_session_id");
    expect(insert?.query).toContain("null");
    expect(insert?.values).toContain(
      createHash("sha256").update(FIXTURES.pdf).digest("hex"),
    );
  });
  it("does not enqueue twice when completion is replayed", async () => {
    const f = fixture(() => [row("COMPLETED")]);
    expect(
      await f.service.complete({
        credential: "opaque-session",
        documentId,
        correlationId: correlationId,
      }),
    ).toEqual({ documentId, versionId, status: "PROCESSING" });
    expect(f.enqueue).not.toHaveBeenCalled();
  });
  it("bounds trusted cleanup batches and skips an application that became live before its lock", async () => {
    const f = fixture((q) =>
      q.startsWith("select d.id")
        ? [
            {
              id: documentId,
              tenant_id: tenantId,
              gateq_application_id: applicationId,
            },
          ]
        : [],
    );
    await expect(f.service.cleanupExpired({ limit: 51 })).rejects.toThrow();
    expect(await f.service.cleanupExpired({ limit: 1 })).toEqual({
      deleted: 0,
      pending: 0,
    });
    expect(f.calls.some((c) => c.query.startsWith("update"))).toBe(false);
  });
  it("filters selected pages by application custody, current version, readiness and latest instruction-risk scan", async () => {
    const f = fixture();
    expect(
      await f.service.readReadyPages({
        credential: "opaque-session",
        documentIds: [documentId],
      }),
    ).toEqual([]);
    const query = f.calls[0];
    expect(query?.query).toContain(
      "d.gateq_application_id=? and d.gateq_session_id=?",
    );
    expect(query?.query).toContain("x.instruction_risk_signals=0");
    expect(query?.query).toContain("v.processing_status='COMPLETED'");
    expect(query?.query).toContain(
      "v.malware_scan_status in ('CLEAN','NOT_SCANNED')",
    );
    expect(query?.query).toContain("limit 24");
    expect(query?.values).toContainEqual([documentId]);
  });
  it("completes application processing without publishing an organisation-facing ready event", async () => {
    const f = fixture();
    const now = UtcTimestampSchema.parse(new Date().toISOString());
    const version: DocumentVersion = {
      id: DocumentVersionIdSchema.parse(versionId),
      tenantId,
      documentId: DocumentIdSchema.parse(documentId),
      versionNumber: 1,
      storageBucket: "cq-documents-private",
      storageKey: "uploads/guest.pdf",
      originalFilename: "pitch.pdf",
      mimeType: "application/pdf",
      sizeBytes: 128,
      sha256: "a".repeat(64),
      uploadedByUserId: null,
      uploadedAt: now,
      supersedesVersionId: null,
      processingStatus: "COMPLETED",
      malwareScanStatus: "NOT_SCANNED",
      textExtractionStatus: "COMPLETED",
    };
    const document: ApplicationOwnedDocument = {
      id: version.documentId,
      tenantId,
      companyId: null,
      ownerOrganisationId: null,
      createdByUserId: null,
      applicationId,
      applicationSessionId: sessionId,
      documentType: "PITCH_DECK",
      title: "Guest pitch",
      visibilityScope: "personal_private",
      sensitivityClass: "CONFIDENTIAL",
      downloadAudience: "ORGANISATION",
      currentVersionId: version.id,
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
      version: 2,
    };
    const run: DocumentProcessingRun = {
      id: DocumentProcessingRunIdSchema.parse(randomUUID()),
      documentVersionId: version.id,
      pipelineVersion: "document-v1",
      status: "RUNNING",
      startedAt: now,
      completedAt: null,
      errorCode: null,
      extractorVersion: null,
      chunkingVersion: null,
      classifierVersion: null,
      embeddingModelId: null,
      costUsd: "0",
      metadata: {},
      createdAt: now,
    };
    const repositories = createPostgresEvidenceRepositories();
    const transition = vi.fn(() =>
      Promise.resolve({ ...run, status: "COMPLETED" as const }),
    );
    const complete = createCompleteDocumentProcessing({
      sql: f.sql,
      transactions: {
        run: (work) => work({ sql: f.sql as TransactionContext["sql"] }),
      },
      outbox: { enqueue: f.enqueue },
      repositories: {
        ...repositories,
        documents: {
          ...repositories.documents,
          findForProcessing: () => Promise.resolve(document),
        },
        documentVersions: {
          ...repositories.documentVersions,
          updateProcessingState: () => Promise.resolve(version),
        },
        processingRuns: {
          ...repositories.processingRuns,
          findById: () => Promise.resolve(run),
          transition,
        },
      },
    });
    expect(
      await complete({
        tenantId,
        documentVersionId: version.id,
        runId: run.id,
        pipelineVersion: run.pipelineVersion,
        correlationId: correlationId,
        scannedClean: false,
        notScanned: true,
      }),
    ).toEqual({ emitted: false });
    expect(transition).toHaveBeenCalledOnce();
    expect(f.enqueue).not.toHaveBeenCalled();
  });
  it("tombstones expired custody, removes original and derived bytes, then erases private page text", async () => {
    const f = fixture((q) =>
      q.startsWith("select d.id")
        ? [
            {
              id: documentId,
              tenant_id: tenantId,
              gateq_application_id: applicationId,
            },
          ]
        : q.startsWith("select a.id")
          ? [{ id: applicationId }]
          : q.startsWith("select storage_bucket")
            ? [
                { bucket: "cq-documents-private", key: "uploads/safe.pdf" },
                {
                  bucket: "cq-extractions-private",
                  key: "extractions/safe.json",
                },
              ]
            : [],
    );
    expect(await f.service.cleanupExpired({ limit: 1 })).toEqual({
      deleted: 1,
      pending: 0,
    });
    expect(f.deleteObject).toHaveBeenCalledTimes(2);
    expect(
      f.calls.some((c) =>
        c.query.includes("custody_cleanup_started_at=coalesce"),
      ),
    ).toBe(true);
    expect(
      f.calls.some((c) => c.query.includes("custody_deleted_at=now()")),
    ).toBe(true);
    expect(
      f.calls.some((c) =>
        c.query.startsWith("delete from evidence.document_pages"),
      ),
    ).toBe(true);
  });
  it("records cleanup debt instead of claiming erased content after a storage failure", async () => {
    const f = fixture((q) =>
      q.startsWith("select d.id")
        ? [
            {
              id: documentId,
              tenant_id: tenantId,
              gateq_application_id: applicationId,
            },
          ]
        : q.startsWith("select a.id")
          ? [{ id: applicationId }]
          : q.startsWith("select storage_bucket")
            ? [{ bucket: "cq-documents-private", key: "uploads/safe.pdf" }]
            : [],
    );
    f.deleteObject.mockRejectedValue(new Error("Storage unavailable"));
    expect(await f.service.cleanupExpired({ limit: 1 })).toEqual({
      deleted: 0,
      pending: 1,
    });
    expect(
      f.calls.some((c) =>
        c.query.includes("custody_cleanup_started_at=coalesce"),
      ),
    ).toBe(true);
    expect(
      f.calls.some((c) => c.query.includes("custody_deleted_at=now()")),
    ).toBe(false);
    expect(
      f.calls.some((c) =>
        c.query.startsWith("delete from evidence.document_pages"),
      ),
    ).toBe(false);
  });
  it("keeps submitted receipt reads available while refusing new upload writes", async () => {
    const f = fixture();
    f.authorise.mockResolvedValue({ ...validScope, open: false });
    expect(await f.service.list({ credential: "opaque-session" })).toEqual([]);
    expect(
      await f.service.readReadyPages({
        credential: "opaque-session",
        documentIds: [],
      }),
    ).toEqual([]);
    await expect(
      f.service.create({ credential: "opaque-session", input }),
    ).rejects.toThrow("SESSION_INVALID");
    await expect(
      f.service.complete({
        credential: "opaque-session",
        documentId,
        correlationId,
      }),
    ).rejects.toThrow("SESSION_INVALID");
    expect(f.calls).toHaveLength(1);
    expect(f.createUploadAuthorization).not.toHaveBeenCalled();
  });
});
