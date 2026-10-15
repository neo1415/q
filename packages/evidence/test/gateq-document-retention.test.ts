import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import { createGateQApplicationEvidenceService } from "../src/application/gateq-application-evidence.js";
const applicationId = randomUUID();
const documentId = randomUUID();
const tenantId = randomUUID();
function fixture(processing = false) {
  const calls: string[] = [];
  const sql = Object.assign(
    vi.fn((parts: TemplateStringsArray) => {
      const q = parts.join("?").replace(/\s+/g, " ").trim();
      calls.push(q);
      if (q.startsWith("select d.id"))
        return Promise.resolve([
          {
            id: documentId,
            tenant_id: tenantId,
            gateq_application_id: applicationId,
          },
        ]);
      if (q.startsWith("select a.id"))
        return Promise.resolve([{ id: applicationId }]);
      if (q.startsWith("select r.id"))
        return Promise.resolve(processing ? [{ id: randomUUID() }] : []);
      if (q.startsWith("select storage_bucket"))
        return Promise.resolve([
          { bucket: "cq-documents-private", key: "uploads/private.pdf" },
        ]);
      return Promise.resolve([]);
    }),
    { array: (values: readonly unknown[]) => values },
  ) as unknown as DatabaseExecutor;
  const deleteObject = vi.fn(() => Promise.resolve());
  const service = createGateQApplicationEvidenceService({
    sql,
    transactions: {
      run: (work) => work({ sql: sql as TransactionContext["sql"] }),
    },
    authorise: vi.fn(),
    outbox: { enqueue: vi.fn() },
    storage: {
      createUploadAuthorization: vi.fn(),
      statObject: vi.fn(),
      openObjectStream: vi.fn(),
      putObject: vi.fn(),
      deleteObject,
    },
    uploads: {
      bucket: "cq-documents-private",
      maxBytes: 1024,
      maxOpenSessions: 3,
      sessionTtlSeconds: 600,
    },
    maxDocuments: 10,
    maxTotalBytes: 10240,
  });
  return { service, calls, deleteObject };
}
describe("never-disclosed application retention", () => {
  it("uses per-document disclosure and retention age, including leftovers after Submit", async () => {
    const f = fixture();
    expect(await f.service.cleanupExpired({ limit: 1 })).toEqual({
      deleted: 1,
      pending: 0,
    });
    const candidate = f.calls[0];
    const locked = f.calls.find((q) => q.startsWith("select a.id"));
    expect(candidate).toContain(
      "not exists(select 1 from evidence.gateq_application_document_disclosures",
    );
    expect(locked).toContain(
      "not exists(select 1 from evidence.gateq_application_document_disclosures",
    );
    expect(candidate).not.toContain("a.status <> 'SUBMITTED'");
    expect(candidate).toContain("s.expires_at > now()");
    expect(candidate).not.toContain("s.revoked_at is null");
    expect(locked).toContain(
      "not evidence.gateq_upload_authorization_retired(u)",
    );
    expect(f.deleteObject).toHaveBeenCalledOnce();
  });
  it("locks the document before a fresh active-processing read and refuses erasure while a worker can write", async () => {
    const f = fixture(true);
    expect(await f.service.cleanupExpired({ limit: 1 })).toEqual({
      deleted: 0,
      pending: 0,
    });
    const docLock = f.calls.findIndex(
      (q) => q.startsWith("select d.id") && q.includes("for update"),
    );
    const active = f.calls.findIndex((q) => q.startsWith("select r.id"));
    expect(docLock).toBeGreaterThan(-1);
    expect(active).toBeGreaterThan(docLock);
    expect(f.calls[active]).toContain("r.status in ('QUEUED','RUNNING')");
    expect(f.calls.some((q) => q.startsWith("update evidence.documents"))).toBe(
      false,
    );
    expect(f.deleteObject).not.toHaveBeenCalled();
  });
  it("records incomplete storage cleanup without erasing pages or claiming deletion", async () => {
    const f = fixture();
    f.deleteObject.mockRejectedValue(new Error("storage unavailable"));
    expect(await f.service.cleanupExpired({ limit: 1 })).toEqual({
      deleted: 0,
      pending: 1,
    });
    expect(
      f.calls.some((q) => q.includes("custody_cleanup_started_at=coalesce")),
    ).toBe(true);
    expect(f.calls.some((q) => q.includes("custody_deleted_at=now()"))).toBe(
      false,
    );
    expect(
      f.calls.some((q) => q.startsWith("delete from evidence.document_pages")),
    ).toBe(false);
  });
});
