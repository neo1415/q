import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import {
  CompanyIdSchema,
  createCompanyService,
  createPostgresCompanyQueryPort,
} from "@capital-q/companies";
import { parseApiConfig } from "@capital-q/config/api";
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
import { createPlatformAdmin } from "@capital-q/platform-admin";
import {
  AuthUserIdSchema,
  createAuthorizationService,
  resolveHumanActorContext,
  UserIdSchema,
  type ActorContext,
} from "@capital-q/security";
import {
  createPostgresActorContextResolver,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";
import {
  createCompanyVerificationService,
  createDecidedClaimOwnerLookup,
  createDecideByOperator,
  createPostgresSyntheticReviewerScope,
  createPostgresVerificationClaimRepository,
  createVerificationClaimsReadinessPort,
  SYNTHETIC_REVIEWER_BASIS_PREFIX,
  VERIFICATION_EVENTS,
} from "@capital-q/verification";

import { COMPANY_EVENTS } from "@capital-q/companies/events";

import { createApp } from "../src/app.js";

/**
 * Owner 13 Nov (S4) certification: the REAL verification workflow run
 * end-to-end by fictional applicants and an authorised synthetic reviewer
 * (a platform admin, role operator, marked synthetic by the service-role
 * marker, with a step-up recorded by the real platform-admin code), over
 * real local PostgreSQL with every migration, in one rolled-back
 * transaction. No owner approval anywhere, the real-user path unchanged,
 * and nothing synthetic readable as real verification.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const registry = createEventRegistry([
  ...VERIFICATION_EVENTS,
  ...COMPANY_EVENTS,
]);

class Rollback extends Error {}

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

type Person = {
  readonly authUserId: string;
  readonly userId: string;
  readonly actor: ActorContext | null;
};

describe("synthetic release-test reviewer, against local PostgreSQL (S4)", () => {
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

  it("certifies the operator workflow with synthetic applicants, and keeps real ones out of reach", async () => {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const { sql } = tx;
        const transactions = nestedTransactions(tx);
        const outbox = createOutboxWriter({ registry });
        const audit = createPostgresMaterialActionAuditWriter();
        const authorization = createAuthorizationService(
          createPostgresAuthorizationPolicySource({ sql }),
        );

        // --- fixtures: tenants, people (the marker is service-role app_metadata)
        const world = async (label: string) => {
          const tenant = randomUUID();
          const org = randomUUID();
          const company = randomUUID();
          await sql`insert into identity.tenants (id, name) values (${tenant}, ${`S4 ${label}`})`;
          await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
            values (${org}, ${tenant}, 'company', ${`S4 Org ${label}`}, ${`s4-${org.slice(0, 8)}`})`;
          await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
          await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
            values (${company}, ${tenant}, ${org}, ${`S4 Company ${label}`}, ${`s4-${company.slice(0, 8)}`})`;
          return { tenant, org, company };
        };
        const person = async (synthetic: boolean): Promise<Person> => {
          const authUserId = randomUUID();
          await sql`insert into auth.users (id, raw_app_meta_data)
            values (${authUserId}, ${JSON.stringify(synthetic ? { synthetic: true } : {})}::text::jsonb)`;
          const [profile] = await sql<{ id: string }[]>`
            select id from identity.user_profiles where auth_user_id = ${authUserId}`;
          if (profile === undefined)
            throw new Error("profile trigger did not run");
          return { authUserId, userId: profile.id, actor: null };
        };
        const join = async (
          who: Person,
          at: { tenant: string; org: string },
        ): Promise<Person> => {
          const membershipId = randomUUID();
          await sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
            values (${membershipId}, ${at.tenant}, ${at.org}, ${who.userId})`;
          await sql`insert into identity.membership_roles (membership_id, role_id)
            select ${membershipId}, r.id from permissions.roles r where r.code = 'organisation_admin'`;
          await sql`insert into identity.user_active_contexts (user_id, membership_id) values (${who.userId}, ${membershipId})`;
          const resolution = await resolveHumanActorContext(
            createPostgresActorContextResolver({ sql }),
            {
              principal: { authUserId: AuthUserIdSchema.parse(who.authUserId) },
            },
          );
          if (resolution.status !== "RESOLVED") {
            throw new Error(`context not resolved: ${resolution.status}`);
          }
          return { ...who, actor: resolution.context };
        };
        const admin = createPlatformAdmin({ sql, transactions });
        const makeOperator = async (synthetic: boolean) => {
          const operator = await person(synthetic);
          await sql`insert into identity.platform_admins (user_id, role, note)
            values (${operator.userId}, 'operator', 'S4 certification')`;
          // The real step-up path: a fresh password authentication, verified
          // for this person, recorded by the platform-admin code.
          const stepUp = await admin.recordStepUp({
            userId: operator.userId,
            freshAuthUserId: operator.authUserId,
            authentication: {
              method: "password",
              at: Math.floor(Date.now() / 1000),
            },
          });
          expect(stepUp.kind).toBe("RECORDED");
          const access = await admin.authorize(
            operator.userId,
            "verification.decide",
          );
          expect(access.kind).toBe("GRANTED");
          return operator;
        };

        const verification = createCompanyVerificationService({
          sql,
          transactions,
          authorization,
          companies: createPostgresCompanyQueryPort({ sql }),
          outbox,
          audit,
        });
        const companies = createCompanyService({
          sql,
          transactions,
          authorization,
          organisations: createPostgresOrganisationQueryPort({ sql }),
          outbox,
          audit,
          verification: createVerificationClaimsReadinessPort({ sql }),
        });
        const decide = createDecideByOperator({
          transactions,
          repository: createPostgresVerificationClaimRepository(),
          outbox,
          audit,
          syntheticReviewers: createPostgresSyntheticReviewerScope(),
        });
        const requestFor = async (who: Person, companyId: string) => {
          if (who.actor === null) throw new Error("not a member");
          await verification.requestCompanyVerification({
            actor: who.actor,
            companyId,
            idempotencyKey: randomUUID(),
            correlationId: CORRELATION(),
          });
          return sql<{ id: string; claim_type: string }[]>`
            select id, claim_type from evidence.verification_claims
             where organisation_id = (select organisation_id from core.companies where id = ${companyId})
               and status = 'PENDING' order by claim_type`;
        };
        const decision = (
          operator: Person,
          tenantId: string,
          claimId: string,
          decisionBasis = "Fictional passport and registry entry match",
        ) =>
          decide({
            tenantId,
            claimId,
            operatorUserId: operator.userId,
            status: "VERIFIED",
            decisionBasis,
            revocationReason: null,
            correlationId: CORRELATION(),
          });
        const decisionsOf = (requestId: string) =>
          sql<
            {
              method: string;
              provider: string;
              decision_basis: string;
              decided_by_actor_type: string;
              decided_by_user_id: string | null;
              status: string;
            }[]
          >`select method, provider, decision_basis, decided_by_actor_type,
                   decided_by_user_id, status
              from evidence.verification_claims where decides_claim_id = ${requestId}`;

        const reviewer = await makeOperator(true);
        const realOperator = await makeOperator(false);

        // (a) The synthetic reviewer's own request: four eyes still hold.
        const ownWorld = await world("reviewer's own");
        const reviewerHere = await join(reviewer, ownWorld);
        const [ownClaim] = await requestFor(reviewerHere, ownWorld.company);
        if (ownClaim === undefined) throw new Error("expected a request");
        expect(await decision(reviewer, ownWorld.tenant, ownClaim.id)).toEqual({
          kind: "SELF_DECISION",
        });
        expect(await decisionsOf(ownClaim.id)).toEqual([]);

        // (b) A synthetic founder's company, decided by the synthetic reviewer.
        const fictional = await world("fictional");
        const founder = await join(await person(true), fictional);
        if (founder.actor === null) throw new Error("not a member");
        const companyId = CompanyIdSchema.parse(fictional.company);
        const before = await companies.getCompany({
          actor: founder.actor,
          companyId,
        });
        const profiled = await companies.updateCompany({
          actor: founder.actor,
          companyId,
          input: {
            expectedVersion: before.version,
            shortDescription: "Fictional rails for payments.",
            currentStageCode: "seed",
            headquartersCountry: "NG",
          },
          correlationId: CORRELATION(),
        });
        await companies.setCompanyVisibility({
          actor: founder.actor,
          companyId,
          input: {
            visibility: "network_visible",
            expectedVersion: profiled.version,
          },
          correlationId: CORRELATION(),
        });
        const claims = await requestFor(founder, fictional.company);
        expect(claims.map((c) => c.claim_type)).toEqual([
          "FOUNDER_IDENTITY",
          "ORGANISATION",
        ]);
        for (const claim of claims) {
          expect(
            await decision(reviewer, fictional.tenant, claim.id),
          ).toMatchObject({ kind: "DECIDED", status: "VERIFIED" });
          const rows = await decisionsOf(claim.id);
          expect(rows).toEqual([
            {
              method: "SYNTHETIC_DEMO_ATTESTATION",
              provider: "CAPITAL_Q_SYNTHETIC_DEMO",
              decision_basis: `${SYNTHETIC_REVIEWER_BASIS_PREFIX}Fictional passport and registry entry match`,
              decided_by_actor_type: "SYSTEM",
              decided_by_user_id: null,
              status: "VERIFIED",
            },
          ]);
        }
        const audits = await sql<
          { actor_type: string; actor_id: string; method: string }[]
        >`select actor_type, actor_id::text, metadata ->> 'method' as method
            from audit.material_actions
           where tenant_id = ${fictional.tenant}
             and action_type = 'verification.claim.decided'`;
        expect(audits).toEqual([
          {
            actor_type: "human",
            actor_id: reviewer.userId,
            method: "OPERATOR_DECISION_BY_SYNTHETIC_REVIEWER",
          },
          {
            actor_type: "human",
            actor_id: reviewer.userId,
            method: "OPERATOR_DECISION_BY_SYNTHETIC_REVIEWER",
          },
        ]);
        const events = await sql<{ method: string }[]>`
          select payload -> 'data' ->> 'method' as method from events.outbox
           where tenant_id = ${fictional.tenant}
             and event_type = 'verification.claim.decided'`;
        expect(events.map((e) => e.method)).toEqual([
          "SYNTHETIC_DEMO_ATTESTATION",
          "SYNTHETIC_DEMO_ATTESTATION",
        ]);

        // (c) Readiness follows, reconciled as the worker does: the owner
        // read from the decided claim, then Capital Q (SYSTEM) reconciles.
        const decided = await sql<{ id: string }[]>`
          select id from evidence.verification_claims
           where tenant_id = ${fictional.tenant} and status = 'VERIFIED'`;
        const ownerOf = createDecidedClaimOwnerLookup({ sql });
        const owner = await ownerOf(fictional.tenant, decided[0]?.id ?? "");
        if (owner === null) throw new Error("no decided claim owner");
        const outcomes = await companies.reconcileMarketplaceReadinessAsSystem({
          tenantId: owner.tenantId,
          organisationId: owner.organisationId,
          correlationId: CORRELATION(),
          trigger: "VERIFICATION_DECIDED",
        });
        expect(outcomes).toEqual([
          { companyId, state: "marketplace_ready", changed: true },
        ]);
        const [stored] = await sql<{ state: string }[]>`
          select marketplace_readiness_state as state from core.companies
           where id = ${fictional.company}`;
        expect(stored?.state).toBe("marketplace_ready");

        // (d) A tenant with one unmarked member: out of the reviewer's reach.
        const mixed = await world("mixed");
        const mixedFounder = await join(await person(true), mixed);
        await join(await person(false), mixed);
        const mixedClaims = await requestFor(mixedFounder, mixed.company);
        for (const claim of mixedClaims) {
          expect(await decision(reviewer, mixed.tenant, claim.id)).toEqual({
            kind: "SYNTHETIC_REVIEWER_SCOPE",
          });
          expect(await decisionsOf(claim.id)).toEqual([]);
        }
        // ... and a real company carrying demonstration data, likewise.
        const demo = await world("demonstration");
        await sql`update core.companies set demonstration_data = true where id = ${demo.company}`;
        const demoFounder = await join(await person(true), demo);
        const [demoClaim] = await requestFor(demoFounder, demo.company);
        expect(
          await decision(reviewer, demo.tenant, demoClaim?.id ?? ""),
        ).toEqual({ kind: "SYNTHETIC_REVIEWER_SCOPE" });
        const nothing = await sql<{ n: number }[]>`
          select count(*)::int as n from audit.material_actions
           where tenant_id in (${mixed.tenant}, ${demo.tenant})
             and action_type = 'verification.claim.decided'`;
        expect(nothing[0]?.n).toBe(0);

        // Through the HTTP route with the real admin access check: the
        // refusal is a 403 that says nothing about the claim, and the
        // queue shows the reviewer fictional applicants only.
        const appFor = (operator: Person) =>
          createApp(
            parseApiConfig({ NODE_ENV: "test" }),
            {
              authenticator: {
                authenticate: () =>
                  Promise.resolve({
                    authUserId: AuthUserIdSchema.parse(operator.authUserId),
                  }),
              },
              resolver: createPostgresActorContextResolver({ sql }),
              identities: {
                lookup: () =>
                  Promise.resolve({
                    userId: UserIdSchema.parse(operator.userId),
                    displayName: null,
                  }),
              },
            },
            { admin, adminVerificationDecider: decide },
          ).app;
        const reviewerApp = appFor(reviewer);
        const refused = await reviewerApp.inject({
          method: "POST",
          url: `/v1/admin/verification/claims/${mixedClaims[0]?.id ?? ""}/decision`,
          payload: { status: "VERIFIED", decisionBasis: "Looks right" },
        });
        expect(refused.statusCode).toBe(403);
        expect(refused.body).not.toContain(mixedClaims[0]?.id ?? "-");
        expect(refused.json<{ detail: string }>().detail).toBe(
          "This reviewer cannot decide this verification.",
        );
        const queue = await reviewerApp.inject({
          method: "GET",
          url: "/v1/admin/verification/claims",
        });
        expect(queue.statusCode).toBe(200);
        const shown = queue
          .json<{ rows: { claimId: string }[] }>()
          .rows.map((r) => r.claimId);
        expect(shown).toContain(ownClaim.id);
        for (const claim of [
          ...mixedClaims,
          ...(demoClaim ? [demoClaim] : []),
        ]) {
          expect(shown).not.toContain(claim.id);
        }
        await reviewerApp.close();
        const realApp = appFor(realOperator);
        const realQueue = await realApp.inject({
          method: "GET",
          url: "/v1/admin/verification/claims",
        });
        const realShown = realQueue
          .json<{ rows: { claimId: string }[] }>()
          .rows.map((r) => r.claimId);
        for (const claim of mixedClaims) expect(realShown).toContain(claim.id);
        await realApp.close();

        // (e) An ordinary operator deciding a real applicant: unchanged.
        const real = await world("real");
        const realFounder = await join(await person(false), real);
        const [realClaim, stillPending] = await requestFor(
          realFounder,
          real.company,
        );
        if (realClaim === undefined) throw new Error("expected a request");
        expect(
          await decision(
            realOperator,
            real.tenant,
            realClaim.id,
            "Passport checked on a video call",
          ),
        ).toMatchObject({ kind: "DECIDED", status: "VERIFIED" });
        expect(await decisionsOf(realClaim.id)).toEqual([
          {
            method: "OPERATOR_DECISION",
            provider: "CAPITAL_Q_OPERATOR",
            decision_basis: "Passport checked on a video call",
            decided_by_actor_type: "HUMAN",
            decided_by_user_id: realOperator.userId,
            status: "VERIFIED",
          },
        ]);
        const [realAudit] = await sql<{ method: string }[]>`
          select metadata ->> 'method' as method from audit.material_actions
           where tenant_id = ${real.tenant} and action_type = 'verification.claim.decided'`;
        expect(realAudit?.method).toBe("OPERATOR_DECISION");

        // (f) Cross-tenant: another tenant's claim id decides nothing.
        // The ORGANISATION request of the real company, still undecided.
        if (stillPending === undefined) throw new Error("expected a request");
        expect(
          await decision(realOperator, fictional.tenant, stillPending.id),
        ).toEqual({ kind: "NOTHING_TO_DECIDE" });
        expect(await decision(reviewer, fictional.tenant, ownClaim.id)).toEqual(
          { kind: "NOTHING_TO_DECIDE" },
        );
        expect(await decisionsOf(stillPending.id)).toEqual([]);

        completed = true;
        throw new Rollback();
      });
    } catch (error: unknown) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  });
});
