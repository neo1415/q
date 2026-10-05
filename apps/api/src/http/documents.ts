import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  DOCUMENT_FILE_SEGMENT,
  DOCUMENT_PAGE_MAX,
  DOCUMENT_UPLOAD_SESSIONS_PATH,
  DOCUMENTS_PATH,
  DocumentFileLinkSchema,
  UtcTimestampSchema,
  parseContract,
  UuidSchema,
} from "@capital-q/contracts";
import {
  DocumentIdSchema,
  toDocumentDto,
  toDocumentUploadSessionDto,
  type DocumentId,
  type DocumentWithVersion,
  type EvidenceService,
} from "@capital-q/evidence";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/documents` — the secure upload boundary (doc 22 §64, doc 15 §25).
 *
 * The client asks for permission and is told where to put the bytes; it
 * then transfers them straight to private storage and asks the server to
 * finalize. The API never proxies document bytes, never accepts a storage
 * path from a client, and never returns a bucket, a key or a download URL.
 *
 * Handlers parse the contract, call the Evidence service and map the DTO.
 * No upload rule lives here: what is admissible, what the bytes actually
 * are and which version they become is decided in the Evidence context.
 */

export type DocumentRoutesDependencies = ActorContextDependencies & {
  readonly evidence: EvidenceService;
  /**
   * P3: a short-lived read of the owner's own current file, once the
   * route has authorised the owner (getDocumentWithVersion). The object's
   * own checks (active, version belongs, scan state) stay in Evidence.
   * Absent without storage: the route answers not found.
   */
  readonly fileLink?:
    | ((document: {
        readonly tenantId: string;
        readonly documentId: string;
        readonly versionId: string;
      }) => Promise<{
        readonly url: string;
        readonly expiresAt: string;
        readonly scanned: boolean;
      }>)
    | undefined;
};

/** P3: an opaque keyset cursor, (updatedAt, id); never an offset. */
function encodeCursor(updatedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ u: updatedAt, i: id })).toString(
    "base64url",
  );
}
function decodeCursor(raw: unknown) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 200) {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    );
    if (typeof value !== "object" || value === null) return undefined;
    const u = UtcTimestampSchema.safeParse((value as { u?: unknown }).u);
    const i = UuidSchema.safeParse((value as { i?: unknown }).i);
    return u.success && i.success
      ? { updatedAt: u.data, id: i.data }
      : undefined;
  } catch {
    return undefined;
  }
}

function uploadSessionIdParam(request: FastifyRequest): string {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    UuidSchema,
    params["uploadSessionId"],
    "The upload session identifier is not valid.",
  );
}

function documentIdParam(request: FastifyRequest): DocumentId {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    DocumentIdSchema,
    params["documentId"],
    "The document identifier is not valid.",
  );
}

function documentPayload(entry: DocumentWithVersion) {
  return toDocumentDto(entry.document, entry.currentVersion);
}

export function registerDocumentRoutes(
  app: FastifyInstance,
  dependencies: DocumentRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const service = dependencies.evidence;
  const sessionById = `${DOCUMENT_UPLOAD_SESSIONS_PATH}/:uploadSessionId`;

  // Starting, completing and cancelling an upload are generated from the
  // action registry (ADR 0040, http/app-actions.ts).
  app.get(sessionById, { onRequest: withContext }, async (request, reply) => {
    const actor = getActorContext(request);
    const session = await service.getDocumentUploadSession({
      actor,
      uploadSessionId: uploadSessionIdParam(request),
    });
    const document = await service.getDocumentWithVersion({
      actor,
      documentId: session.documentId,
    });
    return reply.header("Cache-Control", "no-store").send({
      uploadSession: toDocumentUploadSessionDto(session),
      document: documentPayload(document),
    });
  });

  app.get(
    DOCUMENTS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const query = request.query as Record<string, unknown>;
      const rawCompanyId = query["companyId"];
      const companyId =
        typeof rawCompanyId === "string"
          ? parseContract(
              UuidSchema,
              rawCompanyId,
              "The company identifier is not valid.",
            )
          : undefined;

      // P3: `limit` asks for one page of active documents, newest change
      // first, with a cursor; without it the whole list, as before.
      const rawLimit = Number(query["limit"]);
      const limit =
        query["limit"] === undefined || !Number.isInteger(rawLimit)
          ? undefined
          : Math.min(Math.max(rawLimit, 1), DOCUMENT_PAGE_MAX);
      const after = decodeCursor(query["cursor"]);
      const documents = await service.listDocumentsWithVersions({
        actor,
        ...(companyId === undefined ? {} : { companyId }),
        ...(limit === undefined
          ? {}
          : {
              page: {
                // One more than asked tells whether another page exists.
                limit: limit + 1,
                ...(after === undefined ? {} : { after }),
              },
            }),
      });
      const page = limit === undefined ? documents : documents.slice(0, limit);
      const last = page.at(-1);
      return reply.header("Cache-Control", "no-store").send({
        documents: page.map(documentPayload),
        ...(limit !== undefined &&
        documents.length > limit &&
        last !== undefined
          ? {
              nextCursor: encodeCursor(
                new Date(last.document.updatedAt).toISOString(),
                last.document.id,
              ),
            }
          : {}),
      });
    },
  );

  app.get(
    `${DOCUMENTS_PATH}/:documentId${DOCUMENT_FILE_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      // Their own document first: anything else is not found.
      const entry = await service.getDocumentWithVersion({
        actor,
        documentId: documentIdParam(request),
      });
      if (
        dependencies.fileLink === undefined ||
        entry.currentVersion === null ||
        entry.document.status !== "ACTIVE"
      ) {
        return reply.code(404).send({
          type: "about:blank",
          title: "Not found",
          status: 404,
          detail: "That file isn't available.",
        });
      }
      const link = await dependencies.fileLink({
        tenantId: entry.document.tenantId,
        documentId: entry.document.id,
        versionId: entry.currentVersion.id,
      });
      return reply
        .header("Cache-Control", "no-store")
        .send(DocumentFileLinkSchema.parse(link));
    },
  );

  app.get(
    `${DOCUMENTS_PATH}/:documentId`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const document = await service.getDocumentWithVersion({
        actor,
        documentId: documentIdParam(request),
      });
      return reply
        .header("Cache-Control", "no-store")
        .send({ document: documentPayload(document) });
    },
  );
}
