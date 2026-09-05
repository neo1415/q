import { z } from "zod";

import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
  SecurityEventTypeSchema,
} from "@capital-q/audit";
import { CompanyIdSchema } from "@capital-q/companies";
import { UtcTimestampSchema, type CorrelationId } from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  DocumentIdSchema,
  DocumentTitleSchema,
  DocumentTypeSchema,
  MimeTypeSchema,
  Sha256Schema,
  type Document,
  type DocumentVersion,
} from "../contracts/index.js";
import {
  DocumentUploadSessionIdSchema,
  type DocumentUploadFailureCode,
  type DocumentUploadSession,
  type UploadAuthorisingCapability,
} from "../contracts/upload.js";
import { detectDocumentContent } from "../domain/content-validation.js";
import {
  DocumentNotFoundError,
  DocumentStorageUnavailableError,
  DocumentUploadCreationConflictError,
  DocumentUploadRejectedError,
  DocumentUploadSessionNotFoundError,
  DocumentUploadStateError,
  EvidenceRuleError,
} from "../domain/errors.js";
import { createDocumentStorageKey } from "../domain/storage-identity.js";
import {
  hashCreateDocumentUploadSessionRequest,
  hashDocumentUploadIdempotencyKey,
} from "../domain/upload-idempotency.js";
import {
  checkClaimedType,
  extensionOf,
  sanitiseOriginalFilename,
} from "../domain/upload-policy.js";
import {
  stageObjectForValidation,
  StagedObjectTooLargeError,
} from "../infrastructure/object-staging.js";
import {
  activeOrganisation,
  DOCUMENT_CREATE,
  DOCUMENT_MANAGE,
  documentScope,
} from "./authority.js";
import type { EvidenceServiceDependencies } from "./dependencies.js";
import {
  appendDocumentVersionWithin,
  insertDocumentWithin,
  resolveNewDocument,
} from "./document-use-cases.js";
import { getEvidenceMetrics } from "./metrics.js";
import type { DirectUploadAuthorization } from "./storage-port.js";

/**
 * The secure upload boundary (CQ-EVD-002; doc 15 §25–30, doc 22 §64).
 *
 *   authorise → server-chosen object identity → scoped direct upload
 *   → quarantine → verify the bytes that actually landed → immutable version
 *
 * Every uploaded file is hostile until validated. A successful transfer
 * means bytes arrived and nothing else: not safe, not scanned, not parsed,
 * not trusted, not shareable. The version this creates is quarantined —
 * malware PENDING, extraction NOT_STARTED — and no route serves it.
 *
 * The client never chooses the bucket, the key, the tenant, the owner, the
 * stored MIME type, the size, the hash or the security state. It supplies a
 * filename and a declared type as hints, and the server verifies both
 * against the bytes.
 */

const RESOURCE_DOCUMENT = AuditResourceTypeSchema.parse("document");
const ACTION = {
  uploadAuthorized: AuditActionTypeSchema.parse("document.upload_authorized"),
};
const REJECTED_EVENT = SecurityEventTypeSchema.parse(
  "document_upload_rejected",
);

/**
 * Refusals worth a security event: the file's content disagreed with what
 * it claimed to be. An unsupported extension or an oversized file is an
 * ordinary mistake and must not flood security monitoring (doc 15 §57).
 */
const SUSPICIOUS_FAILURES: readonly DocumentUploadFailureCode[] = [
  "SIGNATURE_MISMATCH",
  "OOXML_TYPE_MISMATCH",
  "ACTIVE_CONTENT_TYPE_NOT_ALLOWED",
  "ARCHIVE_NOT_ALLOWED",
  "CONTENT_UNRECOGNISED",
  "SIZE_MISMATCH",
];

const OPEN_STATUSES = ["PENDING_AUTHORIZATION", "AUTHORIZED", "FINALIZING"];

export const CreateDocumentUploadSessionInputSchema = z
  .object({
    /** Adds a version to a document the caller may already manage. */
    existingDocumentId: DocumentIdSchema.optional(),
    companyId: CompanyIdSchema.optional(),
    documentType: DocumentTypeSchema.default("UNCLASSIFIED"),
    title: DocumentTitleSchema,
    /** Display metadata. Never an object identity, never a path. */
    filename: z.string().min(1).max(1024),
    declaredMimeType: MimeTypeSchema,
    declaredSizeBytes: z.number().int().min(0),
  })
  .strict();
export type CreateDocumentUploadSessionInput = z.input<
  typeof CreateDocumentUploadSessionInputSchema
