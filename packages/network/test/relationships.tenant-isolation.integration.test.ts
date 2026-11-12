import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import {
  CompanyIdSchema,
  createPostgresCompanyQueryPort,
  type CompanyId,
} from "@capital-q/companies";
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
  createPostgresInvestorOrganisationQueryPort,
  InvestorOrganisationIdSchema,
  type InvestorOrganisationId,
} from "@capital-q/investors";
import {
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

import { NETWORK_EVENTS } from "../src/events/index.js";
import { createInterestService, type InterestService } from "../src/index.js";

/**
 * Application-path tenant isolation for relationships, relationship events
 * and interests (security lane, 2026-11-12).
 *
 * Production runs every server statement as `postgres`, which bypasses RLS
 * (ADR 0065; docs/ai-handoff/RLS-RUNTIME-ROLE-PLAN.md). Isolation for server
 * traffic is therefore the access context each use case takes. These tests
 * drive the real services against the local database as `postgres`, exactly
 * as the server does, with no mocked repositories, and prove for actors of
 * ANOTHER tenant:
 *   1. a real tenant-held id gets the same answer as an id that never
 *      existed (no existence oracle), and
 *   2. no domain, outbox or audit row is written by the attempt.
 * For a revoked member they prove the real request path (the actor-context
 * resolver) refuses the membership, and that a stale context the services
 * might still be handed reads nothing and writes nothing.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;

/** Every table an interest, relationship or answer could write to. */
const WRITE_SURFACE = [
  "network.relationships",
  "network.relationship_events",
  "network.interests",
  "network.interest_requests",
  "network.interest_responses",
  "network.interest_response_requests",
  "network.matches",
  "events.outbox",
  "audit.material_actions",
] as const;

class Rollback extends Error {}

type Outcome =
  | { readonly kind: "value"; readonly value: unknown }
  | {
      readonly kind: "refused";
      readonly name: string;
      readonly message: string;
    };

/** What a caller observes: the value, or the refusal's name and message. */
async function outcome(attempt: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { kind: "value", value: await attempt() };
  } catch (error: unknown) {
    if (error instanceof Error) {
      return { kind: "refused", name: error.name, message: error.message };
    }
    throw error;
  }
}

/** Nothing usable came back: a refusal, null, false or an empty list. */
function isNothing(result: Outcome): boolean {
  if (result.kind === "refused") return true;
  const { value } = result;
  return (
    value === null ||
    value === false ||
    (Array.isArray(value) && value.length === 0)
  );
}

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

type World = {
  readonly tx: TransactionContext;
  readonly interests: InterestService;
  readonly companyA: CompanyId;
  readonly companyD: CompanyId;
  readonly investorA: InvestorOrganisationId;
  readonly founderA: ActorContext;
  readonly investorRep: ActorContext;
  /** The founder of a company in a third tenant. */
  readonly foreignFounder: ActorContext;
  /** A member of an investor organisation in a fourth tenant. */
  readonly foreignInvestorRep: ActorContext;
  readonly revokedFounder: {
    readonly principal: AuthenticatedPrincipal;
    readonly membershipId: string;
    readonly staleContext: ActorContext;
  };
  readonly revokedInvestorRep: {
    readonly principal: AuthenticatedPrincipal;
    readonly membershipId: string;
    readonly staleContext: ActorContext;
  };
  readonly resolve: (
    principal: AuthenticatedPrincipal,
  ) => Promise<ActorContext | null>;
};

