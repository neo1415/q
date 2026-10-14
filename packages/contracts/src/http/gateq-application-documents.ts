import { z } from "zod";

import { DirectUploadTargetSchema } from "./documents.js";

/**
 * `gateq-application-documents.v1` (ADR 0067): a GateQ applicant's own
 * documents, uploaded during the application.
 *
 *   application custody ≠ organisation membership ≠ relationship
 *   uploaded ≠ scanned ≠ extracted ≠ disclosed
 *
 * Every route is authorised only by the guest session credential
 * (`Authorization: Bearer gqs_…`). Nothing here names a tenant, an
 * organisation, an application or a storage key: the server derives the
 * owner from the credential, and an unknown, forged or foreign credential
 * is the same 404 as every other guest route.
 *
 * Bytes never pass through the API: the request route returns a signed,
 * single-object, direct-to-storage upload target, and the complete route
 * verifies what arrived before the Evidence pipeline (malware policy,
 * extraction, instruction-risk scan) starts.
 */

export const GATEQ_APPLICATION_DOCUMENTS_CONTRACT_VERSION =
  "gateq-application-documents.v1" as const;

export const GATEQ_APPLY_DOCUMENTS_PATH = "/v1/gateq/apply/documents" as const;
export const GATEQ_APPLY_DOCUMENT_PATH =
  "/v1/gateq/apply/documents/:documentId" as const;
export const GATEQ_APPLY_DOCUMENT_COMPLETE_PATH =
  "/v1/gateq/apply/documents/:documentId/complete" as const;

export function gateqApplyDocumentPath(documentId: string): string {
  return `${GATEQ_APPLY_DOCUMENTS_PATH}/${encodeURIComponent(documentId)}`;
}
export function gateqApplyDocumentCompletePath(documentId: string): string {
  return `${gateqApplyDocumentPath(documentId)}/complete`;
}

/**
 * What the applicant is told about one document.
 *
 * - UPLOADING: an upload target was issued; no verified bytes yet.
 * - PROCESSING: a version exists; scanning or extraction is still running.
 * - READY: scanned (or recorded NOT_SCANNED under the interim policy) and
 *   extracted. Only READY documents can reach Q or be disclosed.
 * - BLOCKED: the malware policy refused it.
 * - FAILED: the upload was refused or expired, or processing failed.
 */
export const ApplicationDocumentStatusSchema = z.enum([
  "UPLOADING",
  "PROCESSING",
  "READY",
  "BLOCKED",
  "FAILED",
]);
export type ApplicationDocumentStatus = z.infer<
  typeof ApplicationDocumentStatusSchema
>;

export const ApplicationDocumentIdParamsSchema = z
  .object({ documentId: z.string().uuid() })
  .strict();

export const RequestApplicationDocumentUploadRequestSchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    mimeType: z.string().trim().min(3).max(129),
    byteSize: z.number().int().positive(),
    /** Retries with the same id and content return the same upload. */
    clientRequestId: z.string().trim().min(8).max(200),
  })
  .strict();
export type RequestApplicationDocumentUploadRequest = z.input<
  typeof RequestApplicationDocumentUploadRequestSchema
>;

export const RequestApplicationDocumentUploadResponseSchema = z
  .object({
    contractVersion: z.literal(GATEQ_APPLICATION_DOCUMENTS_CONTRACT_VERSION),
    documentId: z.string().uuid(),
    status: ApplicationDocumentStatusSchema,
    expiresAt: z.string().datetime(),
    /** Null on a replay whose upload is already finished or refused. */
    upload: DirectUploadTargetSchema.nullable(),
  })
  .strict();
export type RequestApplicationDocumentUploadResponse = z.infer<
  typeof RequestApplicationDocumentUploadResponseSchema
>;

export const CompleteApplicationDocumentUploadRequestSchema = z
  .object({
    /** Optional client digest; a mismatch refuses the upload. */
    sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .strict();

export const CompleteApplicationDocumentUploadResponseSchema = z
  .object({
    contractVersion: z.literal(GATEQ_APPLICATION_DOCUMENTS_CONTRACT_VERSION),
    documentId: z.string().uuid(),
    status: ApplicationDocumentStatusSchema,
  })
  .strict();
export type CompleteApplicationDocumentUploadResponse = z.infer<
  typeof CompleteApplicationDocumentUploadResponseSchema
>;

export const ApplicationDocumentDtoSchema = z
  .object({
    documentId: z.string().uuid(),
    fileName: z.string(),
    status: ApplicationDocumentStatusSchema,
    byteSize: z.number().int().nonnegative(),
    pages: z.number().int().nonnegative().nullable(),
    /** NOT_SCANNED is never presented as clean. */
    malwareStatus: z
      .enum(["PENDING", "CLEAN", "BLOCKED", "ERROR", "NOT_SCANNED"])
      .nullable(),
    /** True once frozen into the submitted application. */
    includedInSubmission: z.boolean(),
    /** Removable only while the application is open and it is not frozen. */
    removable: z.boolean(),
  })
  .strict();
export type ApplicationDocumentDto = z.infer<
  typeof ApplicationDocumentDtoSchema
>;

export const ApplicationDocumentListDtoSchema = z
  .object({
    contractVersion: z.literal(GATEQ_APPLICATION_DOCUMENTS_CONTRACT_VERSION),
    documents: z.array(ApplicationDocumentDtoSchema).max(100),
    limits: z
      .object({
        maxDocuments: z.number().int().positive(),
        maxTotalBytes: z.number().int().positive(),
        maxFileBytes: z.number().int().positive(),
      })
      .strict(),
  })
  .strict();
export type ApplicationDocumentListDto = z.infer<
  typeof ApplicationDocumentListDtoSchema
>;
