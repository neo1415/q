import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresCapitalObjectiveQueryPort } from "@capital-q/capital";
import { createPostgresCompanyQueryPort } from "@capital-q/companies";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  QRunIdSchema,
  UtcTimestampSchema,
  type CorrelationId,
  type PermittedContextPlan,
  type QCapability,
  type QRunId,
  type QSubjectRef,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";
import { createPostgresDocumentQueryPort } from "@capital-q/evidence";
import {
  createPostgresInvestorMandateQueryPort,
  createPostgresInvestorOrganisationQueryPort,
} from "@capital-q/investors";
import {
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
  type RelationshipQueryPort,
} from "@capital-q/network";
import { createLogger, type Logger } from "@capital-q/observability";
import {
  createDefaultDisclosureResolvers,
  createDisclosureAccessService,
  createDisclosureResourceResolverRegistry,
  createPostgresDisclosurePolicyRepository,
  createRelationshipPartyResolver,
} from "@capital-q/permissions";
import { createContextFirewall } from "@capital-q/q-firewall";
import type { QToolExecutionContext, QToolPort } from "@capital-q/q-runtime";
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

import { createQTools } from "../src/index.js";

/**
 * The Safe Read tools against the real local database (packet §67-§69,
 * §97-§100): real authorization (seeded role templates), real disclosure
 * (intrinsic classification), real query ports, and plans produced by the
 * real Context Firewall. Every test runs in one rolled-back transaction.
 *
 * World: tenant C holds Alpha Robotics (founder = organisation_admin,
 * colleague = organisation_member) with a capital objective; tenant I
 * holds investor Apex (admin) with an ACTIVE mandate whose raw text
 * carries a marker; tenant N holds Beacon (network_visible) and Hidden
 * (organisation_private). Nothing a tool returns may carry a marker it
 * was not authorised to return.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const MARKERS = {
  founder: "FOUNDER-PRIVATE-GET-COMPANY-DO-NOT-LEAK",
  investor: "INVESTOR-PRIVATE-MANDATE-DO-NOT-LEAK",
  crossTenant: "TOOL-CROSS-TENANT-DO-NOT-LEAK",
} as const;

const RUN: QRunId = QRunIdSchema.parse("a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1");
const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;

class Rollback extends Error {}

type Member = {
  readonly principal: AuthenticatedPrincipal;
  readonly membershipId: string;
  readonly userId: string;
};

type World = {
  readonly tools: QToolPort;
  readonly planFor: (
    actor: ActorContext,
    capability: QCapability,
    subjects: readonly QSubjectRef[],
  ) => Promise<PermittedContextPlan>;
  readonly founder: ActorContext;
  readonly colleague: ActorContext;
  readonly apexAdmin: ActorContext;
  readonly companyAlpha: string;
  readonly companyBeacon: string;
  readonly companyHidden: string;
  readonly investorApex: string;
  readonly mandateApex: string;
  readonly logLines: string[];
  readonly searchPort: ReturnType<typeof createPostgresCompanyQueryPort>;
  readonly tenantN: string;
  /** Unique per world, so search assertions never depend on other rows in a shared database. */
  readonly token: string;
};

function capturingLogger(lines: string[]): Logger {
  return createLogger(
    { serviceName: "q-tools-test", environment: "test" },
    {
      level: "debug",
      destination: {
        write: (chunk: string) => {
          lines.push(chunk);
        },
      },
    },
  );
}

function assertNoMarkers(text: string): void {
  for (const marker of Object.values(MARKERS)) {
    expect(text).not.toContain(marker);
  }
}

