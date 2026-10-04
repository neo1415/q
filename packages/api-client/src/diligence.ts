import {
  diligencePath,
  DiligenceDownloadDtoSchema,
  DiligenceDtoSchema,
  DiligenceRequestResultDtoSchema,
  DiligenceRevokeResultDtoSchema,
  DiligenceShareResultDtoSchema,
  IDEMPOTENCY_KEY_HEADER,
  type RequestDiligenceDocumentRequest,
} from "@capital-q/contracts";

import { call, type ApiSession } from "./request.js";

/** A relationship's diligence area, as the caller's side sees it. */
export function getDiligence(session: ApiSession, relationshipId: string) {
  return call(
    session,
    "GET",
    diligencePath(relationshipId),
    DiligenceDtoSchema,
  );
}

/** The founder shares one of their own documents with this relationship. */
export function shareDiligenceDocument(
  session: ApiSession,
  relationshipId: string,
  documentId: string,
) {
  return call(
    session,
    "POST",
    diligencePath(relationshipId, "/shares"),
    DiligenceShareResultDtoSchema,
    { body: { documentId } },
  );
}

export function revokeDiligenceShare(
  session: ApiSession,
  relationshipId: string,
  policyId: string,
) {
  return call(
    session,
    "POST",
    diligencePath(
      relationshipId,
      `/shares/${encodeURIComponent(policyId)}/revoke`,
    ),
    DiligenceRevokeResultDtoSchema,
  );
}

/** The investor asks for a document; one key per press. */
export function requestDiligenceDocument(
  session: ApiSession,
  relationshipId: string,
  request: RequestDiligenceDocumentRequest,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    diligencePath(relationshipId, "/requests"),
    DiligenceRequestResultDtoSchema,
    { body: request, headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey } },
  );
}

export function fulfilDiligenceRequest(
  session: ApiSession,
  relationshipId: string,
  requestId: string,
  documentId: string,
) {
  return call(
    session,
    "POST",
    diligencePath(
      relationshipId,
      `/requests/${encodeURIComponent(requestId)}/fulfil`,
    ),
    DiligenceShareResultDtoSchema,
    { body: { documentId } },
  );
}

/**
 * Upload and share in one step: the founder's file, already in storage
 * through a document upload session, answers this request. One key per press.
 */
export function uploadAndFulfilDiligenceRequest(
  session: ApiSession,
  relationshipId: string,
  requestId: string,
  uploadSessionId: string,
  idempotencyKey: string,
) {
  return call(
    session,
    "POST",
    diligencePath(
      relationshipId,
      `/requests/${encodeURIComponent(requestId)}/upload`,
    ),
    DiligenceShareResultDtoSchema,
    {
      body: { uploadSessionId },
      headers: { [IDEMPOTENCY_KEY_HEADER]: idempotencyKey },
    },
  );
}

/** A short-lived signed download of a shared document, decided server-side. */
export function diligenceDownload(
  session: ApiSession,
  relationshipId: string,
  documentId: string,
) {
  return call(
    session,
    "GET",
    diligencePath(
      relationshipId,
      `/documents/${encodeURIComponent(documentId)}/download`,
    ),
    DiligenceDownloadDtoSchema,
  );
}
