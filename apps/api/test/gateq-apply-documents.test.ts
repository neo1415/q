import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { parseApiConfig } from "@capital-q/config/api";
import {
  ApplicationDocumentListDtoSchema,
  GATEQ_APPLY_DOCUMENTS_PATH,
  gateqApplyDocumentCompletePath,
  gateqApplyDocumentPath,
  RequestApplicationDocumentUploadResponseSchema,
} from "@capital-q/contracts";
import {
  GateQApplicationDocumentDisclosedError,
  GateQApplicationEvidenceScopeError,
  type GateQApplicationEvidenceItem,
} from "@capital-q/evidence";
import {
  createGuestThrottle,
  GATEQ_GUEST_QUOTAS,
  IntakeRefusedError,
} from "@capital-q/gateq-intake";

import { createApp, type ApiSecurityDependencies } from "../src/app.js";
import type { GateQApplyDocumentsRoutesDependencies } from "../src/http/gateq-apply-documents.js";

/**
 * ADR 0067 over HTTP: the applicant's own documents. The fake service
 * models two applications; the routes must never let one credential reach
 * the other's document, and every way to be wrong must be the same 404.
 */

const TOKEN_A = `gqs_${"a".repeat(43)}`;
const TOKEN_B = `gqs_${"b".repeat(43)}`;
const FORGED = `gqs_${"f".repeat(43)}`;

type Doc = GateQApplicationEvidenceItem & { owner: string };

