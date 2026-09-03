import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createEventRegistry,
  type CorrelationId,
  type CreateCompanyRequest,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createOutboxWriter, type OutboxWriter } from "@capital-q/eventing";
import { createPostgresOrganisationQueryPort } from "@capital-q/organisations";
import {
  AuthorizationDeniedError,
  AuthUserIdSchema,
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
  CompanyCreationConflictError,
  CompanyIdSchema,
  CompanyNotFoundError,
  CompanyVersionConflictError,
  createCompanyService,
  createPostgresCompanyQueryPort,
  type CompanyService,
} from "../src/index.js";
import { COMPANY_EVENTS } from "../src/events/index.js";

/**
 * Real local PostgreSQL (`pnpm db:start`), run with `pnpm test:integration`.
 * Every test runs in one rolled-back transaction with a savepoint-backed
 * TransactionManager, so a failing use case rolls back its own savepoint
 * and the assertions observe exactly what would have been committed.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;

class Rollback extends Error {}

type World = {
  readonly tx: TransactionContext;
  readonly service: CompanyService;
  readonly adminA: ActorContext;
  readonly memberA: ActorContext;
  readonly adminB: ActorContext;
  readonly tenantA: string;
  readonly orgA: string;
  readonly tenantB: string;
  readonly orgB: string;
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

const registry = createEventRegistry([...COMPANY_EVENTS]);

describe("@capital-q/companies against local PostgreSQL", () => {
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
    options: {
      readonly outbox?: ((real: OutboxWriter) => OutboxWriter) | undefined;
    } = {},
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const { sql } = tx;
        // Two tenants, two organisations; A has an admin and an ordinary
        // member, B has an admin. Memberships carry role templates only.
        const tenantA = await insertTenant(tx, "Company Tenant A");
        const tenantB = await insertTenant(tx, "Company Tenant B");
        const orgA = await insertOrganisation(tx, tenantA, "Org A", "org-a");
        const orgB = await insertOrganisation(tx, tenantB, "Org B", "org-b");
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

        const transactions = nestedTransactions(tx);
        const realOutbox = createOutboxWriter({ registry });
        const service = createCompanyService({
          sql,
          transactions,
          authorization: createAuthorizationService(
            createPostgresAuthorizationPolicySource({ sql }),
          ),
          organisations: createPostgresOrganisationQueryPort({ sql }),
          outbox:
            options.outbox === undefined
              ? realOutbox
              : options.outbox(realOutbox),
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
          adminA: await resolve(adminA),
          memberA: await resolve(memberA),
          adminB: await resolve(adminB),
          tenantA,
          orgA,
          tenantB,
          orgB,
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) {
        throw error;
      }
    }
    expect(completed).toBe(true);
  }

  async function insertTenant(
    tx: TransactionContext,
    name: string,
  ): Promise<string> {
    const id = randomUUID();
    await tx.sql`insert into identity.tenants (id, name) values (${id}, ${name})`;
    return id;
  }

  async function insertOrganisation(
    tx: TransactionContext,
    tenantId: string,
    name: string,
    slug: string,
  ): Promise<string> {
    const id = randomUUID();
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${id}, ${tenantId}, 'company', ${name}, ${slug})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${id})`;
    return id;
  }

  /** A person with an active membership, a role template and a persisted active context. */
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

  function request(
    canonicalName: string,
    overrides: Partial<CreateCompanyRequest> = {},
  ): CreateCompanyRequest {
    return { canonicalName, ...overrides };
  }

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------

  it("an organisation admin creates the canonical company with safe defaults, audit and event", async () => {
    await withWorld(async ({ tx, service, adminA, tenantA, orgA }) => {
      const correlationId = CORRELATION();
      const company = await service.createCompany({
        actor: adminA,
        input: request("NexaRail Technologies", {
          websiteUrl: "https://nexarail.example",
          foundedDate: "2021-03-15",
          headquartersCountry: "GB",
          headquartersCity: "London",
          currentStageCode: "seed",
          shortDescription: "Predictive maintenance for rail operators.",
        }),
        idempotencyKey: "company-key-0001",
        correlationId,
      });

      expect(company.id).not.toBe(orgA);
      expect(company.id).not.toBe(tenantA);
      expect(company.tenantId).toBe(tenantA);
      expect(company.organisationId).toBe(orgA);
      expect(company.slug).toBe("nexarail-technologies");
      expect(company.version).toBe(1);
      expect(company.companyStatus).toBe("active");
      expect(company.marketplaceVisibility).toBe("organisation_private");
      expect(company.marketplaceReadinessState).toBe("not_assessed");
      expect(company.foundedDate).toBe("2021-03-15");
      expect(company.legalName).toBeNull();
      expect(company.logoStorageKey).toBeNull();

      const { sql } = tx;
      const audits = await sql<
        {
          action_type: string;
          actor_id: string;
          tenant_id: string;
          organisation_id: string;
          resource_type: string;
          resource_id: string;
          metadata: unknown;
        }[]
      >`
        select action_type, actor_id, tenant_id, organisation_id, resource_type, resource_id, metadata
          from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`;
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action_type: "company.created",
        actor_id: adminA.userId,
        tenant_id: tenantA,
        organisation_id: orgA,
        resource_type: "company",
        resource_id: company.id,
        metadata: { slug: "nexarail-technologies" },
      });
      expect(JSON.stringify(audits[0]?.metadata)).not.toContain("Predictive");

      const events = await sql<
        {
          event_type: string;
          tenant_id: string;
          payload: { data: unknown; aggregate: unknown };
        }[]
      >`
        select event_type, tenant_id, payload from events.outbox where payload ->> 'correlationId' = ${correlationId}`;
      expect(events).toHaveLength(1);
      expect(events[0]?.event_type).toBe("core.company.created");
      expect(events[0]?.tenant_id).toBe(tenantA);
      expect(events[0]?.payload.data).toEqual({
        companyId: company.id,
        organisationId: orgA,
        version: 1,
      });
      expect(events[0]?.payload.aggregate).toEqual({
        type: "company",
        id: company.id,
        version: 1,
      });

      // Nothing beyond the company: no members, no capital objective, no
      // evidence tables exist to be written.
      const tables = await sql<{ table_name: string }[]>`
        select table_name from information_schema.tables where table_schema = 'core' order by 1`;
      expect(tables.map((t) => t.table_name)).toEqual([
        "companies",
        "company_creation_requests",
      ]);

      // The query port answers the identity for the right tenant only.
      const port = createPostgresCompanyQueryPort({ sql });
      await expect(
        port.getCanonicalCompany(adminA.tenantId, company.id),
      ).resolves.toMatchObject({
        id: company.id,
        organisationId: orgA,
        companyStatus: "active",
      });
    });
  });

  it("requires company.create: an ordinary member is denied and nothing is written", async () => {
    await withWorld(async ({ tx, service, memberA }) => {
      await expect(
        service.createCompany({
          actor: memberA,
          input: request("Member Co"),
          idempotencyKey: "company-key-member",
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      const [count] = await tx.sql<
        { count: number }[]
      >`select count(*)::int as count from core.companies where canonical_name = 'Member Co'`;
      expect(count?.count).toBe(0);
    });
  });

  it("is retry-safe: same key and request return the same company; a different request conflicts", async () => {
    await withWorld(async ({ tx, service, adminA }) => {
      const input = request("Retry Co", { headquartersCountry: "GB" });
      const first = await service.createCompany({
        actor: adminA,
        input,
        idempotencyKey: "company-retry",
        correlationId: CORRELATION(),
      });
      const second = await service.createCompany({
        actor: adminA,
        input: { ...input },
        idempotencyKey: "company-retry",
        correlationId: CORRELATION(),
      });
      expect(second.id).toBe(first.id);
      await expect(
        service.createCompany({
          actor: adminA,
          input: request("Retry Co", { headquartersCountry: "FR" }),
          idempotencyKey: "company-retry",
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(CompanyCreationConflictError);
      const [count] = await tx.sql<
        { count: number }[]
      >`select count(*)::int as count from core.companies where canonical_name = 'Retry Co'`;
      expect(count?.count).toBe(1);
      const [events] = await tx.sql<
        { count: number }[]
      >`select count(*)::int as count from events.outbox where event_type = 'core.company.created' and payload -> 'data' ->> 'companyId' = ${first.id}`;
      expect(events?.count).toBe(1);
    });
  });

  it("allocates deterministic slug suffixes within a tenant and keeps the slug on rename", async () => {
    await withWorld(async ({ service, adminA }) => {
      const one = await service.createCompany({
        actor: adminA,
        input: request("Acme"),
        idempotencyKey: "slug-1",
        correlationId: CORRELATION(),
      });
      const two = await service.createCompany({
        actor: adminA,
        input: request("ACME!"),
        idempotencyKey: "slug-2",
        correlationId: CORRELATION(),
      });
      const three = await service.createCompany({
        actor: adminA,
        input: request("acme"),
        idempotencyKey: "slug-3",
        correlationId: CORRELATION(),
      });
      expect([one.slug, two.slug, three.slug]).toEqual([
        "acme",
        "acme-2",
        "acme-3",
      ]);

      const renamed = await service.updateCompany({
        actor: adminA,
        companyId: one.id,
        input: { expectedVersion: 1, canonicalName: "Acme Robotics" },
        correlationId: CORRELATION(),
      });
      expect(renamed.canonicalName).toBe("Acme Robotics");
      expect(renamed.slug).toBe("acme");
    });
  });

  it("rolls back the company, audit and idempotency record when the event cannot be enqueued", async () => {
    await withWorld(
      async ({ tx, service, adminA }) => {
        const correlationId = CORRELATION();
        await expect(
          service.createCompany({
            actor: adminA,
            input: request("Doomed Co"),
            idempotencyKey: "doomed",
            correlationId,
          }),
        ).rejects.toThrow("outbox unavailable");
        const { sql } = tx;
        const count = async (query: Promise<{ count: number }[]>) =>
          (await query)[0]?.count;
        expect(
          await count(
            sql`select count(*)::int as count from core.companies where canonical_name = 'Doomed Co'`,
          ),
        ).toBe(0);
        expect(
          await count(
            sql`select count(*)::int as count from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`,
          ),
        ).toBe(0);
        expect(
          await count(
            sql`select count(*)::int as count from events.outbox where payload ->> 'correlationId' = ${correlationId}`,
          ),
        ).toBe(0);
        expect(
          await count(
            sql`select count(*)::int as count from core.company_creation_requests where user_id = ${adminA.userId}`,
          ),
        ).toBe(0);
      },
      {
        outbox: () => ({
          enqueue: () => Promise.reject(new Error("outbox unavailable")),
        }),
      },
    );
  });

  // -------------------------------------------------------------------------
  // Reading and updating
  // -------------------------------------------------------------------------

  it("members read with company.view; a valid foreign id is not found; anonymous-like contexts learn nothing", async () => {
    await withWorld(async ({ service, adminA, memberA, adminB }) => {
      const a = await service.createCompany({
        actor: adminA,
        input: request("Read A"),
        idempotencyKey: "read-a",
        correlationId: CORRELATION(),
      });
      const b = await service.createCompany({
        actor: adminB,
        input: request("Read B"),
        idempotencyKey: "read-b",
        correlationId: CORRELATION(),
      });

      await expect(
        service.getCompany({ actor: memberA, companyId: a.id }),
      ).resolves.toMatchObject({ id: a.id });
      await expect(
        service.getCompany({ actor: adminA, companyId: b.id }),
      ).rejects.toBeInstanceOf(CompanyNotFoundError);
      await expect(
        service.getCompany({ actor: adminB, companyId: a.id }),
      ).rejects.toBeInstanceOf(CompanyNotFoundError);
      await expect(
        service.getCompany({
          actor: adminA,
          companyId: CompanyIdSchema.parse(randomUUID()),
        }),
      ).rejects.toBeInstanceOf(CompanyNotFoundError);
    });
  });

  it("an admin edits with the expected version; a member cannot; stale and cross-tenant writes change nothing", async () => {
    await withWorld(async ({ tx, service, adminA, memberA, adminB }) => {
      const a = await service.createCompany({
        actor: adminA,
        input: request("Edit A"),
        idempotencyKey: "edit-a",
        correlationId: CORRELATION(),
      });
      const b = await service.createCompany({
        actor: adminB,
        input: request("Edit B"),
        idempotencyKey: "edit-b",
        correlationId: CORRELATION(),
      });
      const correlationId = CORRELATION();

      const updated = await service.updateCompany({
        actor: adminA,
        companyId: a.id,
        input: {
          expectedVersion: 1,
          shortDescription: "Rail intelligence.",
          currentStageCode: "seed",
          foundedDate: "2020-01-31",
        },
        correlationId,
      });
      expect(updated.version).toBe(2);
      expect(updated.shortDescription).toBe("Rail intelligence.");
      expect(updated.currentStageCode).toBe("seed");
      expect(updated.foundedDate).toBe("2020-01-31");

      const audits = await tx.sql<{ action_type: string; metadata: unknown }[]>`
        select action_type, metadata from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`;
      expect(audits[0]?.action_type).toBe("company.updated");
      expect(audits[0]?.metadata).toEqual({
        changedFields: ["foundedDate", "currentStageCode", "shortDescription"],
        previousVersion: 1,
        newVersion: 2,
      });
      const events = await tx.sql<
        { event_type: string; payload: { data: unknown } }[]
      >`
        select event_type, payload from events.outbox where payload ->> 'correlationId' = ${correlationId}`;
      expect(events).toHaveLength(1);
      expect(events[0]?.event_type).toBe("core.company.updated");
      expect(events[0]?.payload.data).toEqual({
        companyId: a.id,
        version: 2,
        changedFields: ["foundedDate", "currentStageCode", "shortDescription"],
      });

      // Ordinary member: view yes, edit no.
      await expect(
        service.getCompany({ actor: memberA, companyId: a.id }),
      ).resolves.toMatchObject({ version: 2 });
      await expect(
        service.updateCompany({
          actor: memberA,
          companyId: a.id,
          input: { expectedVersion: 2, shortDescription: "x" },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);

      // Stale writer.
      await expect(
        service.updateCompany({
          actor: adminA,
          companyId: a.id,
          input: { expectedVersion: 1, shortDescription: "stale" },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(CompanyVersionConflictError);
      const [row] = await tx.sql<
        { short_description: string; version: number }[]
      >`select short_description, version from core.companies where id = ${a.id}`;
      expect(row).toEqual({
        short_description: "Rail intelligence.",
        version: 2,
      });

      // Cross-tenant: A's admin on B's company.
      await expect(
        service.updateCompany({
          actor: adminA,
          companyId: b.id,
          input: { expectedVersion: 1, canonicalName: "Hijacked" },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(CompanyNotFoundError);
      const [bRow] = await tx.sql<
        { canonical_name: string; version: number }[]
      >`select canonical_name, version from core.companies where id = ${b.id}`;
      expect(bRow).toEqual({ canonical_name: "Edit B", version: 1 });

      // Marketplace state cannot be moved by any profile write.
      const [visibility] = await tx.sql<
        {
          marketplace_visibility: string;
          marketplace_readiness_state: string;
        }[]
      >`
        select marketplace_visibility, marketplace_readiness_state from core.companies where id = ${a.id}`;
      expect(visibility).toEqual({
        marketplace_visibility: "organisation_private",
        marketplace_readiness_state: "not_assessed",
      });
    });
  });

  it("refuses a suspended organisation as a company home", async () => {
    await withWorld(async ({ tx, service, adminA, orgA }) => {
      await tx.sql`update identity.organisations set status = 'suspended' where id = ${orgA}`;
      await expect(
        service.createCompany({
          actor: adminA,
          input: request("Suspended Co"),
          idempotencyKey: "suspended",
          correlationId: CORRELATION(),
        }),
      ).rejects.toThrow(/not available/);
    });
  });
});
