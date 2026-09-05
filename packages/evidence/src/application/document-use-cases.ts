import { z } from "zod";

import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
} from "@capital-q/audit";
import { CompanyIdSchema } from "@capital-q/companies";
import {
  MessageSensitivitySchema,
  UuidSchema,
  type CorrelationId,
  type MessageSensitivity,
} from "@capital-q/contracts";
import type { TransactionContext } from "@capital-q/database";
import type { ActorContext, OrganisationId } from "@capital-q/security";

import {
  DocumentIdSchema,
  DocumentTitleSchema,
  DocumentTypeSchema,
  DocumentVersionIdSchema,
  type DocumentType,
  MimeTypeSchema,
  OriginalFilenameSchema,
  Sha256Schema,
  StorageBucketSchema,
  StorageKeySchema,
  type Document,
  type DocumentId,
  type DocumentVersion,
  type DocumentVersionId,
} from "../contracts/index.js";
import {
  DocumentNotFoundError,
  DocumentVersionConflictError,
  DocumentVersionNotFoundError,
  EvidenceRuleError,
} from "../domain/errors.js";
import {
  defaultDocumentSensitivity,
  isAtLeastAsSensitive,
} from "../domain/sensitivity.js";
import {
  documentCreatedEvent,
  documentVersionCreatedEvent,
} from "../events/index.js";
import {
  activeOrganisation,
  DOCUMENT_CREATE,
  DOCUMENT_MANAGE,
  DOCUMENT_VIEW,
  documentScope,
  ownedSubject,
} from "./authority.js";
import type { EvidenceServiceDependencies } from "./dependencies.js";

/**
 * Logical documents and immutable versions. No bytes pass through here:
 * CQ-EVD-002 obtains a private upload target, verifies what landed, and
 * then registers the version through `registerDocumentVersion` with the
 * storage identity it generated. Ownership is the actor's organisation,
 * tenant is the actor's tenant, a named company must belong to that
 * organisation; nothing about ownership is taken from the request.
 */

const RESOURCE_DOCUMENT = AuditResourceTypeSchema.parse("document");
const ACTION = {
  created: AuditActionTypeSchema.parse("document.created"),
  versionRegistered: AuditActionTypeSchema.parse("document.version_registered"),
};

/** Doc 15 §27 V1 formats. Broader acceptance is a security decision, not a default. */
export const DOCUMENT_MIME_ALLOWLIST = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
  "image/png",
  "image/jpeg",
] as const;

/** Upper bound on a registered version; the platform storage limit is 50 MiB. */
export const DOCUMENT_MAX_SIZE_BYTES = 50 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Transactional bodies shared with the upload boundary (CQ-EVD-002).
//
// The upload flow must create a document and append its version inside its
// own transaction, alongside the upload session it is completing. Sharing
// these bodies keeps one path for the insert, the audit entry and the
// event, so a document created by upload is indistinguishable from any
// other and neither path can drift.
// ---------------------------------------------------------------------------

export type InsertDocumentWithin = {
  readonly actor: ActorContext;
  readonly organisationId: OrganisationId;
  readonly companyId: string | null;
  readonly documentType: DocumentType;
  readonly title: string;
  readonly sensitivityClass: MessageSensitivity;
  readonly correlationId: CorrelationId;
};

export async function insertDocumentWithin(
  tx: TransactionContext,
  dependencies: EvidenceServiceDependencies,
  input: InsertDocumentWithin,
): Promise<Document> {
  const { audit, outbox, repositories } = dependencies;
  const { actor } = input;
  const document = await repositories.documents.insert(tx, {
    tenantId: actor.tenantId,
    companyId: input.companyId,
    ownerOrganisationId: input.organisationId,
    documentType: input.documentType,
    title: input.title,
    // Never broader than the organisation at creation; sharing is a
    // separate, deliberate disclosure decision.
    visibilityScope: "organisation_private",
    sensitivityClass: input.sensitivityClass,
    createdByUserId: actor.userId,
  });
  await audit.record(tx, {
    ...auditActorFromContext(actor),
    auditEventId: createAuditEventId(),
    actionType: ACTION.created,
    resourceType: RESOURCE_DOCUMENT,
    resourceId: document.id,
    occurredAt: occurredNow(),
    outcome: "SUCCEEDED",
    metadata: {
      documentType: document.documentType,
      companyId: document.companyId,
      sensitivityClass: document.sensitivityClass,
    },
    correlationId: input.correlationId,
  });
  await outbox.enqueue(
    tx,
    documentCreatedEvent(
      {
        actor,
        organisationId: input.organisationId,
        correlationId: input.correlationId,
      },
      {
        documentId: document.id,
        ownerOrganisationId: document.ownerOrganisationId,
        companyId: document.companyId,
        documentType: document.documentType,
      },
    ),
  );
  return document;
}

