"use server";

import { z } from "zod";

import {
  diligenceDownload,
  fulfilDiligenceRequest,
  getDiligence,
  listDocuments,
  requestDiligenceDocument,
  revokeDiligenceShare,
  shareDiligenceDocument,
  uploadAndFulfilDiligenceRequest,
  type ApiSession,
} from "@capital-q/api-client";
import {
  RequestDiligenceDocumentRequestSchema,
  type DiligenceDto,
  type RequestDiligenceDocumentRequest,
} from "@capital-q/contracts";

import { getCurrentIdentity } from "@/auth/current-identity";
import { apiSession } from "@/features/q/context";

import {
  diligenceErrorMessage,
  DOWNLOAD_UNAVAILABLE,
} from "./diligence-errors";

/**
 * Diligence, server side (2026-10-02). Server actions so the session token
 * never reaches the browser; ids are input, and the API decides whether
 * this person is a party and on which side. A download is a short-lived
 * signed URL the browser then fetches straight from storage.
 */
export type DiligenceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly message: string };

const Id = z.string().uuid();
const Key = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[A-Za-z0-9:_-]+$/);

async function run<T>(
  work: (session: ApiSession) => Promise<T>,
  refused?: string,
): Promise<DiligenceResult<T>> {
  const session = await apiSession();
  if (session === null) {
    return { ok: false, message: "Please sign in again to continue." };
  }
  try {
    return { ok: true, value: await work(session) };
  } catch (error: unknown) {
    return { ok: false, message: diligenceErrorMessage(error, refused) };
  }
}

export async function readDiligenceAction(
  relationshipId: string,
): Promise<DiligenceResult<DiligenceDto>> {
  const id = Id.safeParse(relationshipId);
  if (!id.success)
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  return run((session) => getDiligence(session, id.data));
}

/** The founder's own documents for this company, to pick one to share. */
export async function ownDocumentsAction(
  companyId: string,
): Promise<
  DiligenceResult<readonly { readonly id: string; readonly title: string }[]>
> {
  const id = Id.safeParse(companyId);
  if (!id.success)
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  return run(async (session) =>
    (await listDocuments(session, { companyId: id.data })).documents.map(
      (document) => ({ id: document.id, title: document.title }),
    ),
  );
}

export async function shareDiligenceAction(
  relationshipId: string,
  documentId: string,
  requestId: string | null,
): Promise<DiligenceResult<{ readonly policyId: string }>> {
  const id = Id.safeParse(relationshipId);
  const document = Id.safeParse(documentId);
  if (!id.success || !document.success)
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  if (requestId !== null) {
    const request = Id.safeParse(requestId);
    if (!request.success)
      return {
        ok: false,
        message: "We couldn't find that. Refresh the page and try again.",
      };
    return run((session) =>
      fulfilDiligenceRequest(session, id.data, request.data, document.data),
    );
  }
  return run((session) =>
    shareDiligenceDocument(session, id.data, document.data),
  );
}

export async function revokeDiligenceAction(
  relationshipId: string,
  policyId: string,
): Promise<DiligenceResult<{ readonly revoked: boolean }>> {
  const id = Id.safeParse(relationshipId);
  const policy = Id.safeParse(policyId);
  if (!id.success || !policy.success)
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  return run((session) => revokeDiligenceShare(session, id.data, policy.data));
}

export async function requestDiligenceAction(
  relationshipId: string,
  request: RequestDiligenceDocumentRequest,
  idempotencyKey: string,
): Promise<DiligenceResult<{ readonly requestId: string }>> {
  const id = Id.safeParse(relationshipId);
  const key = Key.safeParse(idempotencyKey);
  const body = RequestDiligenceDocumentRequestSchema.safeParse(request);
  if (!id.success || !key.success)
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  if (!body.success)
    return { ok: false, message: "Name the document you need." };
  return run((session) =>
    requestDiligenceDocument(session, id.data, body.data, key.data),
  );
}

/**
 * Upload and share in one step: the file is already in storage through the
 * documents screen's own upload session; the API finishes it into their
 * Documents and answers the request with it. One key per press.
 */
export async function uploadAndFulfilAction(
  relationshipId: string,
  requestId: string,
  uploadSessionId: string,
  idempotencyKey: string,
): Promise<DiligenceResult<{ readonly policyId: string }>> {
  const id = Id.safeParse(relationshipId);
  const request = Id.safeParse(requestId);
  const upload = Id.safeParse(uploadSessionId);
  const key = Key.safeParse(idempotencyKey);
  if (!id.success || !request.success || !upload.success || !key.success) {
    return {
      ok: false,
      message: "We couldn't find that. Refresh the page and try again.",
    };
  }
  return run((session) =>
    uploadAndFulfilDiligenceRequest(
      session,
      id.data,
      request.data,
      upload.data,
      key.data,
    ),
  );
}

/**
 * A shared document to read in place (request checklist, 2026-10-20): an
 * inline, short-lived signed URL, and the reader's own name for the
 * watermark over it. The watermark deters and attributes; it does not
 * prevent a screenshot, and nothing claims it does. Opening it is what
 * "Viewed" means to the founder.
 */
export async function diligenceViewAction(
  relationshipId: string,
  documentId: string,
): Promise<
  DiligenceResult<{ readonly url: string; readonly watermark: string }>
> {
  const id = Id.safeParse(relationshipId);
  const document = Id.safeParse(documentId);
  if (!id.success || !document.success)
    return { ok: false, message: DOWNLOAD_UNAVAILABLE };
  const [link, identity] = await Promise.all([
    run(
      async (session) =>
        (await diligenceDownload(session, id.data, document.data, true)).url,
      DOWNLOAD_UNAVAILABLE,
    ),
    getCurrentIdentity(),
  ]);
  if (!link.ok) return link;
  const name =
    identity.status === "AVAILABLE" ? identity.me.user.displayName : null;
  // No "view only": a diligence share can also be downloaded.
  const watermark = [name, new Date().toISOString().slice(0, 10)]
    .filter((part): part is string => part !== null && part.trim() !== "")
    .join(" · ")
    .slice(0, 200);
  return { ok: true, value: { url: link.value, watermark } };
}

export async function diligenceDownloadAction(
  relationshipId: string,
  documentId: string,
  view = false,
): Promise<DiligenceResult<{ readonly url: string }>> {
  const id = Id.safeParse(relationshipId);
  const document = Id.safeParse(documentId);
  if (!id.success || !document.success)
    return { ok: false, message: DOWNLOAD_UNAVAILABLE };
  return run(
    async (session) => ({
      url: (
        await diligenceDownload(session, id.data, document.data, view === true)
      ).url,
    }),
    DOWNLOAD_UNAVAILABLE,
  );
}
