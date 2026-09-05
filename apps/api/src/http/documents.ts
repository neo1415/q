import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CompleteDocumentUploadSessionRequestSchema,
  CorrelationIdSchema,
  CreateDocumentUploadSessionRequestSchema,
  DOCUMENT_UPLOAD_SESSIONS_PATH,
  DOCUMENTS_PATH,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  parseContract,
  UtcTimestampSchema,
  UuidSchema,
  type CorrelationId,
  type DirectUploadTarget,
} from "@capital-q/contracts";
import {
  DocumentIdSchema,
  toDocumentDto,
  toDocumentUploadSessionDto,
  type DirectUploadAuthorization,
  type DocumentId,
  type DocumentUploadSession,
  type DocumentWithVersion,
  type EvidenceService,
} from "@capital-q/evidence";
import { createCorrelationId } from "@capital-q/observability";

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
  readonly uploads: {
    readonly maxBytes: number;
    readonly allowedMimeTypes: readonly string[];
  };
};

function correlation(): CorrelationId {
  return CorrelationIdSchema.parse(createCorrelationId());
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

function idempotencyKey(request: FastifyRequest, purpose: string): string {
  const raw = request.headers[IDEMPOTENCY_KEY_HEADER];
  return parseContract(
    IdempotencyKeyHeaderSchema,
    typeof raw === "string" ? raw : undefined,
    `An Idempotency-Key header is required to ${purpose}.`,
  );
}

function documentPayload(entry: DocumentWithVersion) {
  return toDocumentDto(entry.document, entry.currentVersion);
}

function uploadTarget(
  authorization: DirectUploadAuthorization,
  session: DocumentUploadSession,
  limits: DocumentRoutesDependencies["uploads"],
): DirectUploadTarget {
  return {
    method: authorization.method,
    url: authorization.url,
    headers: authorization.headers,
    // Capital Q stops accepting the upload first; the provider's own token
    // may outlive that, and finalization after it fails closed.
    expiresAt: session.expiresAt,
    providerExpiresAt: UtcTimestampSchema.parse(
      authorization.providerExpiresAt,
    ),
    maxBytes: limits.maxBytes,
    allowedMimeTypes: [...limits.allowedMimeTypes],
  };
}

export function registerDocumentRoutes(
  app: FastifyInstance,
  dependencies: DocumentRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const service = dependencies.evidence;
  const sessionById = `${DOCUMENT_UPLOAD_SESSIONS_PATH}/:uploadSessionId`;

  app.post(
    DOCUMENT_UPLOAD_SESSIONS_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const key = idempotencyKey(request, "start a document upload");
      const input = parseContract(
        CreateDocumentUploadSessionRequestSchema,
        request.body,
        "The upload request is not valid.",
      );

      const result = await service.createDocumentUploadSession({
        actor,
        input,
        idempotencyKey: key,
        correlationId: correlation(),
      });

      return reply
        .code(201)
        .header("Cache-Control", "no-store")
        .header(
          "Location",
          `${DOCUMENT_UPLOAD_SESSIONS_PATH}/${result.session.id}`,
        )
        .send({
          uploadSession: toDocumentUploadSessionDto(result.session),
          document: toDocumentDto(result.document, null),
          upload:
            result.upload === undefined
              ? null
              : uploadTarget(
                  result.upload,
                  result.session,
                  dependencies.uploads,
                ),
        });
    },
  );

  app.post(
    `${sessionById}/complete`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const key = idempotencyKey(request, "complete a document upload");
      const input = parseContract(
        CompleteDocumentUploadSessionRequestSchema,
        request.body ?? {},
        "The upload completion request is not valid.",
      );

      const result = await service.completeDocumentUploadSession({
        actor,
        uploadSessionId: uploadSessionIdParam(request),
        input,
        idempotencyKey: key,
        correlationId: correlation(),
      });

      return reply.header("Cache-Control", "no-store").send({
        uploadSession: toDocumentUploadSessionDto(result.session),
        document: toDocumentDto(result.document, result.version),
      });
    },
  );

  app.post(
    `${sessionById}/cancel`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const session = await service.cancelDocumentUploadSession({
        actor,
        uploadSessionId: uploadSessionIdParam(request),
        correlationId: correlation(),
      });
      const document = await service.getDocumentWithVersion({
        actor,
        documentId: session.documentId,
      });
      return reply.header("Cache-Control", "no-store").send({
        uploadSession: toDocumentUploadSessionDto(session),
        document: documentPayload(document),
      });
    },
  );

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

      const documents = await service.listDocumentsWithVersions({
        actor,
        ...(companyId === undefined ? {} : { companyId }),
      });
      return reply
        .header("Cache-Control", "no-store")
        .send({ documents: documents.map(documentPayload) });
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
