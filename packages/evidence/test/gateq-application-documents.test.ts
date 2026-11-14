import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import { TenantIdSchema } from "@capital-q/security";
import {
  createGateQApplicationEvidenceService,
  GateQApplicationDocumentDisclosedError,
  GateQApplicationEvidenceScopeError,
  gateqApplicationDocumentStatus,
} from "../src/application/gateq-application-evidence.js";
import { createGateQApplicationDocumentPort } from "../src/application/gateq-application-document-port.js";

/**
 * ADR 0067: status, removal, abandoned reservations and the intake port.
 * SQL is a recording fake: these assert what the service asks the
 * database for and refuses on, the pgTAP suites assert what it enforces.
 */

const tenantId = TenantIdSchema.parse(randomUUID());
const applicationId = randomUUID();
const sessionId = randomUUID();
const documentId = randomUUID();
const versionId = randomUUID();
const extractionId = randomUUID();

type Handler = (
  query: string,
  values: readonly unknown[],
) => readonly unknown[];

function recordingSql(handler: Handler) {
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
  return { sql, calls };
}

function service(handler: Handler, open = true) {
  const { sql, calls } = recordingSql(handler);
  const deleteObject = vi.fn(() => Promise.resolve());
  const s = createGateQApplicationEvidenceService({
    sql,
    transactions: {
      run: (work) => work({ sql: sql as TransactionContext["sql"] }),
    },
    authorise: (credential) =>
      credential === "valid"
        ? Promise.resolve({
            tenantId,
            applicationId,
            sessionId,
            expiresAt: new Date(Date.now() + 3600_000).toISOString(),
            open,
            contactConfirmed: true as const,
          })
        : Promise.reject(new GateQApplicationEvidenceScopeError()),
    storage: {
      createUploadAuthorization: vi.fn(),
      statObject: vi.fn(),
      openObjectStream: vi.fn(),
      deleteObject,
      putObject: vi.fn(),
    },
    outbox: { enqueue: vi.fn() },
    uploads: {
      bucket: "cq-documents-private",
      maxBytes: 1024 * 1024,
      sessionTtlSeconds: 600,
      maxOpenSessions: 3,
    },
    maxDocuments: 5,
    maxTotalBytes: 3 * 1024 * 1024,
  });
  return { service: s, calls, deleteObject };
}

describe("application document status", () => {
  const base = {
    uploadStatus: "COMPLETED",
    versionId: "v",
    processingStatus: "COMPLETED",
    malwareStatus: "CLEAN",
    extractionStatus: "COMPLETED",
  };
  it("is READY only when processed, extracted and clean or NOT_SCANNED", () => {
    expect(gateqApplicationDocumentStatus(base)).toBe("READY");
    expect(
      gateqApplicationDocumentStatus({ ...base, malwareStatus: "NOT_SCANNED" }),
    ).toBe("READY");
    expect(
      gateqApplicationDocumentStatus({ ...base, malwareStatus: "PENDING" }),
    ).toBe("PROCESSING");
  });
  it("reports blocked and failed extraction rather than processing forever", () => {
    expect(
      gateqApplicationDocumentStatus({ ...base, malwareStatus: "BLOCKED" }),
    ).toBe("BLOCKED");
    expect(
      gateqApplicationDocumentStatus({ ...base, extractionStatus: "FAILED" }),
    ).toBe("FAILED");
    expect(
      gateqApplicationDocumentStatus({ ...base, processingStatus: "FAILED" }),
    ).toBe("FAILED");
    expect(
      gateqApplicationDocumentStatus({ ...base, malwareStatus: "ERROR" }),
    ).toBe("FAILED");
  });
  it("distinguishes an unfinished upload from a refused or expired one", () => {
    const pending = {
      versionId: null,
      processingStatus: null,
      malwareStatus: null,
      extractionStatus: null,
    };
    expect(
      gateqApplicationDocumentStatus({
        ...pending,
        uploadStatus: "AUTHORIZED",
      }),
    ).toBe("UPLOADING");
    for (const uploadStatus of ["REJECTED", "EXPIRED", "CANCELLED"])
      expect(gateqApplicationDocumentStatus({ ...pending, uploadStatus })).toBe(
        "FAILED",
      );
  });
});

