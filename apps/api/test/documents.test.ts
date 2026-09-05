import { describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { parseApiConfig } from "@capital-q/config/api";
import {
  DocumentNotFoundError,
  DocumentStorageUnavailableError,
  DocumentUploadCreationConflictError,
  DocumentUploadRejectedError,
  DocumentUploadStateError,
  type EvidenceService,
} from "@capital-q/evidence";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";

/**
 * `/v1/documents` at the HTTP boundary. The service is a recording double:
 * what an upload is allowed to be is proven against the database in the
 * Evidence package, and what is proven here is that authority never arrives
 * from the request, that refusals are reported as bounded categories, and
 * that no response carries storage identity.
 */

const PRINCIPAL: AuthenticatedPrincipal = {
  authUserId: AuthUserIdSchema.parse("a0000000-0000-4000-8000-000000000001"),
};
const TENANT = TenantIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ORG = OrganisationIdSchema.parse("d0000000-0000-4000-8000-000000000001");
const USER = UserIdSchema.parse("b0000000-0000-4000-8000-000000000001");
const MEMBERSHIP = MembershipIdSchema.parse(
  "e0000000-0000-4000-8000-000000000001",
);
const CONTEXT: ActorContext = {
  userId: USER,
  tenantId: TENANT,
  organisationId: ORG,
  membershipId: MEMBERSHIP,
  actorType: "HUMAN",
};
const KEY = "11111111-2222-4333-8444-555555555555";
const DOCUMENT_ID = "f0000000-0000-4000-8000-000000000001";
const SESSION_ID = "f0000000-0000-4000-8000-000000000002";
const VERSION_ID = "f0000000-0000-4000-8000-000000000003";
const NOW = "2026-09-05T09:00:00.000Z";
const PDF = "application/pdf";

const VALID_BODY = {
  title: "Pitch deck",
  documentType: "PITCH_DECK",
  companyId: "aa000000-0000-4000-8000-000000000001",
  filename: "deck.pdf",
  declaredMimeType: PDF,
  declaredSizeBytes: 4096,
};

const SESSION = {
  id: SESSION_ID,
  tenantId: TENANT,
  ownerOrganisationId: ORG,
  createdByUserId: USER,
  documentId: DOCUMENT_ID,
  storageBucket: "cq-documents-private",
  storageKey: "raw/tenant/0123456789abcdef0123456789abcdef",
  originalFilename: "deck.pdf",
  declaredMimeType: PDF,
  declaredSizeBytes: 4096,
  authorisingCapability: "document.create",
  status: "AUTHORIZED",
  expiresAt: NOW,
  finalizedAt: null,
  documentVersionId: null,
  failureCode: null,
  cleanupPending: false,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
} as const;

const DOCUMENT = {
  id: DOCUMENT_ID,
  tenantId: TENANT,
  companyId: "aa000000-0000-4000-8000-000000000001",
  ownerOrganisationId: ORG,
  documentType: "PITCH_DECK",
  title: "Pitch deck",
  visibilityScope: "organisation_private",
  sensitivityClass: "CONFIDENTIAL",
  currentVersionId: null,
  status: "ACTIVE",
  createdByUserId: USER,
  createdAt: NOW,
  updatedAt: NOW,
  version: 1,
} as const;

const VERSION = {
  id: VERSION_ID,
  tenantId: TENANT,
  documentId: DOCUMENT_ID,
  versionNumber: 1,
  storageBucket: "cq-documents-private",
  storageKey: "raw/tenant/0123456789abcdef0123456789abcdef",
  originalFilename: "deck.pdf",
  mimeType: PDF,
  sizeBytes: 4096,
  sha256: "a".repeat(64),
  uploadedByUserId: USER,
  uploadedAt: NOW,
  supersedesVersionId: null,
  processingStatus: "NOT_STARTED",
  malwareScanStatus: "PENDING",
  textExtractionStatus: "NOT_STARTED",
} as const;

const UPLOAD = {
  method: "PUT" as const,
  url: "https://storage.invalid/object/upload/sign/cq-documents-private/raw/x?token=scoped",
  headers: { "content-type": PDF, "x-upsert": "false" },
  providerExpiresAt: NOW,
};

const notUnderTest = () => Promise.reject(new Error("not under test"));

function fakeService(overrides: Partial<EvidenceService> = {}) {
  const calls: Record<string, unknown[]> = { create: [], complete: [] };
  const service = {
    registerEvidenceSource: notUnderTest,
    getEvidenceSource: notUnderTest,
    listEvidenceSources: notUnderTest,
    createDocument: notUnderTest,
    registerDocumentVersion: notUnderTest,
    getDocument: notUnderTest,
    listDocuments: notUnderTest,
    listDocumentVersions: notUnderTest,
    getDocumentVersion: notUnderTest,
    getDocumentWithVersion: () =>
      Promise.resolve({ document: DOCUMENT, currentVersion: null }),
    listDocumentsWithVersions: () =>
      Promise.resolve([{ document: DOCUMENT, currentVersion: VERSION }]),
    registerProcessingRun: notUnderTest,
    transitionProcessingRun: notUnderTest,
    advanceVersionProcessingState: notUnderTest,
    createClaim: notUnderTest,
    reviseClaim: notUnderTest,
    linkClaimEvidence: notUnderTest,
    getClaim: notUnderTest,
    listClaims: notUnderTest,
    createEvidenceItem: notUnderTest,
    getEvidenceItem: notUnderTest,
    listEvidenceItems: notUnderTest,
    createDocumentUploadSession: (command: unknown) => {
      calls["create"]?.push(command);
      return Promise.resolve({
        session: SESSION,
        document: DOCUMENT,
        upload: UPLOAD,
      });
    },
    completeDocumentUploadSession: (command: unknown) => {
      calls["complete"]?.push(command);
      return Promise.resolve({
        session: {
          ...SESSION,
          status: "COMPLETED",
          documentVersionId: VERSION_ID,
          finalizedAt: NOW,
        },
        document: { ...DOCUMENT, currentVersionId: VERSION_ID },
        version: VERSION,
      });
    },
    cancelDocumentUploadSession: () =>
      Promise.resolve({ ...SESSION, status: "CANCELLED" }),
    getDocumentUploadSession: () => Promise.resolve(SESSION),
    cleanupExpiredUploadSession: notUnderTest,
    ...overrides,
  } as unknown as EvidenceService;
  return { service, calls };
}

function buildApp(options: {
  readonly principal: AuthenticatedPrincipal | null;
  readonly context?: ActorContext | undefined;
  readonly service: EvidenceService;
}): FastifyInstance {
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(options.principal) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve(
          options.context === undefined
            ? { status: "CONTEXT_REQUIRED" }
            : { status: "RESOLVED", context: options.context },
        ),
    },
    identities: { lookup: () => Promise.resolve(null) },
  };
  return createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    evidence: options.service,
  }).app;
}

