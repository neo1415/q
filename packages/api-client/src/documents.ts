import {
  CreateDocumentUploadSessionResponseSchema,
  DOCUMENT_UPLOAD_SESSIONS_PATH,
  DOCUMENTS_PATH,
  DocumentListResponseSchema,
  DocumentResponseSchema,
  DocumentUploadSessionResponseSchema,
  IDEMPOTENCY_KEY_HEADER,
  type CompleteDocumentUploadSessionRequest,
  type CreateDocumentUploadSessionRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/**
 * Documents and the secure upload boundary.
 *
 * The bytes never travel through here. The client asks for an upload
 * session, receives a scoped target, transfers the file straight to private
 * storage, and then asks the server to finalize — which is the only step
 * that decides whether those bytes become a document version.
 *
 * No method in this module returns a storage bucket, a storage key or a
 * download URL, and none accepts one.
 */

const byId = (uploadSessionId: string) =>
  `${DOCUMENT_UPLOAD_SESSIONS_PATH}/${encodeURIComponent(uploadSessionId)}`;
const idempotent = (key: string) => ({
  headers: { [IDEMPOTENCY_KEY_HEADER]: key },
});

/** `POST /v1/documents/upload-sessions` — ask permission and get a target. */
export function createDocumentUploadSession(
  session: ApiSession,
  request: CreateDocumentUploadSessionRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    DOCUMENT_UPLOAD_SESSIONS_PATH,
    CreateDocumentUploadSessionResponseSchema,
    { body: request, ...idempotent(idempotencyKey) },
  );
}

/**
 * `POST /v1/documents/upload-sessions/:id/complete` — the server verifies
 * what actually landed. Success means a version exists and is queued for
 * processing; it does not mean the file has been scanned or read.
 */
export function completeDocumentUploadSession(
  session: ApiSession,
  uploadSessionId: string,
  request: CompleteDocumentUploadSessionRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    `${byId(uploadSessionId)}/complete`,
    DocumentUploadSessionResponseSchema,
    { body: request, ...idempotent(idempotencyKey) },
  );
}

/** `POST /v1/documents/upload-sessions/:id/cancel` — abandon it safely. */
export function cancelDocumentUploadSession(
  session: ApiSession,
  uploadSessionId: string,
) {
  return call(
    session,
    "POST",
    `${byId(uploadSessionId)}/cancel`,
    DocumentUploadSessionResponseSchema,
    { body: {} },
  );
}

/** `GET /v1/documents/upload-sessions/:id` — status, for resume after a reload. */
export function getDocumentUploadSession(
  session: ApiSession,
  uploadSessionId: string,
) {
  return call(
    session,
    "GET",
    byId(uploadSessionId),
    DocumentUploadSessionResponseSchema,
  );
}

/** `GET /v1/documents/:id` — authorised metadata and processing state only. */
export function getDocument(session: ApiSession, documentId: string) {
  return call(
    session,
    "GET",
    `${DOCUMENTS_PATH}/${encodeURIComponent(documentId)}`,
    DocumentResponseSchema,
  );
}

/**
 * `GET /v1/documents` — the organisation's documents, optionally those of
 * one company. This is how a surface resumes after a reload rather than
 * asking for the same file twice.
 */
export function listDocuments(
  session: ApiSession,
  filter: { readonly companyId?: string | undefined } = {},
) {
  const query =
    filter.companyId === undefined
      ? ""
      : `?companyId=${encodeURIComponent(filter.companyId)}`;
  return call(
    session,
    "GET",
    `${DOCUMENTS_PATH}${query}`,
    DocumentListResponseSchema,
  );
}