describe("listing the application's documents", () => {
  it("shows BLOCKED and FAILED documents to the applicant and marks disclosed ones unremovable", async () => {
    const row = (overrides: Record<string, unknown>) => ({
      document_id: randomUUID(),
      version_id: randomUUID(),
      original_filename: "deck.pdf",
      upload_status: "COMPLETED",
      declared_size_bytes: 10,
      processing_status: "COMPLETED",
      malware_scan_status: "CLEAN",
      text_extraction_status: "COMPLETED",
      sha256: "a".repeat(64),
      page_count: 3,
      instruction_risk_signals: 0,
      disclosed: false,
      ...overrides,
    });
    const f = service((q) =>
      q.startsWith("select d.id as document_id")
        ? [
            row({ disclosed: true }),
            row({ malware_scan_status: "NOT_SCANNED" }),
            row({ malware_scan_status: "BLOCKED" }),
            row({ text_extraction_status: "FAILED" }),
            row({
              version_id: null,
              upload_status: "AUTHORIZED",
              processing_status: null,
              malware_scan_status: null,
              text_extraction_status: null,
            }),
          ]
        : [],
    );
    const items = await f.service.list({ credential: "valid" });
    expect(
      items.map((i) => [i.status, i.includedInSubmission, i.removable]),
    ).toEqual([
      ["READY", true, false],
      ["READY", false, true],
      ["BLOCKED", false, true],
      ["FAILED", false, true],
      ["UPLOADING", false, true],
    ]);
    // Only a CLEAN scan can ever reach an investor; NOT_SCANNED says why.
    expect(
      items.map((i) => [i.shareableWithInvestor, i.privateReason]),
    ).toEqual([
      [true, null],
      [false, "NOT_SCANNED"],
      [false, null],
      [false, null],
      [false, null],
    ]);
    // Scoped to this credential's own application and session.
    const query = f.calls.find((c) => c.query.startsWith("select d.id"));
    expect(query?.values).toEqual([tenantId, applicationId, sessionId]);
  });
});

describe("removing a document before Submit", () => {
  it("archives it and cancels the reservation, deleting bytes only after provider expiry", async () => {
    let cancelled = false;
    const f = service((q) => {
      if (q.startsWith("select a.status")) return [{ status: "IN_PROGRESS" }];
      if (q.startsWith("select a.id")) return [{ id: applicationId }];
      if (q.startsWith("select d.status"))
        return [{ status: "ACTIVE", disclosed: false }];
      if (q.includes("set status='CANCELLED'")) cancelled = true;
      if (q.startsWith("select u.id,u.storage_bucket"))
        return cancelled
          ? [
              {
                id: randomUUID(),
                storage_bucket: "cq-documents-private",
                storage_key: "uploads/abandoned.pdf",
              },
            ]
          : [];
      return [];
    });
    await f.service.remove({ credential: "valid", documentId });
    expect(
      f.calls.some((c) =>
        c.query.startsWith("update evidence.documents set status='ARCHIVED'"),
      ),
    ).toBe(true);
    expect(cancelled).toBe(true);
    expect(
      f.calls.find((c) => c.query.startsWith("select u.id,u.storage_bucket"))
        ?.query,
    ).toContain("evidence.gateq_upload_authorization_retired(u)");
    expect(f.deleteObject).toHaveBeenCalledWith({
      bucket: "cq-documents-private",
      key: "uploads/abandoned.pdf",
    });
  });

  it("is refused once the document is frozen into a submission", async () => {
    const f = service((q) =>
      q.startsWith("select a.status")
        ? [{ status: "IN_PROGRESS" }]
        : q.startsWith("select d.status")
          ? [{ status: "ACTIVE", disclosed: true }]
          : [],
    );
    await expect(
      f.service.remove({ credential: "valid", documentId }),
    ).rejects.toBeInstanceOf(GateQApplicationDocumentDisclosedError);
    expect(f.calls.some((c) => c.query.startsWith("update"))).toBe(false);
  });

  it("is refused after the application is submitted", async () => {
    const f = service(
      (q) =>
        q.startsWith("select a.status")
          ? [{ status: "SUBMITTED" }]
          : q.startsWith("select d.status")
            ? [{ status: "ACTIVE", disclosed: false }]
            : [],
      false,
    );
    await expect(
      f.service.remove({ credential: "valid", documentId }),
    ).rejects.toBeInstanceOf(GateQApplicationDocumentDisclosedError);
    expect(f.calls.some((c) => c.query.startsWith("update"))).toBe(false);
  });

  it("refuses another application's document, a malformed id and a forged credential the same way", async () => {
    const f = service((q) =>
      q.startsWith("select a.status") ? [{ status: "IN_PROGRESS" }] : [],
    );
    for (const attempt of [
      { credential: "valid", documentId: randomUUID() },
      { credential: "valid", documentId: "not-a-uuid" },
      { credential: "forged", documentId },
    ])
      await expect(f.service.remove(attempt)).rejects.toBeInstanceOf(
        GateQApplicationEvidenceScopeError,
      );
    const lookup = f.calls.find((c) => c.query.startsWith("select d.status"));
    // The document lookup is bound to the credential's application/session.
    expect(lookup?.values).toEqual(
      expect.arrayContaining([tenantId, applicationId, sessionId]),
    );
  });

  it("is idempotent for an already removed document", async () => {
    const f = service((q) =>
      q.startsWith("select a.status")
        ? [{ status: "IN_PROGRESS" }]
        : q.startsWith("select a.id")
          ? [{ id: applicationId }]
          : q.startsWith("select d.status")
            ? [{ status: "ARCHIVED", disclosed: false }]
            : [],
    );
    await f.service.remove({ credential: "valid", documentId });
    expect(
      f.calls.some(
        (c) =>
          c.query.startsWith("update evidence.documents") ||
          c.query.includes("set status='CANCELLED'"),
      ),
    ).toBe(false);
  });
});

