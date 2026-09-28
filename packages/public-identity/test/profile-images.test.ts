import { randomUUID } from "node:crypto";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { CorrelationId } from "@capital-q/contracts";
import type {
  DatabaseExecutor,
  TransactionContext,
  TransactionManager,
} from "@capital-q/database";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  createProfileImageService,
  createSharpImageProcessor,
  ProfileImageRejectedError,
  ProfileImageUploadNotFoundError,
  QCardSubjectNotFoundError,
  type ProfileImageRepository,
  type ProfileImageRow,
  type ProfileImageStorage,
  type SubjectDirectory,
} from "../src/index.js";

/**
 * Profile photos and covers: who may upload, what completes, what the
 * stored rendition is. In-memory repository and storage; the real image
 * processor, so "metadata stripped, fixed size" is asserted on real bytes.
 */

const tenantId = randomUUID();
const orgId = randomUUID();
const companyId = randomUUID();
const correlationId = "corr-profile-images" as CorrelationId;

function actor(userId: string, organisationId?: string): ActorContext {
  return ActorContextSchema.parse({
    userId,
    tenantId,
    ...(organisationId === undefined
      ? {}
      : { organisationId, membershipId: randomUUID() }),
    actorType: "HUMAN",
  });
}

function world(options: { readonly denyEdit?: boolean } = {}) {
  const rows = new Map<string, ProfileImageRow>();
  const objects = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  const executor = {} as DatabaseExecutor;
  const tx = {} as TransactionContext;
  const transactions: TransactionManager = { run: (work) => work(tx) };
  const set = (id: string, patch: Partial<ProfileImageRow>) => {
    const row = rows.get(id);
    if (row !== undefined) rows.set(id, { ...row, ...patch });
  };
  const repository: ProfileImageRepository = {
    countRecentPending: async () => 0,
    insertPending: async (_sql, row) => {
      rows.set(row.id, {
        id: row.id,
        tenantId: row.tenantId,
        organisationId: row.organisationId,
        subjectType: row.subject.subjectType,
        subjectId: row.subject.subjectId,
        kind: row.kind,
        status: "PENDING",
        uploadKey: row.uploadKey,
        declaredContentType: row.contentType,
        declaredByteSize: row.byteSize,
        objectKey: null,
        width: null,
        height: null,
        createdByUserId: row.createdByUserId,
        uploadExpiresAt: row.uploadExpiresAt,
        readyAt: null,
      });
    },
    find: async (_sql, id) => rows.get(id) ?? null,
    lockReady: async (_tx, subject, kind) =>
      [...rows.values()].find(
        (row) =>
          row.subjectId === subject.subjectId &&
          row.kind === kind &&
          row.status === "READY",
      ) ?? null,
    findReady: async (_sql, subject) =>
      [...rows.values()].filter(
        (row) => row.subjectId === subject.subjectId && row.status === "READY",
      ),
    end: async (_tx, id, status) => set(id, { status }),
    markFailed: async (_sql, id) => set(id, { status: "FAILED" }),
    markReady: async (_tx, id, rendition) => {
      set(id, {
        status: "READY",
        objectKey: rendition.objectKey,
        width: rendition.width,
        height: rendition.height,
        readyAt: new Date().toISOString(),
      });
      return rows.get(id) ?? null;
    },
  };
  const storage: ProfileImageStorage = {
    createUploadAuthorization: async ({ object, contentType }) => ({
      method: "PUT",
      url: `https://storage.example.invalid/upload/${object.key}`,
      headers: { "content-type": contentType },
    }),
    createDownloadAuthorization: async ({ object }) => ({
      url: `https://storage.example.invalid/sign/${object.key}?token=t`,
    }),
    statObject: async (object) => {
      const bytes = objects.get(object.key);
      return bytes === undefined ? null : { sizeBytes: bytes.byteLength };
    },
    openObjectStream: async (object) => {
      const bytes = objects.get(object.key) ?? new Uint8Array();
      return {
        body: (async function* () {
          yield bytes;
        })(),
      };
    },
    putObject: async ({ object, body }) => {
      objects.set(object.key, body);
    },
    deleteObject: async (object) => {
      deleted.push(object.key);
      objects.delete(object.key);
    },
  };
  const subjects: SubjectDirectory = {
    find: async (subject) =>
      subject.subjectId === companyId
        ? {
            tenantId,
            organisationId: orgId,
            name: "Kivu",
            facts: {},
            verified: { organisation: false, founderIdentity: false },
          }
        : null,
  };
  const service = createProfileImageService({
    sql: executor,
    transactions,
    authorization: {
      authorize: async () => {
        throw new Error("not used");
      },
      requireCapability: async () => {
        if (options.denyEdit === true) throw new Error("DENIED");
      },
    },
    audit: { record: async () => randomUUID() as never },
    subjects,
    repository,
    storage,
    processor: createSharpImageProcessor(),
  });
  return { service, rows, objects, deleted };
}

async function photo(width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: { width, height, channels: 3, background: "#336699" },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: "private GPS here" } } })
      .toBuffer(),
  );
}