describe("network: tenant isolation on the application path (as postgres)", () => {
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
    type: "company" | "investment_firm",
    name: string,
  ) {
    const id = randomUUID();
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${id}, ${tenantId}, ${type}, ${name}, ${`iso-${id.slice(0, 8)}`})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${id})`;
    return id;
  }

  async function insertCompany(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    name: string,
  ): Promise<CompanyId> {
    const id = randomUUID();
    await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
      values (${id}, ${tenantId}, ${organisationId}, ${name}, ${`iso-${id.slice(0, 8)}`})`;
    return CompanyIdSchema.parse(id);
  }

  async function insertInvestor(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    name: string,
  ): Promise<InvestorOrganisationId> {
    const id = randomUUID();
    await tx.sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
      values (${id}, ${tenantId}, ${organisationId}, 'VC', ${name})`;
    return InvestorOrganisationIdSchema.parse(id);
  }

  async function insertMember(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    role: "organisation_admin" | "organisation_member",
  ): Promise<{ principal: AuthenticatedPrincipal; membershipId: string }> {
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<{ id: string }[]>`
      select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) throw new Error("profile trigger did not run");
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = ${role}`;
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
    return {
      principal: { authUserId: AuthUserIdSchema.parse(authUserId) },
      membershipId,
    };
  }

  async function rowCounts(tx: TransactionContext) {
    const out: Record<string, number> = {};
    for (const table of WRITE_SURFACE) {
      const [row] = await tx.sql<{ n: number }[]>`
        select count(*)::int as n from ${tx.sql(table)}`;
      out[table] = row?.n ?? -1;
    }
    return out;
  }

  async function withWorld(work: (world: World) => Promise<void>) {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const resolver = createPostgresActorContextResolver({ sql: tx.sql });
        const resolve = async (principal: AuthenticatedPrincipal) => {
          const resolution = await resolveHumanActorContext(resolver, {
            principal,
          });
          return resolution.status === "RESOLVED" ? resolution.context : null;
        };
        const mustResolve = async (principal: AuthenticatedPrincipal) => {
          const context = await resolve(principal);
          if (context === null) throw new Error("context not resolved");
          return context;
        };

        const tenantC = await insertTenant(tx, "Isolation Company Tenant");
        const tenantI = await insertTenant(tx, "Isolation Investor Tenant");
        const tenantD = await insertTenant(tx, "Isolation Foreign Company");
        const tenantJ = await insertTenant(tx, "Isolation Foreign Investor");
        const companyOrg = await insertOrganisation(
          tx,
          tenantC,
          "company",
          "Kora",
        );
        const investorOrg = await insertOrganisation(
          tx,
          tenantI,
          "investment_firm",
          "Apex",
        );
        const foreignCompanyOrg = await insertOrganisation(
          tx,
          tenantD,
          "company",
          "Elsewhere",
        );
        const foreignInvestorOrg = await insertOrganisation(
          tx,
          tenantJ,
          "investment_firm",
          "Other Capital",
        );
        const companyA = await insertCompany(tx, tenantC, companyOrg, "Kora");
        const companyD = await insertCompany(
          tx,
          tenantD,
          foreignCompanyOrg,
          "Elsewhere",
        );
        const investorA = await insertInvestor(
          tx,
          tenantI,
          investorOrg,
          "Apex",
        );
        await insertInvestor(tx, tenantJ, foreignInvestorOrg, "Other Capital");

        const founderA = await mustResolve(
          (await insertMember(tx, tenantC, companyOrg, "organisation_admin"))
            .principal,
        );
        const investorRep = await mustResolve(
          (await insertMember(tx, tenantI, investorOrg, "organisation_member"))
            .principal,
        );
        const foreignFounder = await mustResolve(
          (
            await insertMember(
              tx,
              tenantD,
              foreignCompanyOrg,
              "organisation_admin",
            )
          ).principal,
        );
        const foreignInvestorRep = await mustResolve(
          (
            await insertMember(
              tx,
              tenantJ,
              foreignInvestorOrg,
              "organisation_member",
            )
          ).principal,
        );
        const revokedFounderMember = await insertMember(
          tx,
          tenantC,
          companyOrg,
          "organisation_admin",
        );
        const revokedInvestorMember = await insertMember(
          tx,
          tenantI,
          investorOrg,
          "organisation_member",
        );
        // Captured while active: what a stale cache or a long-lived job
        // could still hold after the revocation below.
        const revokedFounderContext = await mustResolve(
          revokedFounderMember.principal,
        );
        const revokedInvestorContext = await mustResolve(
          revokedInvestorMember.principal,
        );

        const outbox = createOutboxWriter({
          registry: createEventRegistry([...NETWORK_EVENTS]),
        });
        const interests = createInterestService({
          sql: tx.sql,
          transactions: nestedTransactions(tx),
          companies: createPostgresCompanyQueryPort({ sql: tx.sql }),
          investors: createPostgresInvestorOrganisationQueryPort({
            sql: tx.sql,
          }),
          outbox,
          audit: createPostgresMaterialActionAuditWriter(),
          authorization: createAuthorizationService(
            createPostgresAuthorizationPolicySource({ sql: tx.sql }),
          ),
          // The production port reads the investor organisation in the
          // actor's own tenant and organisation; this is the same query.
          investorSubject: {
            investorOrganisationFor: async (actor) => {
              if (actor.organisationId === undefined) return null;
              const [row] = await tx.sql<{ id: string }[]>`
                select id from core.investor_organisations
                 where tenant_id = ${actor.tenantId} and organisation_id = ${actor.organisationId}`;
              return row === undefined
                ? null
                : { investorOrganisationId: row.id };
            },
          },
          // Every company is visible to every investor here, so a refusal
          // can only come from the access context, not from discovery.
          companyVisibility: {
            isVisibleToInvestor: () => Promise.resolve(true),
          },
        });

        await work({
          tx,
          interests,
          companyA,
          companyD,
          investorA,
          founderA,
          investorRep,
          foreignFounder,
          foreignInvestorRep,
          revokedFounder: {
            ...revokedFounderMember,
            staleContext: revokedFounderContext,
          },
          revokedInvestorRep: {
            ...revokedInvestorMember,
            staleContext: revokedInvestorContext,
          },
          resolve,
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  /** One relationship with one open interest, from the investor to company A. */
  async function seedInterest(world: World) {
    const result = await world.interests.expressInterest({
      actor: world.investorRep,
      companyId: world.companyA,
      surface: "RECOMMENDATION_FEED",
      idempotencyKey: `iso:${randomUUID()}`,
      correlationId: CORRELATION(),
    });
    return result.interest;
  }

  async function revoke(tx: TransactionContext, membershipId: string) {
    await tx.sql`update identity.organisation_memberships
      set membership_status = 'revoked', left_at = clock_timestamp()
      where id = ${membershipId}`;
  }

  it("another tenant's founder gets the same answer for a real relationship or interest id as for one that never existed, and writes nothing", async () => {
    await withWorld(async (world) => {
      const { tx, interests, foreignFounder, investorA } = world;
      const interest = await seedInterest(world);
      const before = await rowCounts(tx);

      const pairs: [() => Promise<unknown>, () => Promise<unknown>][] = [
        [
          () =>
            interests.relationshipById({
              actor: foreignFounder,
              relationshipId: interest.relationshipId,
            }),
          () =>
            interests.relationshipById({
              actor: foreignFounder,
              relationshipId: randomUUID(),
            }),
        ],
        [
          () =>
            interests.relationshipForCompany({
              actor: foreignFounder,
              investorOrganisationId: investorA,
            }),
          () =>
            interests.relationshipForCompany({
              actor: foreignFounder,
              investorOrganisationId: randomUUID(),
            }),
        ],
        [
          () =>
            interests.listIncomingInterest({
              actor: foreignFounder,
              companyId: world.companyA,
            }),
          () =>
            interests.listIncomingInterest({
              actor: foreignFounder,
              companyId: randomUUID(),
            }),
        ],
        [
          () =>
            interests.mayRespondToInterest({
              actor: foreignFounder,
              interestId: interest.id,
            }),
          () =>
            interests.mayRespondToInterest({
              actor: foreignFounder,
              interestId: randomUUID(),
            }),
        ],
        [
          () =>
            interests.respondToInterest({
              actor: foreignFounder,
              interestId: interest.id,
              decision: "ACCEPTED",
              surface: "INBOX",
              idempotencyKey: `iso:${randomUUID()}`,
              correlationId: CORRELATION(),
            }),
          () =>
            interests.respondToInterest({
              actor: foreignFounder,
              interestId: randomUUID(),
              decision: "ACCEPTED",
              surface: "INBOX",
              idempotencyKey: `iso:${randomUUID()}`,
              correlationId: CORRELATION(),
            }),
        ],
      ];
      for (const [real, missing] of pairs) {
        const seen = await outcome(real);
        expect(isNothing(seen)).toBe(true);
        expect(seen).toEqual(await outcome(missing));
      }

      expect(await rowCounts(tx)).toEqual(before);
    });
  });

  it("another tenant's investor gets the same answer for a real company's relationship as for a company that never existed, and writes nothing", async () => {
    await withWorld(async (world) => {
      const { tx, interests, foreignInvestorRep, companyA } = world;
      const interest = await seedInterest(world);
      const before = await rowCounts(tx);

      const byId = await outcome(() =>
        interests.relationshipById({
          actor: foreignInvestorRep,
          relationshipId: interest.relationshipId,
        }),
      );
      expect(byId).toEqual({ kind: "value", value: null });
      expect(byId).toEqual(
        await outcome(() =>
          interests.relationshipById({
            actor: foreignInvestorRep,
            relationshipId: randomUUID(),
          }),
        ),
      );

      // Company A is visible to every investor in this world, so the
      // foreign investor legitimately sees "no relationship yet" — never
      // the Apex relationship that exists on the same company.
      expect(
        await interests.relationshipForInvestor({
          actor: foreignInvestorRep,
          companyId: companyA,
        }),
      ).toBeNull();
      expect(
        await interests.getOwnInterest({
          actor: foreignInvestorRep,
          companyId: companyA,
        }),
      ).toBeNull();
      expect(
        (
          await interests.listRelationshipsForInvestor({
            actor: foreignInvestorRep,
          })
        ).map((r) => r.relationship.id),
      ).not.toContain(interest.relationshipId);

      expect(await rowCounts(tx)).toEqual(before);
    });
  });

  it("a company founder of another tenant cannot list or reach company A's relationships through its own company id", async () => {
    await withWorld(async (world) => {
      const { tx, interests, foreignFounder, companyA, companyD } = world;
      const interest = await seedInterest(world);
      const before = await rowCounts(tx);

      const own = await interests.listRelationshipsForCompany({
        actor: foreignFounder,
        companyId: companyD,
      });
      expect(own.map((r) => r.relationship.id)).not.toContain(
        interest.relationshipId,
      );
      // Naming company A's id is the same answer as naming a random one.
      expect(
        await outcome(() =>
          interests.listRelationshipsForCompany({
            actor: foreignFounder,
            companyId: companyA,
          }),
        ),
      ).toEqual(
        await outcome(() =>
          interests.listRelationshipsForCompany({
            actor: foreignFounder,
            companyId: randomUUID(),
          }),
        ),
      );

      expect(await rowCounts(tx)).toEqual(before);
    });
  });

  it("a revoked founder or investor member gets no actor context, and a stale context reads nothing and writes nothing", async () => {
    await withWorld(async (world) => {
      const {
        tx,
        interests,
        investorA,
        companyA,
        revokedFounder,
        revokedInvestorRep,
        resolve,
      } = world;
      const interest = await seedInterest(world);
      await revoke(tx, revokedFounder.membershipId);
      await revoke(tx, revokedInvestorRep.membershipId);
      const before = await rowCounts(tx);

      // The real request path: the resolver refuses a revoked membership,
      // so no service is reached at all.
      expect(await resolve(revokedFounder.principal)).toBeNull();
      expect(await resolve(revokedInvestorRep.principal)).toBeNull();

      // Defence in depth: a context captured before the revocation.
      const founder = revokedFounder.staleContext;
      const investor = revokedInvestorRep.staleContext;
      const attempts: (() => Promise<unknown>)[] = [
        () =>
          interests.relationshipById({
            actor: founder,
            relationshipId: interest.relationshipId,
          }),
        () =>
          interests.relationshipForCompany({
            actor: founder,
            investorOrganisationId: investorA,
          }),
        () =>
          interests.listIncomingInterest({
            actor: founder,
            companyId: companyA,
          }),
        () =>
          interests.mayRespondToInterest({
            actor: founder,
            interestId: interest.id,
          }),
        () =>
          interests.respondToInterest({
            actor: founder,
            interestId: interest.id,
            decision: "DECLINED",
            surface: "INBOX",
            idempotencyKey: `iso:${randomUUID()}`,
            correlationId: CORRELATION(),
          }),
        () =>
          interests.relationshipForInvestor({
            actor: investor,
            companyId: companyA,
          }),
        () =>
          interests.relationshipById({
            actor: investor,
            relationshipId: interest.relationshipId,
          }),
        () =>
          interests.expressInterest({
            actor: investor,
            companyId: companyA,
            surface: "RECOMMENDATION_FEED",
            idempotencyKey: `iso:${randomUUID()}`,
            correlationId: CORRELATION(),
          }),
      ];
      for (const attempt of attempts) {
        expect(isNothing(await outcome(attempt))).toBe(true);
      }

      // Recorded, not asserted as desired: the lookup-first paths answer a
      // stale former member "forbidden" for a real id and "not found" /
      // null for a missing one (respond, relationshipById,
      // relationshipForCompany). Only a former member of the owning
      // organisation can observe it, and only with a context the resolver
      // would no longer issue. See the security-lane report.
      const respondReal = await outcome(() =>
        interests.respondToInterest({
          actor: founder,
          interestId: interest.id,
          decision: "DECLINED",
          surface: "INBOX",
          idempotencyKey: `iso:${randomUUID()}`,
          correlationId: CORRELATION(),
        }),
      );
      expect(respondReal).toMatchObject({
        kind: "refused",
        name: "AuthorizationDeniedError",
      });

      expect(await rowCounts(tx)).toEqual(before);
    });
  });
});