/** Verified file identity. Whoever calls this has already proved it. */
export type DocumentFileIdentity = {
  readonly storageBucket: string;
  readonly storageKey: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
};

/**
 * Appends the next version to a document the caller already holds a row
 * lock on, and advances the current-version pointer in the same
 * transaction. The lock is what makes version numbers sequential when two
 * uploads finalize at once: whoever holds it is version N, the next is N+1.
 */
export async function appendDocumentVersionWithin(
  tx: TransactionContext,
  dependencies: EvidenceServiceDependencies,
  input: {
    readonly actor: ActorContext;
    readonly organisationId: OrganisationId;
    readonly document: Document;
    readonly file: DocumentFileIdentity;
    readonly correlationId: CorrelationId;
  },
): Promise<RegisterDocumentVersionResult> {
  const { audit, outbox, repositories } = dependencies;
  const { actor, document } = input;
  if (document.status !== "ACTIVE") {
    throw new EvidenceRuleError("an archived document takes no new versions");
  }
  const existing = await repositories.documentVersions.listByDocument(
    tx.sql,
    actor.tenantId,
    document.id,
  );
  const versionNumber =
    existing.reduce((max, v) => Math.max(max, v.versionNumber), 0) + 1;
  const duplicates = await repositories.documentVersions.findBySha256(
    tx.sql,
    actor.tenantId,
    input.organisationId,
    input.file.sha256,
  );
  const version = await repositories.documentVersions.insert(tx, {
    tenantId: actor.tenantId,
    documentId: document.id,
    versionNumber,
    storageBucket: input.file.storageBucket,
    storageKey: input.file.storageKey,
    originalFilename: input.file.originalFilename,
    mimeType: input.file.mimeType.toLowerCase(),
    sizeBytes: input.file.sizeBytes,
    sha256: input.file.sha256,
    uploadedByUserId: actor.userId,
    supersedesVersionId: document.currentVersionId,
  });
  const advanced = await repositories.documents.setCurrentVersion(tx, {
    tenantId: actor.tenantId,
    documentId: document.id,
    expectedVersion: document.version,
    currentVersionId: version.id,
  });
  if (!advanced) {
    throw new DocumentVersionConflictError();
  }
  const updated = await repositories.documents.findById(
    tx.sql,
    actor.tenantId,
    input.organisationId,
    document.id,
  );
  if (updated === null) {
    throw new DocumentNotFoundError();
  }
  await audit.record(tx, {
    ...auditActorFromContext(actor),
    auditEventId: createAuditEventId(),
    actionType: ACTION.versionRegistered,
    resourceType: RESOURCE_DOCUMENT,
    resourceId: document.id,
    occurredAt: occurredNow(),
    outcome: "SUCCEEDED",
    metadata: {
      documentVersionId: version.id,
      versionNumber,
      sizeBytes: version.sizeBytes,
      duplicateCount: duplicates.length,
    },
    correlationId: input.correlationId,
  });
  await outbox.enqueue(
    tx,
    documentVersionCreatedEvent(
      {
        actor,
        organisationId: input.organisationId,
        correlationId: input.correlationId,
      },
      updated.version,
      {
        documentId: document.id,
        documentVersionId: version.id,
        versionNumber,
        supersedesVersionId: version.supersedesVersionId,
      },
    ),
  );
  return {
    document: updated,
    version,
    duplicateOf: duplicates.map((d) => d.id),
  };
}

/**
 * The company and sensitivity checks a new document must pass, whether it
 * is created directly or as the first step of an upload.
 */
export async function resolveNewDocument(
  dependencies: EvidenceServiceDependencies,
  actor: ActorContext,
  input: {
    readonly documentType: DocumentType;
    readonly companyId?: string | undefined;
    readonly sensitivityClass?: MessageSensitivity | undefined;
  },
): Promise<{
  readonly companyId: string | null;
  readonly sensitivityClass: MessageSensitivity;
}> {
  // A company named by the caller must be one this organisation owns; a
  // guessed id from elsewhere is "not found", never "forbidden".
  const companyId =
    input.companyId === undefined
      ? null
      : (
          await ownedSubject(dependencies, actor, {
            subjectType: "COMPANY",
            subjectId: input.companyId,
          }).catch(() => {
            throw new DocumentNotFoundError();
          })
        ).subjectId;
  const floor = defaultDocumentSensitivity(input.documentType);
  const sensitivityClass = input.sensitivityClass ?? floor;
  if (!isAtLeastAsSensitive(sensitivityClass, floor)) {
    throw new EvidenceRuleError(
      `a ${input.documentType} document is at least ${floor}`,
    );
  }
  return { companyId, sensitivityClass };
}

