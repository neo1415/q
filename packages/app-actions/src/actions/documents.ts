import { z } from "zod";

import {
  CompleteDocumentUploadSessionRequestSchema,
  CreateDocumentUploadSessionRequestSchema,
  DOCUMENT_UPLOAD_SESSIONS_PATH,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  UtcTimestampSchema,
  UuidSchema,
  type DirectUploadTarget,
} from "@capital-q/contracts";
import {
  toDocumentDto,
  toDocumentUploadSessionDto,
  type DirectUploadAuthorization,
  type DocumentUploadSession,
  type EvidenceService,
} from "@capital-q/evidence";

import { defineAppAction, type AnyAppAction } from "../define.js";
import type { AppActionPorts, DocumentUploadLimits } from "../ports.js";

/**
 * Document uploads (ADR 0040 checklist, media and documents): starting,
 * completing and cancelling an upload of the person's own document, each
 * declared once with its generated route. Every step needs the person's
 * own file, so Q offers the upload screen (`offer.document_upload`) and
 * never takes them itself. Storage failures answer as before, through the
 * application's own error handler.
 */

const missing = (port: string): never => {
  throw new Error(`APP_ACTION_PORT_MISSING:${port}`);
};

const serviceResult = <T>(): z.ZodType<T> => z.custom<T>();

/** The evidence service authorises (their own organisation's documents). */
const servicesDecide = () => Promise.resolve({ ok: true as const });

type Uploads = Pick<
  EvidenceService,
  | "createDocumentUploadSession"
  | "completeDocumentUploadSession"
  | "cancelDocumentUploadSession"
  | "getDocumentWithVersion"
>;

const evidence = (ports: AppActionPorts): Uploads =>
  ports.documentUploads ?? missing("documentUploads");
const limits = (ports: AppActionPorts): DocumentUploadLimits =>
  ports.documentUploadLimits ?? missing("documentUploadLimits");

const keyOf = (headers: Readonly<Record<string, unknown>>) =>
  headers[IDEMPOTENCY_KEY_HEADER];
const sessionById = `${DOCUMENT_UPLOAD_SESSIONS_PATH}/:uploadSessionId`;
const OFFER = "offer.document_upload" as const;

/** Where the browser sends the bytes: straight to storage, never via us. */
function uploadTarget(
  authorization: DirectUploadAuthorization,
  session: DocumentUploadSession,
  allowed: DocumentUploadLimits,
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
    maxBytes: allowed.maxBytes,
    allowedMimeTypes: [...allowed.allowedMimeTypes],
  };
}

const Start = z
  .object({
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: CreateDocumentUploadSessionRequestSchema,
  })
  .strict();

const START = defineAppAction<
  z.infer<typeof Start>,
  Awaited<ReturnType<EvidenceService["createDocumentUploadSession"]>>
>({
  name: "document.upload.start",
  short: "upload a document",
  area: "documents",
  classification: "CONSEQUENTIAL",
  does: "Starts an upload of one of their own documents, as the documents screen does; the bytes go straight to storage.",
  input: Start,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    evidence(ports).createDocumentUploadSession({
      actor: context.actor,
      input: input.input,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    }),
  targets: () => [],
  card: () => ({ summary: "Upload a document", preview: "" }),
  done: () => "Ready for the file.",
  http: {
    method: "POST",
    path: DOCUMENT_UPLOAD_SESSIONS_PATH,
    fromRequest: (_params, body, headers) => ({
      idempotencyKey: keyOf(headers),
      input: body,
    }),
    status: 201,
    location: (out) => `${DOCUMENT_UPLOAD_SESSIONS_PATH}/${out.session.id}`,
    respond: (out, _input, ports) => ({
      uploadSession: toDocumentUploadSessionDto(out.session),
      document: toDocumentDto(out.document, null),
      upload:
        out.upload === undefined
          ? null
          : uploadTarget(out.upload, out.session, limits(ports)),
    }),
  },
  qCapability: OFFER,
});

const Complete = z
  .object({
    uploadSessionId: UuidSchema,
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: CompleteDocumentUploadSessionRequestSchema,
  })
  .strict();

const COMPLETE = defineAppAction<
  z.infer<typeof Complete>,
  Awaited<ReturnType<EvidenceService["completeDocumentUploadSession"]>>
>({
  name: "document.upload.complete",
  short: "finish a document upload",
  area: "documents",
  classification: "CONSEQUENTIAL",
  does: "Finishes an upload of their own document once its bytes are stored, as the documents screen does.",
  input: Complete,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    evidence(ports).completeDocumentUploadSession({
      actor: context.actor,
      uploadSessionId: input.uploadSessionId,
      input: input.input,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    }),
  targets: () => [],
  card: () => ({ summary: "Finish the upload", preview: "" }),
  done: () => "Uploaded.",
  http: {
    method: "POST",
    path: `${sessionById}/complete`,
    fromRequest: (params, body, headers) => ({
      uploadSessionId: params["uploadSessionId"],
      idempotencyKey: keyOf(headers),
      input: body ?? {},
    }),
    respond: (out) => ({
      uploadSession: toDocumentUploadSessionDto(out.session),
      document: toDocumentDto(out.document, out.version),
    }),
  },
  qCapability: OFFER,
});

const Cancel = z.object({ uploadSessionId: UuidSchema }).strict();

type Cancelled = {
  readonly session: Awaited<
    ReturnType<EvidenceService["cancelDocumentUploadSession"]>
  >;
  readonly document: Awaited<
    ReturnType<EvidenceService["getDocumentWithVersion"]>
  >;
};

const CANCEL = defineAppAction<z.infer<typeof Cancel>, Cancelled>({
  name: "document.upload.cancel",
  short: "cancel a document upload",
  area: "documents",
  classification: "CONSEQUENTIAL",
  does: "Stops an unfinished upload of their own document, as the documents screen does.",
  input: Cancel,
  output: serviceResult(),
  authorize: servicesDecide,
  run: async (ports, context, input) => {
    const session = await evidence(ports).cancelDocumentUploadSession({
      actor: context.actor,
      uploadSessionId: input.uploadSessionId,
      correlationId: context.correlationId,
    });
    const document = await evidence(ports).getDocumentWithVersion({
      actor: context.actor,
      documentId: session.documentId,
    });
    return { session, document };
  },
  targets: () => [],
  card: () => ({ summary: "Cancel the upload", preview: "" }),
  done: () => "Cancelled.",
  http: {
    method: "POST",
    path: `${sessionById}/cancel`,
    fromRequest: (params) => ({ uploadSessionId: params["uploadSessionId"] }),
    respond: (out) => ({
      uploadSession: toDocumentUploadSessionDto(out.session),
      document: toDocumentDto(
        out.document.document,
        out.document.currentVersion,
      ),
    }),
  },
  qCapability: OFFER,
});

export const DOCUMENT_ACTIONS: readonly AnyAppAction[] = [
  START,
  COMPLETE,
  CANCEL,
];
