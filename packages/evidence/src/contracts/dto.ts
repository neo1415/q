import type {
  DocumentDto,
  DocumentUploadSessionDto,
  DocumentVersionDto,
} from "@capital-q/contracts";

import type { Document, DocumentVersion } from "./index.js";
import type { DocumentUploadSession } from "./upload.js";

/**
 * Wire projections.
 *
 * What is deliberately absent is the point: no storage bucket, no storage
 * key, no signed target, no download URL and no scanner internals ever
 * cross this boundary. Knowing where an object lives is not permission to
 * read it, and an owner has no need of the path at all (doc 15 §24.1).
 */

export function toDocumentVersionDto(
  version: DocumentVersion,
): DocumentVersionDto {
  return {
    id: version.id,
    versionNumber: version.versionNumber,
    originalFilename: version.originalFilename,
    mimeType: version.mimeType,
    sizeBytes: version.sizeBytes,
    sha256: version.sha256,
    uploadedAt: version.uploadedAt,
    // Reported exactly as they are: a new version is PENDING and
    // NOT_STARTED, never "clean" and never "analysed".
    processingStatus: version.processingStatus,
    malwareScanStatus: version.malwareScanStatus,
    textExtractionStatus: version.textExtractionStatus,
  };
}

export function toDocumentDto(
  document: Document,
  currentVersion: DocumentVersion | null,
): DocumentDto {
  return {
    id: document.id,
    companyId: document.companyId,
    documentType: document.documentType,
    title: document.title,
    status: document.status,
    visibilityScope: document.visibilityScope,
    sensitivityClass: document.sensitivityClass,
    currentVersion:
      currentVersion === null ? null : toDocumentVersionDto(currentVersion),
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    version: document.version,
  };
}

export function toDocumentUploadSessionDto(
  session: DocumentUploadSession,
): DocumentUploadSessionDto {
  return {
    id: session.id,
    documentId: session.documentId,
    status: session.status,
    originalFilename: session.originalFilename,
    declaredMimeType: session.declaredMimeType,
    declaredSizeBytes: session.declaredSizeBytes,
    expiresAt: session.expiresAt,
    finalizedAt: session.finalizedAt,
    documentVersionId: session.documentVersionId,
    failureCode: session.failureCode,
    createdAt: session.createdAt,
  };
}
