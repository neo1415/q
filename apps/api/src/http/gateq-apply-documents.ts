import type { FastifyInstance, FastifyRequest } from "fastify";

import {
  ApplicationDocumentIdParamsSchema,
  ApplicationDocumentListDtoSchema,
  CompleteApplicationDocumentUploadRequestSchema,
  CompleteApplicationDocumentUploadResponseSchema,
  CorrelationIdSchema,
  GATEQ_APPLICATION_DOCUMENTS_CONTRACT_VERSION,
  GATEQ_APPLY_DOCUMENT_COMPLETE_PATH,
  GATEQ_APPLY_DOCUMENT_PATH,
  GATEQ_APPLY_DOCUMENTS_PATH,
  parseContract,
  RequestApplicationDocumentUploadRequestSchema,
  RequestApplicationDocumentUploadResponseSchema,
  type ApplicationDocumentStatus,
} from "@capital-q/contracts";
import {
  GateQApplicationEvidenceScopeError,
  type GateQApplicationEvidenceItem,
  type GateQApplicationEvidenceService,
} from "@capital-q/evidence";
import {
  IntakeRefusedError,
  type GateQGuestOperation,
  type GuestThrottle,
} from "@capital-q/gateq-intake";
import { randomUUID } from "node:crypto";

/**
 * `gateq-application-documents.v1` (ADR 0067): a GateQ applicant's own
 * documents, under `/v1/gateq/apply/documents`.
 *
 * Anonymous like every applicant route: the only authority is the guest
 * session credential. The owner is the application the credential names —
 * never an organisation, never a membership, never a relationship — and
 * nothing in a request body or path can name another one. A forged,
 * expired, revoked or foreign credential, and a document id that is not
 * this application's, are all the same 404.
 *
 * Bytes go browser → private storage through a signed single-object
 * target; this process never proxies them. Completion verifies what
 * arrived and hands the version to the unchanged Evidence pipeline
 * (malware policy, extraction, instruction-risk scan).
 */

export type GateQApplyDocumentsRoutesDependencies = {
  readonly documents: Pick<
    GateQApplicationEvidenceService,
    "create" | "complete" | "list" | "remove"
  >;
  /** Verifies the credential; its session id keys the throttle. */
  readonly authoriseGuest: (
    token: string,
  ) => Promise<{ readonly sessionId: string }>;
  readonly throttle?: GuestThrottle | undefined;
  readonly limits: {
    readonly maxDocuments: number;
    readonly maxTotalBytes: number;
    readonly maxFileBytes: number;
    readonly allowedMimeTypes: readonly string[];
  };
};

function credential(request: FastifyRequest): string {
  const header = request.headers.authorization;
  if (typeof header !== "string") return "";
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" ? (value ?? "") : "";
}

function dto(item: GateQApplicationEvidenceItem) {
  return {
    documentId: item.documentId,
    fileName: item.fileName,
    status: item.status,
    byteSize: item.byteSize,
    pages: item.pages,
    // Validated by the response schema; NOT_SCANNED is never "clean".
    malwareStatus: item.malwareStatus,
    includedInSubmission: item.includedInSubmission,
    removable: item.removable,
  };
}

