import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresCompanyQueryPort } from "@capital-q/companies";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createEventRegistry,
  type CorrelationId,
  type OnboardingResponseInput,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import {
  AuthUserIdSchema,
  resolveHumanActorContext,
  type AuthenticatedPrincipal,
} from "@capital-q/security";
import { createPostgresActorContextResolver } from "@capital-q/security/postgres";

import { ONBOARDING_EVENTS } from "../src/events/index.js";
import {
  createCompanyOnboardingSubjectResolver,
  createOnboardingService,
  OnboardingSessionIdSchema,
  type OnboardingActor,
  type OnboardingService,
  type OnboardingSessionId,
  type OnboardingWriteTargetHandler,
} from "../src/index.js";
import {
  SYNTHETIC_FOUNDER_MANIFEST,
  TEST_WRITE_TARGET,
} from "./synthetic-manifest.js";

/**
 * Application-path tenant isolation for onboarding sessions (security
 * lane, 2026-11-12).
 *
 * Production runs every server statement as `postgres`, which bypasses RLS
 * (ADR 0065; docs/ai-handoff/RLS-RUNTIME-ROLE-PLAN.md), and onboarding.* is
 * server-only. Against the local database, as `postgres`, through the real
 * runtime: an admin of another tenant gets the same answer for a real,
 * company-bound session id as for one that never existed, on read and on
 * every mutation, and nothing is written.
 *
 * Revocation: the actor-context resolver refuses a revoked membership. The
 * runtime owns a session by person alone (findByIdForUser: id + user_id, no
 * tenant or membership predicate), so the former founder acting personally
 * still reaches the company-bound session. That is recorded below as
 * today's behaviour and raised for an owner decision in
 * docs/ai-handoff/PERSON-VS-ORG-DATA.md.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;

const WRITE_SURFACE = [
  "onboarding.sessions",
  "onboarding.responses",
  "onboarding.step_states",
  "onboarding.session_creation_requests",
  "onboarding.session_mutation_requests",
  "onboarding.suggestions",
  "events.outbox",
] as const;

const select = (optionKey: string): OnboardingResponseInput => ({
  value: { type: "SINGLE_SELECT", optionKey },
});

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

const registry = createEventRegistry([...ONBOARDING_EVENTS]);

type Member = {
  readonly principal: AuthenticatedPrincipal;
  readonly membershipId: string;
  readonly actor: OnboardingActor;
};

type World = {
  readonly tx: TransactionContext;
  readonly service: OnboardingService;
  readonly resolve: (principal: AuthenticatedPrincipal) => Promise<boolean>;
  readonly founderA: Member;
  readonly adminC: Member;
  readonly companyA: string;
  /** Write-target applications, so a refused submit provably applied nothing. */
  readonly applied: string[];
};

