import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import { parseDatabaseConfig } from "@capital-q/config/database";
import { createEventRegistry, type CorrelationId } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import { createPostgresOrganisationQueryPort } from "@capital-q/organisations";
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

import { INVESTOR_EVENTS } from "../src/events/index.js";
import {
  createInvestorService,
  InvestorMandateIdSchema,
  InvestorOrganisationIdSchema,
  type InvestorMandateId,
  type InvestorOrganisationId,
  type InvestorService,
} from "../src/index.js";

/**
 * Application-path tenant isolation for investor mandates (security lane,
 * 2026-11-12).
 *
 * Production runs every server statement as `postgres`, which bypasses RLS
 * (ADR 0065; docs/ai-handoff/RLS-RUNTIME-ROLE-PLAN.md), so a mandate is
 * isolated only by the access context its use cases take. Against the local
 * database, as `postgres`, through the real service: an admin of another
 * tenant gets the same answer for a real mandate (or investor organisation)
 * id as for one that never existed, on read, list, update, activate and
 * close, and nothing is written; a revoked member gets no context, and a
 * stale one reads and writes nothing.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;

const WRITE_SURFACE = [
  "core.investor_mandates",
  "core.investor_mandate_constraints",
  "core.investor_mandate_creation_requests",
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

type Member = {
  readonly principal: AuthenticatedPrincipal;
  readonly membershipId: string;
};

type World = {
  readonly tx: TransactionContext;
  readonly service: InvestorService;
  readonly resolve: (
    principal: AuthenticatedPrincipal,
  ) => Promise<ActorContext | null>;
  readonly adminA: ActorContext;
  readonly adminB: ActorContext;
  readonly revokedA: Member & { readonly staleContext: ActorContext };
  readonly investorA: InvestorOrganisationId;
  readonly investorB: InvestorOrganisationId;
};

describe("investor mandates: tenant isolation on the application path (as postgres)", () => {
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
  ) {
    const id = randomUUID();
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${id}, ${tenantId}, 'investment_firm', ${name}, ${`iso-${id.slice(0, 8)}`})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${id})`;
    return id;
  }

  async function insertMember(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
  ): Promise<Member> {
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<{ id: string }[]>`
      select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) throw new Error("profile trigger did not run");
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = 'organisation_admin'`;
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
        const { sql } = tx;
        const resolver = createPostgresActorContextResolver({ sql });
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

        const tenantA = await insertTenant(tx, "Isolation Mandate A");
        const tenantB = await insertTenant(tx, "Isolation Mandate B");
        const orgA = await insertOrganisation(tx, tenantA, "Apex Ventures");
        const orgB = await insertOrganisation(tx, tenantB, "Beta Capital");
        const adminA = await mustResolve(
          (await insertMember(tx, tenantA, orgA)).principal,
        );
        const adminB = await mustResolve(
          (await insertMember(tx, tenantB, orgB)).principal,
        );
        const revoked = await insertMember(tx, tenantA, orgA);
        const staleContext = await mustResolve(revoked.principal);

        const service = createInvestorService({
          sql,
          transactions: nestedTransactions(tx),
          authorization: createAuthorizationService(
            createPostgresAuthorizationPolicySource({ sql }),
          ),
          organisations: createPostgresOrganisationQueryPort({ sql }),
          outbox: createOutboxWriter({ registry }),
          audit: createPostgresMaterialActionAuditWriter(),
        });
        const investorA = (
          await service.createInvestorOrganisation({
            actor: adminA,
            input: { investorType: "VC" },
            idempotencyKey: `iso-investor-${randomUUID()}`,
            correlationId: CORRELATION(),
          })
        ).id;
        const investorB = (
          await service.createInvestorOrganisation({
            actor: adminB,
            input: { investorType: "FAMILY_OFFICE" },
            idempotencyKey: `iso-investor-${randomUUID()}`,
            correlationId: CORRELATION(),
          })
        ).id;

        await work({
          tx,
          service,
          resolve,
          adminA,
          adminB,
          revokedA: { ...revoked, staleContext },
          investorA,
          investorB,
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  async function seedMandate(world: World): Promise<InvestorMandateId> {
    const mandate = await world.service.createInvestorMandate({
      actor: world.adminA,
      investorOrganisationId: world.investorA,
      input: { name: "Isolation Seed Mandate" },
      idempotencyKey: `iso-mandate-${randomUUID()}`,
      correlationId: CORRELATION(),
    });
    return mandate.id;
  }

  const randomMandate = () => InvestorMandateIdSchema.parse(randomUUID());
  const randomInvestor = () => InvestorOrganisationIdSchema.parse(randomUUID());

  /** Every mandate use case that names an id, for one actor and one pair of ids. */
  function attempts(
    service: InvestorService,
    actor: ActorContext,
    investorOrganisationId: InvestorOrganisationId,
    mandateId: InvestorMandateId,
  ): (() => Promise<unknown>)[] {
    const scoped = { actor, investorOrganisationId, mandateId };
    return [
      () => service.getInvestorMandate(scoped),
      () =>
        service.updateInvestorMandate({
          ...scoped,
          input: { expectedVersion: 1, discoveryMode: "BALANCED" },
          correlationId: CORRELATION(),
        }),
      () =>
        service.activateInvestorMandate({
          ...scoped,
          input: {},
          correlationId: CORRELATION(),
        }),
      () =>
        service.closeInvestorMandate({
          ...scoped,
          input: {},
          correlationId: CORRELATION(),
        }),
    ];
  }

  it("another tenant's admin gets the same answer for a real mandate as for one that never existed, under either investor id, and writes nothing", async () => {
    await withWorld(async (world) => {
      const { tx, service, adminB, investorA, investorB } = world;
      const mandateA = await seedMandate(world);
      const before = await rowCounts(tx);

      // Naming tenant A's investor organisation and mandate.
      const viaForeignInvestor = attempts(service, adminB, investorA, mandateA);
      const viaMissingInvestor = attempts(
        service,
        adminB,
        randomInvestor(),
        randomMandate(),
      );
      // Naming the actor's own investor organisation with A's mandate id.
      const viaOwnInvestor = attempts(service, adminB, investorB, mandateA);
      const viaOwnMissing = attempts(
        service,
        adminB,
        investorB,
        randomMandate(),
      );

      for (let i = 0; i < viaForeignInvestor.length; i += 1) {
        const foreign = await outcome(
          viaForeignInvestor[i] ?? (() => Promise.resolve(null)),
        );
        expect(foreign.kind).toBe("refused");
        expect(foreign).toEqual(
          await outcome(viaMissingInvestor[i] ?? (() => Promise.resolve(null))),
        );
        const own = await outcome(
          viaOwnInvestor[i] ?? (() => Promise.resolve(null)),
        );
        expect(own.kind).toBe("refused");
        expect(own).toEqual(
          await outcome(viaOwnMissing[i] ?? (() => Promise.resolve(null))),
        );
      }

      const listed = await outcome(() =>
        service.listInvestorMandates({
          actor: adminB,
          investorOrganisationId: investorA,
        }),
      );
      expect(listed.kind).toBe("refused");
      expect(listed).toEqual(
        await outcome(() =>
          service.listInvestorMandates({
            actor: adminB,
            investorOrganisationId: randomInvestor(),
          }),
        ),
      );
      expect(
        (
          await service.listInvestorMandates({
            actor: adminB,
            investorOrganisationId: investorB,
          })
        ).items.map((m) => m.id),
      ).not.toContain(mandateA);

      expect(await rowCounts(tx)).toEqual(before);
      // The mandate is untouched: still the DRAFT v1 tenant A created.
      const [row] = await tx.sql<{ status: string; version: number }[]>`
        select status, version from core.investor_mandates where id = ${mandateA}`;
      expect(row).toEqual({ status: "DRAFT", version: 1 });
    });
  });

  it("a revoked admin gets no actor context, and a stale context reads nothing and changes nothing", async () => {
    await withWorld(async (world) => {
      const { tx, service, resolve, revokedA, investorA } = world;
      const mandateA = await seedMandate(world);
      await tx.sql`update identity.organisation_memberships
        set membership_status = 'revoked', left_at = clock_timestamp()
        where id = ${revokedA.membershipId}`;
      const before = await rowCounts(tx);

      expect(await resolve(revokedA.principal)).toBeNull();

      for (const attempt of [
        ...attempts(service, revokedA.staleContext, investorA, mandateA),
        () =>
          service.listInvestorMandates({
            actor: revokedA.staleContext,
            investorOrganisationId: investorA,
          }),
      ]) {
        expect((await outcome(attempt)).kind).toBe("refused");
      }

      expect(await rowCounts(tx)).toEqual(before);
      const [row] = await tx.sql<{ status: string; version: number }[]>`
        select status, version from core.investor_mandates where id = ${mandateA}`;
      expect(row).toEqual({ status: "DRAFT", version: 1 });
    });
  });
});
