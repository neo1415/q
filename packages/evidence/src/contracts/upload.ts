import { z } from "zod";

import {
  createUuidIdSchema,
  DOCUMENT_UPLOAD_FAILURE_CODES,
  DOCUMENT_UPLOAD_SESSION_STATUSES,
  DocumentUploadFailureCodeSchema,
  DocumentUploadSessionStatusSchema,
  type DocumentUploadFailureCode,
  type DocumentUploadSessionStatus,
  type UtcTimestamp,
} from "@capital-q/contracts";
import type { OrganisationId, TenantId, UserId } from "@capital-q/security";

import type { DocumentId, DocumentVersionId } from "./index.js";

/**
 * Upload sessions (CQ-EVD-002).
 *
 * A session is the durable record of one authorised transfer: who may
 * upload, which logical document the bytes will become a version of, and —
 * decisively — the object identity the server chose. The client never picks
 * a bucket, a key, a tenant, an owner or a security state.
 *
 *   transferred ≠ validated ≠ scanned ≠ parsed ≠ safe
 *
 * The scoped upload authorization itself is never persisted: it is minted
 * on demand and handed to the browser once.
 */

export const DocumentUploadSessionIdSchema = createUuidIdSchema(
  "DocumentUploadSessionId",
);
export type DocumentUploadSessionId = z.infer<
  typeof DocumentUploadSessionIdSchema
>;

/**
 * A deliberately small lifecycle.
 *
 *   PENDING_AUTHORIZATION  the session exists; no upload target minted yet
 *   AUTHORIZED             a scoped target was issued; bytes may arrive
 *   FINALIZING             finalization is inspecting what arrived
 *   COMPLETED              bytes validated and an immutable version exists
 *   REJECTED               validation refused the bytes; no version exists
 *   EXPIRED               the window closed before finalization
 *   CANCELLED              the owner abandoned it
 *
 * COMPLETED means bytes exist, the upload boundary accepted them and a
 * DocumentVersion was created. It never means malware-clean, parsed,
 * extracted or safe to show anyone.
 */
export {
  DOCUMENT_UPLOAD_SESSION_STATUSES,
  DocumentUploadSessionStatusSchema,
  type DocumentUploadSessionStatus,
};

/**
 * Bounded refusal reasons. They tell an honest user what to fix and tell a
 * hostile one nothing about the detector beyond the category it tripped.
 */
export {
  DOCUMENT_UPLOAD_FAILURE_CODES,
  DocumentUploadFailureCodeSchema,
  type DocumentUploadFailureCode,
};

/**
 * Which capability admitted this session. A first version of a new document
 * is part of creating it; a further version of an existing document is
 * managing it. Finalization re-checks the same capability, so a role change
 * between authorization and completion is honoured.
 */
export const UPLOAD_AUTHORISING_CAPABILITIES = [
  "document.create",
  "document.manage",
] as const;
export const UploadAuthorisingCapabilitySchema = z.enum(
  UPLOAD_AUTHORISING_CAPABILITIES,
);
export type UploadAuthorisingCapability = z.infer<
  typeof UploadAuthorisingCapabilitySchema
>;

export type DocumentUploadSession = {
  readonly id: DocumentUploadSessionId;
  readonly tenantId: TenantId;
  readonly ownerOrganisationId: OrganisationId;
  readonly createdByUserId: UserId;
  readonly documentId: DocumentId;
  /** Server-chosen object identity, fixed for the life of the session. */
  readonly storageBucket: string;
  readonly storageKey: string;
  readonly originalFilename: string;
  /** What the browser said. Provenance only; never the stored MIME type. */
  readonly declaredMimeType: string;
  readonly declaredSizeBytes: number;
  readonly authorisingCapability: UploadAuthorisingCapability;
  readonly status: DocumentUploadSessionStatus;
  readonly expiresAt: UtcTimestamp;
  readonly finalizedAt: UtcTimestamp | null;
  readonly documentVersionId: DocumentVersionId | null;
  readonly failureCode: DocumentUploadFailureCode | null;
  /** True when an object rejected at validation could not be deleted. */
  readonly cleanupPending: boolean;
  readonly createdAt: UtcTimestamp;
  readonly updatedAt: UtcTimestamp;
  readonly version: number;
};

export type NewDocumentUploadSession = {
  readonly tenantId: TenantId;
  readonly ownerOrganisationId: OrganisationId;
  readonly createdByUserId: UserId;
  readonly documentId: DocumentId;
  readonly storageBucket: string;
  readonly storageKey: string;
  readonly originalFilename: string;
  readonly declaredMimeType: string;
  readonly declaredSizeBytes: number;
  readonly authorisingCapability: UploadAuthorisingCapability;
  readonly expiresAt: UtcTimestamp;
};