function build(options?: { quotaUpload?: number }) {
  const sessions = new Map([
    [TOKEN_A, { sessionId: randomUUID(), submitted: false }],
    [TOKEN_B, { sessionId: randomUUID(), submitted: false }],
  ]);
  const docs = new Map<string, Doc>();
  const authorisations: string[] = [];
  const guest = (token: string) => {
    authorisations.push(token);
    const found = sessions.get(token);
    if (found === undefined) throw new IntakeRefusedError("SESSION_INVALID");
    return found;
  };
  const own = (token: string, documentId: string) => {
    guest(token);
    const doc = docs.get(documentId);
    if (doc === undefined || doc.owner !== token)
      throw new GateQApplicationEvidenceScopeError();
    return doc;
  };
  const documents: GateQApplyDocumentsRoutesDependencies["documents"] = {
    create: ({ credential, input }) => {
      guest(credential);
      const documentId = randomUUID();
      docs.set(documentId, {
        owner: credential,
        documentId,
        versionId: null,
        fileName: input.filename,
        status: "UPLOADING",
        uploadStatus: "AUTHORIZED",
        byteSize: input.declaredSizeBytes,
        pages: null,
        malwareStatus: null,
        extractionStatus: null,
        sha256: null,
        instructionRiskSignals: 0,
        includedInSubmission: false,
        removable: true,
      });
      return Promise.resolve({
        documentId,
        uploadSessionId: randomUUID(),
        expiresAt: new Date(Date.now() + 600_000).toISOString(),
        upload: {
          method: "PUT" as const,
          url: "https://storage.invalid/signed",
          headers: { "x-upsert": "false" },
          providerExpiresAt: new Date(Date.now() + 600_000).toISOString(),
        },
      });
    },
    complete: ({ credential, documentId }) => {
      const doc = own(credential, documentId);
      const versionId = doc.versionId ?? randomUUID();
      docs.set(documentId, {
        ...doc,
        versionId,
        status: "PROCESSING",
        uploadStatus: "COMPLETED",
      });
      return Promise.resolve({
        documentId,
        versionId,
        status: "PROCESSING" as const,
      });
    },
    list: ({ credential }) => {
      guest(credential);
      return Promise.resolve(
        [...docs.values()].filter((doc) => doc.owner === credential),
      );
    },
    remove: ({ credential, documentId }) => {
      const doc = own(credential, documentId);
      if (sessions.get(credential)?.submitted === true)
        throw new GateQApplicationDocumentDisclosedError();
      docs.delete(doc.documentId);
      return Promise.resolve();
    },
  };
  const throttle = createGuestThrottle({
    quotas: {
      ...GATEQ_GUEST_QUOTAS,
      UPLOAD: {
        limit: options?.quotaUpload ?? 10,
        windowMs: 600_000,
      },
    },
  });
  const security: ApiSecurityDependencies = {
    authenticator: { authenticate: () => Promise.resolve(null) },
    resolver: {
      resolveHumanContext: () =>
        Promise.resolve({ status: "NO_APPLICATION_IDENTITY" as const }),
    },
    identities: { lookup: () => Promise.resolve(null) },
  };
  const { app } = createApp(parseApiConfig({ NODE_ENV: "test" }), security, {
    gateqApplyDocuments: {
      documents,
      authoriseGuest: (token) => Promise.resolve(guest(token)),
      throttle,
      limits: {
        maxDocuments: 10,
        maxTotalBytes: 100 * 1024 * 1024,
        maxFileBytes: 25 * 1024 * 1024,
        allowedMimeTypes: ["application/pdf"],
      },
    },
  });
  return { app, docs, sessions, throttle, authorisations };
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
const upload = {
  fileName: "deck.pdf",
  mimeType: "application/pdf",
  byteSize: 2048,
  clientRequestId: "request-0001",
};

describe("GateQ guest documents (ADR 0067)", () => {
  it("issues a signed direct-to-storage target and never accepts bytes", async () => {
    const { app } = build();
    const response = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_DOCUMENTS_PATH,
      headers: bearer(TOKEN_A),
      payload: upload,
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = RequestApplicationDocumentUploadResponseSchema.parse(
      response.json(),
    );
    expect(body.contractVersion).toBe("gateq-application-documents.v1");
    expect(body.status).toBe("UPLOADING");
    expect(body.upload?.method).toBe("PUT");
    expect(body.upload?.maxBytes).toBe(2048);

    // A body carrying content, an application or a tenant is refused.
    for (const extra of [
      { content: "JVBERi0xLjQ=" },
      { applicationId: randomUUID() },
      { tenantId: randomUUID() },
    ]) {
      const refused = await app.inject({
        method: "POST",
        url: GATEQ_APPLY_DOCUMENTS_PATH,
        headers: bearer(TOKEN_A),
        payload: { ...upload, ...extra },
      });
      expect(refused.statusCode).toBe(422);
    }
  });

  it("refuses forged, missing and foreign credentials with one identical 404", async () => {
    const { app } = build();
    const created = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_DOCUMENTS_PATH,
      headers: bearer(TOKEN_A),
      payload: upload,
    });
    const { documentId } = created.json<{ documentId: string }>();
    const unknownId = randomUUID();
    const attempts = [
      // forged credential
      { method: "GET", url: GATEQ_APPLY_DOCUMENTS_PATH, token: FORGED },
      { method: "POST", url: GATEQ_APPLY_DOCUMENTS_PATH, token: FORGED },
      // no credential
      { method: "GET", url: GATEQ_APPLY_DOCUMENTS_PATH, token: "" },
      // another application's document, with a real credential
      {
        method: "POST",
        url: gateqApplyDocumentCompletePath(documentId),
        token: TOKEN_B,
      },
      {
        method: "DELETE",
        url: gateqApplyDocumentPath(documentId),
        token: TOKEN_B,
      },
      // a document that does not exist, and a malformed id
      {
        method: "DELETE",
        url: gateqApplyDocumentPath(unknownId),
        token: TOKEN_A,
      },
      {
        method: "POST",
        url: gateqApplyDocumentCompletePath("not-a-uuid"),
        token: TOKEN_A,
      },
    ] as const;
    const bodies = new Set<string>();
    for (const attempt of attempts) {
      const response = await app.inject({
        method: attempt.method,
        url: attempt.url,
        headers: attempt.token === "" ? {} : bearer(attempt.token),
        ...(attempt.method === "POST"
          ? {
              payload: attempt.url === GATEQ_APPLY_DOCUMENTS_PATH ? upload : {},
            }
          : {}),
      });
      expect(response.statusCode, `${attempt.method} ${attempt.url}`).toBe(404);
      const body = response.json<Record<string, unknown>>();
      delete body["requestId"];
      delete body["instance"];
      bodies.add(JSON.stringify(body));
    }
    expect(bodies.size).toBe(1);

    // B's list never shows A's document.
    const listB = await app.inject({
      method: "GET",
      url: GATEQ_APPLY_DOCUMENTS_PATH,
      headers: bearer(TOKEN_B),
    });
    expect(
      ApplicationDocumentListDtoSchema.parse(listB.json()).documents,
    ).toEqual([]);
  });

  it("completes idempotently and lists the application's documents with status", async () => {
    const { app } = build();
    const created = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_DOCUMENTS_PATH,
      headers: bearer(TOKEN_A),
      payload: upload,
    });
    const { documentId } = created.json<{ documentId: string }>();
    const first = await app.inject({
      method: "POST",
      url: gateqApplyDocumentCompletePath(documentId),
      headers: bearer(TOKEN_A),
      payload: {},
    });
    const second = await app.inject({
      method: "POST",
      url: gateqApplyDocumentCompletePath(documentId),
      headers: bearer(TOKEN_A),
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
    expect(first.json<{ status: string }>().status).toBe("PROCESSING");

    const list = ApplicationDocumentListDtoSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: GATEQ_APPLY_DOCUMENTS_PATH,
          headers: bearer(TOKEN_A),
        })
      ).json(),
    );
    expect(list.documents).toHaveLength(1);
    expect(list.documents[0]).toMatchObject({
      documentId,
      status: "PROCESSING",
      includedInSubmission: false,
      removable: true,
    });
    expect(list.limits.maxDocuments).toBe(10);
  });

  it("refuses removal after submit with a 409 only the owner can reach", async () => {
    const { app, sessions } = build();
    const created = await app.inject({
      method: "POST",
      url: GATEQ_APPLY_DOCUMENTS_PATH,
      headers: bearer(TOKEN_A),
      payload: upload,
    });
    const { documentId } = created.json<{ documentId: string }>();
    const session = sessions.get(TOKEN_A);
    if (session === undefined) throw new Error("fixture");
    session.submitted = true;
    const refused = await app.inject({
      method: "DELETE",
      url: gateqApplyDocumentPath(documentId),
      headers: bearer(TOKEN_A),
    });
    expect(refused.statusCode).toBe(409);
    session.submitted = false;
    const removed = await app.inject({
      method: "DELETE",
      url: gateqApplyDocumentPath(documentId),
      headers: bearer(TOKEN_A),
    });
    expect(removed.statusCode).toBe(204);
  });

  it("charges only verified sessions, and a spent allowance is a 429", async () => {
    const { app, throttle } = build({ quotaUpload: 2 });
    for (let i = 0; i < 5; i += 1) {
      const forged = await app.inject({
        method: "POST",
        url: GATEQ_APPLY_DOCUMENTS_PATH,
        headers: bearer(FORGED),
        payload: upload,
      });
      expect(forged.statusCode).toBe(404);
    }
    expect(throttle.size()).toBe(0);
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const response = await app.inject({
        method: "POST",
        url: GATEQ_APPLY_DOCUMENTS_PATH,
        headers: bearer(TOKEN_A),
        payload: { ...upload, clientRequestId: `request-000${i}` },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses).toEqual([201, 201, 429]);
  });
});
