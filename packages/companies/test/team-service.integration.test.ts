import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  ContractValidationError,
  createEventRegistry,
  type CorrelationId,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import { createPostgresOrganisationQueryPort } from "@capital-q/organisations";
import {
  AuthorizationDeniedError,
  AuthUserIdSchema,
  capability,
  createAuthorizationService,
  resolveHumanActorContext,
  type ActorContext,
  type AuthenticatedPrincipal,
  type AuthorizationService,
} from "@capital-q/security";
import {
  createPostgresActorContextResolver,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";

import { COMPANY_EVENTS } from "../src/events/index.js";
import {
  CompanyMemberNotFoundError,
  CompanyNotFoundError,
  createCompanyService,
  FounderProfileNotAllowedError,
  FounderProfileNotFoundError,
  TeamVersionConflictError,
  type CompanyService,
} from "../src/index.js";

/**
 * Founder / team behaviour against the real local database, in rolled-back
 * transactions. Covers the identity/authority separations this packet
 * exists to protect and the privacy of founder narrative.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const SENTINEL = "PRIVATE-FOUNDER-SUMMARY-DO-NOT-EMIT";

class Rollback extends Error {}

type Person = { principal: AuthenticatedPrincipal; membershipId: string };

type World = {
  readonly tx: TransactionContext;
  readonly service: CompanyService;
  readonly authorization: AuthorizationService;
  readonly resolve: (
    principal: AuthenticatedPrincipal,
  ) => Promise<ActorContext>;
  readonly adminA: Person;
  readonly memberA: Person;
  readonly adminB: Person;
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

const registry = createEventRegistry([...COMPANY_EVENTS]);

describe("@capital-q/companies founder / team against local PostgreSQL", () => {
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
        const tenantA = await insert(tx, "tenant", "Team Tenant A");
        const tenantB = await insert(tx, "tenant", "Team Tenant B");
        const orgA = await insertOrganisation(tx, tenantA, "Team Org A");
        const orgB = await insertOrganisation(tx, tenantB, "Team Org B");
        const companyA = await insertCompany(tx, tenantA, orgA, "Team Co A");
        const companyB = await insertCompany(tx, tenantB, orgB, "Team Co B");
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
        const authorization = createAuthorizationService(
          createPostgresAuthorizationPolicySource({ sql }),
        );
        const service = createCompanyService({
          sql,
          transactions,
          authorization,
          organisations: createPostgresOrganisationQueryPort({ sql }),
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
          authorization,
          resolve,
          adminA,
          memberA,
          adminB,
          companyA,
          companyB,
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

  async function insert(
    tx: TransactionContext,
    _kind: "tenant",
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
  ) {
    const id = randomUUID();
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${id}, ${tenantId}, 'company', ${name}, ${`org-${id.slice(0, 8)}`})`;
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
      values (${id}, ${tenantId}, ${organisationId}, ${name}, ${`co-${id.slice(0, 8)}`})`;
    return id;
  }

  async function insertMember(
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

  function scope(actor: ActorContext, companyId: string) {
    if (actor.organisationId === undefined) {
      throw new Error("no organisation");
    }
    return {
      kind: "RESOURCE" as const,
      tenantId: actor.tenantId,
      organisationId: actor.organisationId,
      resourceType: "company",
      resourceId: companyId,
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

  // -------------------------------------------------------------------------
  // Self-link
  // -------------------------------------------------------------------------

  it("a member links themselves as founder: one current row, correct ids, no role change, audit and event; idempotent on retry", async () => {
    await withWorld(
      async ({ tx, service, authorization, resolve, memberA, companyA }) => {
        const actor = await resolve(memberA.principal);
        const rolesBefore = await roleCodes(tx, memberA.membershipId);
        const correlationId = CORRELATION();

        const member = await service.upsertMyCompanyMembership({
          actor,
          companyId: companyA as never,
          input: {
            relationshipType: "team_member",
            businessTitle: "CEO",
            isFounder: true,
          },
          correlationId,
        });
        expect(member.userId).toBe(actor.userId);
        expect(member.companyId).toBe(companyA);
        expect(member.tenantId).toBe(actor.tenantId);
        expect(member.isFounder).toBe(true);
        expect(member.isCurrent).toBe(true);
        expect(member.version).toBe(1);
        // CompanyMemberId is its own identifier.
        expect([actor.userId, actor.membershipId, companyA]).not.toContain(
          member.id,
        );

        const again = await service.upsertMyCompanyMembership({
          actor,
          companyId: companyA as never,
          input: {
            relationshipType: "team_member",
            businessTitle: "CEO",
            isFounder: true,
          },
          correlationId: CORRELATION(),
        });
        expect(again.id).toBe(member.id);
        expect(again.version).toBe(1);

        const [count] = await tx.sql<
          { count: number }[]
        >`select count(*)::int as count from core.company_members where company_id = ${companyA} and user_id = ${actor.userId}`;
        expect(count?.count).toBe(1);

        // Founder ≠ admin, CEO ≠ authority: roles and capabilities unchanged.
        expect(await roleCodes(tx, memberA.membershipId)).toEqual(rolesBefore);
        expect(rolesBefore).toEqual(["organisation_member"]);
        for (const cap of [
          "organisation.admin",
          "company.team.manage",
          "company.edit",
        ]) {
          const decision = await authorization.authorize({
            actor,
            capability: capability(cap),
            resource: scope(actor, companyA),
          });
          expect(decision.outcome, cap).toBe("DENY");
        }

        const audits = await tx.sql<
          {
            action_type: string;
            resource_type: string;
            resource_id: string;
            metadata: unknown;
          }[]
        >`
        select action_type, resource_type, resource_id, metadata from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`;
        expect(audits).toEqual([
          {
            action_type: "company_member.created",
            resource_type: "company_member",
            resource_id: member.id,
            metadata: { companyId: companyA, isFounder: true },
          },
        ]);
        const events = await tx.sql<
          { event_type: string; payload: { data: unknown } }[]
        >`
        select event_type, payload from events.outbox where payload ->> 'correlationId' = ${correlationId}`;
        expect(events).toHaveLength(1);
        expect(events[0]?.event_type).toBe("core.company_member.created");
        expect(events[0]?.payload.data).toEqual({
          companyMemberId: member.id,
          companyId: companyA,
          userId: actor.userId,
          isFounder: true,
        });

        // Read back through the query path.
        await expect(
          service.getMyCompanyMembership({
            actor,
            companyId: companyA as never,
          }),
        ).resolves.toMatchObject({ id: member.id });
      },
    );
  });

  it("an update changes only the relationship fields and preserves ended history on rejoin", async () => {
    await withWorld(async ({ tx, service, resolve, memberA, companyA }) => {
      const actor = await resolve(memberA.principal);
      const first = await service.upsertMyCompanyMembership({
        actor,
        companyId: companyA as never,
        input: { relationshipType: "team_member", isFounder: false },
        correlationId: CORRELATION(),
      });
      const correlationId = CORRELATION();
      const updated = await service.upsertMyCompanyMembership({
        actor,
        companyId: companyA as never,
        input: {
          relationshipType: "advisor",
          businessTitle: "Chair",
          isFounder: true,
        },
        correlationId,
      });
      expect(updated.id).toBe(first.id);
      expect(updated.version).toBe(2);
      const events = await tx.sql<
        { event_type: string; payload: { data: { changedFields: string[] } } }[]
      >`
        select event_type, payload from events.outbox where payload ->> 'correlationId' = ${correlationId}`;
      expect(events[0]?.event_type).toBe("core.company_member.updated");
      expect(events[0]?.payload.data.changedFields).toEqual([
        "relationshipType",
        "businessTitle",
        "isFounder",
      ]);

      // End the period (a later lifecycle operation); a new self-link opens a
      // new period and the old one stays.
      await tx.sql`update core.company_members set is_current = false, ended_at = clock_timestamp() where id = ${first.id}`;
      await expect(
        service.getMyCompanyMembership({ actor, companyId: companyA as never }),
      ).rejects.toBeInstanceOf(CompanyMemberNotFoundError);
      const rejoined = await service.upsertMyCompanyMembership({
        actor,
        companyId: companyA as never,
        input: { relationshipType: "team_member", isFounder: true },
        correlationId: CORRELATION(),
      });
      expect(rejoined.id).not.toBe(first.id);
      expect(rejoined.version).toBe(1);
      const rows = await tx.sql<
        { id: string; is_current: boolean }[]
      >`select id, is_current from core.company_members where company_id = ${companyA} and user_id = ${actor.userId} order by started_at`;
      expect(rows.map((r) => r.is_current)).toEqual([false, true]);
    });
  });

  it("cross-tenant and no-context self-link are refused without creating rows", async () => {
    await withWorld(async ({ tx, service, resolve, memberA, companyB }) => {
      const actor = await resolve(memberA.principal);
      await expect(
        service.upsertMyCompanyMembership({
          actor,
          companyId: companyB as never,
          input: { relationshipType: "team_member", isFounder: true },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(CompanyNotFoundError);
      await expect(
        service.getMyCompanyMembership({ actor, companyId: companyB as never }),
      ).rejects.toBeInstanceOf(CompanyNotFoundError);
      await expect(
        service.getCompanyTeamFacts({ actor, companyId: companyB as never }),
      ).rejects.toBeInstanceOf(CompanyNotFoundError);
      const [count] = await tx.sql<
        { count: number }[]
      >`select count(*)::int as count from core.company_members where user_id = ${actor.userId}`;
      expect(count?.count).toBe(0);

      const noContext: ActorContext = {
        userId: actor.userId,
        tenantId: actor.tenantId,
        actorType: "HUMAN",
      };
      await expect(
        service.upsertMyCompanyMembership({
          actor: noContext,
          companyId: companyB as never,
          input: { relationshipType: "team_member", isFounder: true },
          correlationId: CORRELATION(),
        }),
      ).rejects.toBeInstanceOf(CompanyNotFoundError);
    });
  });

  it("admin does not imply founder; company membership does not survive organisation revocation as access", async () => {
    await withWorld(async ({ tx, service, resolve, adminA, companyA }) => {
      const actor = await resolve(adminA.principal);
      await expect(
        service.getMyCompanyMembership({ actor, companyId: companyA as never }),
      ).rejects.toBeInstanceOf(CompanyMemberNotFoundError);
      await expect(
        service.getMyFounderProfile({ actor, companyId: companyA as never }),
      ).rejects.toBeInstanceOf(FounderProfileNotAllowedError);
      const [profiles] = await tx.sql<
        { count: number }[]
      >`select count(*)::int as count from core.founder_profiles where user_id = ${actor.userId}`;
      expect(profiles?.count).toBe(0);

      // Become a founder, then lose organisation membership.
      await service.upsertMyCompanyMembership({
        actor,
        companyId: companyA as never,
        input: { relationshipType: "team_member", isFounder: true },
        correlationId: CORRELATION(),
      });
      await tx.sql`update identity.organisation_memberships set membership_status = 'revoked', left_at = clock_timestamp() where id = ${adminA.membershipId}`;
      await expect(resolve(adminA.principal)).rejects.toThrow(
        "CONTEXT_REQUIRED",
      );
      // The stale context, if replayed, still cannot authorise anything.
      await expect(
        service.getMyCompanyMembership({ actor, companyId: companyA as never }),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      const [history] = await tx.sql<
        { count: number }[]
      >`select count(*)::int as count from core.company_members where user_id = ${actor.userId} and is_current`;
      expect(history?.count).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Founder profile
  // -------------------------------------------------------------------------

  it("only a current founder can create a profile; text never reaches audit or events; versions protect writes", async () => {
    await withWorld(
      async ({ tx, service, resolve, memberA, adminB, companyA, companyB }) => {
        const actor = await resolve(memberA.principal);
        await service.upsertMyCompanyMembership({
          actor,
          companyId: companyA as never,
          input: { relationshipType: "team_member", isFounder: false },
          correlationId: CORRELATION(),
        });
        await expect(
          service.updateMyFounderProfile({
            actor,
            companyId: companyA as never,
            input: { professionalSummary: "x" },
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(FounderProfileNotAllowedError);

        await service.upsertMyCompanyMembership({
          actor,
          companyId: companyA as never,
          input: { relationshipType: "team_member", isFounder: true },
          correlationId: CORRELATION(),
        });
        await expect(
          service.getMyFounderProfile({ actor, companyId: companyA as never }),
        ).rejects.toBeInstanceOf(FounderProfileNotFoundError);

        const created = await service.updateMyFounderProfile({
          actor,
          companyId: companyA as never,
          input: {
            professionalSummary: "Rail engineer",
            backgroundSummary: SENTINEL,
          },
          correlationId: CORRELATION(),
        });
        expect(created.userId).toBe(actor.userId);
        expect(created.tenantId).toBe(actor.tenantId);
        expect(created.primaryCompanyId).toBe(companyA);
        expect(created.visibilityScope).toBe("founder_private");
        expect(created.version).toBe(1);
        expect(created.backgroundSummary).toBe(SENTINEL);

        const correlationId = CORRELATION();
        const updated = await service.updateMyFounderProfile({
          actor,
          companyId: companyA as never,
          input: { expectedVersion: 1, backgroundSummary: `${SENTINEL}-2` },
          correlationId,
        });
        expect(updated.version).toBe(2);
        expect(updated.primaryCompanyId).toBe(companyA);

        // Privacy: the sentinel exists only in the canonical row.
        const [leak] = await tx.sql<{ outbox: number; audit: number }[]>`
        select (select count(*)::int from events.outbox where payload::text like ${`%${SENTINEL}%`}) as outbox,
               (select count(*)::int from audit.material_actions where metadata::text like ${`%${SENTINEL}%`}) as audit`;
        expect(leak).toEqual({ outbox: 0, audit: 0 });
        const audits = await tx.sql<
          { action_type: string; metadata: unknown }[]
        >`
        select action_type, metadata from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`;
        expect(audits).toEqual([
          {
            action_type: "founder_profile.updated",
            metadata: {
              changedFields: ["backgroundSummary"],
              previousVersion: 1,
              newVersion: 2,
            },
          },
        ]);
        const events = await tx.sql<
          { event_type: string; payload: { data: unknown } }[]
        >`
        select event_type, payload from events.outbox where payload ->> 'correlationId' = ${correlationId}`;
        expect(events[0]?.event_type).toBe("core.founder_profile.updated");
        expect(events[0]?.payload.data).toEqual({
          founderProfileId: created.id,
          userId: actor.userId,
          primaryCompanyId: companyA,
          version: 2,
          changedFields: ["backgroundSummary"],
        });

        // Stale write and missing version are refused.
        await expect(
          service.updateMyFounderProfile({
            actor,
            companyId: companyA as never,
            input: { expectedVersion: 1, professionalSummary: "stale" },
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(TeamVersionConflictError);
        await expect(
          service.updateMyFounderProfile({
            actor,
            companyId: companyA as never,
            input: { professionalSummary: "no version" },
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(TeamVersionConflictError);
        const [row] = await tx.sql<
          { professional_summary: string; version: number }[]
        >`select professional_summary, version from core.founder_profiles where user_id = ${actor.userId}`;
        expect(row).toEqual({
          professional_summary: "Rail engineer",
          version: 2,
        });

        // Another person in another tenant cannot reach this profile through /me.
        const actorB = await resolve(adminB.principal);
        await service.upsertMyCompanyMembership({
          actor: actorB,
          companyId: companyB as never,
          input: { relationshipType: "team_member", isFounder: true },
          correlationId: CORRELATION(),
        });
        await expect(
          service.getMyFounderProfile({
            actor: actorB,
            companyId: companyB as never,
          }),
        ).rejects.toBeInstanceOf(FounderProfileNotFoundError);
        await expect(
          service.getMyFounderProfile({
            actor: actorB,
            companyId: companyA as never,
          }),
        ).rejects.toBeInstanceOf(CompanyNotFoundError);
      },
    );
  });

  // -------------------------------------------------------------------------
  // Team facts
  // -------------------------------------------------------------------------

  it("an admin records aggregate team facts without creating people; members read but cannot manage; constraints and versions hold", async () => {
    await withWorld(
      async ({ tx, service, resolve, adminA, memberA, companyA }) => {
        const admin = await resolve(adminA.principal);
        const member = await resolve(memberA.principal);
        await expect(
          service.getCompanyTeamFacts({
            actor: member,
            companyId: companyA as never,
          }),
        ).rejects.toThrow(/team facts/);

        const correlationId = CORRELATION();
        const facts = await service.updateCompanyTeamFacts({
          actor: admin,
          companyId: companyA as never,
          input: { founderCount: 3, fullTimeFounderCount: 2, teamSize: 11 },
          correlationId,
        });
        expect(facts).toMatchObject({
          founderCount: 3,
          fullTimeFounderCount: 2,
          teamSize: 11,
          version: 1,
        });
        const [people] = await tx.sql<{ profiles: number; members: number }[]>`
        select (select count(*)::int from identity.user_profiles) as profiles,
               (select count(*)::int from core.company_members where company_id = ${companyA}) as members`;
        expect(people?.members).toBe(0);
        const audits = await tx.sql<
          { action_type: string; metadata: unknown }[]
        >`select action_type, metadata from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`;
        expect(audits).toEqual([
          {
            action_type: "company_team.updated",
            metadata: {
              changedFields: [
                "founderCount",
                "fullTimeFounderCount",
                "teamSize",
              ],
              previousVersion: null,
              newVersion: 1,
            },
          },
        ]);
        const events = await tx.sql<
          { event_type: string }[]
        >`select event_type from events.outbox where payload ->> 'correlationId' = ${correlationId}`;
        expect(events.map((e) => e.event_type)).toEqual([
          "core.company_team.updated",
        ]);

        await expect(
          service.getCompanyTeamFacts({
            actor: member,
            companyId: companyA as never,
          }),
        ).resolves.toMatchObject({ teamSize: 11 });
        await expect(
          service.updateCompanyTeamFacts({
            actor: member,
            companyId: companyA as never,
            input: { expectedVersion: 1, teamSize: 12 },
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(AuthorizationDeniedError);

        for (const bad of [{ fullTimeFounderCount: 4 }, { founderCount: 12 }]) {
          await expect(
            service.updateCompanyTeamFacts({
              actor: admin,
              companyId: companyA as never,
              input: { expectedVersion: 1, ...bad },
              correlationId: CORRELATION(),
            }),
          ).rejects.toBeInstanceOf(ContractValidationError);
        }
        const unknown = await service.updateCompanyTeamFacts({
          actor: admin,
          companyId: companyA as never,
          input: { expectedVersion: 1, teamSize: null },
          correlationId: CORRELATION(),
        });
        expect(unknown).toMatchObject({
          founderCount: 3,
          teamSize: null,
          version: 2,
        });
        await expect(
          service.updateCompanyTeamFacts({
            actor: admin,
            companyId: companyA as never,
            input: { expectedVersion: 1, teamSize: 20 },
            correlationId: CORRELATION(),
          }),
        ).rejects.toBeInstanceOf(TeamVersionConflictError);
        const [row] = await tx.sql<
          { team_size: number | null; version: number }[]
        >`select team_size, version from core.company_team_facts where company_id = ${companyA}`;
        expect(row).toEqual({ team_size: null, version: 2 });
      },
    );
  });
});