const SESSIONS = "/v1/documents/upload-sessions";

describe("POST /v1/documents/upload-sessions", () => {
  it("refuses an unauthenticated caller", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: null, service });
    const response = await app.inject({
      method: "POST",
      url: SESSIONS,
      headers: { "idempotency-key": KEY },
      payload: VALID_BODY,
    });
    expect(response.statusCode).toBe(401);
    expect(calls["create"]).toHaveLength(0);
    await app.close();
  });

  it("refuses a caller with no active organisation", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, service });
    const response = await app.inject({
      method: "POST",
      url: SESSIONS,
      headers: { "idempotency-key": KEY },
      payload: VALID_BODY,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<{ code: string }>().code).toBe("INVALID_REQUEST");
    expect(calls["create"]).toHaveLength(0);
    await app.close();
  });

  it("requires an Idempotency-Key", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: SESSIONS,
      payload: VALID_BODY,
    });
    expect(response.statusCode).toBe(422);
    expect(calls["create"]).toHaveLength(0);
    await app.close();
  });

  it("refuses identity, ownership and storage authority in the body", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    for (const extra of [
      { tenantId: TENANT },
      { organisationId: ORG },
      { ownerOrganisationId: ORG },
      { userId: USER },
      { uploadedByUserId: USER },
      { storageBucket: "public-documents" },
      { storageKey: "raw/anything" },
      { visibilityScope: "public_external" },
      { sensitivityClass: "PUBLIC" },
      { sha256: "b".repeat(64) },
      { versionNumber: 7 },
      { isAdmin: true },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: SESSIONS,
        headers: { "idempotency-key": KEY },
        payload: { ...VALID_BODY, ...extra },
      });
      expect(response.statusCode).toBe(422);
    }
    expect(calls["create"]).toHaveLength(0);
    await app.close();
  });

  it("returns a scoped upload target and no storage identity", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: SESSIONS,
      headers: { "idempotency-key": KEY },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers["location"]).toBe(`${SESSIONS}/${SESSION_ID}`);
    expect(response.headers["cache-control"]).toBe("no-store");

    const body = response.json<{
      uploadSession: Record<string, unknown>;
      document: Record<string, unknown>;
      upload: { url: string; maxBytes: number; allowedMimeTypes: string[] };
    }>();
    expect(body.uploadSession["id"]).toBe(SESSION_ID);
    expect(body.upload.maxBytes).toBeGreaterThan(0);
    expect(body.upload.allowedMimeTypes).toContain(PDF);
    // The response says where to put the bytes and nothing about where they
    // will live: no bucket, no key, no hash of an object that does not exist.
    expect(JSON.stringify(body.uploadSession)).not.toContain("storageKey");
    expect(JSON.stringify(body.uploadSession)).not.toContain(
      "cq-documents-private",
    );
    expect(JSON.stringify(body.document)).not.toContain("storage");

    // The actor came from the verified context, never from the request.
    const [command] = calls["create"] as [{ actor: ActorContext }];
    expect(command.actor).toEqual(CONTEXT);
    await app.close();
  });

  it("reports a refused file as a bounded category", async () => {
    const { service } = fakeService({
      createDocumentUploadSession: () =>
        Promise.reject(new DocumentUploadRejectedError("SIGNATURE_MISMATCH")),
    });
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: SESSIONS,
      headers: { "idempotency-key": KEY },
      payload: VALID_BODY,
    });

    expect(response.statusCode).toBe(422);
    const body = response.json<{
      code: string;
      detail: string;
      errors: { path: string; code: string; message: string }[];
    }>();
    expect(body.code).toBe("VALIDATION_FAILED");
    // Machine-readable for the client, and nothing about the detector.
    expect(body.errors[0]?.code).toBe("SIGNATURE_MISMATCH");
    expect(body.detail).toBe("The file does not match its extension.");
    expect(JSON.stringify(body)).not.toMatch(/magic|signature byte|offset/i);
    await app.close();
  });

  it("reports a reused idempotency key with a different request as a conflict", async () => {
    const { service } = fakeService({
      createDocumentUploadSession: () =>
        Promise.reject(new DocumentUploadCreationConflictError()),
    });
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: SESSIONS,
      headers: { "idempotency-key": KEY },
      payload: VALID_BODY,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe("IDEMPOTENCY_CONFLICT");
    await app.close();
  });

  it("reports unconfigured or unreachable storage as unavailable, never as success", async () => {
    const { service } = fakeService({
      createDocumentUploadSession: () =>
        Promise.reject(new DocumentStorageUnavailableError()),
    });
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: SESSIONS,
      headers: { "idempotency-key": KEY },
      payload: VALID_BODY,
    });
    expect(response.statusCode).toBe(503);
    expect(response.json<{ code: string }>().code).toBe("PROVIDER_UNAVAILABLE");
    // No provider name, URL or credential reaches the caller.
    expect(response.body).not.toMatch(/supabase|token|storage\.v1/i);
    await app.close();
  });
});

