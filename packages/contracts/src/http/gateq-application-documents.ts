import { z } from "zod";
import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import {
  DirectUploadTargetSchema,
  DOCUMENT_FILENAME_MAX_LENGTH,
  CompleteDocumentUploadSessionRequestSchema,
  DocumentMalwareScanStatusSchema,
  DocumentTextExtractionStatusSchema,
  DocumentUploadSessionStatusSchema,
} from "./documents.js";

/** Application credentials authorize these routes; no owner identity is accepted. */
export const GATEQ_APPLICATION_DOCUMENTS_PATH = "/v1/gateq/apply/documents";
export const GATEQ_APPLICATION_DOCUMENT_COMPLETE_PATH =
  "/v1/gateq/apply/documents/:documentId/complete";
export const GATEQ_APPLICATION_DOCUMENT_SELECTION_PATH =
  "/v1/gateq/apply/documents/selection";
export const GATEQ_APPLICATION_DOCUMENT_DOWNLOAD_PATH =
  "/v1/gateq/apply/documents/:documentId/download";

export const CreateApplicationDocumentRequestSchema = z
  .object({
    fileName: z.string().min(1).max(DOCUMENT_FILENAME_MAX_LENGTH),
    mimeType: z.string().min(3).max(129),
    byteSize: z.number().int().positive(),
    clientRequestId: z.string().min(8).max(128),
  })
  .strict();
export type CreateApplicationDocumentRequest = z.infer<
  typeof CreateApplicationDocumentRequestSchema
>;

export const ApplicationDocumentDtoSchema = z
  .object({
    documentId: UuidSchema,
    versionId: UuidSchema.nullable(),
    fileName: z.string().max(DOCUMENT_FILENAME_MAX_LENGTH),
    status: z.enum(["PROCESSING", "READY", "BLOCKED", "FAILED"]),
    uploadStatus: DocumentUploadSessionStatusSchema,
    byteSize: z.number().int().nonnegative(),
    pages: z.number().int().nonnegative().nullable(),
    malwareStatus: DocumentMalwareScanStatusSchema.nullable(),
    extractionStatus: DocumentTextExtractionStatusSchema.nullable(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    instructionRiskSignals: z.number().int().nonnegative().nullable(),
    includedInSubmission: z.boolean(),
  })
  .strict();
export type ApplicationDocumentDto = z.infer<
  typeof ApplicationDocumentDtoSchema
>;

export const CreateApplicationDocumentResponseSchema = z
  .object({
    documentId: UuidSchema,
    uploadSessionId: UuidSchema,
    expiresAt: UtcTimestampSchema,
    upload: DirectUploadTargetSchema.optional(),
  })
  .strict();
export type CreateApplicationDocumentResponse = z.infer<
  typeof CreateApplicationDocumentResponseSchema
>;

export const CompleteApplicationDocumentRequestSchema =
  CompleteDocumentUploadSessionRequestSchema;
export const CompleteApplicationDocumentResponseSchema = z
  .object({
    documentId: UuidSchema,
    versionId: UuidSchema,
    status: z.literal("PROCESSING"),
  })
  .strict();

export const ApplicationDocumentListSchema = z
  .object({
    documents: z.array(ApplicationDocumentDtoSchema).max(20),
  })
  .strict();
export type ApplicationDocumentList = z.infer<
  typeof ApplicationDocumentListSchema
>;

/** The versions and bytes reviewed, not a permission to read arbitrary documents. */
export const ApplicationDocumentReferenceSchema = z
  .object({
    documentId: UuidSchema,
    versionId: UuidSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type ApplicationDocumentReference = z.infer<
  typeof ApplicationDocumentReferenceSchema
>;

export const SelectApplicationDocumentsRequestSchema = z
  .object({
    documents: z.array(ApplicationDocumentReferenceSchema).max(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.documents.map((document) => document.documentId)).size !==
      value.documents.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["documents"],
        message: "Choose each document once.",
      });
    }
  });
