import { z } from "zod";

import {
  DOCUMENT_ARCHIVE_SEGMENT,
  DOCUMENT_FILE_SEGMENT,
  DocumentFileLinkSchema,
  type ArchiveDocumentRequest,
  type RenameDocumentRequest,
  CreateDocumentUploadSessionResponseSchema,
  DOCUMENT_UPLOAD_SESSIONS_PATH,
  DOCUMENT_DOWNLOAD_AUDIENCE_SEGMENT,
  DOCUMENTS_PATH,
  DocumentDownloadAudienceDtoSchema,
  DocumentListResponseSchema,
  DocumentResponseSchema,
  DocumentUploadSessionResponseSchema,
  IDEMPOTENCY_KEY_HEADER,
  type CompleteDocumentUploadSessionRequest,
  type SetDocumentDownloadAudienceRequest,
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
  filter: {
    readonly companyId?: string | undefined;
    /** P3: one page of active documents, newest change first. */
    readonly limit?: number | undefined;
    readonly cursor?: string | undefined;
  } = {},
) {
  const query = new URLSearchParams();
  if (filter.companyId !== undefined) query.set("companyId", filter.companyId);
  if (filter.limit !== undefined) query.set("limit", String(filter.limit));
  if (filter.cursor !== undefined) query.set("cursor", filter.cursor);
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  return call(
    session,
    "GET",
    `${DOCUMENTS_PATH}${suffix}`,
    DocumentListResponseSchema,
  );
}

const ManagedDocumentSchema = z
  .object({
    documentId: z.string(),
    title: z.string(),
    status: z.enum(["ACTIVE", "ARCHIVED"]),
    version: z.number().int(),
  })
  .strict();

/** P3 `PATCH /v1/documents/:id` — rename one of their own documents. */
export function renameDocument(
  session: ApiSession,
  documentId: string,
  request: RenameDocumentRequest,
) {
  return call(
    session,
    "PATCH",
    `${DOCUMENTS_PATH}/${encodeURIComponent(documentId)}`,
    ManagedDocumentSchema,
    { body: request },
  );
}

/** P3 `POST /v1/documents/:id/archive` — delete it, or bring it back. */
export function archiveDocument(
  session: ApiSession,
  documentId: string,
  request: ArchiveDocumentRequest,
) {
  return call(
    session,
    "POST",
    `${DOCUMENTS_PATH}/${encodeURIComponent(documentId)}${DOCUMENT_ARCHIVE_SEGMENT}`,
    ManagedDocumentSchema,
    { body: request },
  );
}

/** P3 `GET /v1/documents/:id/file` — a short-lived link to their own file. */
export function getDocumentFile(session: ApiSession, documentId: string) {
  return call(
    session,
    "GET",
    `${DOCUMENTS_PATH}/${encodeURIComponent(documentId)}${DOCUMENT_FILE_SEGMENT}`,
    DocumentFileLinkSchema,
  );
}

/**
 * `POST /v1/documents/:id/download-audience` — who may download a pitch
 * deck (ADR 0041): only the organisation, or investors who can find the
 * company. The version the screen saw; a stale one is refused.
 */
export function setDocumentDownloadAudience(
  session: ApiSession,
  documentId: string,
  request: SetDocumentDownloadAudienceRequest,
) {
  return call(
    session,
    "POST",
    `${DOCUMENTS_PATH}/${encodeURIComponent(documentId)}${DOCUMENT_DOWNLOAD_AUDIENCE_SEGMENT}`,
    DocumentDownloadAudienceDtoSchema,
    { body: request },
  );
}