describe("abandoned reservations", () => {
  it("expires an unfinished upload and sweeps safely retired provider tokens before a new reservation", async () => {
    let expired = false;
    const f = service((q) => {
      if (q.startsWith("select a.id")) return [{ id: applicationId }];
      if (q.includes("set status='EXPIRED'")) expired = true;
      if (q.startsWith("select u.id,u.storage_bucket"))
        return expired
          ? [
              {
                id: randomUUID(),
                storage_bucket: "cq-documents-private",
                storage_key: "uploads/abandoned.pdf",
              },
            ]
          : [];
      // Refuse the new reservation itself; only the sweep is under test.
      if (q.startsWith("select * from evidence.document_upload_sessions"))
        throw new Error("stop");
      return [];
    });
    await expect(
      f.service.create({
        credential: "valid",
        input: {
          filename: "deck.pdf",
          declaredMimeType: "application/pdf",
          declaredSizeBytes: 10,
          clientRequestId: "r-1",
        },
      }),
    ).rejects.toThrow("stop");
    const sweep = f.calls.find((c) => c.query.includes("set status='EXPIRED'"));
    expect(sweep?.query).toContain("expires_at <= now()");
    expect(sweep?.query).toContain("document_version_id is null");
    expect(f.deleteObject).toHaveBeenCalledWith({
      bucket: "cq-documents-private",
      key: "uploads/abandoned.pdf",
    });
  });
});