describe("@capital-q/q-tools against local PostgreSQL", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "4",
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
    type: string,
    name: string,
  ) {
    const id = randomUUID();
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${id}, ${tenantId}, ${type}, ${name}, ${`org-${id.slice(0, 8)}`})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${id})`;
    return id;
  }

  async function insertMember(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
    roleCode: "organisation_admin" | "organisation_member",
  ): Promise<Member> {
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<{ id: string }[]>`
      select id from identity.user_profiles where auth_user_id = ${authUserId}`;
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
      userId: profile.id,
    };
  }

  async function resolveActor(
    tx: TransactionContext,
    principal: AuthenticatedPrincipal,
  ): Promise<ActorContext> {
    const resolution = await resolveHumanActorContext(
      createPostgresActorContextResolver({ sql: tx.sql }),
      { principal },
    );
    if (resolution.status !== "RESOLVED") {
      throw new Error(`context not resolved: ${resolution.status}`);
    }
    return resolution.context;
  }

  async function withWorld(
    work: (world: World) => Promise<void>,
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const { sql } = tx;
        const tenantC = await insertTenant(tx, "Tools Company Tenant");
        const tenantI = await insertTenant(tx, "Tools Investor Tenant");
        const tenantN = await insertTenant(tx, "Tools Network Tenant");
        const token = `zq${randomUUID().slice(0, 6)}`;
        const orgAlpha = await insertOrganisation(
          tx,
          tenantC,
          "company",
          "Alpha",
        );
        const orgApex = await insertOrganisation(
          tx,
          tenantI,
          "investment_firm",
          "Apex",
        );
        const orgBeacon = await insertOrganisation(
          tx,
          tenantN,
          "company",
          "Beacon",
        );
        const orgHidden = await insertOrganisation(
          tx,
          tenantN,
          "company",
          "Hidden",
        );

        const founder = await insertMember(
          tx,
          tenantC,
          orgAlpha,
          "organisation_admin",
        );
        const colleague = await insertMember(
          tx,
          tenantC,
          orgAlpha,
          "organisation_member",
        );
        const apex = await insertMember(
          tx,
          tenantI,
          orgApex,
          "organisation_admin",
        );

        const companyAlpha = randomUUID();
        await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, primary_description, current_stage_code, headquarters_country)
          values (${companyAlpha}, ${tenantC}, ${orgAlpha}, 'Alpha Robotics', ${`alpha-${companyAlpha.slice(0, 8)}`}, ${`Alpha builds robots. ${MARKERS.founder}`}, 'seed', 'GB')`;
        const objectiveAlpha = randomUUID();
        await sql`insert into core.capital_objectives (id, tenant_id, company_id, target_amount, currency_code, created_by_user_id, use_of_funds_summary, target_stage)
          values (${objectiveAlpha}, ${tenantC}, ${companyAlpha}, 5000000, 'USD', ${founder.userId}, 'Use of funds (synthetic)', 'seed')`;

        const companyBeacon = randomUUID();
        await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, short_description, marketplace_visibility, current_stage_code, headquarters_country)
          values (${companyBeacon}, ${tenantN}, ${orgBeacon}, ${`Beacon Analytics ${token}`}, ${`beacon-${companyBeacon.slice(0, 8)}`}, 'Network-visible analytics company (synthetic).', 'network_visible', 'series_a', 'DE')`;
        const companyHidden = randomUUID();
        await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, primary_description)
          values (${companyHidden}, ${tenantN}, ${orgHidden}, ${`Beacon Hidden ${token} Ltd`}, ${`hidden-${companyHidden.slice(0, 8)}`}, ${`Private. ${MARKERS.crossTenant}`})`;

        const investorApex = randomUUID();
        await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
          values (${investorApex}, ${tenantI}, ${orgApex}, 'VC', 'Apex Ventures')`;
        const mandateApex = randomUUID();
        await sql`insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, effective_from, raw_mandate_text, created_by_user_id, min_cheque, max_cheque, currency_code, min_stage_code, max_stage_code, discovery_mode)
          values (${mandateApex}, ${tenantI}, ${investorApex}, 'Seed thesis', 'ACTIVE', now(), ${`Ceiling ${MARKERS.investor}`}, ${apex.userId}, 250000, 2000000, 'USD', 'pre_seed', 'seed', 'BALANCED')`;
        await sql`insert into core.investor_mandate_constraints (id, tenant_id, mandate_id, dimension, operator, value_jsonb, importance, is_hard_exclusion)
          values (${randomUUID()}, ${tenantI}, ${mandateApex}, 'geography.country', 'IN', ${sql.json({ kind: "codes", values: ["GB", "DE"] })}, 'MUST', false)`;

        const founderActor = await resolveActor(tx, founder.principal);
        const colleagueActor = await resolveActor(tx, colleague.principal);
        const apexAdmin = await resolveActor(tx, apex.principal);

        const logLines: string[] = [];
        const logger = capturingLogger(logLines);
        const authorization = createAuthorizationService(
          createPostgresAuthorizationPolicySource({ sql }),
        );
        const companies = createPostgresCompanyQueryPort({ sql });
        const investors = createPostgresInvestorOrganisationQueryPort({ sql });
        const mandates = createPostgresInvestorMandateQueryPort({ sql });
        const capital = createPostgresCapitalObjectiveQueryPort({ sql });
        const relationshipRepository = createPostgresRelationshipRepository();
        const relationshipEventRepository =
          createPostgresRelationshipEventRepository();
        const relationships: RelationshipQueryPort = {
          getById: (id) => relationshipRepository.findById(sql, id),
          findByParties: (companyId, investorOrganisationId) =>
            relationshipRepository.findByParties(
              sql,
              companyId,
              investorOrganisationId,
            ),
          listEvents: (relationshipId, page = {}) =>
            relationshipEventRepository.listByRelationship(
              sql,
              relationshipId,
              {
                afterSequence: page.afterSequence,
                limit: page.limit ?? 100,
              },
            ),
          getEventById: (id) => relationshipEventRepository.findById(sql, id),
        };
        const ports = {
          companies,
          investors,
          mandates,
          capital,
          relationships,
        };
        const resolvers = createDisclosureResourceResolverRegistry(
          createDefaultDisclosureResolvers(ports),
        );
        const relationshipParties = createRelationshipPartyResolver(ports);
        const clock = {
          now: () => UtcTimestampSchema.parse(new Date().toISOString()),
        };
        const disclosure = createDisclosureAccessService({
          sql,
          policies: createPostgresDisclosurePolicyRepository(),
          resolvers,
          relationshipParties,
          clock,
        });
        const firewall = createContextFirewall({
          authorization,
          disclosure,
          resolvers,
          relationshipParties,
          documents: createPostgresDocumentQueryPort({ sql }),
          capital,
          clock,
          logger,
        });
        const qTools = createQTools({
          ports: {
            companies,
            capital,
            mandates,
            investors,
            authorization,
            disclosure,
          },
          logger,
        });

        const planFor: World["planFor"] = async (
          actor,
          capability,
          subjects,
        ) => {
          const decision = await firewall.plan({
            actor,
            runId: RUN,
            correlationId: CORRELATION(),
            capability,
            subjects,
          });
          if (decision.outcome !== "AUTHORISED") {
            throw new Error(`firewall denied: ${decision.reason}`);
          }
          return decision.plan;
        };

        await work({
          tools: qTools.port,
          planFor,
          founder: founderActor,
          colleague: colleagueActor,
          apexAdmin,
          companyAlpha,
          companyBeacon,
          companyHidden,
          investorApex,
          mandateApex,
          logLines,
          searchPort: companies,
          tenantN,
          token,
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error: unknown) {
      if (!(error instanceof Rollback)) {
        throw error;
      }
    }
    expect(completed).toBe(true);
  }

  function context(
    actor: ActorContext,
    plan: PermittedContextPlan,
  ): QToolExecutionContext {
    return {
      actor,
      runId: RUN,
      correlationId: CORRELATION(),
      capability: plan.purpose.capability,
      plan,
    };
  }

  it("offers a founder the company, capital and search tools for an own-company question, and serves them", async () => {
    await withWorld(async (w) => {
      const plan = await w.planFor(w.founder, "ANSWER", [
        { kind: "COMPANY", companyId: w.companyAlpha },
      ]);
      const ctx = context(w.founder, plan);
      const offered = await w.tools.offer(ctx);
      expect(offered.map((t) => t.definition.name)).toEqual([
        "get_capital_objective",
        "get_company",
        "search_companies",
      ]);

      const company = await w.tools.execute(
        {
          callId: "c1",
          name: "get_company",
          arguments: { companyId: w.companyAlpha },
        },
        ctx,
      );
      expect(company.status).toBe("SUCCEEDED");
      expect(company.sensitivity).toBe("INTERNAL");
      expect(company.result).toMatchObject({
        ok: true,
        data: {
          canonicalName: "Alpha Robotics",
          relationToYou: "OWN",
          currentStageCode: "seed",
        },
      });
      // The founder's own private description is theirs to read.
      expect(JSON.stringify(company.result)).toContain(MARKERS.founder);

      const objective = await w.tools.execute(
        {
          callId: "c2",
          name: "get_capital_objective",
          arguments: { companyId: w.companyAlpha },
        },
        ctx,
      );
      expect(objective.status).toBe("SUCCEEDED");
      expect(objective.sensitivity).toBe("CONFIDENTIAL");
      expect(objective.result).toMatchObject({
        ok: true,
        data: {
          objective: {
            target: { amount: "5000000", currency: "USD" },
            status: "ACTIVE",
          },
        },
      });

      // A colleague with organisation_member holds both view capabilities too.
      const colleaguePlan = await w.planFor(w.colleague, "ANSWER", [
        { kind: "COMPANY", companyId: w.companyAlpha },
      ]);
      const colleagueObjective = await w.tools.execute(
        {
          callId: "c3",
          name: "get_capital_objective",
          arguments: { companyId: w.companyAlpha },
        },
        context(w.colleague, colleaguePlan),
      );
      expect(colleagueObjective.status).toBe("SUCCEEDED");
    });
  });

  it("GOLDEN cross-tenant: an investor never reaches a founder's private company or objective through a tool", async () => {
    await withWorld(async (w) => {
      // Apex asks about its own organisation; Alpha is not a subject and not network-visible.
      const plan = await w.planFor(w.apexAdmin, "ANSWER", [
        {
          kind: "INVESTOR_ORGANISATION",
          investorOrganisationId: w.investorApex,
        },
      ]);
      const ctx = context(w.apexAdmin, plan);
      const offered = await w.tools.offer(ctx);
      expect(offered.map((t) => t.definition.name)).toEqual([
        "get_company",
        "search_companies",
        "get_investor_mandate",
      ]);

      const company = await w.tools.execute(
        {
          callId: "c1",
          name: "get_company",
          arguments: { companyId: w.companyAlpha },
        },
        ctx,
      );
      expect(company.status).toBe("DENIED");
      expect(company.failureCode).toBe("NOT_AVAILABLE");

      const hidden = await w.tools.execute(
        {
          callId: "c2",
          name: "get_company",
          arguments: { companyId: w.companyHidden },
        },
        ctx,
      );
      expect(hidden.failureCode).toBe("NOT_AVAILABLE");
      expect(hidden.result).toEqual(company.result);

      const objective = await w.tools.execute(
        {
          callId: "c3",
          name: "get_capital_objective",
          arguments: { companyId: w.companyAlpha },
        },
        ctx,
      );
      // Not even offered: no capital scope in an investor's own-organisation plan.
      expect(objective.failureCode).toBe("TOOL_NOT_ELIGIBLE");

      const text = JSON.stringify([company, hidden, objective]);
      expect(text).not.toContain(MARKERS.founder);
      expect(text).not.toContain(MARKERS.crossTenant);
      expect(text).not.toContain("5000000");
      assertNoMarkers(w.logLines.join("\n"));
    });
  });

  it("serves a network-visible company to anyone under the network scope, at NETWORK_VISIBLE", async () => {
    await withWorld(async (w) => {
      const plan = await w.planFor(w.founder, "ANSWER", [
        { kind: "COMPANY", companyId: w.companyAlpha },
      ]);
      const beacon = await w.tools.execute(
        {
          callId: "c1",
          name: "get_company",
          arguments: { companyId: w.companyBeacon },
        },
        context(w.founder, plan),
      );
      expect(beacon.status).toBe("SUCCEEDED");
      expect(beacon.sensitivity).toBe("NETWORK_VISIBLE");
      expect(beacon.result).toMatchObject({
        ok: true,
        data: {
          canonicalName: `Beacon Analytics ${w.token}`,
          relationToYou: "SHARED",
        },
      });
    });
  });

  it("GOLDEN investor-private: the investor reads its declared mandate as typed policy; a founder is refused", async () => {
    await withWorld(async (w) => {
      const plan = await w.planFor(w.apexAdmin, "ANSWER", [
        {
          kind: "INVESTOR_ORGANISATION",
          investorOrganisationId: w.investorApex,
        },
      ]);
      const mandate = await w.tools.execute(
        {
          callId: "c1",
          name: "get_investor_mandate",
          arguments: { investorOrganisationId: w.investorApex },
        },
        context(w.apexAdmin, plan),
      );
      expect(mandate.status).toBe("SUCCEEDED");
      expect(mandate.sensitivity).toBe("CONFIDENTIAL");
      const text = JSON.stringify(mandate.result);
      expect(text).toContain(w.mandateApex);
      expect(text).toContain(
        '"cheque":{"currency":"USD","min":"250000","max":"2000000"}',
      );
      expect(text).toContain('"dimension":"geography.country"');
      expect(text).toContain('"automatedUse":"ELIGIBLE"');
      expect(text).not.toContain(MARKERS.investor);

      // The founder's plan never holds an INVESTOR_MANDATE scope: not offered, not served.
      const founderPlan = await w.planFor(w.founder, "ANSWER", [
        { kind: "COMPANY", companyId: w.companyAlpha },
      ]);
      const ctx = context(w.founder, founderPlan);
      expect(
        (await w.tools.offer(ctx)).map((t) => t.definition.name),
      ).not.toContain("get_investor_mandate");
      const refused = await w.tools.execute(
        {
          callId: "c2",
          name: "get_investor_mandate",
          arguments: { investorOrganisationId: w.investorApex },
        },
        ctx,
      );
      expect(refused.status).toBe("DENIED");
      expect(refused.failureCode).toBe("TOOL_NOT_ELIGIBLE");
      expect(JSON.stringify(refused)).not.toContain(w.mandateApex);
      assertNoMarkers(w.logLines.join("\n"));
    });
  });

  it("searches only discoverable companies, pages by cursor and re-checks disclosure per candidate", async () => {
    await withWorld(async (w) => {
      const plan = await w.planFor(w.apexAdmin, "ANSWER", [
        {
          kind: "INVESTOR_ORGANISATION",
          investorOrganisationId: w.investorApex,
        },
      ]);
      const ctx = context(w.apexAdmin, plan);
      const search = await w.tools.execute(
        {
          callId: "c1",
          name: "search_companies",
          arguments: { query: w.token },
        },
        ctx,
      );
      expect(search.status).toBe("SUCCEEDED");
      expect(search.sensitivity).toBe("NETWORK_VISIBLE");
      expect(search.result).toMatchObject({
        ok: true,
        data: {
          items: [
            {
              companyId: w.companyBeacon,
              canonicalName: `Beacon Analytics ${w.token}`,
            },
          ],
          nextCursor: null,
        },
      });
      const text = JSON.stringify(search.result);
      expect(text).not.toContain(w.companyHidden);
      expect(text).not.toContain(w.companyAlpha);

      const byCountry = await w.tools.execute(
        {
          callId: "c2",
          name: "search_companies",
          arguments: { query: w.token, headquartersCountry: "gb" },
        },
        ctx,
      );
      expect(JSON.stringify(byCountry.result)).not.toContain(w.companyBeacon);

      const badCursor = await w.tools.execute(
        {
          callId: "c3",
          name: "search_companies",
          arguments: { cursor: "AAAA" },
        },
        ctx,
      );
      expect(badCursor.status).toBe("FAILED");
      expect(badCursor.failureCode).toBe("INVALID_ARGUMENTS");

      // Keyset pagination on the port itself: page size one over this world's token.
      const first = await w.searchPort.searchCompanies({
        viewer: { tenantId: w.tenantN as never, organisationId: undefined },
        text: w.token,
        limit: 1,
      });
      expect(first.items.map((i) => i.id)).toEqual([w.companyBeacon]);
      // Only Beacon is discoverable under this token: one page, then nothing.
      expect(first.nextCursor).toBeNull();
      // Own-organisation candidates are available to a viewer that names its organisation.
      const owned = await w.searchPort.searchCompanies({
        viewer: {
          tenantId: w.founder.tenantId,
          organisationId: w.founder.organisationId,
        },
        text: "alpha",
        limit: 10,
      });
      expect(
        owned.items.map((i) => [i.canonicalName, i.ownedByViewer]),
      ).toEqual([["Alpha Robotics", true]]);
    });
  });
});