export function registerGateQApplyDocumentRoutes(
  app: FastifyInstance,
  dependencies: GateQApplyDocumentsRoutesDependencies,
): void {
  const { documents, authoriseGuest, throttle, limits } = dependencies;

  /** One answer for every way a guest document request can be wrong. */
  const refuse = (
    error: unknown,
    reply: { callNotFound: () => void },
  ): undefined => {
    if (
      error instanceof GateQApplicationEvidenceScopeError ||
      (error instanceof IntakeRefusedError &&
        error.refusal !== "TOO_MANY_REQUESTS" &&
        error.refusal !== "CONTACT_NOT_CONFIRMED")
    ) {
      reply.callNotFound();
      return undefined;
    }
    throw error;
  };

  /** Verify first, then charge the verified session (never the secret). */
  const charge = async (
    token: string,
    operation: GateQGuestOperation,
  ): Promise<void> => {
    const guest = await authoriseGuest(token);
    if (
      throttle !== undefined &&
      !throttle.charge({ sessionId: guest.sessionId, operation })
    ) {
      throw new IntakeRefusedError("TOO_MANY_REQUESTS");
    }
  };

  const documentId = (params: unknown): string => {
    const parsed = ApplicationDocumentIdParamsSchema.safeParse(params);
    // A malformed id is the same refusal as somebody else's.
    if (!parsed.success) throw new GateQApplicationEvidenceScopeError();
    return parsed.data.documentId;
  };

  const statusOf = async (
    token: string,
    id: string,
    fallback: ApplicationDocumentStatus,
  ): Promise<ApplicationDocumentStatus> =>
    (await documents.list({ credential: token })).find(
      (item) => item.documentId === id,
    )?.status ?? fallback;

  app.post(GATEQ_APPLY_DOCUMENTS_PATH, async (request, reply) => {
    const input = parseContract(
      RequestApplicationDocumentUploadRequestSchema,
      request.body,
      "The document is not valid.",
    );
    const token = credential(request);
    try {
      await charge(token, "UPLOAD");
      const created = await documents.create({
        credential: token,
        input: {
          filename: input.fileName,
          declaredMimeType: input.mimeType,
          declaredSizeBytes: input.byteSize,
          clientRequestId: input.clientRequestId,
        },
      });
      void reply.code(201).header("Cache-Control", "no-store");
      return RequestApplicationDocumentUploadResponseSchema.parse({
        contractVersion: GATEQ_APPLICATION_DOCUMENTS_CONTRACT_VERSION,
        documentId: created.documentId,
        status:
          created.upload === undefined
            ? await statusOf(token, created.documentId, "PROCESSING")
            : "UPLOADING",
        expiresAt: created.expiresAt,
        upload:
          created.upload === undefined
            ? null
            : {
                method: created.upload.method,
                url: created.upload.url,
                headers: created.upload.headers,
                expiresAt: created.expiresAt,
                providerExpiresAt: created.upload.providerExpiresAt,
                maxBytes: Math.min(limits.maxFileBytes, input.byteSize),
                allowedMimeTypes: [...limits.allowedMimeTypes],
              },
      });
    } catch (error: unknown) {
      return refuse(error, reply);
    }
  });

  app.post(GATEQ_APPLY_DOCUMENT_COMPLETE_PATH, async (request, reply) => {
    const token = credential(request);
    try {
      const id = documentId(request.params);
      const input = parseContract(
        CompleteApplicationDocumentUploadRequestSchema,
        request.body ?? {},
        "The request is not valid.",
      );
      // Bounded by the reservation itself: it completes once, and a replay
      // returns early, so it is charged like a read, not a new upload.
      await charge(token, "RESUME");
      const completed = await documents.complete({
        credential: token,
        documentId: id,
        correlationId: CorrelationIdSchema.parse(`cor_${randomUUID()}`),
        ...(input.sha256 === undefined ? {} : { clientSha256: input.sha256 }),
      });
      void reply.header("Cache-Control", "no-store");
      return CompleteApplicationDocumentUploadResponseSchema.parse({
        contractVersion: GATEQ_APPLICATION_DOCUMENTS_CONTRACT_VERSION,
        documentId: completed.documentId,
        status: await statusOf(token, completed.documentId, completed.status),
      });
    } catch (error: unknown) {
      return refuse(error, reply);
    }
  });

  app.get(GATEQ_APPLY_DOCUMENTS_PATH, async (request, reply) => {
    const token = credential(request);
    try {
      await charge(token, "RESUME");
      const items = await documents.list({ credential: token });
      void reply.header("Cache-Control", "no-store");
      return ApplicationDocumentListDtoSchema.parse({
        contractVersion: GATEQ_APPLICATION_DOCUMENTS_CONTRACT_VERSION,
        documents: items.map(dto),
        limits: {
          maxDocuments: limits.maxDocuments,
          maxTotalBytes: limits.maxTotalBytes,
          maxFileBytes: limits.maxFileBytes,
        },
      });
    } catch (error: unknown) {
      return refuse(error, reply);
    }
  });

  app.delete(GATEQ_APPLY_DOCUMENT_PATH, async (request, reply) => {
    const token = credential(request);
    try {
      const id = documentId(request.params);
      await charge(token, "RESUME");
      await documents.remove({ credential: token, documentId: id });
      void reply.code(204).header("Cache-Control", "no-store");
      return undefined;
    } catch (error: unknown) {
      return refuse(error, reply);
    }
  });
}
