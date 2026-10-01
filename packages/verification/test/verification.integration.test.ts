import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import {
  CompanyIdSchema,
  CompanyNotFoundError,
  createPostgresCompanyQueryPort,
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
  AuthorizationDeniedError,
  AuthUserIdSchema,
  createAuthorizationService,
  OrganisationIdSchema,
  resolveHumanActorContext,
  TenantIdSchema,
  type ActorContext,
} from "@capital-q/security";
import {
  createPostgresActorContextResolver,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";

import {
  createCompanyVerificationService,
  createPostgresPendingSyntheticClaimSource,
  createSyntheticAutoVerifySweep,
  closeKybForClaim,
  createDecideByOperator,
  createKybService,
  createPostgresVerificationClaimRepository,
  createSyntheticVerificationDecider,
  syntheticAutoVerifyAttestation,
  createVerificationClaimsReadinessPort,
  VERIFICATION_EVENTS,
  type CompanyVerificationService,
  type SyntheticDemoAttestation,
} from "../src/index.js";

/**
 * Real local PostgreSQL (`pnpm db:start`), run with `pnpm test:integration`.
 * Every test runs in one rolled-back transaction; the services see it
 * through a savepoint-backed TransactionManager. Two tenants; every
 * positive has a cross-tenant or revoked-membership negative.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const PROOF = {
  permitted: true as const,
  attestation: [
    "operator opted in",
    "environment test",
    "database host 127.0.0.1",
  ],
};

class Rollback extends Error {}

type Member = {
  readonly actor: ActorContext;
  readonly membershipId: string;
};

type World = {
  readonly tx: TransactionContext;
  readonly service: CompanyVerificationService;
  readonly decide: ReturnType<typeof createSyntheticVerificationDecider>;
  readonly decider: (
    attestation: SyntheticDemoAttestation | null,
    environment: string,
  ) => ReturnType<typeof createSyntheticVerificationDecider>;
  readonly readiness: ReturnType<typeof createVerificationClaimsReadinessPort>;
  readonly adminA: Member;
  readonly realMemberA: Member;
  /** Marked synthetic only in user_metadata, which a person can edit. */
  readonly selfMarkedA: Member;
  readonly adminB: Member;
  readonly tenantA: string;
  readonly orgA: string;
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

const registry = createEventRegistry([...VERIFICATION_EVENTS]);

describe("@capital-q/verification against local PostgreSQL", () => {
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

  async function insertTenantOrgCompany(tx: TransactionContext, label: string) {
    const tenant = randomUUID();
    const org = randomUUID();
    const company = randomUUID();
    await tx.sql`insert into identity.tenants (id, name) values (${tenant}, ${`Verify ${label}`})`;
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${org}, ${tenant}, 'company', ${`Org ${label}`}, ${`vf-${org.slice(0, 8)}`})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
    await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
      values (${company}, ${tenant}, ${org}, ${`Company ${label}`}, ${`vf-${company.slice(0, 8)}`})`;
    return { tenant, org, company };
  }

  async function insertMember(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    roleCode: "organisation_admin" | "organisation_member",
    marker: "app_metadata" | "user_metadata" | "none",
  ): Promise<Member> {
    const authUserId = randomUUID();
    const flag = (where: typeof marker) =>
      JSON.stringify(marker === where ? { synthetic: true } : {});
    await tx.sql`insert into auth.users (id, raw_app_meta_data, raw_user_meta_data)
      values (${authUserId}, ${flag("app_metadata")}::text::jsonb, ${flag("user_metadata")}::text::jsonb)`;
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
    const resolution = await resolveHumanActorContext(
      createPostgresActorContextResolver({ sql: tx.sql }),
      { principal: { authUserId: AuthUserIdSchema.parse(authUserId) } },
    );
    if (resolution.status !== "RESOLVED") {
      throw new Error(`context not resolved: ${resolution.status}`);
    }
    return { actor: resolution.context, membershipId };
  }

  async function withWorld(work: (world: World) => Promise<void>) {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const { sql } = tx;
        const a = await insertTenantOrgCompany(tx, "A");
        const b = await insertTenantOrgCompany(tx, "B");
        const adminA = await insertMember(
          tx,
          a.tenant,
          a.org,
          "organisation_admin",
          "app_metadata",
        );
        const realMemberA = await insertMember(
          tx,
          a.tenant,
          a.org,
          "organisation_admin",
          "none",
        );
        const selfMarkedA = await insertMember(
          tx,
          a.tenant,
          a.org,
          "organisation_admin",
          "user_metadata",
        );
        const adminB = await insertMember(
          tx,
          b.tenant,
          b.org,
          "organisation_admin",
          "app_metadata",
        );
        const transactions = nestedTransactions(tx);
        const outbox = createOutboxWriter({ registry });
        const audit = createPostgresMaterialActionAuditWriter();
        const decider = (
          attestation: SyntheticDemoAttestation | null,
          environment: string,
        ) =>
          createSyntheticVerificationDecider({
            sql,
            transactions,
            outbox,
            audit,
            attestation,
            environment,
          });
        await work({
          tx,
          service: createCompanyVerificationService({
            sql,
            transactions,
            authorization: createAuthorizationService(
              createPostgresAuthorizationPolicySource({ sql }),
            ),
            companies: createPostgresCompanyQueryPort({ sql }),
            outbox,
            audit,
          }),
          decide: decider(PROOF, "test"),
          decider,
          readiness: createVerificationClaimsReadinessPort({ sql }),
          adminA,
          realMemberA,
          selfMarkedA,
          adminB,
          tenantA: a.tenant,
          orgA: a.org,
          companyA: a.company,
          companyB: b.company,
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error: unknown) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  const request = (world: World, member: Member, companyId = world.companyA) =>
    world.service.requestCompanyVerification({
      actor: member.actor,
      companyId,
      idempotencyKey: randomUUID(),
      correlationId: CORRELATION(),
    });

  const readinessOf = (world: World) =>
    world.readiness.currentStandings({
      tenantId: TenantIdSchema.parse(world.tenantA),
      organisationId: OrganisationIdSchema.parse(world.orgA),
      companyId: CompanyIdSchema.parse(world.companyA),
    });

  const pendingIds = async (tx: TransactionContext, tenantId: string) =>
    (
      await tx.sql<{ id: string }[]>`select id from evidence.verification_claims
        where tenant_id = ${tenantId} and status = 'PENDING' order by claim_type`
    ).map((row) => row.id);

  it("requests both standings once, audits and announces them, and a replay writes nothing", async () => {
    await withWorld(async (world) => {
      const before = await world.service.getCompanyVerification({
        actor: world.adminA.actor,
        companyId: world.companyA,
      });
      expect(before.standings.map((s) => s.status)).toEqual([
        "NOT_REQUESTED",
        "NOT_REQUESTED",
      ]);

      const first = await request(world, world.adminA);
      expect(first.requested).toEqual(["FOUNDER_IDENTITY", "ORGANISATION"]);
      expect(first.verification.standings.map((s) => s.status)).toEqual([
        "PENDING",
        "PENDING",
      ]);
      expect(first.verification.requestable).toBe(false);

      const replay = await request(world, world.adminA);
      expect(replay.requested).toEqual([]);
      expect(await pendingIds(world.tx, world.tenantA)).toHaveLength(2);

      const events = await world.tx.sql<{ event_type: string }[]>`
        select event_type from events.outbox where tenant_id = ${world.tenantA}
          and event_type like 'verification.%'`;
      expect(events.map((e) => e.event_type)).toEqual([
        "verification.claim.recorded",
        "verification.claim.recorded",
      ]);
      const audits = await world.tx.sql<{ n: number }[]>`
        select count(*)::int as n from audit.material_actions
         where tenant_id = ${world.tenantA} and action_type = 'verification.claim.requested'`;
      expect(audits[0]?.n).toBe(2);

      // A request is not a standing readiness can use.
      const facts = await readinessOf(world);
      expect(facts).toEqual({
        available: true,
        founderIdentity: "NOT_VERIFIED",
        organisationIdentity: "NOT_VERIFIED",
      });
    });
  });

  it("decides a synthetic request by attestation, with provenance, exactly once", async () => {
    await withWorld(async (world) => {
      await request(world, world.adminA);
      const ids = await pendingIds(world.tx, world.tenantA);
      for (const claimId of ids) {
        const outcome = await world.decide({
          tenantId: world.tenantA,
          claimId,
          correlationId: CORRELATION(),
        });
        expect(outcome.kind).toBe("VERIFIED");
        // Replay: the request is no longer current.
        expect(
          (
            await world.decide({
              tenantId: world.tenantA,
              claimId,
              correlationId: CORRELATION(),
            })
          ).kind,
        ).toBe("NOTHING_TO_DECIDE");
      }

      const decided = await world.tx.sql<
        {
          method: string;
          provider: string;
          decided_by_actor_type: string;
          decision_basis: string;
          decides_claim_id: string;
          revision: number;
        }[]
      >`select method, provider, decided_by_actor_type, decision_basis, decides_claim_id, revision
          from evidence.verification_claims
         where tenant_id = ${world.tenantA} and status = 'VERIFIED'`;
      expect(decided).toHaveLength(2);
      for (const row of decided) {
        expect(row.method).toBe("SYNTHETIC_DEMO_ATTESTATION");
        expect(row.provider).toBe("CAPITAL_Q_SYNTHETIC_DEMO");
        expect(row.decided_by_actor_type).toBe("SYSTEM");
        expect(row.decision_basis).toContain(
          "requesting account marked synthetic",
        );
        expect(ids).toContain(row.decides_claim_id);
        expect(row.revision).toBe(2);
      }

      const view = await world.service.getCompanyVerification({
        actor: world.adminA.actor,
        companyId: world.companyA,
      });
      expect(view.standings.map((s) => [s.status, s.method])).toEqual([
        ["VERIFIED", "SYNTHETIC_DEMO_ATTESTATION"],
        ["VERIFIED", "SYNTHETIC_DEMO_ATTESTATION"],
      ]);
      expect(view.standings[0]?.description).toContain(
        "Verified (synthetic demo attestation)",
      );

      const facts = await readinessOf(world);
      expect(facts.founderIdentity).toBe("VERIFIED");
      expect(facts.organisationIdentity).toBe("VERIFIED");
    });
  });

  it.each([
    ["a real person", "realMemberA"],
    [
      "a person marked synthetic only in their own user_metadata",
      "selfMarkedA",
    ],
  ] as const)("leaves %s's request PENDING", async (_label, who) => {
    await withWorld(async (world) => {
      const result = await request(world, world[who]);
      expect(result.requested).toContain("FOUNDER_IDENTITY");
      const [founder] = await world.tx.sql<{ id: string }[]>`
        select id from evidence.verification_claims
         where tenant_id = ${world.tenantA} and claim_type = 'FOUNDER_IDENTITY'`;
      const outcome = await world.decide({
        tenantId: world.tenantA,
        claimId: founder?.id ?? "",
        correlationId: CORRELATION(),
      });
      expect(outcome).toEqual({
        kind: "REFUSED",
        reason: "PRINCIPAL_NOT_SYNTHETIC",
      });
      expect(await pendingIds(world.tx, world.tenantA)).toHaveLength(2);
    });
  });

  // R43, temporary until BIZ-006 /ops: the hosted staging workers' sweep.
  it("lets an operator decide a real person's request by hand, as a HUMAN, exactly once (ADR 0033)", async () => {
    await withWorld(async (world) => {
      await request(world, world.realMemberA);
      const [identity, organisation] = await pendingIds(
        world.tx,
        world.tenantA,
      );
      if (identity === undefined || organisation === undefined) {
        throw new Error("expected two pending requests");
      }
      const [operator] = await world.tx.sql<{ id: string }[]>`
        select user_id as id from identity.organisation_memberships
         where id = ${world.adminB.membershipId}`;
      const decide = createDecideByOperator({
        transactions: nestedTransactions(world.tx),
        repository: createPostgresVerificationClaimRepository(),
        outbox: createOutboxWriter({ registry }),
        audit: createPostgresMaterialActionAuditWriter(),
      });
      const base = {
        tenantId: world.tenantA,
        operatorUserId: operator?.id ?? "",
        correlationId: CORRELATION(),
      };
      expect(
        await decide({
          ...base,
          claimId: identity,
          status: "VERIFIED",
          decisionBasis: "Passport checked on a video call",
          revocationReason: null,
        }),
      ).toMatchObject({ kind: "DECIDED", status: "VERIFIED" });
      expect(
        await decide({
          ...base,
          claimId: organisation,
          status: "REVOKED",
          decisionBasis: "Registry shows no such company",
          revocationReason: "Company not found in the registry",
        }),
      ).toMatchObject({ kind: "DECIDED", status: "REVOKED" });
      // Replay decides nothing.
      expect(
        (
          await decide({
            ...base,
            claimId: identity,
            status: "REVOKED",
            decisionBasis: "again",
            revocationReason: "again",
          })
        ).kind,
      ).toBe("NOTHING_TO_DECIDE");
      const rows = await world.tx.sql<
        {
          status: string;
          method: string;
          decided_by_actor_type: string;
          decided_by_user_id: string;
          revocation_reason: string | null;
        }[]
      >`
        select status, method, decided_by_actor_type, decided_by_user_id, revocation_reason
          from evidence.verification_claims
         where tenant_id = ${world.tenantA} and decides_claim_id is not null
         order by status desc`;
      expect(rows).toEqual([
        {
          status: "VERIFIED",
          method: "OPERATOR_DECISION",
          decided_by_actor_type: "HUMAN",
          decided_by_user_id: operator?.id,
          revocation_reason: null,
        },
        {
          status: "REVOKED",
          method: "OPERATOR_DECISION",
          decided_by_actor_type: "HUMAN",
          decided_by_user_id: operator?.id,
          revocation_reason: "Company not found in the registry",
        },
      ]);
      const [audits] = await world.tx.sql<{ n: number }[]>`
        select count(*)::int as n from audit.material_actions
         where tenant_id = ${world.tenantA} and action_type = 'verification.claim.decided'
           and actor_type = 'human'`;
      expect(audits?.n).toBe(2);
    });
  });

  it("takes an organisation's KYB once, records the ORGANISATION claim, and closes it with the operator's decision (ADMIN-3)", async () => {
    await withWorld(async (world) => {
      const kyb = createKybService({
        sql: world.tx.sql,
        transactions: nestedTransactions(world.tx),
        authorization: createAuthorizationService(
          createPostgresAuthorizationPolicySource({ sql: world.tx.sql }),
        ),
        repository: createPostgresVerificationClaimRepository(),
        audit: createPostgresMaterialActionAuditWriter(),
        outbox: createOutboxWriter({ registry }),
      });
      const details = {
        legalName: "Company A Ltd",
        registrationNumber: "RC 0001",
        jurisdictionCode: "NG",
        registeredAddress: null,
        websiteUrl: "https://a.example",
        documentId: null,
      };
      const submit = (key: string, documentId: string | null = null) =>
        kyb.submit({
          actor: world.realMemberA.actor,
          input: { ...details, documentId },
          idempotencyKey: key,
          correlationId: CORRELATION(),
        });
      // A document that is not the organisation's is refused.
      expect((await submit("kyb-key-0000", randomUUID())).kind).toBe(
        "DOCUMENT_NOT_FOUND",
      );
      const first = await submit("kyb-key-0001");
      expect(first.kind).toBe("SUBMITTED");
      if (first.kind !== "SUBMITTED") throw new Error(first.kind);
      expect(first.view.standing).toBe("PENDING");
      expect(first.view.submission?.status).toBe("SUBMITTED");
      expect((await submit("kyb-key-0001")).kind).toBe("REPLAYED");
      expect((await submit("kyb-key-0002")).kind).toBe("ALREADY_OPEN");
      // Another tenant's member sees only their own organisation.
      const other = await kyb.current(world.adminB.actor);
      expect(other).toEqual({ standing: "NOT_REQUESTED", submission: null });

      const [claim] = await world.tx.sql<{ id: string }[]>`
        select claim_id as id from core.kyb_submissions
         where organisation_id = ${world.orgA}`;
      const [operator] = await world.tx.sql<{ id: string }[]>`
        select user_id as id from identity.organisation_memberships
         where id = ${world.adminB.membershipId}`;
      const decide = createDecideByOperator({
        transactions: nestedTransactions(world.tx),
        repository: createPostgresVerificationClaimRepository(),
        outbox: createOutboxWriter({ registry }),
        audit: createPostgresMaterialActionAuditWriter(),
      });
      expect(
        (
          await decide({
            tenantId: world.tenantA,
            claimId: claim?.id ?? "",
            operatorUserId: operator?.id ?? "",
            status: "REVOKED",
            decisionBasis: "Registry has no such number",
            revocationReason: "No matching registration",
            correlationId: CORRELATION(),
          })
        ).kind,
      ).toBe("DECIDED");
      expect(
        await closeKybForClaim(nestedTransactions(world.tx), {
          claimId: claim?.id ?? "",
          approved: false,
          reason: "No matching registration",
          decidedByUserId: operator?.id ?? "",
        }),
      ).toBe(true);
      const after = await kyb.current(world.realMemberA.actor);
      expect(after?.standing).toBe("REVOKED");
      expect(after?.submission?.status).toBe("REJECTED");
      expect(after?.submission?.decisionReason).toBe(
        "No matching registration",
      );
      const [notice] = await world.tx.sql<{ kind: string }[]>`
        select kind from communication.notifications
         where user_id = ${world.realMemberA.actor.userId} and kind = 'VERIFICATION_DECIDED'`;
      expect(notice?.kind).toBe("VERIFICATION_DECIDED");
      // A rejected organisation may submit again.
      expect((await submit("kyb-key-0003")).kind).toBe("SUBMITTED");
    });
  });

  describe("SYNTHETIC_AUTO_VERIFY_POLICY sweep", () => {
    const sweepFor = (world: World, environment: string) => {
      const source = createPostgresPendingSyntheticClaimSource(world.tx.sql);
      return {
        source,
        sweep: createSyntheticAutoVerifySweep({
          // Only this world's tenant, so other local rows cannot move counts.
          source: {
            pendingSyntheticClaims: async (limit) =>
              (await source.pendingSyntheticClaims(limit)).filter(
                (c) => c.tenantId === world.tenantA,
              ),
          },
          decide: world.decider(
            syntheticAutoVerifyAttestation(environment),
            environment,
          ),
          correlation: CORRELATION,
          limit: 5000,
        }),
      };
    };

    it("verifies a synthetic founder's requests on staging once; a rerun writes nothing", async () => {
      await withWorld(async (world) => {
        await request(world, world.adminA);
        const ids = await pendingIds(world.tx, world.tenantA);
        const { source, sweep } = sweepFor(world, "staging");
        const offered = (await source.pendingSyntheticClaims(5000)).map(
          (c) => c.claimId,
        );
        expect(offered).toEqual(expect.arrayContaining(ids));

        expect(await sweep()).toMatchObject({ considered: 2, verified: 2 });
        expect(await sweep()).toMatchObject({ considered: 0, verified: 0 });

        const [counts] = await world.tx.sql<
          { decided: number; audits: number; events: number }[]
        >`select
            (select count(*)::int from evidence.verification_claims
              where tenant_id = ${world.tenantA} and status = 'VERIFIED') as decided,
            (select count(*)::int from audit.material_actions
              where tenant_id = ${world.tenantA}
                and action_type = 'verification.claim.decided') as audits,
            (select count(*)::int from events.outbox
              where tenant_id = ${world.tenantA}
                and event_type = 'verification.claim.decided') as events`;
        expect(counts).toEqual({ decided: 2, audits: 2, events: 2 });
        const [basis] = await world.tx.sql<{ decision_basis: string }[]>`
          select decision_basis from evidence.verification_claims
           where tenant_id = ${world.tenantA} and status = 'VERIFIED' limit 1`;
        expect(basis?.decision_basis).toContain("SYNTHETIC_AUTO_VERIFY_POLICY");
        expect((await readinessOf(world)).founderIdentity).toBe("VERIFIED");
      });
    });

    it.each(["realMemberA", "selfMarkedA"] as const)(
      "never offers or verifies %s's request",
      async (who) => {
        await withWorld(async (world) => {
          await request(world, world[who]);
          const ids = await pendingIds(world.tx, world.tenantA);
          const { source, sweep } = sweepFor(world, "staging");
          const offered = (await source.pendingSyntheticClaims(5000)).map(
            (c) => c.claimId,
          );
          for (const id of ids) expect(offered).not.toContain(id);
          expect(await sweep()).toMatchObject({ verified: 0 });
          expect(await pendingIds(world.tx, world.tenantA)).toHaveLength(2);
        });
      },
    );

    it("decides nothing in production", async () => {
      await withWorld(async (world) => {
        await request(world, world.adminA);
        const { sweep } = sweepFor(world, "production");
        expect(await sweep()).toMatchObject({
          verified: 0,
          refused: { PRODUCTION_POSTURE: 2 },
        });
        expect(await pendingIds(world.tx, world.tenantA)).toHaveLength(2);
      });
    });
  });

  it("refuses to decide on a production posture or without the attestation", async () => {
    await withWorld(async (world) => {
      await request(world, world.adminA);
      const [claimId] = await pendingIds(world.tx, world.tenantA);
      const command = {
        tenantId: world.tenantA,
        claimId: claimId ?? "",
        correlationId: CORRELATION(),
      };
      expect(await world.decider(PROOF, "production")(command)).toEqual({
        kind: "REFUSED",
        reason: "PRODUCTION_POSTURE",
      });
      expect(await world.decider(null, "local")(command)).toEqual({
        kind: "REFUSED",
        reason: "NO_ATTESTATION",
      });
      expect(await pendingIds(world.tx, world.tenantA)).toHaveLength(2);
    });
  });

  it("hides another tenant's company and cannot decide across tenants", async () => {
    await withWorld(async (world) => {
      await expect(request(world, world.adminB)).rejects.toBeInstanceOf(
        CompanyNotFoundError,
      );
      await expect(
        world.service.getCompanyVerification({
          actor: world.adminB.actor,
          companyId: world.companyA,
        }),
      ).rejects.toBeInstanceOf(CompanyNotFoundError);
      await request(world, world.adminA);
      const [claimId] = await pendingIds(world.tx, world.tenantA);
      const foreignTenant = world.adminB.actor.tenantId;
      expect(
        await world.decide({
          tenantId: foreignTenant,
          claimId: claimId ?? "",
          correlationId: CORRELATION(),
        }),
      ).toEqual({ kind: "NOTHING_TO_DECIDE" });
    });
  });

  it("loses the right to ask or read once the membership is revoked", async () => {
    await withWorld(async (world) => {
      await world.tx.sql`update identity.organisation_memberships
        set membership_status = 'revoked', left_at = clock_timestamp()
        where id = ${world.adminA.membershipId}`;
      await expect(request(world, world.adminA)).rejects.toBeInstanceOf(
        AuthorizationDeniedError,
      );
      await expect(
        world.service.getCompanyVerification({
          actor: world.adminA.actor,
          companyId: world.companyA,
        }),
      ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      expect(await pendingIds(world.tx, world.tenantA)).toHaveLength(0);
    });
  });

  it("stops counting a verified founder who left the organisation", async () => {
    await withWorld(async (world) => {
      await request(world, world.adminA);
      for (const claimId of await pendingIds(world.tx, world.tenantA)) {
        await world.decide({
          tenantId: world.tenantA,
          claimId,
          correlationId: CORRELATION(),
        });
      }
      await world.tx.sql`update identity.organisation_memberships
        set membership_status = 'left', left_at = clock_timestamp()
        where id = ${world.adminA.membershipId}`;
      const facts = await readinessOf(world);
      expect(facts.founderIdentity).toBe("NOT_VERIFIED");
      expect(facts.organisationIdentity).toBe("VERIFIED");
    });
  });

  it("refuses to update or delete a claim row: history is appended, never rewritten", async () => {
    await withWorld(async (world) => {
      await request(world, world.adminA);
      const [claimId] = await pendingIds(world.tx, world.tenantA);
      await expect(
        world.tx.sql.savepoint(
          (s) =>
            s`update evidence.verification_claims set status = 'VERIFIED' where id = ${claimId ?? ""}`,
        ),
      ).rejects.toThrow(/append-only/);
      await expect(
        world.tx.sql.savepoint(
          (s) =>
            s`delete from evidence.verification_claims where id = ${claimId ?? ""}`,
        ),
      ).rejects.toThrow(/append-only/);
    });
  });
});