export const CreateDocumentInputSchema = z
  .object({
    title: DocumentTitleSchema,
    documentType: DocumentTypeSchema.default("UNCLASSIFIED"),
    companyId: CompanyIdSchema.optional(),
    /** May only strengthen the server default for the declared type. */
    sensitivityClass: MessageSensitivitySchema.optional(),
  })
  .strict();
export type CreateDocumentInput = z.input<typeof CreateDocumentInputSchema>;

export type CreateDocumentCommand = {
  readonly actor: ActorContext;
  readonly input: CreateDocumentInput;
  readonly correlationId: CorrelationId;
};

export function createCreateDocument(
  dependencies: EvidenceServiceDependencies,
) {
  const { transactions } = dependencies;
  return async (command: CreateDocumentCommand): Promise<Document> => {
    const input = CreateDocumentInputSchema.parse(command.input);
    const { actor } = command;
    const organisationId = activeOrganisation(actor);
    const { companyId, sensitivityClass } = await resolveNewDocument(
      dependencies,
      actor,
      input,
    );
    await dependencies.authorization.requireCapability({
      actor,
      capability: DOCUMENT_CREATE,
      resource: {
        kind: "ORGANISATION",
        tenantId: actor.tenantId,
        organisationId,
      },
    });
    return transactions.run((tx) =>
      insertDocumentWithin(tx, dependencies, {
        actor,
        organisationId,
        companyId,
        documentType: input.documentType,
        title: input.title,
        sensitivityClass,
        correlationId: command.correlationId,
      }),
    );
  };
}

export const RegisterDocumentVersionInputSchema = z
  .object({
    documentId: DocumentIdSchema,
    /** The document version the caller last read; guards concurrent registrations. */
    expectedDocumentVersion: z.number().int().min(1),
    storageBucket: StorageBucketSchema,
    storageKey: StorageKeySchema,
    originalFilename: OriginalFilenameSchema,
    mimeType: MimeTypeSchema,
    sizeBytes: z.number().int().min(1).max(DOCUMENT_MAX_SIZE_BYTES),
    sha256: Sha256Schema,
  })
  .strict();
export type RegisterDocumentVersionInput = z.infer<
  typeof RegisterDocumentVersionInputSchema
>;

export type RegisterDocumentVersionCommand = {
  readonly actor: ActorContext;
  readonly input: RegisterDocumentVersionInput;
  readonly correlationId: CorrelationId;
};

export type RegisterDocumentVersionResult = {
  readonly document: Document;
  readonly version: DocumentVersion;
  /** Versions in this organisation with the same bytes; informational only. */
  readonly duplicateOf: readonly DocumentVersionId[];
};

/**
 * Registers an immutable version and advances the current-version pointer
 * atomically. The caller is the trusted upload workflow; the file identity
 * it passes is never editable afterwards. Same bytes elsewhere in the
 * organisation are reported, never merged, and other organisations'
 * documents are never consulted.
 */
export function createRegisterDocumentVersion(
  dependencies: EvidenceServiceDependencies,
) {
  const { transactions, repositories } = dependencies;
  return async (
    command: RegisterDocumentVersionCommand,
  ): Promise<RegisterDocumentVersionResult> => {
    const input = RegisterDocumentVersionInputSchema.parse(command.input);
    const { actor } = command;
    const organisationId = activeOrganisation(actor);
    if (
      !(DOCUMENT_MIME_ALLOWLIST as readonly string[]).includes(
        input.mimeType.toLowerCase(),
      )
    ) {
      throw new EvidenceRuleError("unsupported document format");
    }
    const visible = await repositories.documents.findById(
      dependencies.sql,
      actor.tenantId,
      organisationId,
      input.documentId,
    );
    if (visible === null) {
      throw new DocumentNotFoundError();
    }
    await dependencies.authorization.requireCapability({
      actor,
      capability: DOCUMENT_MANAGE,
      resource: documentScope(actor, organisationId, visible.id),
    });
    return transactions.run(async (tx) => {
      const document = await repositories.documents.lockById(
        tx,
        actor.tenantId,
        organisationId,
        input.documentId,
      );
      if (document === null) {
        throw new DocumentNotFoundError();
      }
      if (document.version !== input.expectedDocumentVersion) {
        throw new DocumentVersionConflictError();
      }
      return appendDocumentVersionWithin(tx, dependencies, {
        actor,
        organisationId,
        document,
        file: {
          storageBucket: input.storageBucket,
          storageKey: input.storageKey,
          originalFilename: input.originalFilename,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          sha256: input.sha256,
        },
        correlationId: command.correlationId,
      });
    });
  };
}

