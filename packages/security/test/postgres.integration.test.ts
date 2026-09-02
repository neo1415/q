import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  DatabaseError,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";

import {
  ActorContextSchema,
  type ActorContext,
} from "../src/actor-context/actor-context.js";
import { resolveHumanActorContext } from "../src/actor-context/resolver.js";
import {
  capability,
  REFERENCE_CAPABILITIES,
} from "../src/authorization/capability.js";
import { createAuthorizationService } from "../src/authorization/service.js";
import {
  AuthUserIdSchema,
  MembershipIdSchema,
  OrganisationIdSchema,
  TenantIdSchema,
  UserIdSchema,
  type MembershipId,
  type OrganisationId,
  type TenantId,
  type UserId,
} from "../src/identity/ids.js";
import { createPostgresActiveOrganisationContextStore } from "../src/postgres/active-context-store.js";
import { createPostgresActorContextResolver } from "../src/postgres/actor-context-resolver.js";
import {
  createPostgresAuthorizationPolicySource,
  type PolicyIntegrityFailure,
} from "../src/postgres/authorization-policy-source.js";

/**
 * Real local PostgreSQL (`pnpm db:start`), run with `pnpm test:integration`.
 *
 * Every test runs inside one transaction that is rolled back at the end, so
 * synthetic auth users, tenants and memberships never persist. The adapters
 * under test are handed the transaction's own executor so they observe the
 * uncommitted fixtures.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const ORGANISATION_ADMIN = capability("organisation.admin");
const DATA_ROOM_SHARE = capability("data_room.share");
const FINANCIALS_VIEW = capability("company.financials.view");

class Rollback extends Error {}

type World = {
  readonly authA: string;
  readonly authB: string;
  readonly userA: UserId;
  readonly userB: UserId;
  readonly tenantA: TenantId;
  readonly tenantB: TenantId;
  readonly orgA: OrganisationId;
  readonly orgB: OrganisationId;
  readonly membershipA: MembershipId;
  readonly membershipB: MembershipId;
  readonly adminRoleId: string;
};

describe("@capital-q/security Postgres adapters", () => {
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

  /** Run `work` in a transaction that is always rolled back. */
  async function inRolledBackTransaction(
    work: (tx: TransactionContext, world: World) => Promise<void>,
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const world = await createWorld(tx);
        await work(tx, world);
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(
        error instanceof DatabaseError && error.cause instanceof Rollback
      )) {
        throw error;
      }
    }
    expect(completed).toBe(true);
  }

  /**
   * A TransactionManager for code under test that already runs inside the
   * test transaction: nested work becomes a savepoint, so a failing store
   * call rolls back its own writes without ending the outer test transaction.
   */
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

  async function createWorld(tx: TransactionContext): Promise<World> {
    const { sql } = tx;
    const authA = randomUUID();
    const authB = randomUUID();
    await sql`insert into auth.users (id) values (${authA}), (${authB})`;

    const profiles = await sql<{ id: string; auth_user_id: string }[]>`
      select id, auth_user_id from identity.user_profiles
       where auth_user_id in (${authA}, ${authB})`;
    const userA = UserIdSchema.parse(
      profiles.find((p) => p.auth_user_id === authA)?.id,
    );
    const userB = UserIdSchema.parse(
      profiles.find((p) => p.auth_user_id === authB)?.id,
    );

    const tenantA = TenantIdSchema.parse(randomUUID());
    const tenantB = TenantIdSchema.parse(randomUUID());
    await sql`insert into identity.tenants (id, name) values
      (${tenantA}, 'Synthetic Tenant A'), (${tenantB}, 'Synthetic Tenant B')`;

    const orgA = OrganisationIdSchema.parse(randomUUID());
    const orgB = OrganisationIdSchema.parse(randomUUID());
    await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug) values
      (${orgA}, ${tenantA}, 'company', 'Synthetic Org A', 'org-a'),
      (${orgB}, ${tenantB}, 'investment_firm', 'Synthetic Org B', 'org-b')`;
    await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values
      (${tenantA}, ${orgA}), (${tenantB}, ${orgB})`;

    const membershipA = MembershipIdSchema.parse(randomUUID());
    const membershipB = MembershipIdSchema.parse(randomUUID());
    await sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id, primary_business_title) values
      (${membershipA}, ${tenantA}, ${orgA}, ${userA}, 'CEO'),
      (${membershipB}, ${tenantB}, ${orgB}, ${userB}, 'Partner')`;

    const [adminRole] = await sql<{ id: string }[]>`
      select id from permissions.roles where code = 'organisation_admin'`;
    if (adminRole === undefined) {
      throw new Error("seed missing: organisation_admin");
    }

    return {
      authA,
      authB,
      userA,
      userB,
      tenantA,
      tenantB,
      orgA,
      orgB,
      membershipA,
      membershipB,
      adminRoleId: adminRole.id,
    };
  }

  function principal(authUserId: string) {
    return { authUserId: AuthUserIdSchema.parse(authUserId) };
  }

  function actorA(world: World): ActorContext {
    return ActorContextSchema.parse({
      userId: world.userA,
      tenantId: world.tenantA,
      organisationId: world.orgA,
      membershipId: world.membershipA,
      actorType: "HUMAN",
    });
  }

  async function assignAdmin(
    tx: TransactionContext,
    world: World,
    window: { validFrom?: string; validUntil?: string } = {},
  ) {
    await tx.sql`insert into identity.membership_roles (membership_id, role_id, valid_from, valid_until)
      values (${world.membershipA}, ${world.adminRoleId},
              coalesce(${window.validFrom ?? null}::timestamptz, now()),
              ${window.validUntil ?? null}::timestamptz)`;
  }

  async function insertGrant(
    tx: TransactionContext,
    world: World,
    grant: {
      capabilityCode: string;
      effect: "ALLOW" | "DENY";
      principalType?: "user" | "membership" | "organisation";
      principalId?: string;
      scope: unknown;
      resourceType?: string | null;
      resourceId?: string | null;
      validFrom?: string;
      validUntil?: string | null;
      revokedAt?: string | null;
    },
  ): Promise<string> {
    const id = randomUUID();
    await tx.sql`insert into permissions.grants
      (id, tenant_id, principal_type, principal_id, capability_id, effect, scope,
       resource_type, resource_id, valid_from, valid_until, revoked_at)
      select ${id}, ${world.tenantA}, ${grant.principalType ?? "user"},
             ${grant.principalId ?? world.userA}, c.id, ${grant.effect},
             ${JSON.stringify(grant.scope)}::text::jsonb,
             ${grant.resourceType ?? null}, ${grant.resourceId ?? null},
             coalesce(${grant.validFrom ?? null}::timestamptz, now()),
             ${grant.validUntil ?? null}::timestamptz,
             ${grant.revokedAt ?? null}::timestamptz
        from permissions.capabilities c where c.code = ${grant.capabilityCode}`;
    return id;
  }

  // -------------------------------------------------------------------------
  // Capability registry <-> seed
  // -------------------------------------------------------------------------

  it("seeds every registered reference capability", async () => {
    const rows = await db.sql<{ code: string }[]>`
      select code from permissions.capabilities where status = 'active'`;
    const codes = new Set(rows.map((row) => row.code));
    for (const code of REFERENCE_CAPABILITIES) {
      expect(codes.has(code), `missing capability ${code}`).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // ActorContextResolver
  // -------------------------------------------------------------------------

  describe("PostgresActorContextResolver", () => {
    it("maps AuthUserId to a distinct UserId and refuses unknown auth identities", async () => {
      await inRolledBackTransaction(async (tx, world) => {
        const resolver = createPostgresActorContextResolver({ sql: tx.sql });

        const unknown = await resolver.resolveHumanContext({
          principal: principal(randomUUID()),
          selection: { organisationId: world.orgA },
        });
        expect(unknown).toEqual({ status: "NO_APPLICATION_IDENTITY" });

        const resolved = await resolver.resolveHumanContext({
          principal: principal(world.authA),
          selection: { organisationId: world.orgA },
        });
        expect(resolved.status).toBe("RESOLVED");
        if (resolved.status === "RESOLVED") {
          expect(resolved.context.userId).toBe(world.userA);
          expect(resolved.context.userId).not.toBe(world.authA);
        }
      });
    });

    it("resolves an explicit accessible organisation to a HUMAN context from trusted rows", async () => {
      await inRolledBackTransaction(async (tx, world) => {
        const resolver = createPostgresActorContextResolver({ sql: tx.sql });
        const resolution = await resolveHumanActorContext(resolver, {
          principal: principal(world.authA),
          selection: { organisationId: world.orgA },
        });
        expect(resolution).toEqual({
          status: "RESOLVED",
          context: {
            userId: world.userA,
            tenantId: world.tenantA,
            organisationId: world.orgA,
            membershipId: world.membershipA,
            actorType: "HUMAN",
          },
        });
      });
    });

    it("denies an explicit organisation the person is not an active member of", async () => {
      await inRolledBackTransaction(async (tx, world) => {
        const resolver = createPostgresActorContextResolver({ sql: tx.sql });
        const other = await resolver.resolveHumanContext({
          principal: principal(world.authA),
          selection: { organisationId: world.orgB },
        });
        expect(other).toEqual({ status: "CONTEXT_NOT_ACCESSIBLE" });

        const missing = await resolver.resolveHumanContext({
          principal: principal(world.authA),
          selection: {
            organisationId: OrganisationIdSchema.parse(randomUUID()),
          },
        });
        expect(missing).toEqual({ status: "CONTEXT_NOT_ACCESSIBLE" });
      });
    });

    it("requires a context when nothing is selected or persisted, even with exactly one membership", async () => {
      await inRolledBackTransaction(async (tx, world) => {
        const resolver = createPostgresActorContextResolver({ sql: tx.sql });
        const [count] = await tx.sql<{ n: number }[]>`
          select count(*)::int as n from identity.organisation_memberships
           where user_id = ${world.userA} and membership_status = 'active'`;
        expect(count?.n).toBe(1);

        const resolution = await resolver.resolveHumanContext({
          principal: principal(world.authA),
        });
        expect(resolution).toEqual({ status: "CONTEXT_REQUIRED" });
      });
    });

    it("uses the persisted active context when no selector is supplied", async () => {
      await inRolledBackTransaction(async (tx, world) => {
        await tx.sql`insert into identity.user_active_contexts (user_id, membership_id)
          values (${world.userA}, ${world.membershipA})`;
        const resolver = createPostgresActorContextResolver({ sql: tx.sql });
        const resolution = await resolver.resolveHumanContext({
          principal: principal(world.authA),
        });
        expect(resolution.status).toBe("RESOLVED");
        if (resolution.status === "RESOLVED") {
          expect(resolution.context.membershipId).toBe(world.membershipA);
          expect(resolution.context.tenantId).toBe(world.tenantA);
        }
      });
    });

    it("fails closed once the persisted membership is revoked, and never falls back", async () => {
      await inRolledBackTransaction(async (tx, world) => {
        await tx.sql`insert into identity.user_active_contexts (user_id, membership_id)
          values (${world.userA}, ${world.membershipA})`;
        await tx.sql`update identity.organisation_memberships
          set membership_status = 'revoked', left_at = now() where id = ${world.membershipA}`;

        const resolver = createPostgresActorContextResolver({ sql: tx.sql });
        await expect(
          resolver.resolveHumanContext({ principal: principal(world.authA) }),
        ).resolves.toEqual({ status: "CONTEXT_REQUIRED" });
        await expect(
          resolver.resolveHumanContext({
            principal: principal(world.authA),
            selection: { organisationId: world.orgA },
          }),
        ).resolves.toEqual({ status: "CONTEXT_NOT_ACCESSIBLE" });
      });
    });

    it("never resolves a persisted context that points at a different organisation than requested", async () => {
      await inRolledBackTransaction(async (tx, world) => {
        await tx.sql`insert into identity.user_active_contexts (user_id, membership_id)
          values (${world.userA}, ${world.membershipA})`;
        const resolver = createPostgresActorContextResolver({ sql: tx.sql });
        // Selector for B with persisted A: the selector wins and is denied;
        // the persisted row is not consulted as a fallback.
        await expect(
          resolveHumanActorContext(resolver, {
            principal: principal(world.authA),
            selection: { organisationId: world.orgB },
          }),
        ).resolves.toEqual({ status: "CONTEXT_NOT_ACCESSIBLE" });
      });
    });
  });

  // -------------------------------------------------------------------------
  // ActiveOrganisationContextStore
  // -------------------------------------------------------------------------

  describe("PostgresActiveOrganisationContextStore", () => {
    it("persists a valid active membership by organisation or by membership id", async () => {
      await inRolledBackTransaction(async (tx, world) => {
        const store = createPostgresActiveOrganisationContextStore({
          transactions: nestedTransactions(tx),
        });
        const resolver = createPostgresActorContextResolver({ sql: tx.sql });

        await expect(
          store.setActiveContext({
            userId: world.userA,
            organisationId: world.orgA,
          }),
        ).resolves.toEqual({
          status: "ACTIVE_CONTEXT_SET",
          membershipId: world.membershipA,
        });
        const first = await resolver.resolveHumanContext({
          principal: principal(world.authA),
        });
        expect(first.status).toBe("RESOLVED");

        await expect(
          store.setActiveContext({
            userId: world.userA,
            membershipId: world.membershipA,
          }),
        ).resolves.toEqual({
          status: "ACTIVE_CONTEXT_SET",
          membershipId: world.membershipA,
        });
      });
    });

    it("rejects another person's membership, a revoked membership and a foreign-tenant organisation", async () => {
      await inRolledBackTransaction(async (tx, world) => {
        const store = createPostgresActiveOrganisationContextStore({
          transactions: nestedTransactions(tx),
        });

        await expect(
          store.setActiveContext({
            userId: world.userA,
            membershipId: world.membershipB,
          }),
        ).resolves.toEqual({ status: "MEMBERSHIP_NOT_ACCESSIBLE" });
        await expect(
          store.setActiveContext({
            userId: world.userA,
            organisationId: world.orgB,
          }),
        ).resolves.toEqual({ status: "MEMBERSHIP_NOT_ACCESSIBLE" });

        await tx.sql`update identity.organisation_memberships
          set membership_status = 'revoked', left_at = now() where id = ${world.membershipA}`;
        await expect(
          store.setActiveContext({
            userId: world.userA,
            organisationId: world.orgA,
          }),
        ).resolves.toEqual({ status: "MEMBERSHIP_NOT_ACCESSIBLE" });

        const rows =
          await tx.sql`select 1 from identity.user_active_contexts where user_id = ${world.userA}`;
        expect(rows).toHaveLength(0);
      });
    });
  });

  // -------------------------------------------------------------------------
  // AuthorizationPolicySource
  // -------------------------------------------------------------------------

  describe("PostgresAuthorizationPolicySource", () => {
    it("expands a current organisation_admin assignment into an organisation-scoped ALLOW", async () => {
      await inRolledBackTransaction(async (tx, world) => {
        await assignAdmin(tx, world);
        const source = createPostgresAuthorizationPolicySource({ sql: tx.sql });
        const actor = actorA(world);
        const resource = {
          kind: "ORGANISATION",
          tenantId: world.tenantA,
          organisationId: world.orgA,
        } as const;

        const facts = await source.getPolicyFacts({
          actor,
          capability: ORGANISATION_ADMIN,
          resource,
        });
        expect(facts).toEqual({
          grants: [
            {
              capability: ORGANISATION_ADMIN,
              scope: resource,
              source: "ROLE_TEMPLATE",
            },
          ],
          denials: [],
          unmetRequirements: [],
        });

        const decision = await createAuthorizationService(source).authorize({
          actor,
          capability: ORGANISATION_ADMIN,
          resource,
        });
        expect(decision.outcome).toBe("ALLOW");

        // The template grants organisation.admin only.
        const other = await source.getPolicyFacts({
          actor,
          capability: FINANCIALS_VIEW,
          resource,
        });
        expect(other.grants).toHaveLength(0);
      });
    });

    it("ignores expired and not-yet-valid role assignments", async () => {
      await inRolledBackTransaction(async (tx, world) => {
        await assignAdmin(tx, world, {
          validFrom: "2020-01-01T00:00:00Z",
          validUntil: "2020-06-01T00:00:00Z",
        });
        await assignAdmin(tx, world, { validFrom: "2999-01-01T00:00:00Z" });
        const source = createPostgresAuthorizationPolicySource({ sql: tx.sql });
        const facts = await source.getPolicyFacts({
          actor: actorA(world),
          capability: ORGANISATION_ADMIN,
          resource: {
            kind: "ORGANISATION",
            tenantId: world.tenantA,
            organisationId: world.orgA,
          },
        });
        expect(facts.grants).toHaveLength(0);
      });
    });

    it("returns an explicit ALLOW grant with its typed scope, including RESOURCE scope", async () => {
      await inRolledBackTransaction(async (tx, world) => {
        const resourceId = randomUUID();
        await insertGrant(tx, world, {
          capabilityCode: "data_room.share",
          effect: "ALLOW",
          scope: {
            kind: "ORGANISATION",
            tenantId: world.tenantA,
            organisationId: world.orgA,
          },
        });
        await insertGrant(tx, world, {
          capabilityCode: "company.financials.view",
          effect: "ALLOW",
          principalType: "membership",
          principalId: world.membershipA,
          scope: {
            kind: "RESOURCE",
            tenantId: world.tenantA,
            organisationId: world.orgA,
            resourceType: "company",
            resourceId,
          },
          resourceType: "company",
          resourceId,
        });
        const source = createPostgresAuthorizationPolicySource({ sql: tx.sql });
        const actor = actorA(world);

        const share = await source.getPolicyFacts({
          actor,
          capability: DATA_ROOM_SHARE,
          resource: {
            kind: "ORGANISATION",
            tenantId: world.tenantA,
            organisationId: world.orgA,
          },
        });
        expect(share.grants).toEqual([
          {
            capability: DATA_ROOM_SHARE,
            scope: {
              kind: "ORGANISATION",
              tenantId: world.tenantA,
              organisationId: world.orgA,
            },
            source: "EXPLICIT_GRANT",
          },
        ]);

        const view = await source.getPolicyFacts({
          actor,
          capability: FINANCIALS_VIEW,
          resource: {
            kind: "RESOURCE",
            tenantId: world.tenantA,
            organisationId: world.orgA,
            resourceType: "company",
            resourceId,
          },
        });
        expect(view.grants).toHaveLength(1);
        expect(view.grants[0]?.scope.kind).toBe("RESOURCE");
      });
    });

    it("returns an explicit DENY as a denial that the service applies over a role grant", async () => {
      await inRolledBackTransaction(async (tx, world) => {
        await assignAdmin(tx, world);
        await insertGrant(tx, world, {
          capabilityCode: "organisation.admin",
          effect: "DENY",
          scope: {
            kind: "ORGANISATION",
            tenantId: world.tenantA,
            organisationId: world.orgA,
          },
        });
        const source = createPostgresAuthorizationPolicySource({ sql: tx.sql });
        const actor = actorA(world);
        const resource = {
          kind: "ORGANISATION",
          tenantId: world.tenantA,
          organisationId: world.orgA,
        } as const;

        const facts = await source.getPolicyFacts({
          actor,
          capability: ORGANISATION_ADMIN,
          resource,
        });
        expect(facts.grants).toHaveLength(1);
        expect(facts.denials).toEqual([
          {
            capability: ORGANISATION_ADMIN,
            scope: resource,
            source: "EXPLICIT_DENIAL",
          },
        ]);

        const decision = await createAuthorizationService(source).authorize({
          actor,
          capability: ORGANISATION_ADMIN,
          resource,
        });
        expect(decision.outcome).toBe("DENY");
        expect(decision.reasonCode).toBe("EXPLICIT_DENIAL");
      });
    });

    it("ignores expired, revoked and future grants", async () => {
      await inRolledBackTransaction(async (tx, world) => {
        const scope = {
          kind: "ORGANISATION",
          tenantId: world.tenantA,
          organisationId: world.orgA,
        };
        await insertGrant(tx, world, {
          capabilityCode: "data_room.share",
          effect: "ALLOW",
          scope,
          validFrom: "2020-01-01T00:00:00Z",
          validUntil: "2020-06-01T00:00:00Z",
        });
        await insertGrant(tx, world, {
          capabilityCode: "data_room.share",
          effect: "ALLOW",
          scope,
          revokedAt: "2024-01-01T00:00:00Z",
        });
        await insertGrant(tx, world, {
          capabilityCode: "data_room.share",
          effect: "ALLOW",
          scope,
          validFrom: "2999-01-01T00:00:00Z",
        });
        const source = createPostgresAuthorizationPolicySource({ sql: tx.sql });
        const facts = await source.getPolicyFacts({
          actor: actorA(world),
          capability: DATA_ROOM_SHARE,
          resource: {
            kind: "ORGANISATION",
            tenantId: world.tenantA,
            organisationId: world.orgA,
          },
        });
        expect(facts.grants).toHaveLength(0);

        const decision = await createAuthorizationService(source).authorize({
          actor: actorA(world),
          capability: DATA_ROOM_SHARE,
          resource: {
            kind: "ORGANISATION",
            tenantId: world.tenantA,
            organisationId: world.orgA,
          },
        });
        expect(decision.outcome).toBe("DENY");
      });
    });

    it("fails closed on a malformed persisted scope and reports it without the raw JSON", async () => {
      await inRolledBackTransaction(async (tx, world) => {
        // A perfectly valid ALLOW plus one corrupt row for the same capability.
        await insertGrant(tx, world, {
          capabilityCode: "data_room.share",
          effect: "ALLOW",
          scope: {
            kind: "ORGANISATION",
            tenantId: world.tenantA,
            organisationId: world.orgA,
          },
        });
        const corruptId = await insertGrant(tx, world, {
          capabilityCode: "data_room.share",
          effect: "ALLOW",
          scope: {
            kind: "ORGANISATION",
            tenantId: world.tenantA,
            secret: "do-not-echo",
          },
        });
        const failures: PolicyIntegrityFailure[] = [];
        const source = createPostgresAuthorizationPolicySource({
          sql: tx.sql,
          onIntegrityFailure: (failure) => failures.push(failure),
        });

        const facts = await source.getPolicyFacts({
          actor: actorA(world),
          capability: DATA_ROOM_SHARE,
          resource: {
            kind: "ORGANISATION",
            tenantId: world.tenantA,
            organisationId: world.orgA,
          },
        });
        expect(facts).toEqual({
          grants: [],
          denials: [],
          unmetRequirements: [],
        });
        expect(failures).toEqual([
          {
            source: "EXPLICIT_GRANT",
            reason: "MALFORMED_SCOPE",
            recordId: corruptId,
          },
        ]);
        expect(JSON.stringify(failures)).not.toContain("do-not-echo");
      });
    });

    it("fails closed when resource columns contradict the scope", async () => {
      await inRolledBackTransaction(async (tx, world) => {
        await insertGrant(tx, world, {
          capabilityCode: "data_room.share",
          effect: "ALLOW",
          scope: {
            kind: "ORGANISATION",
            tenantId: world.tenantA,
            organisationId: world.orgA,
          },
          resourceType: "company",
          resourceId: randomUUID(),
        });
        const failures: PolicyIntegrityFailure[] = [];
        const source = createPostgresAuthorizationPolicySource({
          sql: tx.sql,
          onIntegrityFailure: (failure) => failures.push(failure),
        });
        const facts = await source.getPolicyFacts({
          actor: actorA(world),
          capability: DATA_ROOM_SHARE,
          resource: {
            kind: "ORGANISATION",
            tenantId: world.tenantA,
            organisationId: world.orgA,
          },
        });
        expect(facts.grants).toHaveLength(0);
        expect(failures.map((f) => f.reason)).toEqual(["RESOURCE_MISMATCH"]);
      });
    });

    it("returns no facts for an ActorContext whose membership the database does not confirm", async () => {
      await inRolledBackTransaction(async (tx, world) => {
        await assignAdmin(tx, world);
        const source = createPostgresAuthorizationPolicySource({ sql: tx.sql });
        const resource = {
          kind: "ORGANISATION",
          tenantId: world.tenantA,
          organisationId: world.orgA,
        } as const;

        // User B claiming A's membership.
        const forged = ActorContextSchema.parse({
          userId: world.userB,
          tenantId: world.tenantA,
          organisationId: world.orgA,
          membershipId: world.membershipA,
          actorType: "HUMAN",
        });
        const facts = await source.getPolicyFacts({
          actor: forged,
          capability: ORGANISATION_ADMIN,
          resource,
        });
        expect(facts).toEqual({
          grants: [],
          denials: [],
          unmetRequirements: [],
        });

        // Revoked membership with an otherwise correct context.
        await tx.sql`update identity.organisation_memberships
          set membership_status = 'revoked', left_at = now() where id = ${world.membershipA}`;
        const revoked = await source.getPolicyFacts({
          actor: actorA(world),
          capability: ORGANISATION_ADMIN,
          resource,
        });
        expect(revoked.grants).toHaveLength(0);
      });
    });

    it("gives Q and SYSTEM actors nothing without explicit grants", async () => {
      await inRolledBackTransaction(async (tx, world) => {
        await assignAdmin(tx, world);
        const source = createPostgresAuthorizationPolicySource({ sql: tx.sql });
        const service = createAuthorizationService(source);
        const resource = { kind: "TENANT", tenantId: world.tenantA } as const;

        for (const actorType of ["Q", "SYSTEM"] as const) {
          const actor = ActorContextSchema.parse({
            userId: world.userA,
            tenantId: world.tenantA,
            actorType,
          });
          const decision = await service.authorize({
            actor,
            capability: ORGANISATION_ADMIN,
            resource,
          });
          expect(decision.outcome).toBe("DENY");
          expect(decision.reasonCode).toBe("NO_MATCHING_GRANT");
        }
      });
    });
  });
});
