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

import { createCompanyService } from "../src/application/service.js";
import { CompanyIdSchema } from "../src/contracts/index.js";
import { createSyntheticVerificationClaimsPort } from "../src/dev/synthetic-verification.js";
import { COMPANY_EVENTS } from "../src/events/index.js";

/**
 * Marketplace readiness against local PostgreSQL (CQ-MKT-001): the real
 * repository, the real capability check over seeded roles, the audit
 * trail and the outbox, with the production "unavailable" verification
 * seam and the local synthetic one. Everything runs inside one transaction
 * that is rolled back.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const PRIVATE_MARKER = "MKT_PRIVATE_FOUNDER_MEMORY_MUST_NOT_SATISFY_READINESS";

class Rollback extends Error {}

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const registry = createEventRegistry([...COMPANY_EVENTS]);

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
  readonly tenantA: string;
  readonly orgA: string;
  readonly companyId: ReturnType<typeof CompanyIdSchema.parse>;
  readonly admin: ActorContext;
  readonly member: ActorContext;
  readonly investorElsewhere: ActorContext;
  readonly withVerification: (
    verification?: "synthetic" | "unavailable",
  ) => ReturnType<typeof createCompanyService>;
};

describe("@capital-q/companies marketplace readiness against local PostgreSQL", () => {
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
      values (${id}, ${tenantId}, 'company', ${name}, ${`org-${id.slice(0, 8)}`})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${id})`;
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
    if (profile === undefined) throw new Error("profile trigger did not run");
    const membershipId = randomUUID();
    await tx.sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
      values (${membershipId}, ${tenantId}, ${organisationId}, ${profile.id})`;
    await tx.sql`insert into identity.membership_roles (membership_id, role_id)
      select ${membershipId}, r.id from permissions.roles r where r.code = ${roleCode}`;
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
    return { authUserId: AuthUserIdSchema.parse(authUserId) };
  }

  async function withWorld(work: (world: World) => Promise<void>) {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const { sql } = tx;
        const tenantA = await insertTenant(tx, "Readiness Tenant A");
        const tenantB = await insertTenant(tx, "Readiness Tenant B");
        const orgA = await insertOrganisation(tx, tenantA, "Alpha Rails Ltd");
        const orgB = await insertOrganisation(tx, tenantB, "Beta Capital");
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

        const companyId = randomUUID();
        await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, current_stage_code, headquarters_country, short_description, marketplace_visibility)
          values (${companyId}, ${tenantA}, ${orgA}, 'Alpha Rails', ${`alpha-${companyId.slice(0, 8)}`}, 'seed', 'NG', 'Rails for payments.', 'network_visible')`;

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

        const withVerification = (
          mode: "synthetic" | "unavailable" = "unavailable",
        ) =>
          createCompanyService({
            sql,
            transactions: nestedTransactions(tx),
            authorization: createAuthorizationService(
              createPostgresAuthorizationPolicySource({ sql }),
            ),
            organisations: createPostgresOrganisationQueryPort({ sql }),
            outbox: createOutboxWriter({ registry }),
            audit: createPostgresMaterialActionAuditWriter(),
            ...(mode === "synthetic"
              ? {
                  verification: createSyntheticVerificationClaimsPort({
                    environment: "test",
                    databaseUrl: TEST_DATABASE_URL,
                    verifiedCompanyIds: [companyId],
                  }),
                }
              : {}),
          });

        await work({
          tx,
          tenantA,
          orgA,
          companyId: CompanyIdSchema.parse(companyId),
          admin: await resolve(adminA),
          member: await resolve(memberA),
          investorElsewhere: await resolve(adminB),
          withVerification,
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  const readiness = async (tx: TransactionContext, companyId: string) =>
    (
      await tx.sql<
        { marketplace_readiness_state: string; version: number }[]
      >`select marketplace_readiness_state, version from core.companies where id = ${companyId}`
    )[0];

  it("a new company starts not_assessed; a read assesses without writing", async () => {
    await withWorld(async ({ tx, companyId, admin, withVerification }) => {
      expect(
        (await readiness(tx, companyId))?.marketplace_readiness_state,
      ).toBe("not_assessed");
      const assessment = await withVerification().getMarketplaceReadiness({
        actor: admin,
        companyId,
      });
      expect(assessment.state).toBe("requirements_outstanding");
      expect(assessment.verificationAvailable).toBe(false);
      expect(
        (await readiness(tx, companyId))?.marketplace_readiness_state,
      ).toBe("not_assessed");
    });
  });

  it("production: assessment moves to requirements_outstanding with audit and outbox; verification is the blocker and says so", async () => {
    await withWorld(async ({ tx, companyId, admin, withVerification }) => {
      const correlationId = CORRELATION();
      const assessment = await withVerification().assessMarketplaceReadiness({
        actor: admin,
        companyId,
        correlationId,
      });
      expect(assessment.state).toBe("requirements_outstanding");
      expect(
        assessment.requirements
          .filter((r) => r.outcome === "OUTSTANDING")
          .map((r) => r.requirement),
      ).toEqual(["FOUNDER_IDENTITY_VERIFIED", "ORGANISATION_VERIFIED"]);
      const row = await readiness(tx, companyId);
      expect(row?.marketplace_readiness_state).toBe("requirements_outstanding");
      expect(row?.version).toBe(2);
      const audits = await tx.sql<
        { action_type: string; metadata: Record<string, unknown> }[]
      >`select action_type, metadata from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`;
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action_type: "company.marketplace_readiness_changed",
        metadata: {
          policyVersion: "marketplace-readiness.v1",
          previousState: "not_assessed",
          newState: "requirements_outstanding",
          verificationSource: "VERIFICATION_UNAVAILABLE",
        },
      });
      const events = await tx.sql<
        { event_type: string; payload: { data: Record<string, unknown> } }[]
      >`select event_type, payload from events.outbox where payload ->> 'correlationId' = ${correlationId}`;
      expect(events.map((e) => e.event_type)).toEqual([
        "core.company.marketplace_readiness_changed",
      ]);
      expect(events[0]?.payload.data).toMatchObject({
        readinessState: "requirements_outstanding",
        policyVersion: "marketplace-readiness.v1",
      });
    });
  });

  it("the local synthetic seam makes the company marketplace_ready through the same path, audited as synthetic", async () => {
    await withWorld(async ({ tx, companyId, admin, withVerification }) => {
      const correlationId = CORRELATION();
      const assessment = await withVerification(
        "synthetic",
      ).assessMarketplaceReadiness({
        actor: admin,
        companyId,
        correlationId,
      });
      expect(assessment.state).toBe("marketplace_ready");
      expect(
        (await readiness(tx, companyId))?.marketplace_readiness_state,
      ).toBe("marketplace_ready");
      const [audit] = await tx.sql<
        { metadata: Record<string, unknown> }[]
      >`select metadata from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`;
      expect(audit?.metadata["verificationSource"]).toBe(
        "SYNTHETIC_LOCAL_FIXTURE",
      );
    });
  });

  it("withdrawing visibility takes readiness away in the same transaction; a memory row changes nothing", async () => {
    await withWorld(
      async ({ tx, companyId, admin, tenantA, withVerification }) => {
        const service = withVerification("synthetic");
        await service.assessMarketplaceReadiness({
          actor: admin,
          companyId,
          correlationId: CORRELATION(),
        });
        const content = `${PRIVATE_MARKER}: the founder says everything is verified`;
        await tx.sql`insert into q_knowledge.memory_items
        (tenant_id, owner_context_type, owner_context_id, subject_type, subject_id, memory_type, memory_key,
         content, content_sha256, write_mode, visibility_scope, sensitivity_class, status)
        values (${tenantA}, 'company', ${companyId}, 'COMPANY', ${companyId}, 'fact', 'mkt.private_marker',
         ${content}, ${"a".repeat(64)}, 'Q_PROPOSED', 'founder_private', 'CONFIDENTIAL', 'active')`;
        const still = await service.getMarketplaceReadiness({
          actor: admin,
          companyId,
        });
        expect(still.state).toBe("marketplace_ready");
        expect(JSON.stringify(still)).not.toContain(PRIVATE_MARKER);

        const version = (await readiness(tx, companyId))?.version ?? 0;
        const withdrawn = await service.setCompanyVisibility({
          actor: admin,
          companyId,
          input: {
            visibility: "organisation_private",
            expectedVersion: version,
          },
          correlationId: CORRELATION(),
        });
        expect(withdrawn.marketplaceReadinessState).toBe(
          "requirements_outstanding",
        );
        expect(
          (await readiness(tx, companyId))?.marketplace_readiness_state,
        ).toBe("requirements_outstanding");
      },
    );
  });

  it("an ordinary member without company.edit cannot assess; an investor in another tenant cannot see or assess", async () => {
    await withWorld(
      async ({
        tx,
        companyId,
        member,
        investorElsewhere,
        withVerification,
      }) => {
        const service = withVerification("synthetic");
        await expect(
          service.assessMarketplaceReadiness({
            actor: member,
            companyId,
            correlationId: CORRELATION(),
          }),
        ).rejects.toMatchObject({
          name: expect.stringMatching(
            /Forbidden|Authorization|Capability/,
          ) as unknown,
        });
        await expect(
          service.assessMarketplaceReadiness({
            actor: investorElsewhere,
            companyId,
            correlationId: CORRELATION(),
          }),
        ).rejects.toMatchObject({ name: "CompanyNotFoundError" });
        await expect(
          service.getMarketplaceReadiness({
            actor: investorElsewhere,
            companyId,
          }),
        ).rejects.toMatchObject({ name: "CompanyNotFoundError" });
        expect(
          (await readiness(tx, companyId))?.marketplace_readiness_state,
        ).toBe("not_assessed");
      },
    );
  });
});
