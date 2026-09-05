import { z } from "zod";

import { UuidSchema } from "../common/ids.js";
import { UtcTimestampSchema } from "../common/time.js";
import { ResourceVersionSchema } from "../common/version.js";

/**
 * `/v1/documents` — logical documents and the secure upload boundary.
 *
 *   transferred ≠ validated ≠ scanned ≠ parsed ≠ safe
 *
 * The client asks for permission to upload and is told where to put the
 * bytes. It never names a bucket, a key, a tenant, an owner, a version
 * number or a security state, and it never receives a storage credential.
 * Strict request schemas: identity and authority fields fail validation
 * rather than being ignored.
 *
 * No response on this path carries a storage bucket, a storage key, a
 * signed target after it has been used, or a download URL. Downloading a
 * document is a separate, later, authorised operation.
 */

export const DOCUMENTS_PATH = "/v1/documents" as const;
export const DOCUMENT_UPLOAD_SESSIONS_PATH =
  "/v1/documents/upload-sessions" as const;

/**
 * Wire vocabulary for document classification. The Evidence context owns
 * the canonical list and validates against it; this is the boundary copy,
 * kept identical by contract test.
 */
export const DOCUMENT_TYPES = [
  "UNCLASSIFIED",
  "PITCH_DECK",
  "FINANCIAL_MODEL",
  "MANAGEMENT_ACCOUNTS",
  "COMPANY_PROFILE",
  "FINANCIAL",
  "LEGAL",
  "CORPORATE",
  "GOVERNANCE",
  "PRODUCT",
  "COMMERCIAL",
  "CUSTOMER",
  "OPERATIONAL",
  "OTHER",
] as const;
export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES);
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const DOCUMENT_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export const DocumentStatusSchema = z.enum(DOCUMENT_STATUSES);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

/**
 * Quarantine state, reported honestly. A freshly uploaded version is
 * malware PENDING and extraction NOT_STARTED, and nothing about it may be
 * described as clean, analysed or safe.
 */
export const DOCUMENT_PROCESSING_STATUSES = [
  "NOT_STARTED",
  "QUEUED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
] as const;
export const DocumentProcessingStatusSchema = z.enum(
  DOCUMENT_PROCESSING_STATUSES,
);

export const DOCUMENT_MALWARE_SCAN_STATUSES = [
  "PENDING",
  "CLEAN",
  "BLOCKED",
  "ERROR",
] as const;
export const DocumentMalwareScanStatusSchema = z.enum(
  DOCUMENT_MALWARE_SCAN_STATUSES,
);

export const DOCUMENT_TEXT_EXTRACTION_STATUSES = [
  "NOT_STARTED",
  "PROCESSING",
  "COMPLETED",
  "FAILED",
  /** The format has no extractor yet; the owner is told so, not told "done". */
  "UNSUPPORTED",
] as const;
export const DocumentTextExtractionStatusSchema = z.enum(
  DOCUMENT_TEXT_EXTRACTION_STATUSES,
);

export const DOCUMENT_UPLOAD_SESSION_STATUSES = [
  "PENDING_AUTHORIZATION",
  "AUTHORIZED",
  "FINALIZING",
  "COMPLETED",
  "REJECTED",
  "EXPIRED",
  "CANCELLED",
] as const;
export const DocumentUploadSessionStatusSchema = z.enum(
  DOCUMENT_UPLOAD_SESSION_STATUSES,
);
export type DocumentUploadSessionStatus = z.infer<
  typeof DocumentUploadSessionStatusSchema
>;

/**
 * Why an upload was refused. Bounded categories: enough for an honest user
 * to fix the file, never a description of the detector.
 */
export const DOCUMENT_UPLOAD_FAILURE_CODES = [
  "FILE_TOO_LARGE",
  "FILE_EMPTY",
  "FILENAME_NOT_ALLOWED",
  "EXTENSION_NOT_ALLOWED",
  "MIME_NOT_ALLOWED",
  "SIGNATURE_MISMATCH",
  "OOXML_TYPE_MISMATCH",
  "ACTIVE_CONTENT_TYPE_NOT_ALLOWED",
  "ARCHIVE_NOT_ALLOWED",
  "CONTENT_UNRECOGNISED",
  "SIZE_MISMATCH",
  "OBJECT_MISSING",
  "UPLOAD_EXPIRED",
  "STORAGE_VALIDATION_FAILED",
] as const;
export const DocumentUploadFailureCodeSchema = z.enum(
  DOCUMENT_UPLOAD_FAILURE_CODES,
);
export type DocumentUploadFailureCode = z.infer<
  typeof DocumentUploadFailureCodeSchema
>;

export const DOCUMENT_TITLE_MAX_LENGTH = 200;
export const DOCUMENT_FILENAME_MAX_LENGTH = 1024;

