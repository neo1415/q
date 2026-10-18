import { randomUUID } from "node:crypto";

import {
  AuditActionTypeSchema,
  AuditResourceTypeSchema,
  auditActorFromContext,
  createAuditEventId,
  occurredNow,
  type MaterialActionAuditWriter,
} from "@capital-q/audit";
import {
  PROFILE_IMAGE_DIMENSIONS,
  PROFILE_IMAGE_MAX_BYTES,
  type CorrelationId,
  type CreateProfileImageUploadRequest,
  type ProfileImageDto,
  type ProfileImageKind,
  type ProfileImagesDto,
  type ProfileImageSubjectType,
  type ProfileImageUploadDto,
} from "@capital-q/contracts";
import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import {
  capability,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

import {
  ProfileImageRejectedError,
  ProfileImageStorageUnavailableError,
  ProfileImageUploadNotFoundError,
  QCardSubjectNotFoundError,
} from "../domain/errors.js";
import type { SubjectDirectory } from "./ports.js";

/**
 * Profile photos and covers (founder directive 2026-09-28, item 15).
 *
 * The browser uploads straight to private storage on a single-object
 * signed URL this service mints; the bytes never pass through the API or
 * the web app. Completing the upload is where trust is established: the
 * original is read back (bounded), decoded and re-encoded by the image
 * processor into a fixed-size rendition with every metadata block dropped,
 * and only that rendition becomes READY. The original is then deleted.
 *
 * Who may change an image: the person themselves (PERSON), or a member of
 * the organisation holding the profile-edit capability (COMPANY,
 * INVESTOR_ORGANISATION). Who may see it: the person; the organisation's
 * members; whoever may see the subject's name on a surface, for the photo
 * (named-images.ts, founder decision 2026-10-04); and, for an
 * organisation's cover, the Q Card's audiences through the card's own
 * `cover` scope -- never a public bucket.
 */

export const PROFILE_IMAGE_BUCKET = "cq-profile-images" as const;
const UPLOAD_TTL_MS = 15 * 60 * 1000;
/** Signed reads live briefly; pages re-read on every render. */
export const PROFILE_IMAGE_READ_TTL_SECONDS = 60 * 60;
const MAX_PENDING_PER_HOUR = 20;
/** Below this the rendition would be an upscaled blur. */
const MIN_SOURCE_WIDTH = 200;

const EDIT = {
  COMPANY: capability("company.edit"),
  INVESTOR_ORGANISATION: capability("investor.edit"),
} as const;
const VIEW = {
  COMPANY: capability("company.view"),
  INVESTOR_ORGANISATION: capability("investor.view"),
} as const;
const RESOURCE_TYPE = {
  COMPANY: "company",
  INVESTOR_ORGANISATION: "investor_organisation",
} as const;

const IMAGE_SET = AuditActionTypeSchema.parse("profile_image.set");
const IMAGE_REMOVED = AuditActionTypeSchema.parse("profile_image.removed");
const IMAGE_RESOURCE = AuditResourceTypeSchema.parse("profile_image");

export type ProfileImageSubject = {
  readonly subjectType: ProfileImageSubjectType;
  readonly subjectId: string;
};

export type StoredImageObject = {
  readonly bucket: string;
  readonly key: string;
};

/**
 * The storage the apps compose (structurally the evidence context's
 * private-object adapter, pointed at another bucket). Holds the privileged
 * credential; the browser only ever sees one signed URL.
 */
export type ProfileImageStorage = {
  readonly createUploadAuthorization: (input: {
    readonly object: StoredImageObject;
    readonly contentType: string;
    readonly maxBytes: number;
  }) => Promise<{
    readonly method: "PUT";
    readonly url: string;
    readonly headers: Readonly<Record<string, string>>;
  }>;
  readonly createDownloadAuthorization: (input: {
    readonly object: StoredImageObject;
    readonly expiresInSeconds: number;
  }) => Promise<{ readonly url: string }>;
  /**
   * Many reads of one bucket signed in one provider call (a list's
   * pictures). Each entry is the URL or null, in the order asked. Absent:
   * the reader signs one by one.
   */
  readonly createDownloadAuthorizations?:
    | ((input: {
        readonly bucket: string;
        readonly keys: readonly string[];
        readonly expiresInSeconds: number;
      }) => Promise<readonly (string | null)[]>)
    | undefined;
  readonly statObject: (
    object: StoredImageObject,
  ) => Promise<{ readonly sizeBytes: number } | null>;
  readonly openObjectStream: (
    object: StoredImageObject,
  ) => Promise<{ readonly body: AsyncIterable<Uint8Array> }>;
  readonly putObject: (input: {
    readonly object: StoredImageObject;
    readonly body: Uint8Array;
    readonly contentType: string;
  }) => Promise<void>;
  readonly deleteObject: (object: StoredImageObject) => Promise<void>;
};

export type ProcessedImage = {
  readonly bytes: Uint8Array;
  readonly contentType: "image/webp";
  readonly width: number;
  readonly height: number;
  /** The decoded source's width, for the too-small refusal. */
  readonly sourceWidth: number;
};

/** Decodes untrusted bytes and re-encodes a clean, fixed-size rendition. */
export type ProfileImageProcessor = {
  /** Null when the bytes are not a decodable JPEG, PNG or WebP. */
  readonly process: (
    bytes: Uint8Array,
    target: { readonly width: number; readonly height: number },
  ) => Promise<ProcessedImage | null>;
};

export type ProfileImageStatus =
  "PENDING" | "READY" | "SUPERSEDED" | "REMOVED" | "FAILED";

export type ProfileImageRow = {
  readonly id: string;
  readonly tenantId: string;
  readonly organisationId: string | null;
  readonly subjectType: ProfileImageSubjectType;
  readonly subjectId: string;
  readonly kind: ProfileImageKind;
  readonly status: ProfileImageStatus;
  readonly uploadKey: string;
  readonly declaredContentType: string;
  readonly declaredByteSize: number;
  readonly objectKey: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly createdByUserId: string;
  readonly uploadExpiresAt: Date;
  readonly readyAt: string | null;
};

export type ProfileImageRepository = {
  readonly countRecentPending: (
    sql: DatabaseExecutor,
    userId: string,
    since: Date,
  ) => Promise<number>;
  readonly insertPending: (
    sql: DatabaseExecutor,
    row: {
      readonly id: string;
      readonly tenantId: string;
      readonly organisationId: string | null;
      readonly subject: ProfileImageSubject;
      readonly kind: ProfileImageKind;
      readonly uploadKey: string;
      readonly contentType: string;
      readonly byteSize: number;
      readonly createdByUserId: string;
      readonly uploadExpiresAt: Date;
    },
  ) => Promise<void>;
  readonly find: (
    sql: DatabaseExecutor,
    id: string,
  ) => Promise<ProfileImageRow | null>;
  /** The READY row, locked for the change (transaction only). */
  readonly lockReady: (
    tx: TransactionContext,
    subject: ProfileImageSubject,
    kind: ProfileImageKind,
  ) => Promise<ProfileImageRow | null>;
  readonly findReady: (
    sql: DatabaseExecutor,
    subject: ProfileImageSubject,
  ) => Promise<readonly ProfileImageRow[]>;
  readonly end: (
    tx: TransactionContext,
    id: string,
    status: "SUPERSEDED" | "REMOVED",
  ) => Promise<void>;
  readonly markFailed: (sql: DatabaseExecutor, id: string) => Promise<void>;
  readonly markReady: (
    tx: TransactionContext,
    id: string,
    rendition: {
      readonly objectKey: string;
      readonly width: number;
      readonly height: number;
      readonly byteSize: number;
    },
  ) => Promise<ProfileImageRow | null>;
};

export type ProfileImageServiceDependencies = {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly authorization: AuthorizationService;
  readonly audit: MaterialActionAuditWriter;
  readonly subjects: SubjectDirectory;
  readonly repository: ProfileImageRepository;
  /** Absent: uploads refuse; reads answer "no image". */
  readonly storage?: ProfileImageStorage | undefined;
  readonly processor?: ProfileImageProcessor | undefined;
  readonly now?: (() => Date) | undefined;
};

export type ProfileImageService = {
  readonly requestUpload: (input: {
    readonly actor: ActorContext;
    readonly subject: ProfileImageSubject;
    readonly kind: ProfileImageKind;
    readonly request: CreateProfileImageUploadRequest;
  }) => Promise<ProfileImageUploadDto>;
  readonly completeUpload: (input: {
    readonly actor: ActorContext;
    readonly uploadId: string;
    readonly correlationId: CorrelationId;
  }) => Promise<ProfileImagesDto>;
  readonly remove: (input: {
    readonly actor: ActorContext;
    readonly subject: ProfileImageSubject;
    readonly kind: ProfileImageKind;
    readonly correlationId: CorrelationId;
  }) => Promise<ProfileImagesDto>;
  readonly read: (input: {
    readonly actor: ActorContext;
    readonly subject: ProfileImageSubject;
  }) => Promise<ProfileImagesDto>;
  /**
   * The Q Card's read: signed URLs for an organisation's current images,
   * with no actor. The caller (the card projection) decides which audience
   * may see them through the card's own scopes.
   */
  readonly cardImageUrls: (subject: ProfileImageSubject) => Promise<{
    readonly photo: string | null;
    readonly cover: string | null;
  }>;
};

async function readBounded(
  body: AsyncIterable<Uint8Array>,
  maxBytes: number,
): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > maxBytes) return null;
    chunks.push(chunk);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function createProfileImageService(
  dependencies: ProfileImageServiceDependencies,
): ProfileImageService {
  const { sql, transactions, authorization, audit, subjects, repository } =
    dependencies;
  const now = dependencies.now ?? (() => new Date());

  const composed = () => {
    const { storage, processor } = dependencies;
    if (storage === undefined || processor === undefined) {
      throw new ProfileImageStorageUnavailableError();
    }
    return { storage, processor };
  };

  /**
   * The owning tenant and organisation, once the actor may act here. A
   * subject outside the actor's own reach is one "not found".
   */
  const authorise = async (
    actor: ActorContext,
    subject: ProfileImageSubject,
    purpose: "EDIT" | "VIEW",
  ): Promise<{ tenantId: string; organisationId: string | null }> => {
    if (subject.subjectType === "PERSON") {
      if (subject.subjectId !== actor.userId) {
        throw new QCardSubjectNotFoundError();
      }
      return { tenantId: actor.tenantId, organisationId: null };
    }
    const type = subject.subjectType;
    const facts = await subjects.find({
      subjectType: type,
      subjectId: subject.subjectId,
    });
    if (
      facts === null ||
      actor.organisationId === undefined ||
      facts.organisationId !== actor.organisationId
    ) {
      throw new QCardSubjectNotFoundError();
    }
    await authorization.requireCapability({
      actor,
      capability: purpose === "EDIT" ? EDIT[type] : VIEW[type],
      resource: {
        kind: "RESOURCE",
        tenantId: actor.tenantId,
        organisationId: actor.organisationId,
        resourceType: RESOURCE_TYPE[type],
        resourceId: subject.subjectId,
      },
    });
    return { tenantId: facts.tenantId, organisationId: facts.organisationId };
  };

  const signed = async (row: ProfileImageRow): Promise<string | null> => {
    const storage = dependencies.storage;
    if (storage === undefined || row.objectKey === null) return null;
    try {
      const { url } = await storage.createDownloadAuthorization({
        object: { bucket: PROFILE_IMAGE_BUCKET, key: row.objectKey },
        expiresInSeconds: PROFILE_IMAGE_READ_TTL_SECONDS,
      });
      return url;
    } catch {
      // An image that cannot be signed right now reads as absent; the
      // profile still renders.
      return null;
    }
  };

  const toDto = async (
    row: ProfileImageRow | undefined,
  ): Promise<ProfileImageDto | null> => {
    if (row === undefined || row.width === null || row.height === null) {
      return null;
    }
    const url = await signed(row);
    if (url === null) return null;
    return {
      kind: row.kind,
      url,
      width: row.width,
      height: row.height,
      updatedAt: row.readyAt ?? new Date(0).toISOString(),
    };
  };

  const current = async (
    subject: ProfileImageSubject,
  ): Promise<ProfileImagesDto> => {
    const rows = await repository.findReady(sql, subject);
    const [avatar, cover] = await Promise.all([
      toDto(rows.find((row) => row.kind === "AVATAR")),
      toDto(rows.find((row) => row.kind === "COVER")),
    ]);
    return {
      subjectType: subject.subjectType,
      subjectId: subject.subjectId,
      avatar,
      cover,
    };
  };

  const deleteQuietly = async (key: string | null): Promise<void> => {
    if (key === null || dependencies.storage === undefined) return;
    await dependencies.storage
      .deleteObject({ bucket: PROFILE_IMAGE_BUCKET, key })
      .catch(() => undefined);
  };

  return {
    requestUpload: async ({ actor, subject, kind, request }) => {
      const { storage } = composed();
      const owner = await authorise(actor, subject, "EDIT");
      const at = now();
      const recent = await repository.countRecentPending(
        sql,
        actor.userId,
        new Date(at.getTime() - 60 * 60 * 1000),
      );
      if (recent >= MAX_PENDING_PER_HOUR) {
        throw new ProfileImageRejectedError("TOO_MANY");
      }
      const id = randomUUID();
      const uploadKey = `raw/${owner.tenantId}/${id}`;
      const expiresAt = new Date(at.getTime() + UPLOAD_TTL_MS);
      await repository.insertPending(sql, {
        id,
        tenantId: owner.tenantId,
        organisationId: owner.organisationId,
        subject,
        kind,
        uploadKey,
        contentType: request.contentType,
        byteSize: request.byteSize,
        createdByUserId: actor.userId,
        uploadExpiresAt: expiresAt,
      });
      const upload = await storage
        .createUploadAuthorization({
          object: { bucket: PROFILE_IMAGE_BUCKET, key: uploadKey },
          contentType: request.contentType,
          maxBytes: PROFILE_IMAGE_MAX_BYTES,
        })
        .catch(() => {
          throw new ProfileImageStorageUnavailableError();
        });
      return {
        uploadId: id,
        upload: {
          method: "PUT",
          url: upload.url,
          headers: { ...upload.headers },
        },
        expiresAt: expiresAt.toISOString(),
      };
    },

    completeUpload: async ({ actor, uploadId, correlationId }) => {
      const { storage, processor } = composed();
      const row = await repository.find(sql, uploadId);
      // Only the uploader finishes their own upload; anything else is one
      // "not found", whoever's it is.
      if (row === null || row.createdByUserId !== actor.userId) {
        throw new ProfileImageUploadNotFoundError();
      }
      const subject: ProfileImageSubject = {
        subjectType: row.subjectType,
        subjectId: row.subjectId,
      };
      await authorise(actor, subject, "EDIT");
      // A retried completion of an image that already went through is
      // answered with the current state rather than an error.
      if (row.status === "READY") return current(subject);
      if (row.status !== "PENDING") {
        throw new ProfileImageUploadNotFoundError();
      }
      const raw = { bucket: PROFILE_IMAGE_BUCKET, key: row.uploadKey };
      const refuse = async (
        reason: ConstructorParameters<typeof ProfileImageRejectedError>[0],
      ): Promise<never> => {
        await repository.markFailed(sql, row.id);
        await deleteQuietly(row.uploadKey);
        throw new ProfileImageRejectedError(reason);
      };
      if (row.uploadExpiresAt.getTime() < now().getTime()) {
        return refuse("EXPIRED");
      }
      const stat = await storage.statObject(raw).catch(() => {
        throw new ProfileImageStorageUnavailableError();
      });
      if (stat === null) throw new ProfileImageRejectedError("NOT_UPLOADED");
      if (stat.sizeBytes > PROFILE_IMAGE_MAX_BYTES) return refuse("TOO_LARGE");
      const stream = await storage.openObjectStream(raw).catch(() => {
        throw new ProfileImageStorageUnavailableError();
      });
      const bytes = await readBounded(stream.body, PROFILE_IMAGE_MAX_BYTES);
      if (bytes === null) return refuse("TOO_LARGE");
      const processed = await processor
        .process(bytes, PROFILE_IMAGE_DIMENSIONS[row.kind])
        .catch(() => null);
      if (processed === null) return refuse("NOT_AN_IMAGE");
      if (processed.sourceWidth < MIN_SOURCE_WIDTH) return refuse("TOO_SMALL");

      const objectKey = `img/${row.tenantId}/${row.id}.webp`;
      await storage
        .putObject({
          object: { bucket: PROFILE_IMAGE_BUCKET, key: objectKey },
          body: processed.bytes,
          contentType: processed.contentType,
        })
        .catch(() => {
          throw new ProfileImageStorageUnavailableError();
        });

      const previous = await transactions.run(async (tx) => {
        const ready = await repository.lockReady(tx, subject, row.kind);
        if (ready !== null) await repository.end(tx, ready.id, "SUPERSEDED");
        const updated = await repository.markReady(tx, row.id, {
          objectKey,
          width: processed.width,
          height: processed.height,
          byteSize: processed.bytes.byteLength,
        });
        if (updated === null) throw new ProfileImageUploadNotFoundError();
        await audit.record(tx, {
          ...auditActorFromContext(actor),
          auditEventId: createAuditEventId(),
          actionType: IMAGE_SET,
          resourceType: IMAGE_RESOURCE,
          resourceId: row.id,
          occurredAt: occurredNow(),
          outcome: "SUCCEEDED",
          metadata: {
            subjectType: row.subjectType,
            kind: row.kind,
            replaced: ready?.id ?? null,
          },
          correlationId,
        });
        return ready;
      });
      // The untrusted original and the replaced rendition's bytes go; the
      // rows stay as history.
      await deleteQuietly(row.uploadKey);
      await deleteQuietly(previous?.objectKey ?? null);
      return current(subject);
    },

    remove: async ({ actor, subject, kind, correlationId }) => {
      await authorise(actor, subject, "EDIT");
      const removed = await transactions.run(async (tx) => {
        const ready = await repository.lockReady(tx, subject, kind);
        if (ready === null) return null;
        await repository.end(tx, ready.id, "REMOVED");
        await audit.record(tx, {
          ...auditActorFromContext(actor),
          auditEventId: createAuditEventId(),
          actionType: IMAGE_REMOVED,
          resourceType: IMAGE_RESOURCE,
          resourceId: ready.id,
          occurredAt: occurredNow(),
          outcome: "SUCCEEDED",
          metadata: { subjectType: subject.subjectType, kind },
          correlationId,
        });
        return ready;
      });
      await deleteQuietly(removed?.objectKey ?? null);
      return current(subject);
    },

    read: async ({ actor, subject }) => {
      await authorise(actor, subject, "VIEW");
      return current(subject);
    },

    cardImageUrls: async (subject) => {
      const images = await current(subject);
      return {
        photo: images.avatar?.url ?? null,
        cover: images.cover?.url ?? null,
      };
    },
  };
}
