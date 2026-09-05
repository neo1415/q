import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createPostgresMaterialActionAuditWriter,
  createPostgresSecurityEventWriter,
} from "@capital-q/audit";
import { createPostgresCompanyQueryPort } from "@capital-q/companies";
import { parseDatabaseConfig } from "@capital-q/config/database";
import { createEventRegistry, type CorrelationId } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import { createLogger } from "@capital-q/observability";
import {
  AuthUserIdSchema,
  AuthorizationDeniedError,
  createAuthorizationService,
  resolveHumanActorContext,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import {
  createPostgresActorContextResolver,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";

import {
  createCompanyEvidenceSubjectResolver,
  createEvidenceService,
  createEvidenceSubjectResolverRegistry,
  DocumentNotFoundError,
  DocumentUploadCreationConflictError,
  DocumentUploadRejectedError,
  DocumentUploadSessionNotFoundError,
  DocumentUploadStateError,
  DOCUMENT_STORAGE_BUCKET,
  type DocumentUploadLimits,
  type EvidenceService,
  type PrivateDocumentStorageProvider,
  type StoredObjectRef,
} from "../src/index.js";
import { EVIDENCE_EVENTS } from "../src/events/index.js";
import { FIXTURES } from "./upload-fixtures.js";

/**
 * The upload boundary against real PostgreSQL (`pnpm db:start`), run with
 * `pnpm test:integration`. Storage is a faithful in-memory double: it
 * refuses to overwrite an existing object, exactly as a scoped signed
 * target does, and it can be made to fail a delete so the cleanup-debt path
 * is exercised rather than assumed.
 *
 * Every test runs inside one rolled-back transaction, and every positive
 * case has a cross-tenant or cross-organisation negative twin.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const PRIVATE_TITLE = "PRIVATE-DOCUMENT-TITLE-DO-NOT-EMIT";
const PRIVATE_FILENAME = "PRIVATE-DOCUMENT-FILENAME-DO-NOT-EMIT.pdf";
const PDF = "application/pdf";
const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

class Rollback extends Error {}

class FakeStorage implements PrivateDocumentStorageProvider {
  readonly objects = new Map<string, Uint8Array>();
  readonly authorised: StoredObjectRef[] = [];
  deleteFails = false;
  readonly deleted: string[] = [];

  private static path(object: StoredObjectRef): string {
    return `${object.bucket}/${object.key}`;
  }

  createUploadAuthorization(input: {
    readonly object: StoredObjectRef;
    readonly contentType: string;
    readonly maxBytes: number;
  }) {
    this.authorised.push(input.object);
    return Promise.resolve({
      method: "PUT" as const,
      url: `https://storage.invalid/object/upload/sign/${FakeStorage.path(input.object)}?token=scoped`,
      headers: { "content-type": input.contentType, "x-upsert": "false" },
      providerExpiresAt: new Date(Date.now() + 7200_000).toISOString(),
    });
  }

  statObject(object: StoredObjectRef) {
    const bytes = this.objects.get(FakeStorage.path(object));
    return Promise.resolve(
      bytes === undefined
        ? null
        : { sizeBytes: bytes.byteLength, declaredContentType: null },
    );
  }

  openObjectStream(object: StoredObjectRef) {
    const bytes = this.objects.get(FakeStorage.path(object));
    if (bytes === undefined) throw new Error("no such object");
    return Promise.resolve({
      body: (async function* () {
        // Deliberately chunked and asynchronous: validation must stream,
        // not assume it is handed one buffer.
        for (let at = 0; at < bytes.byteLength; at += 512) {
          yield await Promise.resolve(
            bytes.subarray(at, Math.min(at + 512, bytes.byteLength)),
          );
        }
      })(),
    });
  }

  deleteObject(object: StoredObjectRef) {
    if (this.deleteFails)
      return Promise.reject(new Error("storage unavailable"));
    this.deleted.push(FakeStorage.path(object));
    this.objects.delete(FakeStorage.path(object));
    return Promise.resolve();
  }

  /** What a browser does with the scoped target: one object, no overwrite. */
  put(object: StoredObjectRef, bytes: Uint8Array): void {
    const path = FakeStorage.path(object);
    if (this.objects.has(path)) {
      throw new Error("KeyAlreadyExists");
    }
    this.objects.set(path, bytes);
  }
}

type World = {
  readonly tx: TransactionContext;
  readonly service: EvidenceService;
  readonly expiredService: EvidenceService;
  readonly storage: FakeStorage;
  readonly logs: string[];
  readonly events: () => Promise<readonly unknown[]>;
  readonly audit: () => Promise<readonly unknown[]>;
  readonly adminA: ActorContext;
  readonly memberA: ActorContext;
  readonly adminB: ActorContext;
  readonly companyA: string;
  readonly companyB: string;
};

function nestedTransactions(tx: TransactionContext): TransactionManager {
  return {
    run: async (work) => {
      const { value } = await tx.sql.savepoint(async (inner) => ({
        value: await work({ sql: inner }),
      }));
      return value;
    },
  };
}

const registry = createEventRegistry([...EVIDENCE_EVENTS]);
const LIMITS: DocumentUploadLimits = {
  bucket: DOCUMENT_STORAGE_BUCKET,
  maxBytes: 4096,
  sessionTtlSeconds: 1800,
  maxOpenSessions: 25,
};

describe("document upload against local PostgreSQL", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "2",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  async function withWorld(
    work: (world: World) => Promise<void>,
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const { sql } = tx;
        const tenantA = await insertTenant(tx, "Upload Tenant A");
        const tenantB = await insertTenant(tx, "Upload Tenant B");
        const orgA = await insertOrganisation(
          tx,
          tenantA,
          "Org A",
          `up-a-${randomUUID().slice(0, 8)}`,
        );
        const orgB = await insertOrganisation(
          tx,
          tenantB,
          "Org B",
          `up-b-${randomUUID().slice(0, 8)}`,
        );
        const companyA = await insertCompany(tx, tenantA, orgA, "Company A");
        const companyB = await insertCompany(tx, tenantB, orgB, "Company B");
        const adminA = await insertMember(
          tx,
          tenantA,
          orgA,
          "organisation_admin",
        );
        const memberA = await insertMember(
          tx,
          tenantA,
          orgA,
          "organisation_member",
        );
        const adminB = await insertMember(
          tx,
          tenantB,
          orgB,
          "organisation_admin",
        );

        const storage = new FakeStorage();
        const logs: string[] = [];
        const logger = createLogger(
          { serviceName: "test", environment: "test" },
          {
            level: "debug",
            destination: new Writable({
              write(chunk: Buffer, _encoding, callback) {
                logs.push(chunk.toString("utf8"));
                callback();
              },
            }),
          },
        );
        logger.debug({ phase: "upload world ready" }, "world");

        const base = {
          sql,
          transactions: nestedTransactions(tx),
          authorization: createAuthorizationService(
            createPostgresAuthorizationPolicySource({ sql }),
          ),
          subjects: createEvidenceSubjectResolverRegistry([
            createCompanyEvidenceSubjectResolver(
              createPostgresCompanyQueryPort({ sql }),
            ),
          ]),
          outbox: createOutboxWriter({ registry }),
          audit: createPostgresMaterialActionAuditWriter(),
          securityEvents: createPostgresSecurityEventWriter({ sql }),
          storage,
        };

        const resolver = createPostgresActorContextResolver({ sql });
        const resolve = async (principal: AuthenticatedPrincipal) => {
          const resolution = await resolveHumanActorContext(resolver, {
            principal,
          });
          if (resolution.status !== "RESOLVED") {
            throw new Error(`context not resolved: ${resolution.status}`);
          }
          return resolution.context;
        };

        await work({
          tx,
          storage,
          logs,
          service: createEvidenceService({ ...base, uploads: LIMITS }),
          // Same wiring, with a window that has already closed.
          expiredService: createEvidenceService({
            ...base,
            uploads: { ...LIMITS, sessionTtlSeconds: -60 },
          }),
          events: async () =>
            await tx.sql`select event_type, payload from events.outbox`,
          audit: async () =>
            await tx.sql`select action_type, metadata from audit.material_actions`,
          adminA: await resolve(adminA),
          memberA: await resolve(memberA),
          adminB: await resolve(adminB),
          companyA,
          companyB,
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  async function insertTenant(tx: TransactionContext, name: string) {
    const id = randomUUID();
    await tx.sql`insert into identity.tenants (id, name) values (${id}, ${name})`;
    return id;
  }

  async function insertOrganisation(
    tx: TransactionContext,
    tenantId: string,
    name: string,
    slug: string,
  ) {
    const id = randomUUID();
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${id}, ${tenantId}, 'company', ${name}, ${slug})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${id})`;
    return id;
  }

  async function insertCompany(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    name: string,
  ) {
    const id = randomUUID();
    await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
      values (${id}, ${tenantId}, ${organisationId}, ${name}, ${`up-${id.slice(0, 8)}`})`;
    return id;
  }

  async function insertMember(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    roleCode: "organisation_admin" | "organisation_member",
  ): Promise<AuthenticatedPrincipal> {
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<
      { id: string }[]
    >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) throw new Error("profile trigger did not run");
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = ${roleCode}`;
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
    return { authUserId: AuthUserIdSchema.parse(authUserId) };
  }

  /** Authorise, transfer the bytes to the scoped target, and finalize. */
  async function upload(
    world: World,
    actor: ActorContext,
    options: {
      readonly content?: Uint8Array;
      readonly filename?: string;
      readonly declaredMimeType?: string;
      readonly title?: string;
      readonly companyId?: string | undefined;
      readonly existingDocumentId?: string;
      readonly service?: EvidenceService;
      readonly transfer?: boolean;
      readonly clientSha256?: string;
    } = {},
  ) {
    const service = options.service ?? world.service;
    const content = options.content ?? FIXTURES.pdf;
    const created = await service.createDocumentUploadSession({
      actor,
      input: {
        title: options.title ?? "Pitch deck",
        documentType: "PITCH_DECK",
        filename: options.filename ?? "deck.pdf",
        declaredMimeType: options.declaredMimeType ?? PDF,
        declaredSizeBytes: content.byteLength,
        ...(options.existingDocumentId === undefined
          ? { companyId: options.companyId ?? world.companyA }
          : { existingDocumentId: options.existingDocumentId }),
      },
      idempotencyKey: randomUUID(),
      correlationId: CORRELATION(),
    });
    if (options.transfer !== false) {
      world.storage.put(
        {
          bucket: created.session.storageBucket,
          key: created.session.storageKey,
        },
        content,
      );
    }
    return {
      created,
      complete: () =>
        service.completeDocumentUploadSession({
          actor,
          uploadSessionId: created.session.id,
          input:
            options.clientSha256 === undefined
              ? {}
              : { clientSha256: options.clientSha256 },
          idempotencyKey: randomUUID(),
          correlationId: CORRELATION(),
        }),
    };
  }

  // -------------------------------------------------------------------------

  it("authorises one object, verifies what landed, and creates a quarantined version", async () => {
    await withWorld(async (world) => {
      const { created, complete } = await upload(world, world.adminA, {
        title: PRIVATE_TITLE,
        filename: PRIVATE_FILENAME,
      });

      // The server chose the identity; the client named neither bucket nor key.
      expect(created.session.storageBucket).toBe(DOCUMENT_STORAGE_BUCKET);
      expect(created.session.storageKey).toMatch(
        /^raw\/[0-9a-f-]{36}\/[0-9a-f]{32}$/,
      );
      expect(created.session.storageKey).not.toContain("PRIVATE");
      expect(created.session.status).toBe("AUTHORIZED");
      expect(created.upload?.method).toBe("PUT");
      expect(created.upload?.headers["x-upsert"]).toBe("false");
      // A document exists but has no version yet: nothing to mistake for content.
      expect(created.document.currentVersionId).toBeNull();

      const finished = await complete();
      expect(finished.session.status).toBe("COMPLETED");
      expect(finished.version.versionNumber).toBe(1);
      expect(finished.version.mimeType).toBe(PDF);
      expect(finished.version.sizeBytes).toBe(FIXTURES.pdf.byteLength);
      expect(finished.version.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(finished.document.currentVersionId).toBe(finished.version.id);

      // Uploaded is not scanned, parsed or safe.
      expect(finished.version.malwareScanStatus).toBe("PENDING");
      expect(finished.version.textExtractionStatus).toBe("NOT_STARTED");
      expect(finished.version.processingStatus).toBe("NOT_STARTED");

      // Neither the private title, the filename nor the storage key leaves
      // the context through events, audit or logs.
      const emitted = JSON.stringify([
        await world.events(),
        await world.audit(),
        world.logs.join("\n"),
      ]);
      expect(emitted).not.toContain(PRIVATE_TITLE);
      expect(emitted).not.toContain("PRIVATE-DOCUMENT-FILENAME");
      expect(emitted).not.toContain(created.session.storageKey);
      expect(emitted).not.toContain(finished.version.sha256);
    });
  });

  it("refuses an executable renamed as a PDF and deletes the bytes", async () => {
    await withWorld(async (world) => {
      const { created, complete } = await upload(world, world.adminA, {
        content: FIXTURES.windowsExecutable,
        filename: "invoice.pdf",
      });

      await expect(complete()).rejects.toMatchObject({
        name: "DocumentUploadRejectedError",
        failureCode: "ACTIVE_CONTENT_TYPE_NOT_ALLOWED",
      });

      const session = await world.service.getDocumentUploadSession({
        actor: world.adminA,
        uploadSessionId: created.session.id,
      });
      expect(session.status).toBe("REJECTED");
      expect(session.documentVersionId).toBeNull();
      expect(session.cleanupPending).toBe(false);
      expect(world.storage.deleted).toHaveLength(1);
      // No version was created for refused bytes.
      const versions = await world.service.listDocumentVersions({
        actor: world.adminA,
        documentId: created.document.id,
      });
      expect(versions).toHaveLength(0);
    });
  });

  it("refuses an archive wearing an Office name, and a macro-enabled package", async () => {
    await withWorld(async (world) => {
      const zip = await upload(world, world.adminA, {
        content: FIXTURES.plainZip,
        filename: "accounts.xlsx",
        declaredMimeType: XLSX,
      });
      await expect(zip.complete()).rejects.toMatchObject({
        failureCode: "ARCHIVE_NOT_ALLOWED",
      });

      const macro = await upload(world, world.adminA, {
        content: FIXTURES.docmWithMacro,
        filename: "notes.docx",
        declaredMimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      await expect(macro.complete()).rejects.toMatchObject({
        failureCode: "ACTIVE_CONTENT_TYPE_NOT_ALLOWED",
      });
    });
  });

  it("refuses bytes larger than the limit, an empty object and a missing one", async () => {
    await withWorld(async (world) => {
      // Declared small, actually large: the declaration is only a hint.
      const large = await upload(world, world.adminA, { transfer: false });
      world.storage.put(
        {
          bucket: large.created.session.storageBucket,
          key: large.created.session.storageKey,
        },
        new Uint8Array(LIMITS.maxBytes + 1),
      );
      await expect(large.complete()).rejects.toMatchObject({
        failureCode: "FILE_TOO_LARGE",
      });

      const missing = await upload(world, world.adminA, { transfer: false });
      await expect(missing.complete()).rejects.toMatchObject({
        failureCode: "OBJECT_MISSING",
      });

      const empty = await upload(world, world.adminA, { transfer: false });
      world.storage.put(
        {
          bucket: empty.created.session.storageBucket,
          key: empty.created.session.storageKey,
        },
        new Uint8Array(0),
      );
      await expect(empty.complete()).rejects.toMatchObject({
        failureCode: "FILE_EMPTY",
      });
    });
  });

  it("treats a client hash as a hint only, and refuses when it disagrees", async () => {
    await withWorld(async (world) => {
      const { complete } = await upload(world, world.adminA, {
        clientSha256: "f".repeat(64),
      });
      await expect(complete()).rejects.toMatchObject({
        failureCode: "STORAGE_VALIDATION_FAILED",
      });
    });
  });

  it("fails closed once the window has passed, whatever the provider token allows", async () => {
    await withWorld(async (world) => {
      const { created, complete } = await upload(world, world.adminA, {
        service: world.expiredService,
      });
      await expect(complete()).rejects.toMatchObject({
        failureCode: "UPLOAD_EXPIRED",
      });
      const session = await world.service.getDocumentUploadSession({
        actor: world.adminA,
        uploadSessionId: created.session.id,
      });
      expect(session.status).toBe("EXPIRED");
      expect(session.documentVersionId).toBeNull();
    });
  });

  it("records cleanup debt when refused bytes cannot be deleted", async () => {
    await withWorld(async (world) => {
      const { created, complete } = await upload(world, world.adminA, {
        content: FIXTURES.html,
        filename: "page.txt",
        declaredMimeType: "text/plain",
      });
      world.storage.deleteFails = true;
      await expect(complete()).rejects.toMatchObject({
        failureCode: "SIGNATURE_MISMATCH",
      });
      const session = await world.service.getDocumentUploadSession({
        actor: world.adminA,
        uploadSessionId: created.session.id,
      });
      // The refusal stands whether or not the object could be removed.
      expect(session.status).toBe("REJECTED");
      expect(session.cleanupPending).toBe(true);
    });
  });

  it("replays one idempotency key to the same session and refuses a different request", async () => {
    await withWorld(async (world) => {
      const key = randomUUID();
      const request = {
        title: "Pitch deck",
        documentType: "PITCH_DECK" as const,
        companyId: world.companyA,
        filename: "deck.pdf",
        declaredMimeType: PDF,
        declaredSizeBytes: FIXTURES.pdf.byteLength,
      };
      const first = await world.service.createDocumentUploadSession({
        actor: world.adminA,
        input: request,
        idempotencyKey: key,
        correlationId: CORRELATION(),
      });
      const replay = await world.service.createDocumentUploadSession({
        actor: world.adminA,
        input: request,
        idempotencyKey: key,
        correlationId: CORRELATION(),
      });

      // One session, one document, one storage object: a retry never doubles.
      expect(replay.session.id).toBe(first.session.id);
      expect(replay.document.id).toBe(first.document.id);
      expect(replay.session.storageKey).toBe(first.session.storageKey);

      await expect(
        world.service.createDocumentUploadSession({
          actor: world.adminA,
          input: { ...request, title: "Something else" },
          idempotencyKey: key,
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(DocumentUploadCreationConflictError);
    });
  });

  it("completes once even when finalization is retried", async () => {
    await withWorld(async (world) => {
      const { created, complete } = await upload(world, world.adminA);
      const first = await complete();
      const second = await complete();

      expect(second.version.id).toBe(first.version.id);
      const versions = await world.service.listDocumentVersions({
        actor: world.adminA,
        documentId: created.document.id,
      });
      expect(versions).toHaveLength(1);
    });
  });

  it("gives two uploads of one document sequential versions and one current pointer", async () => {
    await withWorld(async (world) => {
      const first = await upload(world, world.adminA);
      const one = await first.complete();

      const second = await upload(world, world.adminA, {
        existingDocumentId: one.document.id,
        content: FIXTURES.docx,
        filename: "notes.docx",
        declaredMimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
      const two = await second.complete();

      expect(two.version.versionNumber).toBe(2);
      expect(two.version.supersedesVersionId).toBe(one.version.id);
      expect(two.document.currentVersionId).toBe(two.version.id);
      // The first version remains; a new one never rewrites the old bytes.
      const versions = await world.service.listDocumentVersions({
        actor: world.adminA,
        documentId: one.document.id,
      });
      expect(versions.map((v) => v.versionNumber).sort()).toEqual([1, 2]);
      expect(versions[0]?.storageKey).not.toBe(versions[1]?.storageKey);
    });
  });

  it("keeps identical bytes in two tenants as two documents with separate ownership", async () => {
    await withWorld(async (world) => {
      const a = await upload(world, world.adminA);
      const b = await upload(world, world.adminB, {
        companyId: world.companyB,
      });
      const first = await a.complete();
      const second = await b.complete();

      expect(second.version.sha256).toBe(first.version.sha256);
      expect(second.document.id).not.toBe(first.document.id);
      expect(second.version.id).not.toBe(first.version.id);
      // Same hash, different object: one tenant's bytes are never another's.
      expect(second.version.storageKey).not.toBe(first.version.storageKey);

      // And the hash is not a key into the other tenant's documents.
      await expect(
        world.service.getDocument({
          actor: world.adminB,
          documentId: first.document.id,
        }),
      ).rejects.toBeInstanceOf(DocumentNotFoundError);
    });
  });

  it("hides another tenant's session and refuses to complete or cancel it", async () => {
    await withWorld(async (world) => {
      const { created } = await upload(world, world.adminA);

      for (const call of [
        () =>
          world.service.getDocumentUploadSession({
            actor: world.adminB,
            uploadSessionId: created.session.id,
          }),
        () =>
          world.service.completeDocumentUploadSession({
            actor: world.adminB,
            uploadSessionId: created.session.id,
            input: {},
            idempotencyKey: randomUUID(),
            correlationId: CORRELATION(),
          }),
        () =>
          world.service.cancelDocumentUploadSession({
            actor: world.adminB,
            uploadSessionId: created.session.id,
            correlationId: CORRELATION(),
          }),
      ]) {
        await expect(call()).rejects.toBeInstanceOf(
          DocumentUploadSessionNotFoundError,
        );
      }

      // A colleague in the same organisation is not the uploader either.
      await expect(
        world.service.completeDocumentUploadSession({
          actor: world.memberA,
          uploadSessionId: created.session.id,
          input: {},
          idempotencyKey: randomUUID(),
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(DocumentUploadSessionNotFoundError);
    });
  });

  it("refuses an upload aimed at a company the organisation does not own", async () => {
    await withWorld(async (world) => {
      await expect(
        world.service.createDocumentUploadSession({
          actor: world.adminA,
          input: {
            title: "Someone else's deck",
            documentType: "PITCH_DECK",
            // A real id, from another tenant.
            companyId: world.companyB,
            filename: "deck.pdf",
            declaredMimeType: PDF,
            declaredSizeBytes: 32,
          },
          idempotencyKey: randomUUID(),
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(DocumentNotFoundError);
      expect(world.storage.authorised).toHaveLength(0);
    });
  });

  it("lets a member create a document with its first version but not add versions to another's", async () => {
    await withWorld(async (world) => {
      // document.create covers a new document and the bytes that make it one.
      const own = await upload(world, world.memberA);
      const created = await own.complete();
      expect(created.version.versionNumber).toBe(1);

      // A further version of an existing document is document.manage, which
      // a member does not hold.
      await expect(
        world.service.createDocumentUploadSession({
          actor: world.memberA,
          input: {
            title: "Replacement",
            documentType: "PITCH_DECK",
            existingDocumentId: created.document.id,
            filename: "deck.pdf",
            declaredMimeType: PDF,
            declaredSizeBytes: 32,
          },
          idempotencyKey: randomUUID(),
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    });
  });

  it("cancels safely: the bytes go, the session closes and it cannot be completed", async () => {
    await withWorld(async (world) => {
      const { created, complete } = await upload(world, world.adminA);
      const cancelled = await world.service.cancelDocumentUploadSession({
        actor: world.adminA,
        uploadSessionId: created.session.id,
        correlationId: CORRELATION(),
      });
      expect(cancelled.status).toBe("CANCELLED");
      expect(world.storage.deleted).toHaveLength(1);
      await expect(complete()).rejects.toBeInstanceOf(DocumentUploadStateError);
    });
  });

  it("refuses at authorisation time what it would refuse later, before any object exists", async () => {
    await withWorld(async (world) => {
      for (const bad of [
        { filename: "payload.exe", declaredMimeType: PDF },
        { filename: "sheet.xlsm", declaredMimeType: XLSX },
        { filename: "archive.zip", declaredMimeType: "application/zip" },
        { filename: "page.html", declaredMimeType: "text/html" },
        { filename: "deck.pdf .exe", declaredMimeType: PDF },
      ]) {
        await expect(
          world.service.createDocumentUploadSession({
            actor: world.adminA,
            input: {
              title: "Nope",
              documentType: "OTHER",
              companyId: world.companyA,
              filename: bad.filename,
              declaredMimeType: bad.declaredMimeType,
              declaredSizeBytes: 128,
            },
            idempotencyKey: randomUUID(),
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(DocumentUploadRejectedError);
      }
      // Nothing was authorised, so no scoped write to storage was ever issued.
      expect(world.storage.authorised).toHaveLength(0);
    });
  });

  it("refuses to authorise more bytes than the limit before anything is transferred", async () => {
    await withWorld(async (world) => {
      await expect(
        world.service.createDocumentUploadSession({
          actor: world.adminA,
          input: {
            title: "Huge",
            documentType: "OTHER",
            companyId: world.companyA,
            filename: "deck.pdf",
            declaredMimeType: PDF,
            declaredSizeBytes: LIMITS.maxBytes + 1,
          },
          idempotencyKey: randomUUID(),
          correlationId: CORRELATION(),
        }),
      ).rejects.toMatchObject({ failureCode: "FILE_TOO_LARGE" });
    });
  });

  it("records a security event for content that disagreed with its claim, and none for an ordinary mistake", async () => {
    await withWorld(async (world) => {
      const hostile = await upload(world, world.adminA, {
        content: FIXTURES.windowsExecutable,
        filename: "deck.pdf",
      });
      await expect(hostile.complete()).rejects.toMatchObject({
        failureCode: "ACTIVE_CONTENT_TYPE_NOT_ALLOWED",
      });

      const events = await world.tx.sql<
        { event_type: string; metadata: Record<string, unknown> }[]
      >`select event_type, metadata from audit.security_events`;
      expect(events).toHaveLength(1);
      expect(events[0]?.event_type).toBe("document_upload_rejected");
      // Category and shape only: never the filename, the bytes or the key.
      expect(JSON.stringify(events[0]?.metadata)).toContain(
        "ACTIVE_CONTENT_TYPE_NOT_ALLOWED",
      );
      expect(JSON.stringify(events[0]?.metadata)).not.toContain("deck.pdf");

      // An oversized file is a user mistake, not a security signal.
      const oversize = await upload(world, world.adminA, { transfer: false });
      world.storage.put(
        {
          bucket: oversize.created.session.storageBucket,
          key: oversize.created.session.storageKey,
        },
        new Uint8Array(LIMITS.maxBytes + 1),
      );
      await expect(oversize.complete()).rejects.toMatchObject({
        failureCode: "FILE_TOO_LARGE",
      });
      const after = await world.tx.sql<
        { count: number }[]
      >`select count(*)::int as count from audit.security_events`;
      expect(after[0]?.count).toBe(1);
    });
  });

  it("leaves a malware-shaped file quarantined rather than calling it clean", async () => {
    await withWorld(async (world) => {
      // The upload boundary identifies containers; it does not scan. A
      // plain-text sample is admitted as text and its version stays PENDING,
      // because no scanner has run. Nothing here may report CLEAN.
      const { complete } = await upload(world, world.adminA, {
        content: FIXTURES.malwareShapedText,
        filename: "sample.txt",
        declaredMimeType: "text/plain",
      });
      const finished = await complete();
      expect(finished.version.malwareScanStatus).toBe("PENDING");
      expect(finished.version.textExtractionStatus).toBe("NOT_STARTED");
    });
  });

  it("leaves a cancelled upload's document with no current version", async () => {
    await withWorld(async (world) => {
      const { created } = await upload(world, world.adminA, {
        transfer: false,
      });
      await world.service.cancelDocumentUploadSession({
        actor: world.adminA,
        uploadSessionId: created.session.id,
        correlationId: CORRELATION(),
      });
      // The document exists but nothing about it can be mistaken for an
      // uploaded file: it has no current version and no versions at all.
      const document = await world.service.getDocumentWithVersion({
        actor: world.adminA,
        documentId: created.document.id,
      });
      expect(document.document.currentVersionId).toBeNull();
      expect(document.currentVersion).toBeNull();
      expect(
        await world.service.listDocumentVersions({
          actor: world.adminA,
          documentId: created.document.id,
        }),
      ).toHaveLength(0);
    });
  });

  it("never lets a completed session's object be written again", async () => {
    await withWorld(async (world) => {
      const { created, complete } = await upload(world, world.adminA);
      await complete();
      // The scoped target refuses to replace an object, exactly as the
      // provider does; replacement means a new session and a new identity.
      expect(() =>
        world.storage.put(
          {
            bucket: created.session.storageBucket,
            key: created.session.storageKey,
          },
          FIXTURES.docx,
        ),
      ).toThrow(/KeyAlreadyExists/);
    });
  });
});