export type GetDocumentQuery = {
  readonly actor: ActorContext;
  readonly documentId: DocumentId;
};

export function createGetDocument(dependencies: EvidenceServiceDependencies) {
  return async (query: GetDocumentQuery): Promise<Document> => {
    const { actor } = query;
    const organisationId = activeOrganisation(actor);
    const document = await dependencies.repositories.documents.findById(
      dependencies.sql,
      actor.tenantId,
      organisationId,
      DocumentIdSchema.parse(query.documentId),
    );
    if (document === null) {
      throw new DocumentNotFoundError();
    }
    await dependencies.authorization.requireCapability({
      actor,
      capability: DOCUMENT_VIEW,
      resource: documentScope(actor, organisationId, document.id),
    });
    return document;
  };
}

export type ListDocumentsQuery = {
  readonly actor: ActorContext;
  readonly companyId?: string | undefined;
};

export function createListDocuments(dependencies: EvidenceServiceDependencies) {
  return async (query: ListDocumentsQuery): Promise<readonly Document[]> => {
    const { actor } = query;
    const organisationId = activeOrganisation(actor);
    await dependencies.authorization.requireCapability({
      actor,
      capability: DOCUMENT_VIEW,
      resource: {
        kind: "ORGANISATION",
        tenantId: actor.tenantId,
        organisationId,
      },
    });
    return dependencies.repositories.documents.listByOwner(
      dependencies.sql,
      actor.tenantId,
      organisationId,
      {
        companyId:
          query.companyId === undefined
            ? undefined
            : UuidSchema.parse(query.companyId),
      },
    );
  };
}

export type ListDocumentVersionsQuery = GetDocumentQuery;

export function createListDocumentVersions(
  dependencies: EvidenceServiceDependencies,
) {
  const getDocument = createGetDocument(dependencies);
  return async (
    query: ListDocumentVersionsQuery,
  ): Promise<readonly DocumentVersion[]> => {
    const document = await getDocument(query);
    return dependencies.repositories.documentVersions.listByDocument(
      dependencies.sql,
      query.actor.tenantId,
      document.id,
    );
  };
}

export type GetDocumentVersionQuery = {
  readonly actor: ActorContext;
  readonly documentVersionId: DocumentVersionId;
};

/** The version is reachable only through a document the actor may view. */
export function createGetDocumentVersion(
  dependencies: EvidenceServiceDependencies,
) {
  const getDocument = createGetDocument(dependencies);
  return async (query: GetDocumentVersionQuery): Promise<DocumentVersion> => {
    const version = await dependencies.repositories.documentVersions.findById(
      dependencies.sql,
      query.actor.tenantId,
      DocumentVersionIdSchema.parse(query.documentVersionId),
    );
    if (version === null) {
      throw new DocumentVersionNotFoundError();
    }
    await getDocument({
      actor: query.actor,
      documentId: version.documentId,
    }).catch(() => {
      throw new DocumentVersionNotFoundError();
    });
    return version;
  };
}

// ---------------------------------------------------------------------------
// Reads that include the current version, for surfaces that show a
// document's state. Two queries for a page, never one per row.
// ---------------------------------------------------------------------------

export type DocumentWithVersion = {
  readonly document: Document;
  readonly currentVersion: DocumentVersion | null;
};

export function createGetDocumentWithVersion(
  dependencies: EvidenceServiceDependencies,
) {
  const getDocument = createGetDocument(dependencies);
  return async (query: GetDocumentQuery): Promise<DocumentWithVersion> => {
    const document = await getDocument(query);
    if (document.currentVersionId === null) {
      return { document, currentVersion: null };
    }
    const version = await dependencies.repositories.documentVersions.findById(
      dependencies.sql,
      query.actor.tenantId,
      document.currentVersionId,
    );
    return { document, currentVersion: version };
  };
}

export function createListDocumentsWithVersions(
  dependencies: EvidenceServiceDependencies,
) {
  const listDocuments = createListDocuments(dependencies);
  return async (
    query: ListDocumentsQuery,
  ): Promise<readonly DocumentWithVersion[]> => {
    const documents = await listDocuments(query);
    if (documents.length === 0) return [];
    const versions =
      await dependencies.repositories.documentVersions.listCurrentByOwner(
        dependencies.sql,
        query.actor.tenantId,
        activeOrganisation(query.actor),
      );
    const byId = new Map(versions.map((version) => [version.id, version]));
    return documents.map((document) => ({
      document,
      currentVersion:
        document.currentVersionId === null
          ? null
          : (byId.get(document.currentVersionId) ?? null),
    }));
  };
}