describe("POST /v1/documents/upload-sessions/:id/complete", () => {
  it("finalizes and reports the version as quarantined", async () => {
    const { service, calls } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: `${SESSIONS}/${SESSION_ID}/complete`,
      headers: { "idempotency-key": KEY },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      uploadSession: { status: string };
      document: {
        currentVersion: {
          malwareScanStatus: string;
          textExtractionStatus: string;
        };
      };
    }>();
    expect(body.uploadSession.status).toBe("COMPLETED");
    // Completed means the bytes were verified, never that they are clean.
    expect(body.document.currentVersion.malwareScanStatus).toBe("PENDING");
    expect(body.document.currentVersion.textExtractionStatus).toBe(
      "NOT_STARTED",
    );
    expect(JSON.stringify(body)).not.toContain("storageKey");
    expect(calls["complete"]).toHaveLength(1);
    await app.close();
  });

  it("refuses a session that is not at a step where completion is possible", async () => {
    const { service } = fakeService({
      completeDocumentUploadSession: () =>
        Promise.reject(
          new DocumentUploadStateError("this upload cannot be completed"),
        ),
    });
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: `${SESSIONS}/${SESSION_ID}/complete`,
      headers: { "idempotency-key": KEY },
      payload: {},
    });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ code: string }>().code).toBe("UPLOAD_NOT_READY");
    await app.close();
  });

  it("requires an Idempotency-Key and a valid session identifier", async () => {
    const { service } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });

    const noKey = await app.inject({
      method: "POST",
      url: `${SESSIONS}/${SESSION_ID}/complete`,
      payload: {},
    });
    expect(noKey.statusCode).toBe(422);

    const badId = await app.inject({
      method: "POST",
      url: `${SESSIONS}/not-a-uuid/complete`,
      headers: { "idempotency-key": KEY },
      payload: {},
    });
    expect(badId.statusCode).toBe(422);
    await app.close();
  });

  it("refuses a client-supplied hash that is not a hash", async () => {
    const { service } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "POST",
      url: `${SESSIONS}/${SESSION_ID}/complete`,
      headers: { "idempotency-key": KEY },
      payload: { clientSha256: "nope" },
    });
    expect(response.statusCode).toBe(422);
    await app.close();
  });
});

