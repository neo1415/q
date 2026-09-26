import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
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
import {
  AuthUserIdSchema,
  createAuthorizationService,
  resolveHumanActorContext,
  TenantIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import {
  createPostgresActorContextResolver,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";

import {
  createCompanyMediaOwnerResolver,
  createMediaOwnerResolverRegistry,
  createMediaService,
  createPostgresCompanyPitchQueryPort,
  createPostgresDiscoverablePitchQueryPort,
  MediaAssetNotFoundError,
  MediaIdempotencyConflictError,
  MediaOwnerNotFoundError,
  MediaReplacementConflictError,
  MediaRuleError,
  MediaTransitionError,
  type MediaService,
} from "../src/index.js";
import { MEDIA_EVENTS } from "../src/events/index.js";

/**
 * Real local PostgreSQL (`pnpm db:start`), run with `pnpm test:integration`.
 * Every test runs in one rolled-back transaction with a savepoint-backed
 * TransactionManager. Two tenants, each with its own organisation and
 * company; every positive test has a cross-tenant or cross-organisation
 * negative twin.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;

/**
 * Deliberately shaped like something that must never leave the server: it
 * is written into provider integration metadata, and the tests then check
 * every outbound surface for it.
 */
const PRIVATE_MARKER = "PRIVATE-MEDIA-METADATA-DO-NOT-EMIT";

class Rollback extends Error {}

type World = {
  readonly tx: TransactionContext;
  readonly service: MediaService;
  readonly adminA: ActorContext;
  readonly memberA: ActorContext;
  readonly adminB: ActorContext;
  readonly tenantA: string;
  readonly companyA: string;
  readonly tenantB: string;
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

const registry = createEventRegistry([...MEDIA_EVENTS]);

describe("@capital-q/media against local PostgreSQL", () => {
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
      values (${id}, ${tenantId}, ${organisationId}, ${name}, ${`md-${id.slice(0, 8)}`})`;
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
    if (profile === undefined) {
      throw new Error("profile trigger did not run");
    }
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = ${roleCode}`;
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
    return { authUserId: AuthUserIdSchema.parse(authUserId) };
  }

  async function withWorld(
    work: (world: World) => Promise<void>,
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const { sql } = tx;
        const tenantA = await insertTenant(tx, "Media Tenant A");
        const tenantB = await insertTenant(tx, "Media Tenant B");
        const orgA = await insertOrganisation(
          tx,
          tenantA,
          "Org A",
          `md-org-a-${randomUUID().slice(0, 8)}`,
        );
        const orgB = await insertOrganisation(
          tx,
          tenantB,
          "Org B",
          `md-org-b-${randomUUID().slice(0, 8)}`,
        );
        const companyA = await insertCompany(tx, tenantA, orgA, "Company A");
        const companyB = await insertCompany(tx, tenantB, orgB, "Company B");
        const adminPrincipalA = await insertMember(
          tx,
          tenantA,
          orgA,
          "organisation_admin",
        );
        const memberPrincipalA = await insertMember(
          tx,
          tenantA,
          orgA,
          "organisation_member",
        );
        const adminPrincipalB = await insertMember(
          tx,
          tenantB,
          orgB,
          "organisation_admin",
        );

        const service = createMediaService({
          sql,
          transactions: nestedTransactions(tx),
          authorization: createAuthorizationService(
            createPostgresAuthorizationPolicySource({ sql }),
          ),
          owners: createMediaOwnerResolverRegistry([
            createCompanyMediaOwnerResolver(
              createPostgresCompanyQueryPort({ sql }),
            ),
          ]),
          outbox: createOutboxWriter({ registry }),
          audit: createPostgresMaterialActionAuditWriter(),
        });

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
          service,
          adminA: await resolve(adminPrincipalA),
          memberA: await resolve(memberPrincipalA),
          adminB: await resolve(adminPrincipalB),
          tenantA,
          companyA,
          tenantB,
          companyB,
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error: unknown) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  // Scoped to this world's tenants: the local database is shared, and media
  // events other work committed there are not this test's to count.
  const outboxTypes = async (world: World) => {
    const rows = await world.tx.sql<{ event_type: string }[]>`
      select event_type from events.outbox
       where event_type like 'media.%'
         and tenant_id in (${world.tenantA}, ${world.tenantB})
       order by id`;
    return rows.map((row) => row.event_type);
  };

  it("creates a pitch record that is honest about what happened", async () => {
    await withWorld(async (world) => {
      const { asset, replaced } = await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: {},
        correlationId: CORRELATION(),
      });

      // A record exists. A video does not, and nothing pretends otherwise.
      expect(asset.status).toBe("CREATED");
      expect(asset.provider).toBe("UNASSIGNED");
      expect(asset.providerAssetId).toBeNull();
      expect(asset.readyAt).toBeNull();
      // Conservative by construction: nobody can be shown this yet.
      expect(asset.playbackPolicy).toBe("PRIVATE");
      expect(asset.moderationStatus).toBe("NOT_REVIEWED");
      expect(asset.captionState).toBe("NOT_REQUESTED");
      expect(asset.transcriptState).toBe("NOT_REQUESTED");
      expect(asset.ownerType).toBe("COMPANY");
      expect(asset.ownerId).toBe(world.companyA);
      expect(replaced).toBeNull();

      expect(await outboxTypes(world)).toEqual(["media.asset.created"]);
    });
  });

  it("keeps one current pitch and refuses a silent second one", async () => {
    await withWorld(async (world) => {
      await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: {},
        correlationId: CORRELATION(),
      });
      await expect(
        world.service.createCompanyPitch({
          actor: world.adminA,
          companyId: world.companyA,
          input: {},
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(MediaReplacementConflictError);
    });
  });

  it("replaces a pitch by creating a new asset and keeping the old one", async () => {
    await withWorld(async (world) => {
      const first = await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: {},
        correlationId: CORRELATION(),
      });
      const second = await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: { replacesMediaAssetId: first.asset.id },
        correlationId: CORRELATION(),
      });

      expect(second.asset.id).not.toBe(first.asset.id);
      expect(second.asset.replacesMediaAssetId).toBe(first.asset.id);
      expect(second.replaced?.id).toBe(first.asset.id);

      const history = await world.service.listCompanyMedia({
        actor: world.adminA,
        companyId: world.companyA,
      });
      // The old pitch is still there. Replacement is lineage, not erasure.
      expect(history).toHaveLength(2);

      const current = await world.service.getCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
      });
      expect(current?.id).toBe(second.asset.id);
      expect(await outboxTypes(world)).toEqual([
        "media.asset.created",
        "media.asset.replaced",
      ]);
    });
  });

  it("answers a retried replacement with the same asset and refuses a reused key (VID)", async () => {
    await withWorld(async (world) => {
      const first = await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: {},
        idempotencyKey: `vid-create-${randomUUID()}`,
        correlationId: CORRELATION(),
      });
      const key = `vid-replace-${randomUUID()}`;
      const replace = () =>
        world.service.createCompanyPitch({
          actor: world.adminA,
          companyId: world.companyA,
          input: { replacesMediaAssetId: first.asset.id },
          idempotencyKey: key,
          correlationId: CORRELATION(),
        });
      const second = await replace();
      const retried = await replace();
      expect(second.replayed).toBe(false);
      expect(retried.replayed).toBe(true);
      expect(retried.asset.id).toBe(second.asset.id);
      expect(retried.replaced?.id).toBe(first.asset.id);
      expect(await outboxTypes(world)).toEqual([
        "media.asset.created",
        "media.asset.replaced",
      ]);

      // The same key for a different request is refused, not replayed.
      await expect(
        world.service.createCompanyPitch({
          actor: world.adminA,
          companyId: world.companyA,
          input: {},
          idempotencyKey: key,
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(MediaIdempotencyConflictError);

      // Another tenant's administrator cannot reach it with the same key.
      await expect(
        world.service.createCompanyPitch({
          actor: world.adminB,
          companyId: world.companyA,
          input: { replacesMediaAssetId: first.asset.id },
          idempotencyKey: key,
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(MediaOwnerNotFoundError);

      const rows = await world.tx.sql`
        select count(*)::int as n from media.pitch_requests
         where media_asset_id in (${first.asset.id}, ${second.asset.id})`;
      expect(rows[0]?.["n"]).toBe(2);
    });
  });

  it("refuses a replacement that names a pitch which is no longer current", async () => {
    await withWorld(async (world) => {
      const first = await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: {},
        correlationId: CORRELATION(),
      });
      await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: { replacesMediaAssetId: first.asset.id },
        correlationId: CORRELATION(),
      });

      // The second caller read the world before the first replacement
      // committed. Refused, rather than resolved into two current pitches.
      await expect(
        world.service.createCompanyPitch({
          actor: world.adminA,
          companyId: world.companyA,
          input: { replacesMediaAssetId: first.asset.id },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(MediaReplacementConflictError);

      const history = await world.service.listCompanyMedia({
        actor: world.adminA,
        companyId: world.companyA,
      });
      expect(
        history.filter(
          (asset) => asset.supersededAt === null && asset.deletedAt === null,
        ),
      ).toHaveLength(1);
    });
  });

  it("resolves the delete-then-replace race to one coherent state", async () => {
    await withWorld(async (world) => {
      const first = await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: {},
        correlationId: CORRELATION(),
      });
      await world.service.deleteCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        mediaAssetId: first.asset.id,
        correlationId: CORRELATION(),
      });

      // The pitch the replacement names is gone, so the replacement is
      // refused rather than resurrecting it as a predecessor.
      await expect(
        world.service.createCompanyPitch({
          actor: world.adminA,
          companyId: world.companyA,
          input: { replacesMediaAssetId: first.asset.id },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(MediaReplacementConflictError);

      // And a fresh pitch is allowed, because the company now has none.
      const fresh = await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: {},
        correlationId: CORRELATION(),
      });
      expect(fresh.replaced).toBeNull();
      const current = await world.service.getCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
      });
      expect(current?.id).toBe(fresh.asset.id);
    });
  });

  it("soft-deletes, keeps the history, and does not re-announce a second delete", async () => {
    await withWorld(async (world) => {
      const created = await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: {},
        correlationId: CORRELATION(),
      });
      const deleted = await world.service.deleteCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        mediaAssetId: created.asset.id,
        correlationId: CORRELATION(),
      });
      expect(deleted.status).toBe("DELETED");
      expect(deleted.deletedAt).not.toBeNull();

      const again = await world.service.deleteCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        mediaAssetId: created.asset.id,
        correlationId: CORRELATION(),
      });
      expect(again.status).toBe("DELETED");

      // The row survives deletion; only one deletion was announced.
      const history = await world.service.listCompanyMedia({
        actor: world.adminA,
        companyId: world.companyA,
      });
      expect(history).toHaveLength(1);
      expect(await outboxTypes(world)).toEqual([
        "media.asset.created",
        "media.asset.deleted",
      ]);
    });
  });

  it("lets a member publish and replace, but not delete", async () => {
    await withWorld(async (world) => {
      const created = await world.service.createCompanyPitch({
        actor: world.memberA,
        companyId: world.companyA,
        input: {},
        correlationId: CORRELATION(),
      });
      expect(created.asset.createdByUserId).toBe(world.memberA.userId);

      // Removing a pitch is consequential and stays with administrators.
      await expect(
        world.service.deleteCompanyPitch({
          actor: world.memberA,
          companyId: world.companyA,
          mediaAssetId: created.asset.id,
          correlationId: CORRELATION(),
        }),
      ).rejects.toThrowError();
    });
  });

  it("refuses another tenant's company, whether creating or reading", async () => {
    await withWorld(async (world) => {
      // A valid company id from another tenant is indistinguishable from a
      // typo: the same "not found", before any authorization detail.
      await expect(
        world.service.createCompanyPitch({
          actor: world.adminA,
          companyId: world.companyB,
          input: {},
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(MediaOwnerNotFoundError);
      await expect(
        world.service.getCompanyPitch({
          actor: world.adminA,
          companyId: world.companyB,
        }),
      ).rejects.toBeInstanceOf(MediaOwnerNotFoundError);

      const theirs = await world.service.createCompanyPitch({
        actor: world.adminB,
        companyId: world.companyB,
        input: {},
        correlationId: CORRELATION(),
      });
      await expect(
        world.service.deleteCompanyPitch({
          actor: world.adminA,
          companyId: world.companyB,
          mediaAssetId: theirs.asset.id,
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(MediaOwnerNotFoundError);
    });
  });

  it("refuses to delete an asset that belongs to another company", async () => {
    await withWorld(async (world) => {
      const mine = await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: {},
        correlationId: CORRELATION(),
      });
      const otherCompany = await insertCompany(
        world.tx,
        world.tenantA,
        world.adminA.organisationId ?? "",
        "Company A2",
      );
      await expect(
        world.service.deleteCompanyPitch({
          actor: world.adminA,
          companyId: otherCompany,
          mediaAssetId: mine.asset.id,
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(MediaAssetNotFoundError);
    });
  });

  it("moves through the lifecycle only in legal steps, and never backwards", async () => {
    await withWorld(async (world) => {
      const { asset } = await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: {},
        correlationId: CORRELATION(),
      });
      const move = (
        status: Parameters<MediaService["transitionMediaStatus"]>[0]["status"],
      ) =>
        world.service.transitionMediaStatus({
          tenantId: world.tenantA,
          mediaAssetId: asset.id,
          status,
        });

      await move("UPLOAD_PENDING");
      await move("UPLOADING");
      await move("PROCESSING");
      const ready = await move("READY");
      expect(ready.status).toBe("READY");
      expect(ready.readyAt).not.toBeNull();

      // The late webhook. It changes nothing.
      await expect(move("PROCESSING")).rejects.toBeInstanceOf(
        MediaTransitionError,
      );
      const stillReady = await world.service.getCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
      });
      expect(stillReady?.status).toBe("READY");

      await move("DELETED");
      // And a deleted asset stays deleted, whatever arrives afterwards.
      await expect(move("READY")).rejects.toBeInstanceOf(MediaTransitionError);
      const afterDelete = await world.service.listCompanyMedia({
        actor: world.adminA,
        companyId: world.companyA,
      });
      expect(afterDelete[0]?.status).toBe("DELETED");
    });
  });

  it("refuses a stale writer even when the move itself is legal", async () => {
    await withWorld(async (world) => {
      const { asset } = await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: {},
        correlationId: CORRELATION(),
      });
      await world.service.transitionMediaStatus({
        tenantId: world.tenantA,
        mediaAssetId: asset.id,
        status: "UPLOAD_PENDING",
      });
      await expect(
        world.service.transitionMediaStatus({
          tenantId: world.tenantA,
          mediaAssetId: asset.id,
          status: "UPLOADING",
          expectedVersion: asset.version,
        }),
      ).rejects.toThrowError();
    });
  });

  it("attaches provider metadata once, and never to a deleted asset", async () => {
    await withWorld(async (world) => {
      const { asset } = await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: {},
        correlationId: CORRELATION(),
      });
      const attached = await world.service.attachProviderAsset({
        tenantId: world.tenantA,
        mediaAssetId: asset.id,
        provider: "CLOUDFLARE_STREAM",
        providerAssetId: PRIVATE_MARKER,
      });
      expect(attached.providerAssetId).toBe(PRIVATE_MARKER);

      // Re-pointing would orphan bytes and break the link to history.
      await expect(
        world.service.attachProviderAsset({
          tenantId: world.tenantA,
          mediaAssetId: asset.id,
          provider: "CLOUDFLARE_STREAM",
          providerAssetId: "second-uid",
        }),
      ).rejects.toBeInstanceOf(MediaRuleError);

      const withMetadata = await world.service.recordProviderMetadata({
        tenantId: world.tenantA,
        mediaAssetId: asset.id,
        metadata: {
          durationSeconds: 96,
          width: 1080,
          height: 1920,
          aspectRatio: "9:16",
          thumbnailReference: PRIVATE_MARKER,
        },
      });
      expect(withMetadata.durationSeconds).toBe(96);
      expect(withMetadata.aspectRatio).toBe("9:16");
    });
  });

  it("keeps provider metadata out of events and audit", async () => {
    await withWorld(async (world) => {
      const { asset } = await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: {},
        correlationId: CORRELATION(),
      });
      await world.service.attachProviderAsset({
        tenantId: world.tenantA,
        mediaAssetId: asset.id,
        provider: "CLOUDFLARE_STREAM",
        providerAssetId: PRIVATE_MARKER,
      });
      await world.service.recordProviderMetadata({
        tenantId: world.tenantA,
        mediaAssetId: asset.id,
        metadata: { thumbnailReference: PRIVATE_MARKER },
      });
      await world.service.deleteCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        mediaAssetId: asset.id,
        correlationId: CORRELATION(),
      });

      const events = await world.tx.sql<
        { payload: unknown }[]
      >`select to_jsonb(o.*) as payload from events.outbox o`;
      const audits = await world.tx.sql<
        { payload: unknown }[]
      >`select to_jsonb(a.*) as payload from audit.material_actions a`;
      const serialised = JSON.stringify([events, audits]);
      expect(serialised).not.toContain(PRIVATE_MARKER);
      // What is recorded is the identifiers and the coded states.
      expect(serialised).toContain("media.asset.deleted");
    });
  });

  it("applies verified provider reports idempotently, as the platform, through the outbox (CQ-MEDIA-012)", async () => {
    await withWorld(async (world) => {
      const uid = `wh${randomUUID().replace(/-/g, "")}`;
      const { asset } = await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: {},
        correlationId: CORRELATION(),
      });
      await world.service.attachProviderAsset({
        tenantId: world.tenantA,
        mediaAssetId: asset.id,
        provider: "CLOUDFLARE_STREAM",
        providerAssetId: uid,
      });
      await world.service.transitionMediaStatus({
        tenantId: world.tenantA,
        mediaAssetId: asset.id,
        status: "UPLOAD_PENDING",
      });
      // A pitch in the other tenant that no report names: it must not move.
      const other = await world.service.createCompanyPitch({
        actor: world.adminB,
        companyId: world.companyB,
        input: {},
        correlationId: CORRELATION(),
      });

      const apply = (
        report: Parameters<
          MediaService["applyProviderStatusReport"]
        >[0]["report"],
      ) =>
        world.service.applyProviderStatusReport({
          provider: "CLOUDFLARE_STREAM",
          report,
          mediaAssetId: asset.id,
          correlationId: CORRELATION(),
        });
      const ready = {
        providerAssetId: uid,
        status: "READY" as const,
        durationSeconds: 87,
        width: 1080,
        height: 1920,
        thumbnailReference: `${uid}/thumbnails/thumbnail.jpg`,
      };

      expect(await apply(ready)).toMatchObject({
        kind: "APPLIED",
        status: "READY",
        appliedTransitions: ["UPLOADING", "PROCESSING", "READY"],
      });
      // Duplicate, out-of-order, and failure-after-READY deliveries.
      expect(await apply(ready)).toMatchObject({
        kind: "UNCHANGED",
        stale: false,
      });
      expect(
        await apply({ providerAssetId: uid, status: "PROCESSING" }),
      ).toMatchObject({ kind: "UNCHANGED", stale: true });
      expect(
        await apply({
          providerAssetId: uid,
          status: "PROCESSING_FAILED",
          providerErrorCode: "ERR_MALFORMED_VIDEO",
        }),
      ).toMatchObject({ kind: "UNCHANGED", status: "READY" });
      expect(
        await world.service.applyProviderStatusReport({
          provider: "CLOUDFLARE_STREAM",
          report: { ...ready, providerAssetId: `${uid}x` },
          correlationId: CORRELATION(),
        }),
      ).toEqual({ kind: "UNKNOWN_ASSET" });

      const [row] = await world.tx.sql<
        {
          status: string;
          ready_at: Date | null;
          aspect_ratio: string | null;
          duration_seconds: number | null;
        }[]
      >`select status, ready_at, aspect_ratio, duration_seconds
          from media.media_assets where id = ${asset.id}`;
      expect(row).toMatchObject({
        status: "READY",
        aspect_ratio: "9:16",
        duration_seconds: 87,
      });
      expect(row?.ready_at).not.toBeNull();
      const [untouched] = await world.tx.sql<
        { status: string }[]
      >`select status from media.media_assets where id = ${other.asset.id}`;
      expect(untouched?.status).toBe("CREATED");

      // One event per step, once; attributed to the platform; no uid.
      const events = await world.tx.sql<
        { payload: { actor: { type: string }; data: { status: string } } }[]
      >`select payload from events.outbox
         where event_type = 'media.asset.status_changed'
           and payload->'aggregate'->>'id' = ${asset.id}
         order by id`;
      expect(events.map((e) => e.payload.data.status)).toEqual([
        "UPLOADING",
        "PROCESSING",
        "READY",
      ]);
      for (const event of events) {
        expect(event.payload.actor.type).toBe("SYSTEM");
      }
      const audits = await world.tx.sql<
        { actor_type: string }[]
      >`select actor_type from audit.material_actions
         where action_type = 'media.asset.provider_status_applied'
           and resource_id = ${asset.id}`;
      expect(audits).toHaveLength(1);
      expect(audits[0]?.actor_type).toBe("capital_q_system");
      const outboxRows = await world.tx.sql<
        { payload: unknown }[]
      >`select to_jsonb(o.*) as payload from events.outbox o`;
      expect(JSON.stringify(outboxRows)).not.toContain(uid);
    });
  });

  it("answers the current-pitch query port without scanning history", async () => {
    await withWorld(async (world) => {
      const port = createPostgresCompanyPitchQueryPort({ sql: world.tx.sql });
      expect(
        await port.getCurrentPitchForCompany(
          TenantIdSchema.parse(world.tenantA),
          world.companyA,
        ),
      ).toBeNull();

      const first = await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: {},
        correlationId: CORRELATION(),
      });
      const second = await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: { replacesMediaAssetId: first.asset.id },
        correlationId: CORRELATION(),
      });

      const pitch = await port.getCurrentPitchForCompany(
        TenantIdSchema.parse(world.tenantA),
        world.companyA,
      );
      expect(pitch?.mediaAssetId).toBe(second.asset.id);
      expect(pitch?.companyId).toBe(world.companyA);
      // The projection is deliberately thin: no provider identity, no
      // storage reference, nothing that could be mistaken for quality.
      expect(Object.keys(pitch ?? {})).not.toContain("providerAssetId");

      // Another tenant asking for the same company id gets nothing.
      expect(
        await port.getCurrentPitchForCompany(
          TenantIdSchema.parse(world.tenantB),
          world.companyA,
        ),
      ).toBeNull();
    });
  });

  // CQ-MEDIA-012: the feed's batched read. One query for many companies
  // across tenants, and only what is publishable comes back.
  it("answers the feed's batched pitch read with publishable pitches only, across tenants", async () => {
    await withWorld(async (world) => {
      const port = createPostgresDiscoverablePitchQueryPort({
        sql: world.tx.sql,
      });
      expect(
        (await port.findDiscoverablePitches([world.companyA, world.companyB]))
          .size,
      ).toBe(0);

      const LIFECYCLE = [
        "UPLOAD_PENDING",
        "UPLOADING",
        "PROCESSING",
        "READY",
      ] as const;

      // Company A: a READY, ALLOWED, AUTHORISED pitch — publishable.
      const a = await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: {},
        correlationId: CORRELATION(),
      });
      await world.service.attachProviderAsset({
        tenantId: world.tenantA,
        mediaAssetId: a.asset.id,
        provider: "CLOUDFLARE_STREAM",
        providerAssetId: PRIVATE_MARKER,
      });
      for (const status of LIFECYCLE) {
        await world.service.transitionMediaStatus({
          tenantId: world.tenantA,
          mediaAssetId: a.asset.id,
          status,
        });
      }
      await world.service.recordProviderMetadata({
        tenantId: world.tenantA,
        mediaAssetId: a.asset.id,
        metadata: { durationSeconds: 87, aspectRatio: "9:16" },
      });
      await world.service.setMediaStates({
        tenantId: world.tenantA,
        mediaAssetId: a.asset.id,
        moderationStatus: "ALLOWED",
        playbackPolicy: "AUTHORISED",
      });

      // Company B, in the other tenant: READY but still PRIVATE and
      // unreviewed — not publishable, so absent.
      const b = await world.service.createCompanyPitch({
        actor: world.adminB,
        companyId: world.companyB,
        input: {},
        correlationId: CORRELATION(),
      });
      await world.service.attachProviderAsset({
        tenantId: world.tenantB,
        mediaAssetId: b.asset.id,
        provider: "CLOUDFLARE_STREAM",
        providerAssetId: `${PRIVATE_MARKER}-b`,
      });
      for (const status of LIFECYCLE) {
        await world.service.transitionMediaStatus({
          tenantId: world.tenantB,
          mediaAssetId: b.asset.id,
          status,
        });
      }

      const pitches = await port.findDiscoverablePitches([
        world.companyA,
        world.companyB,
        randomUUID(),
      ]);
      expect([...pitches.keys()]).toEqual([world.companyA]);
      expect(pitches.get(world.companyA)).toEqual({
        mediaAssetId: a.asset.id,
        companyId: world.companyA,
        aspectRatio: "9:16",
        durationSeconds: 87,
        captionState: "NOT_REQUESTED",
      });
      expect(JSON.stringify([...pitches.values()])).not.toContain(
        PRIVATE_MARKER,
      );

      // Once B is allowed and widened it appears too — cross-tenant, one
      // query, nothing about either tenant in the ask.
      await world.service.setMediaStates({
        tenantId: world.tenantB,
        mediaAssetId: b.asset.id,
        moderationStatus: "ALLOWED",
        playbackPolicy: "AUTHORISED",
      });
      expect(
        [
          ...(
            await port.findDiscoverablePitches([world.companyA, world.companyB])
          ).keys(),
        ].sort(),
      ).toEqual([world.companyA, world.companyB].sort());

      // Replacing A's pitch supersedes it: the CREATED successor is not
      // publishable, so A drops out rather than showing a stale pitch.
      await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: { replacesMediaAssetId: a.asset.id },
        correlationId: CORRELATION(),
      });
      expect(
        (await port.findDiscoverablePitches([world.companyA])).has(
          world.companyA,
        ),
      ).toBe(false);

      await expect(
        port.findDiscoverablePitches(
          Array.from({ length: 201 }, () => randomUUID()),
        ),
      ).rejects.toBeInstanceOf(RangeError);
    });
  });

  it("uses an index for the current-pitch lookup", async () => {
    await withWorld(async (world) => {
      const first = await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: {},
        correlationId: CORRELATION(),
      });
      await world.service.createCompanyPitch({
        actor: world.adminA,
        companyId: world.companyA,
        input: { replacesMediaAssetId: first.asset.id },
        correlationId: CORRELATION(),
      });

      // A handful of rows in a test transaction is always cheapest to scan,
      // so the planner is asked what it would do if it had to choose an
      // index: the property under test is that one covers this exact
      // predicate, not that a two-row table uses it.
      await world.tx.sql`set local enable_seqscan = off`;
      const plan = await world.tx.sql<{ "QUERY PLAN": string }[]>`
        explain select m.id
          from media.media_assets m
         where m.tenant_id = ${world.tenantA}
           and m.owner_type = 'COMPANY'
           and m.owner_id = ${world.companyA}
           and m.purpose = 'FOUNDER_PITCH'
           and m.deleted_at is null
           and m.superseded_at is null`;
      const text = plan.map((row) => row["QUERY PLAN"]).join("\n");
      // A company's pitch history is never scanned to find the current one.
      expect(text).toContain("media_assets_current_pitch_idx");
    });
  });
});