>;

export type CreateDocumentUploadSessionCommand = {
  readonly actor: ActorContext;
  readonly input: CreateDocumentUploadSessionInput;
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
};

export type DocumentUploadSessionResult = {
  readonly session: DocumentUploadSession;
  readonly document: Document;
  /** Present only while the session can still receive bytes. */
  readonly upload: DirectUploadAuthorization | undefined;
};

export const CompleteDocumentUploadSessionInputSchema = z
  .object({
    /** Optional integrity hint. The server's own hash is always canonical. */
    clientSha256: Sha256Schema.optional(),
  })
  .strict();
export type CompleteDocumentUploadSessionInput = z.infer<
  typeof CompleteDocumentUploadSessionInputSchema
>;

export type CompleteDocumentUploadSessionCommand = {
  readonly actor: ActorContext;
  readonly uploadSessionId: string;
  readonly input: CompleteDocumentUploadSessionInput;
  readonly idempotencyKey: string;
  readonly correlationId: CorrelationId;
};

export type CompletedUploadResult = {
  readonly session: DocumentUploadSession;
  readonly document: Document;
  readonly version: DocumentVersion;
};

function requireStorage(dependencies: EvidenceServiceDependencies) {
  const storage = dependencies.storage;
  if (storage === undefined || dependencies.uploads === undefined) {
    // Uploads are unavailable rather than open: no credential, no transfer.
    throw new DocumentStorageUnavailableError();
  }
  return { storage, limits: dependencies.uploads };
}