describe("document reads", () => {
  it("returns a document without any storage identity", async () => {
    const { service } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "GET",
      url: `/v1/documents/${DOCUMENT_ID}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain("storageKey");
    expect(response.body).not.toContain("cq-documents-private");
    await app.close();
  });

  it("lists documents with their current version state", async () => {
    const { service } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "GET",
      url: "/v1/documents?companyId=aa000000-0000-4000-8000-000000000001",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      documents: { currentVersion: { malwareScanStatus: string } }[];
    }>();
    expect(body.documents).toHaveLength(1);
    expect(body.documents[0]?.currentVersion.malwareScanStatus).toBe("PENDING");
    await app.close();
  });

  it("answers not found for a document the caller may not see", async () => {
    const { service } = fakeService({
      getDocumentWithVersion: () => Promise.reject(new DocumentNotFoundError()),
    });
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    const response = await app.inject({
      method: "GET",
      url: `/v1/documents/${DOCUMENT_ID}`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json<{ code: string }>().code).toBe("RESOURCE_NOT_FOUND");
    await app.close();
  });

  it("does not serve document bytes from any route", async () => {
    const { service } = fakeService();
    const app = buildApp({ principal: PRINCIPAL, context: CONTEXT, service });
    for (const url of [
      `/v1/documents/${DOCUMENT_ID}/download`,
      `/v1/documents/${DOCUMENT_ID}/content`,
      `/v1/documents/${DOCUMENT_ID}/versions/${VERSION_ID}/download`,
    ]) {
      const response = await app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(404);
    }
    await app.close();
  });
});