describe("onboarding: tenant isolation on the application path (as postgres)", () => {
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
      values (${id}, ${tenantId}, 'company', ${name}, ${`iso-${id.slice(0, 8)}`})`;
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
      values (${id}, ${tenantId}, ${organisationId}, ${name}, ${`iso-${id.slice(0, 8)}`})`;
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
    const principal: AuthenticatedPrincipal = {
      authUserId: AuthUserIdSchema.parse(authUserId),
    };
    const resolution = await resolveHumanActorContext(
      createPostgresActorContextResolver({ sql: tx.sql }),
      { principal },
    );
    if (resolution.status !== "RESOLVED") {
      throw new Error(`context not resolved: ${resolution.status}`);
    }
    return {
      principal,
      membershipId,
      actor: { userId: resolution.context.userId, context: resolution.context },
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
        const tenantA = await insertTenant(tx, "Isolation Onboarding A");
        const tenantC = await insertTenant(tx, "Isolation Onboarding C");
        const orgA = await insertOrganisation(tx, tenantA, "Alpha");
        const orgC = await insertOrganisation(tx, tenantC, "Gamma");
        const companyA = await insertCompany(tx, tenantA, orgA, "Alpha Rails");
        await insertCompany(tx, tenantC, orgC, "Gamma Co");
        const founderA = await insertMember(tx, tenantA, orgA);
        const adminC = await insertMember(tx, tenantC, orgC);

        const applied: string[] = [];
        const recorder: OnboardingWriteTargetHandler = {
          targetKey: TEST_WRITE_TARGET,
          apply: (_context, response) => {
            applied.push(response.stepKey);
            return Promise.resolve();
          },
        };
        const service = createOnboardingService({
          sql: tx.sql,
          transactions: nestedTransactions(tx),
          outbox: createOutboxWriter({ registry }),
          subjectResolvers: [
            createCompanyOnboardingSubjectResolver(
              createPostgresCompanyQueryPort({ sql: tx.sql }),
            ),
          ],
          writeTargets: [recorder],
        });
        await service.publisher.publish(SYNTHETIC_FOUNDER_MANIFEST);

        const resolver = createPostgresActorContextResolver({ sql: tx.sql });
        const resolve = async (principal: AuthenticatedPrincipal) =>
          (await resolveHumanActorContext(resolver, { principal })).status ===
          "RESOLVED";

        await work({
          tx,
          service,
          resolve,
          founderA,
          adminC,
          companyA,
          applied,
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  /** A session tenant A's founder started for company A. */
  async function seedBoundSession(world: World): Promise<OnboardingSessionId> {
    const started = await world.service.runtime.startSession({
      actor: world.founderA.actor,
      journeyType: "external_investor_conversion",
      subject: { subjectType: "COMPANY", subjectId: world.companyA },
      idempotencyKey: randomUUID(),
      correlationId: CORRELATION(),
    });
    return OnboardingSessionIdSchema.parse(started.view.session.id);
  }

  function attempts(
    service: OnboardingService,
    actor: OnboardingActor,
    sessionId: OnboardingSessionId,
  ): (readonly [string, () => Promise<unknown>])[] {
    return [
      ["getSession", () => service.runtime.getSession({ actor, sessionId })],
      [
        "submitResponse",
        () =>
          service.runtime.submitResponse({
            actor,
            sessionId,
            stepKey: "intent",
            response: select("exploring"),
            expectedSessionVersion: 1,
            idempotencyKey: randomUUID(),
            correlationId: CORRELATION(),
          }),
      ],
      [
        "skipStep",
        () =>
          service.runtime.skipStep({
            actor,
            sessionId,
            stepKey: "notes",
            expectedSessionVersion: 1,
            idempotencyKey: randomUUID(),
            correlationId: CORRELATION(),
          }),
      ],
      [
        "goBack",
        () =>
          service.runtime.goBack({
            actor,
            sessionId,
            expectedSessionVersion: 1,
          }),
      ],
      [
        "completeSession",
        () =>
          service.runtime.completeSession({
            actor,
            sessionId,
            expectedSessionVersion: 1,
            correlationId: CORRELATION(),
          }),
      ],
    ];
  }

  it("another tenant's admin gets the same answer for a real company-bound session as for one that never existed, and nothing is written or applied", async () => {
    await withWorld(async (world) => {
      const { tx, service, adminC, applied } = world;
      const sessionId = await seedBoundSession(world);
      const before = await rowCounts(tx);
      const appliedBefore = applied.length;

      const viaReal = attempts(service, adminC.actor, sessionId);
      const viaMissing = attempts(
        service,
        adminC.actor,
        OnboardingSessionIdSchema.parse(randomUUID()),
      );
      for (let i = 0; i < viaReal.length; i += 1) {
        const [name, attempt] = viaReal[i] ?? ["?", () => Promise.resolve()];
        const seen = await outcome(attempt);
        const missing = await outcome(
          viaMissing[i]?.[1] ?? (() => Promise.resolve()),
        );
        expect({ name, seen }).toEqual({ name, seen: missing });
        expect(seen.kind).toBe("refused");
      }
      // The same holds for the person acting with no organisation context.
      const personal: OnboardingActor = {
        userId: adminC.actor.userId,
        context: null,
      };
      expect(
        await outcome(() =>
          service.runtime.getSession({ actor: personal, sessionId }),
        ),
      ).toEqual(
        await outcome(() =>
          service.runtime.getSession({
            actor: personal,
            sessionId: OnboardingSessionIdSchema.parse(randomUUID()),
          }),
        ),
      );

      expect(await rowCounts(tx)).toEqual(before);
      expect(applied.length).toBe(appliedBefore);
    });
  });

  it("a revoked founder gets no actor context; acting personally they still reach the company-bound session today (recorded for an owner decision)", async () => {
    await withWorld(async (world) => {
      const { tx, service, resolve, founderA, companyA } = world;
      const sessionId = await seedBoundSession(world);
      await tx.sql`update identity.organisation_memberships
        set membership_status = 'revoked', left_at = clock_timestamp()
        where id = ${founderA.membershipId}`;

      // The real request path refuses the revoked membership.
      expect(await resolve(founderA.principal)).toBe(false);

      // Today's behaviour, not a target: the person, signed in with no
      // organisation context, still reads the session bound to the
      // company they have left (and, per onboarding.integration.test.ts
      // "a bound session keeps its context", may still answer in it).
      // Flip this when the owner decides (PERSON-VS-ORG-DATA.md).
      const personal: OnboardingActor = {
        userId: founderA.actor.userId,
        context: null,
      };
      const seen = await service.runtime.getSession({
        actor: personal,
        sessionId,
      });
      expect(seen.session.subject).toEqual({ type: "COMPANY", id: companyA });
    });
  });
});