describe("profile images", () => {
  it("uploads a person's own photo: signed URL, re-encoded 512x512 WebP, no metadata, original deleted", async () => {
    const { service, objects, deleted } = world();
    const me = randomUUID();
    const upload = await service.requestUpload({
      actor: actor(me),
      subject: { subjectType: "PERSON", subjectId: me },
      kind: "AVATAR",
      request: { contentType: "image/jpeg", byteSize: 1000 },
    });
    expect(upload.upload.method).toBe("PUT");
    const rawKey = upload.upload.url.split("/upload/")[1] ?? "";
    objects.set(rawKey, await photo(900, 700));

    const images = await service.completeUpload({
      actor: actor(me),
      uploadId: upload.uploadId,
      correlationId,
    });
    expect(images.avatar?.width).toBe(512);
    expect(images.avatar?.height).toBe(512);
    expect(images.avatar?.url).toContain("/sign/img/");
    expect(images.cover).toBeNull();
    expect(deleted).toContain(rawKey);

    const stored = [...objects.entries()].find(([key]) =>
      key.startsWith("img/"),
    );
    const meta = await sharp(stored?.[1]).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();

    // A retried completion answers with the current state.
    const again = await service.completeUpload({
      actor: actor(me),
      uploadId: upload.uploadId,
      correlationId,
    });
    expect(again.avatar?.width).toBe(512);
  });

  it("refuses someone else's person profile, and someone else's upload", async () => {
    const { service } = world();
    const me = randomUUID();
    await expect(
      service.requestUpload({
        actor: actor(me),
        subject: { subjectType: "PERSON", subjectId: randomUUID() },
        kind: "AVATAR",
        request: { contentType: "image/png", byteSize: 10 },
      }),
    ).rejects.toBeInstanceOf(QCardSubjectNotFoundError);

    const upload = await service.requestUpload({
      actor: actor(me),
      subject: { subjectType: "PERSON", subjectId: me },
      kind: "COVER",
      request: { contentType: "image/png", byteSize: 10 },
    });
    await expect(
      service.completeUpload({
        actor: actor(randomUUID()),
        uploadId: upload.uploadId,
        correlationId,
      }),
    ).rejects.toBeInstanceOf(ProfileImageUploadNotFoundError);
  });

  it("refuses an organisation outside the actor's own, and one they may not edit", async () => {
    const outsider = world();
    await expect(
      outsider.service.requestUpload({
        actor: actor(randomUUID(), randomUUID()),
        subject: { subjectType: "COMPANY", subjectId: companyId },
        kind: "COVER",
        request: { contentType: "image/png", byteSize: 10 },
      }),
    ).rejects.toBeInstanceOf(QCardSubjectNotFoundError);
    const member = world({ denyEdit: true });
    await expect(
      member.service.requestUpload({
        actor: actor(randomUUID(), orgId),
        subject: { subjectType: "COMPANY", subjectId: companyId },
        kind: "COVER",
        request: { contentType: "image/png", byteSize: 10 },
      }),
    ).rejects.toThrow("DENIED");
  });

  it("marks bytes that are not an image as FAILED and says so", async () => {
    const { service, rows, objects } = world();
    const me = randomUUID();
    const upload = await service.requestUpload({
      actor: actor(me),
      subject: { subjectType: "PERSON", subjectId: me },
      kind: "AVATAR",
      request: { contentType: "image/png", byteSize: 10 },
    });
    objects.set(
      upload.upload.url.split("/upload/")[1] ?? "",
      new TextEncoder().encode("<svg onload=alert(1)>"),
    );
    await expect(
      service.completeUpload({
        actor: actor(me),
        uploadId: upload.uploadId,
        correlationId,
      }),
    ).rejects.toBeInstanceOf(ProfileImageRejectedError);
    expect(rows.get(upload.uploadId)?.status).toBe("FAILED");
  });

  it("replaces a company cover (the old one superseded, its bytes deleted) and removes it", async () => {
    const { service, rows, objects, deleted } = world();
    const editor = actor(randomUUID(), orgId);
    const subject = { subjectType: "COMPANY" as const, subjectId: companyId };
    const put = async () => {
      const upload = await service.requestUpload({
        actor: editor,
        subject,
        kind: "COVER",
        request: { contentType: "image/jpeg", byteSize: 1000 },
      });
      objects.set(
        upload.upload.url.split("/upload/")[1] ?? "",
        await photo(1600, 500),
      );
      return service.completeUpload({
        actor: editor,
        uploadId: upload.uploadId,
        correlationId,
      });
    };
    const first = await put();
    expect(first.cover).toMatchObject({ width: 1584, height: 396 });
    await put();
    const statuses = [...rows.values()].map((row) => row.status).sort();
    expect(statuses).toEqual(["READY", "SUPERSEDED"]);
    expect(deleted.filter((key) => key.startsWith("img/"))).toHaveLength(1);

    const removed = await service.remove({
      actor: editor,
      subject,
      kind: "COVER",
      correlationId,
    });
    expect(removed.cover).toBeNull();
    expect([...rows.values()].map((row) => row.status).sort()).toEqual([
      "REMOVED",
      "SUPERSEDED",
    ]);
  });
});
