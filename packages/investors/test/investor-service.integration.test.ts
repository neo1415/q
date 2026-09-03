import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createEventRegistry,
  type CorrelationId,
  type CreateInvestorOrganisationRequest,
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
  capability,
  createAuthorizationService,
  resolveHumanActorContext,
  TenantIdSchema,
  type ActorContext,
  type AuthenticatedPrincipal,
  type AuthorizationService,
} from "@capital-q/security";
import {
  createPostgresActorContextResolver,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";

import { INVESTOR_EVENTS } from "../src/events/index.js";
import {
  createInvestorService,
  createPostgresInvestorOrganisationQueryPort,
  InvestorCreationConflictError,
  InvestorOrganisationExistsError,
  InvestorOrganisationIdSchema,
  InvestorOrganisationNotFoundError,
  InvestorRepresentativeNotFoundError,
  InvestorVersionConflictError,
  type InvestorService,
} from "../src/index.js";

/**
 * Real local PostgreSQL (`pnpm db:start`), run with `pnpm test:integration`.
 * Every test runs in one rolled-back transaction with a savepoint-backed
 * TransactionManager, so a failing use case rolls back its own savepoint
 * and the assertions observe exactly what would have been committed.
 *
 * Covers the identity and authority separations this packet exists to
 * protect: one investor organisation per organisation, representatives that
 * grant nothing, titles that grant nothing, revoked memberships that remove
 * access, and profile text that never reaches the bus or the audit trail.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const SENTINEL = "PRIVATE-INVESTOR-DESCRIPTION-DO-NOT-EMIT";

class Rollback extends Error {}

type Person = { principal: AuthenticatedPrincipal; membershipId: string };

type World = {
  readonly tx: TransactionContext;
  readonly service: InvestorService;
  readonly authorization: AuthorizationService;
  readonly resolve: (
    principal: AuthenticatedPrincipal,
  ) => Promise<ActorContext>;
  readonly insertMember: (
    tenantId: string,
    organisationId: string,
    roleCode: "organisation_admin" | "organisation_member",
  ) => Promise<Person>;
  readonly adminA: Person;
  readonly memberA: Person;
  readonly adminB: Person;
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

const registry = createEventRegistry([...INVESTOR_EVENTS]);

describe("@capital-q/investors against local PostgreSQL", () => {
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
        // member, B has an admin. Organisation A is an investment firm with
        // a website and a country so profile defaults can be observed.
        const tenantA = await insertTenant(tx, "Investor Tenant A");
        const tenantB = await insertTenant(tx, "Investor Tenant B");
        const orgA = await insertOrganisation(tx, tenantA, "Apex Ventures", {
          organisationType: "investment_firm",
          websiteUrl: "https://apex.example",
          countryCode: "GB",
        });
        const orgB = await insertOrganisation(tx, tenantB, "Beta Capital", {
          organisationType: "family_office",
          websiteUrl: null,
          countryCode: null,
        });
        const insertMember = (
          tenantId: string,
          organisationId: string,
          roleCode: "organisation_admin" | "organisation_member",
        ) => insertMemberRow(tx, tenantId, organisationId, roleCode);
        const adminA = await insertMember(tenantA, orgA, "organisation_admin");
        const memberA = await insertMember(
          tenantA,
          orgA,
          "organisation_member",
        );
        const adminB = await insertMember(tenantB, orgB, "organisation_admin");

        const transactions = nestedTransactions(tx);
        const authorization = createAuthorizationService(
          createPostgresAuthorizationPolicySource({ sql }),
        );
        const realOutbox = createOutboxWriter({ registry });
        const service = createInvestorService({
          sql,
          transactions,
          authorization,
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
          authorization,
          resolve,
          insertMember,
          adminA,
          memberA,
          adminB,
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
    profile: {
      readonly organisationType: string;
      readonly websiteUrl: string | null;
      readonly countryCode: string | null;
    },
  ): Promise<string> {
    const id = randomUUID();
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug, website_url, country_code)
      values (${id}, ${tenantId}, ${profile.organisationType}, ${name}, ${`org-${id.slice(0, 8)}`}, ${profile.websiteUrl}, ${profile.countryCode})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${id})`;
    return id;
  }

  /** A person with an active membership, a role template and a persisted active context. */
  async function insertMemberRow(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    roleCode: "organisation_admin" | "organisation_member",
  ): Promise<Person> {
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
    return {
      principal: { authUserId: AuthUserIdSchema.parse(authUserId) },
      membershipId,
    };
  }

  function request(
    overrides: Partial<CreateInvestorOrganisationRequest> = {},
  ): CreateInvestorOrganisationRequest {
    return { investorType: "VC", ...overrides };
  }

  function scope(actor: ActorContext, investorId: string) {
    if (actor.organisationId === undefined) {
      throw new Error("no organisation");
    }
    return {
      kind: "RESOURCE" as const,
      tenantId: actor.tenantId,
      organisationId: actor.organisationId,
      resourceType: "investor_organisation",
      resourceId: investorId,
    };
  }

  async function roleCodes(
    tx: TransactionContext,
    membershipId: string,
  ): Promise<string[]> {
    const rows = await tx.sql<{ code: string }[]>`
      select r.code from identity.membership_roles mr join permissions.roles r on r.id = mr.role_id
       where mr.membership_id = ${membershipId} order by r.code`;
    return rows.map((r) => r.code);
  }

  const count = async (query: Promise<{ count: number }[]>) =>
    (await query)[0]?.count;

  // -------------------------------------------------------------------------
  // Creation
  // -------------------------------------------------------------------------

  it("an organisation admin establishes the canonical investor organisation with defaults from the organisation, one representative, audit and events", async () => {
    await withWorld(async ({ tx, service, resolve, adminA, tenantA, orgA }) => {
      const actor = await resolve(adminA.principal);
      const correlationId = CORRELATION();
      const investor = await service.createInvestorOrganisation({
        actor,
        input: request({ deploymentState: "ACTIVELY_INVESTING" }),
        idempotencyKey: "investor-key-0001",
        correlationId,
      });

      // InvestorOrganisationId != OrganisationId != TenantId != UserId.
      expect([orgA, tenantA, actor.userId, actor.membershipId]).not.toContain(
        investor.id,
      );
      expect(investor.tenantId).toBe(tenantA);
      expect(investor.organisationId).toBe(orgA);
      expect(investor.investorType).toBe("VC");
      expect(investor.displayName).toBe("Apex Ventures");
      expect(investor.websiteUrl).toBe("https://apex.example");
      expect(investor.hqCountry).toBe("GB");
      expect(investor.publicDescription).toBeNull();
      expect(investor.verificationState).toBe("unverified");
      expect(investor.deploymentState).toBe("ACTIVELY_INVESTING");
      expect(investor.version).toBe(1);

      // Organisation identity is untouched: no name, website or type write-back.
      const [organisation] = await tx.sql<
        { display_name: string; organisation_type: string; version: number }[]
      >`select display_name, organisation_type, version from identity.organisations where id = ${orgA}`;
      expect(organisation).toEqual({
        display_name: "Apex Ventures",
        organisation_type: "investment_firm",
        version: 1,
      });

      // Exactly one current representative: the creator, in their membership.
      const representatives = await tx.sql<
        {
          user_id: string;
          membership_id: string;
          organisation_id: string;
          business_title: string | null;
          is_current: boolean;
        }[]
      >`select user_id, membership_id, organisation_id, business_title, is_current
          from core.investor_representatives where investor_organisation_id = ${investor.id}`;
      expect(representatives).toEqual([
        {
          user_id: actor.userId,
          membership_id: adminA.membershipId,
          organisation_id: orgA,
          business_title: null,
          is_current: true,
        },
      ]);
      const me = await service.getMyInvestorRepresentative({
        actor,
        investorOrganisationId: investor.id,
      });
      expect(me.userId).toBe(actor.userId);
      expect(me.membershipId).toBe(adminA.membershipId);
      expect([investor.id, actor.userId, actor.membershipId]).not.toContain(
        me.id,
      );

      const audits = await tx.sql<
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
          from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid order by action_type`;
      expect(audits).toHaveLength(2);
      expect(audits[0]).toMatchObject({
        action_type: "investor_organisation.created",
        actor_id: actor.userId,
        tenant_id: tenantA,
        organisation_id: orgA,
        resource_type: "investor_organisation",
        resource_id: investor.id,
        metadata: { investorType: "VC" },
      });
      expect(audits[1]).toMatchObject({
        action_type: "investor_representative.created",
        resource_type: "investor_representative",
        resource_id: me.id,
        metadata: { investorOrganisationId: investor.id },
      });

      const events = await tx.sql<
        {
          event_type: string;
          tenant_id: string;
          payload: { data: unknown; aggregate: unknown };
        }[]
      >`select event_type, tenant_id, payload from events.outbox where payload ->> 'correlationId' = ${correlationId} order by event_type`;
      expect(events.map((e) => e.event_type)).toEqual([
        "core.investor_organisation.created",
        "core.investor_representative.created",
      ]);
      expect(events[0]?.tenant_id).toBe(tenantA);
      expect(events[0]?.payload.data).toEqual({
        investorOrganisationId: investor.id,
        organisationId: orgA,
        investorType: "VC",
        version: 1,
      });
      expect(events[1]?.payload.data).toEqual({
        investorRepresentativeId: me.id,
        investorOrganisationId: investor.id,
        userId: actor.userId,
        membershipId: adminA.membershipId,
      });

      // Nothing beyond the investor and its representative: no fund, no
      // mandate, no GateQ rule set exists to be written.
      const tables = await tx.sql<{ table_name: string }[]>`
        select table_schema || '.' || table_name as table_name from information_schema.tables
         where table_name in ('investment_funds', 'investor_mandates', 'gateq_rule_sets')`;
      expect(tables).toEqual([]);

      // The permission-neutral query port answers the identity for the right tenant only.
      const port = createPostgresInvestorOrganisationQueryPort({ sql: tx.sql });
      await expect(
        port.getCanonicalInvestorOrganisation(actor.tenantId, investor.id),
      ).resolves.toEqual({
        id: investor.id,
        tenantId: tenantA,
        organisationId: orgA,
        investorType: "VC",
        displayName: "Apex Ventures",
        deploymentState: "ACTIVELY_INVESTING",
      });
      await expect(
        port.getCanonicalInvestorOrganisation(
          TenantIdSchema.parse(randomUUID()),
          investor.id,
        ),
      ).resolves.toBeNull();
    });
  });

  it("deployment state may be unknown at creation and is never coerced", async () => {
    await withWorld(async ({ tx, service, resolve, adminA }) => {
      const actor = await resolve(adminA.principal);
      const investor = await service.createInvestorOrganisation({
        actor,
        input: request({ investorType: "ANGEL" }),
        idempotencyKey: "unknown-deployment",
        correlationId: CORRELATION(),
      });
      expect(investor.deploymentState).toBeNull();
      const [row] = await tx.sql<
        { deployment_state: string | null }[]
      >`select deployment_state from core.investor_organisations where id = ${investor.id}`;
      expect(row?.deployment_state).toBeNull();
    });
  });

  it("refuses a second investor organisation for the same organisation, from any admin, while a retry with the same key returns the first", async () => {
    await withWorld(
      async ({ tx, service, resolve, insertMember, adminA, tenantA, orgA }) => {
        const actor = await resolve(adminA.principal);
        const input = request({ hqCountry: "GB" });
        const first = await service.createInvestorOrganisation({
          actor,
          input,
          idempotencyKey: "investor-retry",
          correlationId: CORRELATION(),
        });
        const again = await service.createInvestorOrganisation({
          actor,
          input: { ...input },
          idempotencyKey: "investor-retry",
          correlationId: CORRELATION(),
        });
        expect(again.id).toBe(first.id);

        // Same key, different payload.
        await expect(
          service.createInvestorOrganisation({
            actor,
            input: request({ hqCountry: "FR" }),
            idempotencyKey: "investor-retry",
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(InvestorCreationConflictError);

        // New key, same organisation: the identity is already established.
        await expect(
          service.createInvestorOrganisation({
            actor,
            input: request({ investorType: "SYNDICATE" }),
            idempotencyKey: "investor-second",
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(InvestorOrganisationExistsError);

        // A second admin of the same organisation cannot create their own copy.
        const otherAdmin = await insertMember(
          tenantA,
          orgA,
          "organisation_admin",
        );
        await expect(
          service.createInvestorOrganisation({
            actor: await resolve(otherAdmin.principal),
            input: request(),
            idempotencyKey: "investor-other-admin",
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(InvestorOrganisationExistsError);

        expect(
          await count(
            tx.sql`select count(*)::int as count from core.investor_organisations where organisation_id = ${orgA}`,
          ),
        ).toBe(1);
        expect(
          await count(
            tx.sql`select count(*)::int as count from core.investor_representatives where investor_organisation_id = ${first.id}`,
          ),
        ).toBe(1);
        expect(
          await count(
            tx.sql`select count(*)::int as count from events.outbox where event_type = 'core.investor_organisation.created' and payload -> 'data' ->> 'investorOrganisationId' = ${first.id}`,
          ),
        ).toBe(1);
      },
    );
  });

  it("requires investor.create: an ordinary member is denied and nothing is written", async () => {
    await withWorld(async ({ tx, service, resolve, memberA, orgA }) => {
      await expect(
        service.createInvestorOrganisation({
          actor: await resolve(memberA.principal),
          input: request(),
          idempotencyKey: "investor-member",
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      expect(
        await count(
          tx.sql`select count(*)::int as count from core.investor_organisations where organisation_id = ${orgA}`,
        ),
      ).toBe(0);
    });
  });

  it("rolls back the investor, representative, audit, events and idempotency record when the event cannot be enqueued", async () => {
    await withWorld(
      async ({ tx, service, resolve, adminA, orgA }) => {
        const actor = await resolve(adminA.principal);
        const correlationId = CORRELATION();
        await expect(
          service.createInvestorOrganisation({
            actor,
            input: request(),
            idempotencyKey: "doomed",
            correlationId,
          }),
        ).rejects.toThrow("outbox unavailable");
        const { sql } = tx;
        expect(
          await count(
            sql`select count(*)::int as count from core.investor_organisations where organisation_id = ${orgA}`,
          ),
        ).toBe(0);
        expect(
          await count(
            sql`select count(*)::int as count from core.investor_representatives where organisation_id = ${orgA}`,
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
            sql`select count(*)::int as count from core.investor_creation_requests where user_id = ${actor.userId}`,
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

  it("refuses a suspended organisation as an investor home", async () => {
    await withWorld(async ({ tx, service, resolve, adminA, orgA }) => {
      await tx.sql`update identity.organisations set status = 'suspended' where id = ${orgA}`;
      await expect(
        service.createInvestorOrganisation({
          actor: await resolve(adminA.principal),
          input: request(),
          idempotencyKey: "suspended",
          correlationId: CORRELATION(),
        }),
      ).rejects.toThrow(/not available/);
    });
  });

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  it("members read with investor.view; the current query answers the active organisation; foreign ids are not found", async () => {
    await withWorld(async ({ service, resolve, adminA, memberA, adminB }) => {
      const a = await service.createInvestorOrganisation({
        actor: await resolve(adminA.principal),
        input: request(),
        idempotencyKey: "read-a",
        correlationId: CORRELATION(),
      });
      const actorB = await resolve(adminB.principal);
      await expect(
        service.getCurrentInvestorOrganisation({ actor: actorB }),
      ).rejects.toBeInstanceOf(InvestorOrganisationNotFoundError);
      const b = await service.createInvestorOrganisation({
        actor: actorB,
        input: request({ investorType: "FAMILY_OFFICE" }),
        idempotencyKey: "read-b",
        correlationId: CORRELATION(),
      });

      const member = await resolve(memberA.principal);
      await expect(
        service.getInvestorOrganisation({
          actor: member,
          investorOrganisationId: a.id,
        }),
      ).resolves.toMatchObject({ id: a.id });
      await expect(
        service.getCurrentInvestorOrganisation({ actor: member }),
      ).resolves.toMatchObject({ id: a.id });
      await expect(
        service.getCurrentInvestorOrganisation({ actor: actorB }),
      ).resolves.toMatchObject({ id: b.id, investorType: "FAMILY_OFFICE" });

      // Valid foreign UUIDs are simply not found; nothing is disclosed.
      await expect(
        service.getInvestorOrganisation({
          actor: member,
          investorOrganisationId: b.id,
        }),
      ).rejects.toBeInstanceOf(InvestorOrganisationNotFoundError);
      await expect(
        service.getInvestorOrganisation({
          actor: actorB,
          investorOrganisationId: a.id,
        }),
      ).rejects.toBeInstanceOf(InvestorOrganisationNotFoundError);
      await expect(
        service.getInvestorOrganisation({
          actor: member,
          investorOrganisationId:
            InvestorOrganisationIdSchema.parse(randomUUID()),
        }),
      ).rejects.toBeInstanceOf(InvestorOrganisationNotFoundError);
      await expect(
        service.getMyInvestorRepresentative({
          actor: actorB,
          investorOrganisationId: a.id,
        }),
      ).rejects.toBeInstanceOf(InvestorOrganisationNotFoundError);
    });
  });

  // -------------------------------------------------------------------------
  // Updating
  // -------------------------------------------------------------------------

  it("an admin changes deployment state and profile with the expected version; audit and event carry names only; a member cannot edit; stale and foreign writes change nothing", async () => {
    await withWorld(
      async ({ tx, service, resolve, adminA, memberA, adminB, orgA }) => {
        const admin = await resolve(adminA.principal);
        const a = await service.createInvestorOrganisation({
          actor: admin,
          input: request({ deploymentState: "ACTIVELY_INVESTING" }),
          idempotencyKey: "edit-a",
          correlationId: CORRELATION(),
        });
        const b = await service.createInvestorOrganisation({
          actor: await resolve(adminB.principal),
          input: request(),
          idempotencyKey: "edit-b",
          correlationId: CORRELATION(),
        });
        const correlationId = CORRELATION();

        const updated = await service.updateInvestorOrganisation({
          actor: admin,
          investorOrganisationId: a.id,
          input: {
            expectedVersion: 1,
            deploymentState: "PAUSED",
            publicDescription: SENTINEL,
            investorType: "CVC",
          },
          correlationId,
        });
        expect(updated.version).toBe(2);
        expect(updated.deploymentState).toBe("PAUSED");
        expect(updated.investorType).toBe("CVC");
        expect(updated.publicDescription).toBe(SENTINEL);
        expect(updated.verificationState).toBe("unverified");

        const audits = await tx.sql<
          { action_type: string; metadata: unknown }[]
        >`select action_type, metadata from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`;
        expect(audits).toHaveLength(1);
        expect(audits[0]?.action_type).toBe("investor_organisation.updated");
        expect(audits[0]?.metadata).toEqual({
          changedFields: [
            "investorType",
            "publicDescription",
            "deploymentState",
          ],
          previousVersion: 1,
          newVersion: 2,
        });
        const events = await tx.sql<
          { event_type: string; payload: { data: unknown } }[]
        >`select event_type, payload from events.outbox where payload ->> 'correlationId' = ${correlationId}`;
        expect(events).toHaveLength(1);
        expect(events[0]?.event_type).toBe(
          "core.investor_organisation.updated",
        );
        expect(events[0]?.payload.data).toEqual({
          investorOrganisationId: a.id,
          version: 2,
          changedFields: [
            "investorType",
            "publicDescription",
            "deploymentState",
          ],
        });

        // The sentinel lives in the canonical row and nowhere else.
        expect(
          await count(
            tx.sql`select count(*)::int as count from core.investor_organisations where public_description = ${SENTINEL}`,
          ),
        ).toBe(1);
        expect(
          await count(
            tx.sql`select count(*)::int as count from events.outbox where payload::text like ${`%${SENTINEL}%`}`,
          ),
        ).toBe(0);
        expect(
          await count(
            tx.sql`select count(*)::int as count from audit.material_actions where metadata::text like ${`%${SENTINEL}%`}`,
          ),
        ).toBe(0);

        // The deployment change touched nothing else: organisation and
        // representative rows are untouched, and no mandate/GateQ table exists.
        const [organisation] = await tx.sql<
          { version: number }[]
        >`select version from identity.organisations where id = ${orgA}`;
        expect(organisation?.version).toBe(1);

        // Ordinary member: view yes, edit no.
        const member = await resolve(memberA.principal);
        await expect(
          service.getInvestorOrganisation({
            actor: member,
            investorOrganisationId: a.id,
          }),
        ).resolves.toMatchObject({ version: 2 });
        await expect(
          service.updateInvestorOrganisation({
            actor: member,
            investorOrganisationId: a.id,
            input: { expectedVersion: 2, deploymentState: "SELECTIVE" },
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(AuthorizationDeniedError);

        // Stale writer.
        await expect(
          service.updateInvestorOrganisation({
            actor: admin,
            investorOrganisationId: a.id,
            input: { expectedVersion: 1, deploymentState: "SELECTIVE" },
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(InvestorVersionConflictError);
        const [row] = await tx.sql<
          { deployment_state: string; version: number }[]
        >`select deployment_state, version from core.investor_organisations where id = ${a.id}`;
        expect(row).toEqual({ deployment_state: "PAUSED", version: 2 });

        // Returning the answer to unknown is an explicit, versioned change.
        const cleared = await service.updateInvestorOrganisation({
          actor: admin,
          investorOrganisationId: a.id,
          input: { expectedVersion: 2, deploymentState: null },
          correlationId: CORRELATION(),
        });
        expect(cleared.deploymentState).toBeNull();
        expect(cleared.version).toBe(3);

        // Cross-tenant: A's admin on B's investor organisation.
        await expect(
          service.updateInvestorOrganisation({
            actor: admin,
            investorOrganisationId: b.id,
            input: { expectedVersion: 1, displayName: "Hijacked" },
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(InvestorOrganisationNotFoundError);
        const [bRow] = await tx.sql<
          { display_name: string; version: number }[]
        >`select display_name, version from core.investor_organisations where id = ${b.id}`;
        expect(bRow).toEqual({ display_name: "Beta Capital", version: 1 });
      },
    );
  });

  // -------------------------------------------------------------------------
  // Representatives
  // -------------------------------------------------------------------------

  it("five members of one organisation each represent it: one investor organisation, five representatives, no role change, titles grant nothing", async () => {
    await withWorld(
      async ({
        tx,
        service,
        authorization,
        resolve,
        insertMember,
        adminA,
        memberA,
        tenantA,
        orgA,
      }) => {
        const admin = await resolve(adminA.principal);
        const investor = await service.createInvestorOrganisation({
          actor: admin,
          input: request(),
          idempotencyKey: "five",
          correlationId: CORRELATION(),
        });

        const people = [
          memberA,
          await insertMember(tenantA, orgA, "organisation_member"),
          await insertMember(tenantA, orgA, "organisation_member"),
          await insertMember(tenantA, orgA, "organisation_member"),
        ];
        const titles = ["Partner", "Principal", "Analyst", "Scout"];
        for (const [index, person] of people.entries()) {
          const actor = await resolve(person.principal);
          const rolesBefore = await roleCodes(tx, person.membershipId);
          const correlationId = CORRELATION();
          const representative = await service.upsertMyInvestorRepresentative({
            actor,
            investorOrganisationId: investor.id,
            input: { businessTitle: titles[index] ?? null },
            correlationId,
          });
          expect(representative.userId).toBe(actor.userId);
          expect(representative.membershipId).toBe(person.membershipId);
          expect(representative.investorOrganisationId).toBe(investor.id);
          expect(representative.isCurrent).toBe(true);
          expect(representative.version).toBe(1);
          expect(await roleCodes(tx, person.membershipId)).toEqual(rolesBefore);

          // Idempotent on retry: same row, no new period, no new event.
          const again = await service.upsertMyInvestorRepresentative({
            actor,
            investorOrganisationId: investor.id,
            input: { businessTitle: titles[index] ?? null },
            correlationId: CORRELATION(),
          });
          expect(again.id).toBe(representative.id);
          expect(again.version).toBe(1);

          // "Partner" grants nothing: an ordinary member still cannot edit.
          const decision = await authorization.authorize({
            actor,
            capability: capability("investor.edit"),
            resource: scope(actor, investor.id),
          });
          expect(decision.outcome).toBe("DENY");
          await expect(
            service.updateInvestorOrganisation({
              actor,
              investorOrganisationId: investor.id,
              input: { expectedVersion: 1, deploymentState: "PAUSED" },
              correlationId: CORRELATION(),
            }),
          ).rejects.toBeInstanceOf(AuthorizationDeniedError);
        }

        expect(
          await count(
            tx.sql`select count(*)::int as count from core.investor_organisations where organisation_id = ${orgA}`,
          ),
        ).toBe(1);
        expect(
          await count(
            tx.sql`select count(*)::int as count from core.investor_representatives where investor_organisation_id = ${investor.id} and is_current`,
          ),
        ).toBe(5);
        expect(
          await count(
            tx.sql`select count(*)::int as count from identity.organisation_memberships where organisation_id = ${orgA}`,
          ),
        ).toBe(5);
        expect(
          await count(
            tx.sql`select count(*)::int as count from events.outbox where event_type = 'core.investor_representative.created' and payload -> 'data' ->> 'investorOrganisationId' = ${investor.id}`,
          ),
        ).toBe(5);
      },
    );
  });

  it("a later admin is not a representative until they say so; a title change is versioned and leaves authorization facts unchanged", async () => {
    await withWorld(
      async ({
        tx,
        service,
        authorization,
        resolve,
        insertMember,
        adminA,
        memberA,
        tenantA,
        orgA,
      }) => {
        const investor = await service.createInvestorOrganisation({
          actor: await resolve(adminA.principal),
          input: request(),
          idempotencyKey: "later-admin",
          correlationId: CORRELATION(),
        });
        const laterAdmin = await insertMember(
          tenantA,
          orgA,
          "organisation_admin",
        );
        const later = await resolve(laterAdmin.principal);
        // May administer...
        await expect(
          service.updateInvestorOrganisation({
            actor: later,
            investorOrganisationId: investor.id,
            input: { expectedVersion: 1, deploymentState: "SELECTIVE" },
            correlationId: CORRELATION(),
          }),
        ).resolves.toMatchObject({ version: 2 });
        // ...but no representative identity appeared by magic.
        await expect(
          service.getMyInvestorRepresentative({
            actor: later,
            investorOrganisationId: investor.id,
          }),
        ).rejects.toBeInstanceOf(InvestorRepresentativeNotFoundError);

        // Analyst -> Managing Partner: version 2, one updated event, same facts.
        const member = await resolve(memberA.principal);
        const first = await service.upsertMyInvestorRepresentative({
          actor: member,
          investorOrganisationId: investor.id,
          input: { businessTitle: "Analyst" },
          correlationId: CORRELATION(),
        });
        const before = await authorization.authorize({
          actor: member,
          capability: capability("investor.edit"),
          resource: scope(member, investor.id),
        });
        const correlationId = CORRELATION();
        const promoted = await service.upsertMyInvestorRepresentative({
          actor: member,
          investorOrganisationId: investor.id,
          input: { businessTitle: "Managing Partner" },
          correlationId,
        });
        expect(promoted.id).toBe(first.id);
        expect(promoted.version).toBe(2);
        expect(promoted.businessTitle).toBe("Managing Partner");
        const after = await authorization.authorize({
          actor: member,
          capability: capability("investor.edit"),
          resource: scope(member, investor.id),
        });
        expect(after.outcome).toBe("DENY");
        expect(after.outcome).toBe(before.outcome);
        const events = await tx.sql<
          { event_type: string; payload: { data: unknown } }[]
        >`select event_type, payload from events.outbox where payload ->> 'correlationId' = ${correlationId}`;
        expect(events).toHaveLength(1);
        expect(events[0]?.event_type).toBe(
          "core.investor_representative.updated",
        );
        expect(events[0]?.payload.data).toEqual({
          investorRepresentativeId: first.id,
          investorOrganisationId: investor.id,
          version: 2,
          changedFields: ["businessTitle"],
        });
        expect(JSON.stringify(events[0]?.payload)).not.toContain(
          "Managing Partner",
        );
        const audits = await tx.sql<
          { action_type: string; metadata: unknown }[]
        >`select action_type, metadata from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`;
        expect(audits[0]?.action_type).toBe("investor_representative.updated");
        expect(JSON.stringify(audits[0]?.metadata)).not.toContain(
          "Managing Partner",
        );
      },
    );
  });

  it("a person without membership cannot self-link and no membership is created; a membership from another organisation is refused by the database", async () => {
    await withWorld(
      async ({
        tx,
        service,
        resolve,
        adminA,
        memberA,
        adminB,
        tenantB,
        orgB,
      }) => {
        const investor = await service.createInvestorOrganisation({
          actor: await resolve(adminA.principal),
          input: request(),
          idempotencyKey: "coherence",
          correlationId: CORRELATION(),
        });
        const actorB = await resolve(adminB.principal);
        const membershipsBefore = await count(
          tx.sql`select count(*)::int as count from identity.organisation_memberships`,
        );
        // B's admin has no membership of organisation A: the investor is not found for them.
        await expect(
          service.upsertMyInvestorRepresentative({
            actor: actorB,
            investorOrganisationId: investor.id,
            input: { businessTitle: "Partner" },
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(InvestorOrganisationNotFoundError);
        expect(
          await count(
            tx.sql`select count(*)::int as count from identity.organisation_memberships`,
          ),
        ).toBe(membershipsBefore);

        // Even a privileged writer cannot pair investor A with a membership of
        // organisation B, or a person of A (with no representation yet, so the
        // unique index does not fire first) with B's membership.
        await expect(
          tx.sql.savepoint(
            (inner) => inner`insert into core.investor_representatives
              (tenant_id, investor_organisation_id, organisation_id, user_id, membership_id)
              values (${tenantB}, ${investor.id}, ${orgB}, ${actorB.userId}, ${adminB.membershipId})`,
          ),
        ).rejects.toMatchObject({ code: "23503" });
        const member = await resolve(memberA.principal);
        await expect(
          tx.sql.savepoint(
            (inner) => inner`insert into core.investor_representatives
              (tenant_id, investor_organisation_id, organisation_id, user_id, membership_id)
              values (${member.tenantId}, ${investor.id}, ${investor.organisationId}, ${member.userId}, ${adminB.membershipId})`,
          ),
        ).rejects.toMatchObject({ code: "23503" });
        // And user A cannot be paired with another A member's membership either.
        await expect(
          tx.sql.savepoint(
            (inner) => inner`insert into core.investor_representatives
              (tenant_id, investor_organisation_id, organisation_id, user_id, membership_id)
              values (${member.tenantId}, ${investor.id}, ${investor.organisationId}, ${member.userId}, ${adminA.membershipId})`,
          ),
        ).rejects.toMatchObject({ code: "23503" });
      },
    );
  });

  it("revoking the organisation membership removes access while the representative row remains history", async () => {
    await withWorld(async ({ tx, service, resolve, adminA, memberA }) => {
      const investor = await service.createInvestorOrganisation({
        actor: await resolve(adminA.principal),
        input: request(),
        idempotencyKey: "revoke",
        correlationId: CORRELATION(),
      });
      const actor = await resolve(memberA.principal);
      const representative = await service.upsertMyInvestorRepresentative({
        actor,
        investorOrganisationId: investor.id,
        input: { businessTitle: "Partner" },
        correlationId: CORRELATION(),
      });

      await tx.sql`update identity.organisation_memberships set membership_status = 'revoked', left_at = clock_timestamp() where id = ${memberA.membershipId}`;
      await expect(resolve(memberA.principal)).rejects.toThrow(
        "CONTEXT_REQUIRED",
      );
      // The stale context, if replayed, still cannot authorise anything.
      await expect(
        service.getInvestorOrganisation({
          actor,
          investorOrganisationId: investor.id,
        }),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      await expect(
        service.upsertMyInvestorRepresentative({
          actor,
          investorOrganisationId: investor.id,
          input: { businessTitle: "Still here" },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      const [history] = await tx.sql<
        { is_current: boolean; business_title: string }[]
      >`select is_current, business_title from core.investor_representatives where id = ${representative.id}`;
      expect(history).toEqual({ is_current: true, business_title: "Partner" });
    });
  });
});
