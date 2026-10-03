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
  type ApiSession,
} from "@capital-q/api-client";
import {
  RequestDiligenceDocumentRequestSchema,
  type DiligenceDto,
  type RequestDiligenceDocumentRequest,
} from "@capital-q/contracts";

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
  if (!id.success) return { ok: false, message: "Not found." };
  return run((session) => getDiligence(session, id.data));
}

/** The founder's own documents for this company, to pick one to share. */
export async function ownDocumentsAction(
  companyId: string,
): Promise<
  DiligenceResult<readonly { readonly id: string; readonly title: string }[]>
> {
  const id = Id.safeParse(companyId);
  if (!id.success) return { ok: false, message: "Not found." };
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
    return { ok: false, message: "Not found." };
  if (requestId !== null) {
    const request = Id.safeParse(requestId);
    if (!request.success) return { ok: false, message: "Not found." };
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
    return { ok: false, message: "Not found." };
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
  if (!id.success || !key.success) return { ok: false, message: "Not found." };
  if (!body.success)
    return { ok: false, message: "Name the document you need." };
  return run((session) =>
    requestDiligenceDocument(session, id.data, body.data, key.data),
  );
}

export async function diligenceDownloadAction(
  relationshipId: string,
  documentId: string,
): Promise<DiligenceResult<{ readonly url: string }>> {
  const id = Id.safeParse(relationshipId);
  const document = Id.safeParse(documentId);
  if (!id.success || !document.success)
    return { ok: false, message: DOWNLOAD_UNAVAILABLE };
  return run(
    async (session) => ({
      url: (await diligenceDownload(session, id.data, document.data)).url,
    }),
    DOWNLOAD_UNAVAILABLE,
  );
}