export const CreateDocumentUploadSessionRequestSchema = z
  .object({
    /** Add a version to a document the caller may already manage. */
    existingDocumentId: UuidSchema.optional(),
    companyId: UuidSchema.optional(),
    documentType: DocumentTypeSchema.default("UNCLASSIFIED"),
    title: z.string().trim().min(1).max(DOCUMENT_TITLE_MAX_LENGTH),
    /** Display metadata. The server chooses the object identity. */
    filename: z.string().min(1).max(DOCUMENT_FILENAME_MAX_LENGTH),
    declaredMimeType: z.string().min(3).max(129),
    declaredSizeBytes: z.number().int().min(0),
  })
  .strict();
export type CreateDocumentUploadSessionRequest = z.input<
  typeof CreateDocumentUploadSessionRequestSchema
>;

export const CompleteDocumentUploadSessionRequestSchema = z
  .object({
    /** Optional integrity hint. The server's own hash is canonical. */
    clientSha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
  })
  .strict();
export type CompleteDocumentUploadSessionRequest = z.input<
  typeof CompleteDocumentUploadSessionRequestSchema
>;

/**
 * Where to put the bytes, for this one object, for a short while. Handed
 * over once and never stored. Carries no credential of its own beyond the
 * scoped token embedded in the URL, and grants nothing else.
 */
export const DirectUploadTargetSchema = z
  .object({
    method: z.literal("PUT"),
    url: z.string().url(),
    headers: z.record(z.string(), z.string()),
    /**
     * When Capital Q stops accepting this upload. The storage provider's
     * own token may outlive it; finalization after this instant fails
     * closed, so late bytes can never become a version.
     */
    expiresAt: UtcTimestampSchema,
    providerExpiresAt: UtcTimestampSchema,
    maxBytes: z.number().int().min(1),
    allowedMimeTypes: z.array(z.string()).min(1),
  })
  .strict();
export type DirectUploadTarget = z.infer<typeof DirectUploadTargetSchema>;

export const DocumentUploadSessionDtoSchema = z
  .object({
    id: UuidSchema,
    documentId: UuidSchema,
    status: DocumentUploadSessionStatusSchema,
    originalFilename: z.string(),
    declaredMimeType: z.string(),
    declaredSizeBytes: z.number().int().min(0),
    expiresAt: UtcTimestampSchema,
    finalizedAt: UtcTimestampSchema.nullable(),
    documentVersionId: UuidSchema.nullable(),
    failureCode: DocumentUploadFailureCodeSchema.nullable(),
    createdAt: UtcTimestampSchema,
  })
  .strict();
export type DocumentUploadSessionDto = z.infer<
  typeof DocumentUploadSessionDtoSchema
>;

/**
 * A version's metadata as the owner may see it: what the bytes were found
 * to be and where they are in their processing life. Never the bucket,
 * never the key, never a URL.
 */
export const DocumentVersionDtoSchema = z
  .object({
    id: UuidSchema,
    versionNumber: z.number().int().min(1),
    originalFilename: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int().min(0),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    uploadedAt: UtcTimestampSchema,
    processingStatus: DocumentProcessingStatusSchema,
    malwareScanStatus: DocumentMalwareScanStatusSchema,
    textExtractionStatus: DocumentTextExtractionStatusSchema,
  })
  .strict();
export type DocumentVersionDto = z.infer<typeof DocumentVersionDtoSchema>;

export const DocumentDtoSchema = z
  .object({
    id: UuidSchema,
    companyId: UuidSchema.nullable(),
    documentType: DocumentTypeSchema,
    title: z.string(),
    status: DocumentStatusSchema,
    visibilityScope: z.string(),
    sensitivityClass: z.string(),
    currentVersion: DocumentVersionDtoSchema.nullable(),
    createdAt: UtcTimestampSchema,
    updatedAt: UtcTimestampSchema,
    version: ResourceVersionSchema,
  })
  .strict();
export type DocumentDto = z.infer<typeof DocumentDtoSchema>;

export const CreateDocumentUploadSessionResponseSchema = z
  .object({
    uploadSession: DocumentUploadSessionDtoSchema,
    document: DocumentDtoSchema,
    /**
     * Absent when a replayed request names a session that can no longer
     * take bytes; the session status says why.
     */
    upload: DirectUploadTargetSchema.nullable(),
  })
  .strict();
export type CreateDocumentUploadSessionResponse = z.infer<
  typeof CreateDocumentUploadSessionResponseSchema
>;

export const DocumentUploadSessionResponseSchema = z
  .object({
    uploadSession: DocumentUploadSessionDtoSchema,
    document: DocumentDtoSchema,
  })
  .strict();
export type DocumentUploadSessionResponse = z.infer<
  typeof DocumentUploadSessionResponseSchema
>;

export const DocumentResponseSchema = z
  .object({ document: DocumentDtoSchema })
  .strict();
export type DocumentResponse = z.infer<typeof DocumentResponseSchema>;

export const DocumentListResponseSchema = z
  .object({ documents: z.array(DocumentDtoSchema) })
  .strict();
export type DocumentListResponse = z.infer<typeof DocumentListResponseSchema>;