function reject(failureCode: DocumentUploadFailureCode): never {
  throw new DocumentUploadRejectedError(failureCode);
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export function createCreateDocumentUploadSession(
  dependencies: EvidenceServiceDependencies,
) {
  const { transactions, audit, repositories } = dependencies;
  return async (
    command: CreateDocumentUploadSessionCommand,
  ): Promise<DocumentUploadSessionResult> => {
    const { storage, limits } = requireStorage(dependencies);
    const input = CreateDocumentUploadSessionInputSchema.parse(command.input);
    const { actor } = command;
    const organisationId = activeOrganisation(actor);
    const metrics = getEvidenceMetrics();

    const filename = sanitiseOriginalFilename(input.filename);
    if (!filename.ok) reject(filename.failureCode);
    // Extension and declared MIME must already agree; the bytes are checked
    // again at finalization against what actually landed.
    const claimed = checkClaimedType({
      filename: filename.filename,
      declaredMimeType: input.declaredMimeType,
    });
    if (!claimed.ok) reject(claimed.failureCode);
    if (input.declaredSizeBytes === 0) reject("FILE_EMPTY");
    if (input.declaredSizeBytes > limits.maxBytes) reject("FILE_TOO_LARGE");

    // Authority is decided before anything durable happens. A first version
    // of a new document is part of creating it; a further version of an
    // existing one is managing it.
    let authorisingCapability: UploadAuthorisingCapability;
    let existing: Document | null = null;
    if (input.existingDocumentId === undefined) {
      await dependencies.authorization.requireCapability({
        actor,
        capability: DOCUMENT_CREATE,
        resource: {
          kind: "ORGANISATION",
          tenantId: actor.tenantId,
          organisationId,
        },
      });
      authorisingCapability = "document.create";
    } else {
      existing = await repositories.documents.findById(
        dependencies.sql,
        actor.tenantId,
        organisationId,
        input.existingDocumentId,
      );
      if (existing === null) throw new DocumentNotFoundError();
      await dependencies.authorization.requireCapability({
        actor,
        capability: DOCUMENT_MANAGE,
        resource: documentScope(actor, organisationId, existing.id),
      });
      if (existing.status !== "ACTIVE") {
        throw new EvidenceRuleError(
          "an archived document takes no new versions",
        );
      }
      authorisingCapability = "document.manage";
    }

    const newDocument =
      existing === null
        ? await resolveNewDocument(dependencies, actor, {
            documentType: input.documentType,
            ...(input.companyId === undefined
              ? {}
              : { companyId: input.companyId }),
          })
        : null;

    const keyHash = hashDocumentUploadIdempotencyKey(command.idempotencyKey);
    const requestHash = hashCreateDocumentUploadSessionRequest({
      existingDocumentId: input.existingDocumentId,
      companyId: input.companyId,
      documentType: input.documentType,
      title: input.title,
      filename: filename.filename,
      declaredMimeType: input.declaredMimeType,
      declaredSizeBytes: input.declaredSizeBytes,
    });

    const created = await transactions.run(
      async (
        tx,
      ): Promise<{
        readonly session: DocumentUploadSession;
        readonly document: Document;
        readonly replayed: boolean;
      }> => {
        await repositories.uploadRequests.lock(
          tx,
          actor.userId,
          organisationId,
          keyHash,
        );
        const previous = await repositories.uploadRequests.find(
          tx,
          actor.userId,
          organisationId,
          keyHash,
        );
        if (previous !== null) {
          if (previous.requestHash !== requestHash) {
            throw new DocumentUploadCreationConflictError();
          }
          const session = await repositories.uploadSessions.findById(
            tx.sql,
            actor.tenantId,
            organisationId,
            previous.uploadSessionId,
          );
          const document =
            session === null
              ? null
              : await repositories.documents.findById(
                  tx.sql,
                  actor.tenantId,
                  organisationId,
                  session.documentId,
                );
          if (session === null || document === null) {
            throw new DocumentUploadCreationConflictError();
          }
          return { session, document, replayed: true };
        }

        const open = await repositories.uploadSessions.countOpen(
          tx.sql,
          actor.tenantId,
          organisationId,
        );
        if (open >= limits.maxOpenSessions) {
          throw new EvidenceRuleError(
            "too many uploads are already awaiting completion",
          );
        }

        const document =
          existing ??
          (await insertDocumentWithin(tx, dependencies, {
            actor,
            organisationId,
            companyId: newDocument?.companyId ?? null,
            documentType: input.documentType,
            title: input.title,
            sensitivityClass: newDocument?.sensitivityClass ?? "CONFIDENTIAL",
            correlationId: command.correlationId,
          }));

        const session = await repositories.uploadSessions.insert(tx, {
          tenantId: actor.tenantId,
          ownerOrganisationId: organisationId,
          createdByUserId: actor.userId,
          documentId: document.id,
          storageBucket: limits.bucket,
          // Server-chosen, random, and never derived from the filename.
          storageKey: createDocumentStorageKey(actor.tenantId),
          originalFilename: filename.filename,
          declaredMimeType: input.declaredMimeType.toLowerCase(),
          declaredSizeBytes: input.declaredSizeBytes,
          authorisingCapability,
          expiresAt: UtcTimestampSchema.parse(
            new Date(
              Date.now() + limits.sessionTtlSeconds * 1000,
            ).toISOString(),
          ),
        });
        await repositories.uploadRequests.record(tx, {
          userId: actor.userId,
          organisationId,
          tenantId: actor.tenantId,
          idempotencyKeyHash: keyHash,
          requestHash,
          uploadSessionId: session.id,
        });
        await audit.record(tx, {
          ...auditActorFromContext(actor),
          auditEventId: createAuditEventId(),
          actionType: ACTION.uploadAuthorized,
          resourceType: RESOURCE_DOCUMENT,
          resourceId: document.id,
          occurredAt: occurredNow(),
          outcome: "SUCCEEDED",
          metadata: {
            uploadSessionId: session.id,
            documentType: document.documentType,
            declaredSizeBytes: input.declaredSizeBytes,
            declaredMimeType: session.declaredMimeType,
          },
          correlationId: command.correlationId,
        });
        return { session, document, replayed: false };
      },
    );

    if (!created.replayed) {
      metrics.uploadSessionsCreated.add(1);
    }
    // A session that can no longer take bytes is reported as-is; only an
    // open one is handed a target.
    if (
      created.session.status !== "PENDING_AUTHORIZATION" &&
      created.session.status !== "AUTHORIZED"
    ) {
      return { ...created, upload: undefined };
    }

    // Outside the transaction: an external call never runs inside one. If
    // it fails the session stays PENDING_AUTHORIZATION and the same
    // idempotency key retries it, so a transient provider failure never
    // creates a second document.
    const upload = await storage.createUploadAuthorization({
      object: {
        bucket: created.session.storageBucket,
        key: created.session.storageKey,
      },
      contentType: created.session.declaredMimeType,
      maxBytes: limits.maxBytes,
    });
    const authorised =
      created.session.status === "AUTHORIZED"
        ? created.session
        : ((await transactions.run((tx) =>
            repositories.uploadSessions.update(tx, {
              tenantId: actor.tenantId,
              sessionId: created.session.id,
              expectedVersion: created.session.version,
              changes: { status: "AUTHORIZED" },
            }),
          )) ?? created.session);
    return { session: authorised, document: created.document, upload };
  };
}

// ---------------------------------------------------------------------------
// Complete
// ---------------------------------------------------------------------------

export function createCompleteDocumentUploadSession(
  dependencies: EvidenceServiceDependencies,
) {
  const { transactions, repositories } = dependencies;

  return async (
    command: CompleteDocumentUploadSessionCommand,
  ): Promise<CompletedUploadResult> => {
    const { storage, limits } = requireStorage(dependencies);
    const input = CompleteDocumentUploadSessionInputSchema.parse(command.input);
    const sessionId = DocumentUploadSessionIdSchema.parse(
      command.uploadSessionId,
    );
    const { actor } = command;
    const organisationId = activeOrganisation(actor);
    const metrics = getEvidenceMetrics();

    const session = await repositories.uploadSessions.findById(
      dependencies.sql,
      actor.tenantId,
      organisationId,
      sessionId,
    );
    // Another organisation's or tenant's session is simply absent.
    if (session === null || session.createdByUserId !== actor.userId) {
      throw new DocumentUploadSessionNotFoundError();
    }

    const object = { bucket: session.storageBucket, key: session.storageKey };

    /**
     * Marks the session refused and removes the bytes if it can. Returns
     * the error for the caller to throw, so every refusal is visibly a
     * termination at its call site.
     */
    const refuse = async (
      failureCode: DocumentUploadFailureCode,
    ): Promise<DocumentUploadRejectedError> => {
      let cleanupPending = false;
      try {
        await storage.deleteObject(object);
      } catch {
        // Validity never depends on cleanup succeeding: the object stays
        // private and unattached, and the debt is recorded.
        cleanupPending = true;
      }
      await transactions.run(async (tx) => {
        // Re-read under the lock: the session advanced to FINALIZING on the
        // way here, and a refusal must land whatever its version is now.
        const locked = await repositories.uploadSessions.lockById(
          tx,
          actor.tenantId,
          organisationId,
          session.id,
        );
        // A session that completed in the meantime is never un-completed.
        if (locked === null || locked.status === "COMPLETED") return;
        await repositories.uploadSessions.update(tx, {
          tenantId: actor.tenantId,
          sessionId: locked.id,
          expectedVersion: locked.version,
          changes: {
            status: failureCode === "UPLOAD_EXPIRED" ? "EXPIRED" : "REJECTED",
            failureCode,
            cleanupPending,
          },
        });
      });
      metrics.uploadsRejected.add(1, { failureCode });
      if (SUSPICIOUS_FAILURES.includes(failureCode)) {
        await dependencies.securityEvents?.record({
          auditEventId: createAuditEventId(),
          tenantId: actor.tenantId,
          userId: actor.userId,
          eventType: REJECTED_EVENT,
          severity: "MEDIUM",
          resourceType: RESOURCE_DOCUMENT,
          resourceId: session.documentId,
          occurredAt: occurredNow(),
          metadata: {
            failureCode,
            uploadSessionId: session.id,
            // The extension, never the filename; the bytes, never their content.
            extension: extensionOf(session.originalFilename),
            declaredMimeType: session.declaredMimeType,
            declaredSizeBytes: session.declaredSizeBytes,
          },
          correlationId: command.correlationId,
        });
      }
      return new DocumentUploadRejectedError(failureCode);
    };

    if (session.status === "COMPLETED") {
      // Idempotent replay: the same version, never a second one.
      const version =
        session.documentVersionId === null
          ? null
          : await repositories.documentVersions.findById(
              dependencies.sql,
              actor.tenantId,
              session.documentVersionId,
            );
      const document = await repositories.documents.findById(
        dependencies.sql,
        actor.tenantId,
        organisationId,
        session.documentId,
      );
      if (version === null || document === null) {
        throw new DocumentUploadStateError("this upload cannot be completed");
      }
      return { session, document, version };
    }
    if (session.status !== "AUTHORIZED" && session.status !== "FINALIZING") {
      throw new DocumentUploadStateError("this upload cannot be completed");
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      // Fails closed: bytes that arrive late can never become a version,
      // even while the provider's own token is still technically valid.
      throw await refuse("UPLOAD_EXPIRED");
    }

    // The capability that authorised the session is re-checked now, so a
    // role removed in between is honoured.
    await dependencies.authorization.requireCapability({
      actor,
      capability:
        session.authorisingCapability === "document.manage"
          ? DOCUMENT_MANAGE
          : DOCUMENT_CREATE,
      resource:
        session.authorisingCapability === "document.manage"
          ? documentScope(actor, organisationId, session.documentId)
          : {
              kind: "ORGANISATION",
              tenantId: actor.tenantId,
              organisationId,
            },
    });

    if (session.status !== "FINALIZING") {
      await transactions.run((tx) =>
        repositories.uploadSessions.update(tx, {
          tenantId: actor.tenantId,
          sessionId: session.id,
          expectedVersion: session.version,
          changes: { status: "FINALIZING" },
        }),
      );
    }

    const stat = await storage.statObject(object);
    if (stat === null) throw await refuse("OBJECT_MISSING");
    if (stat.sizeBytes === 0) throw await refuse("FILE_EMPTY");
    if (stat.sizeBytes > limits.maxBytes) throw await refuse("FILE_TOO_LARGE");

    const stream = await storage.openObjectStream(object);
    const staged = await stageObjectForValidation({
      body: stream.body,
      maxBytes: limits.maxBytes,
    }).catch(async (error: unknown) => {
      if (error instanceof StagedObjectTooLargeError) {
        throw await refuse("FILE_TOO_LARGE");
      }
      throw error;
    });

    let verified: {
      readonly mimeType: string;
      readonly sizeBytes: number;
      readonly sha256: string;
    };
    try {
      if (staged.sizeBytes !== stat.sizeBytes) {
        throw await refuse("SIZE_MISMATCH");
      }
      const detected = await detectDocumentContent({
        sizeBytes: staged.sizeBytes,
        read: staged.read,
      });
      if (!detected.ok) throw await refuse(detected.failureCode);
      const agreed = checkClaimedType({
        filename: session.originalFilename,
        declaredMimeType: session.declaredMimeType,
        detected: detected.kind,
      });
      if (!agreed.ok) throw await refuse(agreed.failureCode);
      // A client hash is an integrity hint only; the server's hash of the
      // stored bytes is what is persisted, and disagreement is a refusal.
      if (
        input.clientSha256 !== undefined &&
        input.clientSha256 !== staged.sha256
      ) {
        throw await refuse("STORAGE_VALIDATION_FAILED");
      }
      verified = {
        mimeType: agreed.type.mimeType,
        sizeBytes: staged.sizeBytes,
        sha256: staged.sha256,
      };
    } finally {
      await staged.dispose();
    }

    const result = await transactions.run(
      async (tx): Promise<CompletedUploadResult> => {
        // Session first, then document: two finalizations of one session
        // serialise here, and two sessions on one document take sequential
        // version numbers in commit order.
        const locked = await repositories.uploadSessions.lockById(
          tx,
          actor.tenantId,
          organisationId,
          session.id,
        );
        if (locked === null) throw new DocumentUploadSessionNotFoundError();
        if (locked.status === "COMPLETED") {
          const version =
            locked.documentVersionId === null
              ? null
              : await repositories.documentVersions.findById(
                  tx.sql,
                  actor.tenantId,
                  locked.documentVersionId,
                );
          const document = await repositories.documents.findById(
            tx.sql,
            actor.tenantId,
            organisationId,
            locked.documentId,
          );
          if (version === null || document === null) {
            throw new DocumentUploadStateError(
              "this upload cannot be completed",
            );
          }
          return { session: locked, document, version };
        }
        if (locked.status !== "FINALIZING" && locked.status !== "AUTHORIZED") {
          throw new DocumentUploadStateError("this upload cannot be completed");
        }
        const document = await repositories.documents.lockById(
          tx,
          actor.tenantId,
          organisationId,
          locked.documentId,
        );
        if (document === null) throw new DocumentNotFoundError();
        const appended = await appendDocumentVersionWithin(tx, dependencies, {
          actor,
          organisationId,
          document,
          file: {
            storageBucket: locked.storageBucket,
            storageKey: locked.storageKey,
            originalFilename: locked.originalFilename,
            // The type the bytes actually are, not the browser's word.
            mimeType: verified.mimeType,
            sizeBytes: verified.sizeBytes,
            sha256: verified.sha256,
          },
          correlationId: command.correlationId,
        });
        const completed = await repositories.uploadSessions.update(tx, {
          tenantId: actor.tenantId,
          sessionId: locked.id,
          expectedVersion: locked.version,
          changes: {
            status: "COMPLETED",
            documentVersionId: appended.version.id,
            finalizedAt: new Date().toISOString(),
          },
        });
        if (completed === null) {
          throw new DocumentUploadStateError("this upload cannot be completed");
        }
        return {
          session: completed,
          document: appended.document,
          version: appended.version,
        };
      },
    );
    metrics.uploadsCompleted.add(1);
    metrics.uploadBytes.add(verified.sizeBytes);
    return result;
  };
}

// ---------------------------------------------------------------------------
// Cancel and expiry
// ---------------------------------------------------------------------------

export type CancelDocumentUploadSessionCommand = {
  readonly actor: ActorContext;
  readonly uploadSessionId: string;
  readonly correlationId: CorrelationId;
};

export function createCancelDocumentUploadSession(
  dependencies: EvidenceServiceDependencies,
) {
  const { transactions, repositories } = dependencies;
  return async (
    command: CancelDocumentUploadSessionCommand,
  ): Promise<DocumentUploadSession> => {
    const { storage } = requireStorage(dependencies);
    const sessionId = DocumentUploadSessionIdSchema.parse(
      command.uploadSessionId,
    );
    const { actor } = command;
    const organisationId = activeOrganisation(actor);
    const session = await repositories.uploadSessions.findById(
      dependencies.sql,
      actor.tenantId,
      organisationId,
      sessionId,
    );
    if (session === null || session.createdByUserId !== actor.userId) {
      throw new DocumentUploadSessionNotFoundError();
    }
    if (!OPEN_STATUSES.includes(session.status)) {
      throw new DocumentUploadStateError("this upload cannot be cancelled");
    }
    let cleanupPending = false;
    try {
      await storage.deleteObject({
        bucket: session.storageBucket,
        key: session.storageKey,
      });
    } catch {
      cleanupPending = true;
    }
    const cancelled = await transactions.run((tx) =>
      repositories.uploadSessions.update(tx, {
        tenantId: actor.tenantId,
        sessionId: session.id,
        expectedVersion: session.version,
        changes: { status: "CANCELLED", cleanupPending },
      }),
    );
    if (cancelled === null) {
      throw new DocumentUploadStateError("this upload cannot be cancelled");
    }
    return cancelled;
  };
}

/**
 * Closes one expired session and removes its bytes if any arrived. A
 * service primitive, not a scheduler: recurring cleanup belongs to the
 * worker packet. Until it exists, an abandoned object stays private and
 * unattachable — no session can ever finalize it.
 */
export function createCleanupExpiredUploadSession(
  dependencies: EvidenceServiceDependencies,
) {
  const { transactions, repositories } = dependencies;
  return async (command: {
    readonly actor: ActorContext;
    readonly uploadSessionId: string;
  }): Promise<DocumentUploadSession | null> => {
    const { storage } = requireStorage(dependencies);
    const sessionId = DocumentUploadSessionIdSchema.parse(
      command.uploadSessionId,
    );
    const { actor } = command;
    const organisationId = activeOrganisation(actor);
    const session = await repositories.uploadSessions.findById(
      dependencies.sql,
      actor.tenantId,
      organisationId,
      sessionId,
    );
    if (session === null) return null;
    if (
      !OPEN_STATUSES.includes(session.status) ||
      Date.parse(session.expiresAt) > Date.now()
    ) {
      return session;
    }
    let cleanupPending = false;
    try {
      await storage.deleteObject({
        bucket: session.storageBucket,
        key: session.storageKey,
      });
    } catch {
      cleanupPending = true;
    }
    const expired = await transactions.run((tx) =>
      repositories.uploadSessions.update(tx, {
        tenantId: actor.tenantId,
        sessionId: session.id,
        expectedVersion: session.version,
        changes: {
          status: "EXPIRED",
          failureCode: "UPLOAD_EXPIRED",
          cleanupPending,
        },
      }),
    );
    getEvidenceMetrics().uploadsExpired.add(1);
    return expired;
  };
}

export type GetDocumentUploadSessionQuery = {
  readonly actor: ActorContext;
  readonly uploadSessionId: string;
};

export function createGetDocumentUploadSession(
  dependencies: EvidenceServiceDependencies,
) {
  return async (
    query: GetDocumentUploadSessionQuery,
  ): Promise<DocumentUploadSession> => {
    const sessionId = DocumentUploadSessionIdSchema.parse(
      query.uploadSessionId,
    );
    const organisationId = activeOrganisation(query.actor);
    const session = await dependencies.repositories.uploadSessions.findById(
      dependencies.sql,
      query.actor.tenantId,
      organisationId,
      sessionId,
    );
    if (session === null || session.createdByUserId !== query.actor.userId) {
      throw new DocumentUploadSessionNotFoundError();
    }
    return session;
  };
}