describe("the GateQ intake document port", () => {
  const ready = (overrides: Record<string, unknown> = {}) => ({
    document_id: documentId,
    version_id: versionId,
    title: "Deck",
    original_filename: "deck.pdf",
    mime_type: "application/pdf",
    sha256: "b".repeat(64),
    size_bytes: "2048",
    malware_scan_status: "NOT_SCANNED",
    extraction_id: extractionId,
    page_count: 2,
    instruction_risk_signals: 0,
    ...overrides,
  });

  it("returns READY documents with bounded, page-labelled text scoped by application", async () => {
    const { sql, calls } = recordingSql((q) => {
      if (q.startsWith("select d.id as document_id")) return [ready()];
      if (q.startsWith("select page_number"))
        return [
          { page_number: 1, text: "Revenue\u0000 grew", full_length: 13 },
          { page_number: 2, text: "x".repeat(10), full_length: 500 },
        ];
      return [];
    });
    const port = createGateQApplicationDocumentPort({ sql });
    const [doc] = await port.readyDocuments({
      tenantId,
      applicationId,
      maxCharsPerDocument: 20,
    });
    expect(doc).toMatchObject({
      documentId,
      versionId,
      title: "Deck",
      contentType: "application/pdf",
      sha256: "b".repeat(64),
      malwareStatus: "NOT_SCANNED",
      instructionRisk: false,
      truncated: true,
    });
    expect(doc?.excerpts).toEqual([
      { page: 1, text: "Revenue grew" },
      { page: 2, text: "x".repeat(8) },
    ]);
    const select = calls.find((c) => c.query.startsWith("select d.id"));
    expect(select?.query).toContain("d.owner_kind='GATEQ_APPLICATION'");
    // The founder's own interview may read NOT_SCANNED; disclosure may not.
    expect(select?.query).toContain(
      "(v.malware_scan_status='CLEAN' or (? and v.malware_scan_status='NOT_SCANNED'))",
    );
    expect(select?.values.slice(0, 2)).toEqual([tenantId, applicationId]);
    expect(select?.values.at(-2)).toBe(true);
  });

  it("withholds every excerpt of a document flagged for instruction-like text", async () => {
    const { sql, calls } = recordingSql((q) =>
      q.startsWith("select d.id as document_id")
        ? [ready({ instruction_risk_signals: 2 })]
        : [],
    );
    const port = createGateQApplicationDocumentPort({ sql });
    const [doc] = await port.readyDocuments({ tenantId, applicationId });
    expect(doc).toMatchObject({
      instructionRisk: true,
      excerpts: [],
      truncated: true,
    });
    expect(calls.some((c) => c.query.startsWith("select page_number"))).toBe(
      false,
    );
  });

  it("freezes exact current versions once, and returns the same freeze on retry", async () => {
    const frozenRow = {
      document_id: documentId,
      document_version_id: versionId,
      title: "Deck",
      mime_type: "application/pdf",
      sha256: "b".repeat(64),
      frozen_at: new Date("2026-10-14T00:00:00Z"),
    };
    let inserted = false;
    const { sql, calls } = recordingSql((q) => {
      if (q.startsWith("select id,status from gateq.applications"))
        return [
          { id: applicationId, status: inserted ? "SUBMITTED" : "IN_PROGRESS" },
        ];
      if (q.startsWith("select g.document_id"))
        return inserted ? [frozenRow] : [];
      if (
        q.startsWith("select d.id as document_id,v.id as version_id,u.status")
      )
        return [
          {
            document_id: documentId,
            version_id: versionId,
            upload_status: "COMPLETED",
            processing_status: "COMPLETED",
            malware_scan_status: "CLEAN",
            text_extraction_status: "COMPLETED",
          },
          {
            document_id: randomUUID(),
            version_id: randomUUID(),
            upload_status: "COMPLETED",
            processing_status: "PROCESSING",
            malware_scan_status: "PENDING",
            text_extraction_status: "PROCESSING",
          },
        ];
      if (q.startsWith("select d.id as document_id")) return [ready()];
      if (
        q.startsWith(
          "insert into evidence.gateq_application_document_disclosures",
        )
      )
        inserted = true;
      return [];
    });
    const port = createGateQApplicationDocumentPort({ sql });
    const tx = { sql: sql as TransactionContext["sql"] };
    const first = await port.freezeForSubmission(tx, {
      tenantId,
      applicationId,
      selectedDocuments: [{ documentId, versionId, sha256: "b".repeat(64) }],
    });
    expect(first.deduplicated).toBe(false);
    expect(first.documents).toEqual([
      {
        documentId,
        versionId,
        title: "Deck",
        contentType: "application/pdf",
        sha256: "b".repeat(64),
        frozenAt: "2026-10-14T00:00:00.000Z",
      },
    ]);
    expect(first.notReady).toEqual([]);
    // Freezing for an investor admits only CLEAN: the NOT_SCANNED branch is off.
    expect(
      calls
        .find((c) => c.query.startsWith("select d.id as document_id"))
        ?.values.at(-2),
    ).toBe(false);
    const inserts = () =>
      calls.filter((c) => c.query.startsWith("insert into")).length;
    expect(inserts()).toBe(1);
    const second = await port.freezeForSubmission(tx, {
      tenantId,
      applicationId,
      selectedDocuments: [{ documentId, versionId, sha256: "b".repeat(64) }],
    });
    expect(second.deduplicated).toBe(true);
    expect(second.documents).toEqual(first.documents);
    expect(inserts()).toBe(1);
  });

  it("refuses to freeze an application it cannot lock", async () => {
    const { sql } = recordingSql(() => []);
    const port = createGateQApplicationDocumentPort({ sql });
    await expect(
      port.freezeForSubmission(
        { sql: sql as TransactionContext["sql"] },
        { tenantId, applicationId, selectedDocuments: [] },
      ),
    ).rejects.toThrow();
    await expect(
      port.readyDocuments({ tenantId, applicationId: "not-a-uuid" }),
    ).rejects.toThrow();
  });
  it("an explicit empty selection discloses no ready or draft document and performs no readiness retrieval", async () => {
    const { sql, calls } = recordingSql((q) =>
      q.startsWith("select id,status")
        ? [{ id: applicationId, status: "IN_PROGRESS" }]
        : [],
    );
    const port = createGateQApplicationDocumentPort({ sql });
    expect(
      await port.freezeForSubmission(
        { sql: sql as TransactionContext["sql"] },
        { tenantId, applicationId, selectedDocuments: [] },
      ),
    ).toEqual({ documents: [], notReady: [], deduplicated: false });
    expect(calls.some((c) => c.query.startsWith("insert"))).toBe(false);
    expect(
      calls.some((c) => c.query.startsWith("select d.id as document_id")),
    ).toBe(false);
  });
  it.each(["stale version", "stale hash", "foreign document", "not ready"])(
    "refuses the entire selection when one tuple is %s",
    async (problem) => {
      const otherId = randomUUID();
      const otherVersion = randomUUID();
      const { sql, calls } = recordingSql((q) => {
        if (q.startsWith("select id,status"))
          return [{ id: applicationId, status: "IN_PROGRESS" }];
        if (q.startsWith("select d.id as document_id"))
          return problem === "not ready" || problem === "foreign document"
            ? [ready()]
            : [
                ready(),
                ready({
                  document_id: otherId,
                  version_id:
                    problem === "stale version" ? randomUUID() : otherVersion,
                  sha256:
                    problem === "stale hash" ? "c".repeat(64) : "b".repeat(64),
                }),
              ];
        return [];
      });
      const port = createGateQApplicationDocumentPort({ sql });
      await expect(
        port.freezeForSubmission(
          { sql: sql as TransactionContext["sql"] },
          {
            tenantId,
            applicationId,
            selectedDocuments: [
              { documentId, versionId, sha256: "b".repeat(64) },
              {
                documentId: otherId,
                versionId: otherVersion,
                sha256: "b".repeat(64),
              },
            ],
          },
        ),
      ).rejects.toThrow("Review the document selection again");
      expect(calls.some((c) => c.query.startsWith("insert"))).toBe(false);
    },
  );
  it("refuses omitted selection and duplicate document ids before any disclosure write", async () => {
    const { sql, calls } = recordingSql(() => []);
    const port = createGateQApplicationDocumentPort({ sql });
    const tx = { sql: sql as TransactionContext["sql"] };
    await expect(
      port.freezeForSubmission(tx, {
        tenantId,
        applicationId,
        selectedDocuments: undefined as unknown as [],
      }),
    ).rejects.toThrow();
    const selected = { documentId, versionId, sha256: "b".repeat(64) };
    await expect(
      port.freezeForSubmission(tx, {
        tenantId,
        applicationId,
        selectedDocuments: [selected, selected],
      }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  it("refuses a changed selection after submission, including an attempted empty replacement", async () => {
    const { sql, calls } = recordingSql((q) =>
      q.startsWith("select id,status")
        ? [{ id: applicationId, status: "SUBMITTED" }]
        : q.startsWith("select g.document_id")
          ? [
              {
                document_id: documentId,
                document_version_id: versionId,
                title: "deck.pdf",
                mime_type: "application/pdf",
                sha256: "b".repeat(64),
                frozen_at: new Date(),
              },
            ]
          : [],
    );
    const port = createGateQApplicationDocumentPort({ sql });
    await expect(
      port.freezeForSubmission(
        { sql: sql as TransactionContext["sql"] },
        { tenantId, applicationId, selectedDocuments: [] },
      ),
    ).rejects.toThrow();
    expect(calls.some((c) => c.query.startsWith("insert"))).toBe(false);
  });
  it("never hands an investor the bytes of a version that was not scanned clean", async () => {
    const { sql } = recordingSql((q) =>
      q.includes("v.storage_bucket,v.storage_key")
        ? [
            ready({
              storage_bucket: "cq-documents-private",
              storage_key: "uploads/unscanned.pdf",
              malware_scan_status: "NOT_SCANNED",
            }),
          ]
        : [],
    );
    const port = createGateQApplicationDocumentPort({ sql });
    expect(
      await port.frozenDocumentObject({
        tenantId,
        applicationId,
        documentId,
        versionId,
        sha256: "b".repeat(64),
      }),
    ).toBeNull();
  });
  it("resolves only the exact submitted tuple, and keeps storage coordinates out of page excerpts", async () => {
    const { sql, calls } = recordingSql((q) =>
      q.includes("v.storage_bucket,v.storage_key")
        ? [
            ready({
              title: "deck.pdf",
              storage_bucket: "cq-documents-private",
              storage_key: "uploads/frozen.pdf",
              malware_scan_status: "CLEAN",
            }),
          ]
        : q.startsWith("select page_number")
          ? [{ page_number: 2, text: "Authorized evidence", full_length: 19 }]
          : [],
    );
    const port = createGateQApplicationDocumentPort({ sql });
    const input = {
      tenantId,
      applicationId,
      documentId,
      versionId,
      sha256: "b".repeat(64),
    };
    const object = await port.frozenDocumentObject(input);
    expect(object).toMatchObject({
      documentId,
      versionId,
      object: { bucket: "cq-documents-private", key: "uploads/frozen.pdf" },
      malwareStatus: "CLEAN",
    });
    const doc = await port.readFrozenDocument(input);
    expect(doc?.excerpts).toEqual([{ page: 2, text: "Authorized evidence" }]);
    expect(doc).not.toHaveProperty("object");
    expect(doc).not.toHaveProperty("storage_key");
    const guard = calls.find((c) =>
      c.query.includes("v.storage_bucket,v.storage_key"),
    );
    expect(guard?.query).toContain("a.status='SUBMITTED'");
    expect(guard?.query).toContain("v.malware_scan_status='CLEAN'");
    expect(guard?.query).not.toContain("NOT_SCANNED");
    expect(guard?.query).toContain("g.document_version_id=? and g.sha256=?");
    expect(guard?.query).not.toContain("d.current_version_id");
    expect(guard?.values).toEqual([
      tenantId,
      applicationId,
      documentId,
      versionId,
      "b".repeat(64),
    ]);
  });
  it("returns no object or excerpts for an undisclosed, foreign, blocked or unavailable submitted tuple", async () => {
    const { sql, calls } = recordingSql(() => []);
    const port = createGateQApplicationDocumentPort({ sql });
    const input = {
      tenantId,
      applicationId,
      documentId,
      versionId,
      sha256: "b".repeat(64),
    };
    expect(await port.frozenDocumentObject(input)).toBeNull();
    expect(await port.readFrozenDocument(input)).toBeNull();
    expect(calls.some((c) => c.query.startsWith("select page_number"))).toBe(
      false,
    );
  });
  it("withholds instruction-like submitted text using the same readiness policy", async () => {
    const { sql, calls } = recordingSql((q) =>
      q.includes("v.storage_bucket,v.storage_key")
        ? [
            ready({
              storage_bucket: "cq-documents-private",
              storage_key: "uploads/frozen.pdf",
              instruction_risk_signals: 1,
            }),
          ]
        : [],
    );
    const port = createGateQApplicationDocumentPort({ sql });
    expect(
      await port.readFrozenDocument({
        tenantId,
        applicationId,
        documentId,
        versionId,
        sha256: "b".repeat(64),
      }),
    ).toMatchObject({ instructionRisk: true, excerpts: [], truncated: true });
    expect(calls.some((c) => c.query.startsWith("select page_number"))).toBe(
      false,
    );
  });
  it("frozen summaries require SUBMITTED in the same SQL read, not a separate stale preflight", async () => {
    const { sql, calls } = recordingSql(() => []);
    const port = createGateQApplicationDocumentPort({ sql });
    expect(await port.frozenDocuments({ tenantId, applicationId })).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toContain("a.status='SUBMITTED'");
    expect(calls[0]?.values).toContain(false);
  });
});

/**
 * Live D4b (2026-11-14, application bf389feb): a signed-in founder sent a
 * deck (9 pages) and a product brief (1 page) from their own library;
 * `evidence.gateq_application_document_disclosures` holds only
 * application-owned uploads, so Q read nothing and said nothing was
 * attached. The founder's library documents are read from what the
 * submission froze, at the version they sent, and nothing else.
 */
describe("the founder's own documents sent with a submission (live D4b)", () => {
  const founderTenant = randomUUID();
  const otherTenant = TenantIdSchema.parse(randomUUID());
  const deckId = randomUUID();
  const briefId = randomUUID();
  const unticked = randomUUID();
  const deckVersion = randomUUID();
  const briefVersion = randomUUID();
  const sha = (c: string) => c.repeat(64);
  const submittedAt = new Date("2026-11-14T01:48:51.000Z");

  type Fixture = {
    readonly pins: unknown;
    readonly attached: readonly string[];
    /** documentId -> version row, or absent */
    readonly versions: Record<string, Record<string, unknown> | undefined>;
  };
  const handler =
    (fixture: Fixture): Handler =>
    (query, values) => {
      if (
        query.includes(
          "from gateq.application_submissions s join gateq.applications",
        )
      )
        return values[0] === tenantId && values[1] === applicationId
          ? [{ submitted_at: submittedAt, pins: fixture.pins }]
          : [];
      if (query.includes("from gateq.application_documents ad"))
        return values[0] === tenantId && values[1] === applicationId
          ? fixture.attached.map((document_id) => ({ document_id }))
          : [];
      if (
        query.includes(
          "from evidence.documents d join evidence.document_versions v on v.document_id=d.id",
        )
      ) {
        const row = fixture.versions[values[0] as string];
        return row === undefined ? [] : [row];
      }
      if (query.includes("from evidence.document_pages"))
        return [
          {
            page_number: 1,
            text: `page text of ${String(values[2])}`,
            full_length: 30,
          },
        ];
      throw new Error(`unexpected query: ${query}`);
    };
  const versionRow = (
    documentId: string,
    versionId: string,
    title: string,
    pages: number,
    extra: Record<string, unknown> = {},
  ) => ({
    document_id: documentId,
    document_tenant_id: founderTenant,
    title,
    version_id: versionId,
    original_filename: `${title}.pdf`,
    mime_type: "application/pdf",
    sha256: sha(versionId === deckVersion ? "a" : "b"),
    size_bytes: 1000,
    malware_scan_status: "NOT_SCANNED",
    processing_status: "COMPLETED",
    text_extraction_status: "COMPLETED",
    extraction_id: randomUUID(),
    page_count: pages,
    instruction_risk_signals: 0,
    ...extra,
  });
  const branchari: Fixture = {
    pins: [
      { documentId: deckId, versionId: deckVersion, sha256: sha("a") },
      { documentId: briefId, versionId: briefVersion, sha256: sha("b") },
    ],
    attached: [deckId, briefId],
    versions: {
      [deckId]: versionRow(deckId, deckVersion, "Branchari investor deck", 9),
      [briefId]: versionRow(
        briefId,
        briefVersion,
        "Branchari product brief",
        1,
      ),
    },
  };

  it("reads both sent documents at their pinned versions, from the founder's tenant", async () => {
    const { sql, calls } = recordingSql(handler(branchari));
    const port = createGateQApplicationDocumentPort({ sql });
    const shared = await port.sharedSubmittedDocuments({
      tenantId,
      applicationId,
    });
    expect(shared.map((d) => [d.title, d.reading?.pageCount])).toEqual([
      ["Branchari investor deck", 9],
      ["Branchari product brief", 1],
    ]);
    expect(shared[0]?.reading?.versionId).toBe(deckVersion);
    expect(shared[0]?.reading?.excerpts[0]?.text).toContain(deckVersion);
    // The pinned version is the one asked for, never "whatever is current".
    const versionReads = calls.filter((c) =>
      c.query.includes(
        "join evidence.document_versions v on v.document_id=d.id",
      ),
    );
    expect(versionReads.map((c) => c.values[0])).toEqual([deckId, briefId]);
    expect(versionReads[0]?.values).toContain(deckVersion);
    // Pages are read in the document owner's tenant.
    const pageReads = calls.filter((c) => c.query.includes("document_pages"));
    expect(pageReads.length).toBe(2);
    expect(pageReads.every((c) => c.values[1] === founderTenant)).toBe(true);
    // Only documents attached to this application and named in its frozen
    // submission are listed, scoped by the application's own tenant.
    const listed = calls.find((c) =>
      c.query.includes("from gateq.application_documents ad"),
    );
    expect(listed?.query).toContain(
      "coalesce(s.snapshot->'documentIds','[]'::jsonb) @> jsonb_build_array(ad.document_id::text)",
    );
    expect(listed?.query).toContain("ad.tenant_id=? and ad.application_id=?");
    expect(listed?.values.slice(0, 2)).toEqual([tenantId, applicationId]);
  });

  it("an unticked library document is never read", async () => {
    const { sql, calls } = recordingSql(
      handler({
        ...branchari,
        versions: {
          ...branchari.versions,
          [unticked]: versionRow(unticked, randomUUID(), "Cap table", 2),
        },
      }),
    );
    const port = createGateQApplicationDocumentPort({ sql });
    const shared = await port.sharedSubmittedDocuments({
      tenantId,
      applicationId,
    });
    expect(shared.map((d) => d.documentId)).not.toContain(unticked);
    expect(calls.some((c) => c.values.includes(unticked))).toBe(false);
  });

  it("another tenant asking for the same application reads nothing", async () => {
    const { sql, calls } = recordingSql(handler(branchari));
    const port = createGateQApplicationDocumentPort({ sql });
    expect(
      await port.sharedSubmittedDocuments({
        tenantId: otherTenant,
        applicationId,
      }),
    ).toEqual([]);
    expect(calls.some((c) => c.query.includes("evidence.documents"))).toBe(
      false,
    );
  });

  it("an unpinned (older) submission reads the version current at the submission instant", async () => {
    const { sql, calls } = recordingSql(handler({ ...branchari, pins: null }));
    const port = createGateQApplicationDocumentPort({ sql });
    const shared = await port.sharedSubmittedDocuments({
      tenantId,
      applicationId,
    });
    expect(shared).toHaveLength(2);
    const read = calls.find((c) => c.query.includes("v.uploaded_at<=?"));
    expect(
      read?.values.some(
        (v) => v instanceof Date && v.getTime() === submittedAt.getTime(),
      ),
    ).toBe(true);
    expect(read?.values).toContain(null);
  });

  it("says which sent document could not be read instead of dropping it", async () => {
    const { sql } = recordingSql(
      handler({
        ...branchari,
        versions: {
          [deckId]: versionRow(
            deckId,
            deckVersion,
            "Branchari investor deck",
            9,
            {
              text_extraction_status: "FAILED",
            },
          ),
          [briefId]: versionRow(
            briefId,
            briefVersion,
            "Branchari product brief",
            1,
            {
              sha256: sha("c"),
            },
          ),
        },
      }),
    );
    const port = createGateQApplicationDocumentPort({ sql });
    const shared = await port.sharedSubmittedDocuments({
      tenantId,
      applicationId,
    });
    // Not processed, and a hash that is not the one sent: neither is read.
    expect(shared.map((d) => [d.title, d.reading])).toEqual([
      ["Branchari investor deck", null],
      ["Branchari product brief", null],
    ]);
  });
});
