import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  DOCUMENT_UPLOAD_SESSIONS_PATH,
  DOCUMENTS_PATH,
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
};

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
