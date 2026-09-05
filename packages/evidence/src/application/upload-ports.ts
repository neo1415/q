import type { DatabaseExecutor, TransactionContext } from "@capital-q/database";
import type { OrganisationId, TenantId, UserId } from "@capital-q/security";

import type {
  DocumentUploadFailureCode,
  DocumentUploadSession,
  DocumentUploadSessionId,
  DocumentUploadSessionStatus,
  NewDocumentUploadSession,
} from "../contracts/upload.js";
import type { DocumentVersionId } from "../contracts/index.js";

/**
 * Persistence for upload sessions and their idempotency records. Writes
 * take the transaction, reads take an executor, and every call names the
 * tenant: the same rules the rest of the context follows.
 */

/** Absent fields keep their stored value; a session never un-sets one. */
export type DocumentUploadSessionChanges = {
  readonly status: DocumentUploadSessionStatus;
  readonly failureCode?: DocumentUploadFailureCode | undefined;
  readonly documentVersionId?: DocumentVersionId | undefined;
  readonly finalizedAt?: string | undefined;
  readonly cleanupPending?: boolean | undefined;
};

export type DocumentUploadSessionRepository = {
  readonly insert: (
    tx: TransactionContext,
    input: NewDocumentUploadSession,
  ) => Promise<DocumentUploadSession>;
  /** Scoped to the owning organisation; anything else reads as absent. */
  readonly findById: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    ownerOrganisationId: OrganisationId,
    sessionId: DocumentUploadSessionId,
  ) => Promise<DocumentUploadSession | null>;
  /** Row lock: finalization and cancellation serialise on it. */
  readonly lockById: (
    tx: TransactionContext,
    tenantId: TenantId,
    ownerOrganisationId: OrganisationId,
    sessionId: DocumentUploadSessionId,
  ) => Promise<DocumentUploadSession | null>;
  /**
   * Open authorizations an organisation currently holds. Bounds outstanding
   * scoped writes to private storage.
   */
  readonly countOpen: (
    executor: DatabaseExecutor,
    tenantId: TenantId,
    ownerOrganisationId: OrganisationId,
  ) => Promise<number>;
  /** `null` when `expectedVersion` no longer matches. */
  readonly update: (
    tx: TransactionContext,
    input: {
      readonly tenantId: TenantId;
      readonly sessionId: DocumentUploadSessionId;
      readonly expectedVersion: number;
      readonly changes: DocumentUploadSessionChanges;
    },
  ) => Promise<DocumentUploadSession | null>;
};

export type DocumentUploadRequestRecord = {
  readonly requestHash: string;
  readonly uploadSessionId: DocumentUploadSessionId;
};

export type DocumentUploadRequestStore = {
  readonly lock: (
    tx: TransactionContext,
    userId: UserId,
    organisationId: OrganisationId,
    idempotencyKeyHash: string,
  ) => Promise<void>;
  readonly find: (
    tx: TransactionContext,
    userId: UserId,
    organisationId: OrganisationId,
    idempotencyKeyHash: string,
  ) => Promise<DocumentUploadRequestRecord | null>;
  readonly record: (
    tx: TransactionContext,
    input: {
      readonly userId: UserId;
      readonly organisationId: OrganisationId;
      readonly tenantId: TenantId;
      readonly idempotencyKeyHash: string;
      readonly requestHash: string;
      readonly uploadSessionId: DocumentUploadSessionId;
    },
  ) => Promise<void>;
};
