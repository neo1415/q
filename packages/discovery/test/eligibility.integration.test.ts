import { createHash, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import { createPostgresCapitalObjectiveQueryPort } from "@capital-q/capital";
import {
  CompanyIdSchema,
  createCompanyService,
  createPostgresCompanyMarketplaceQueryPort,
  createPostgresCompanyQueryPort,
} from "@capital-q/companies";
import { createSyntheticVerificationClaimsPort } from "@capital-q/companies/dev";
import { COMPANY_EVENTS } from "@capital-q/companies/events";
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
  createPostgresInvestorMandateQueryPort,
  createPostgresInvestorOrganisationQueryPort,
  createPostgresInvestorOrganisationRepository,
} from "@capital-q/investors";
import { createPostgresOrganisationQueryPort } from "@capital-q/organisations";
import {
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
  type RelationshipQueryPort,
} from "@capital-q/network";
import {
  createDefaultDisclosureResolvers,
  createDisclosureAccessService,
  createDisclosureResourceResolverRegistry,
  createPostgresDisclosurePolicyRepository,
  createRelationshipPartyResolver,
  systemDisclosureClock,
} from "@capital-q/permissions";
import {
  ActorContextSchema,
  createAuthorizationService,
  type ActorContext,
} from "@capital-q/security";
import { createPostgresAuthorizationPolicySource } from "@capital-q/security/postgres";
import {
  createPostgresTaxonomyAssignmentRepository,
  referenceNode,
} from "@capital-q/taxonomy";

import type { EligibilityResult } from "../src/eligibility/contracts.js";
import { createEligibilityService } from "../src/eligibility/service.js";
import { createDomainEligibilityPorts } from "../src/infrastructure/domain-port-eligibility-sources.js";

/**
 * Hard eligibility over the real owning-context adapters and local
 * PostgreSQL. The point of running this against a database rather than a
 * fake: the founder-private memory row, the conversation summary and the
 * public-web source below really exist in the tables Q reads from, and
 * the eligibility answer is proven not to move.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const PRIVATE_MARKER = "REC_PRIVATE_FOUNDER_MEMORY_MUST_NOT_AFFECT_ELIGIBILITY";

class Rollback extends Error {}

type World = {
  readonly tx: TransactionContext;
  readonly investorActor: ActorContext;
  readonly founderActor: ActorContext;
  readonly tenantC: string;
  readonly orgC: string;
  readonly founderUserId: string;
  readonly companyId: string;
  readonly investorOrgId: string;
  readonly mandateId: string;
  readonly evaluate: (
    companyIds: readonly string[],
  ) => Promise<readonly EligibilityResult[]>;
  /** The Companies context's own service, with the local synthetic verification seam. */
  readonly companiesWithSyntheticVerification: () => ReturnType<
    typeof createCompanyService
  >;
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

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;

const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");
const node = (vocabulary: string, code: string) =>
  referenceNode(vocabulary, code).id;

describe("@capital-q/discovery hard eligibility against local PostgreSQL", () => {
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
      values (${id}, ${tenantId}, 'investment_firm', ${name}, ${`org-${id.slice(0, 8)}`})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${id})`;
    return id;
  }

  async function insertMember(
    tx: TransactionContext,
    tenantId: string,
    organisationId: string,
  ): Promise<{ userId: string; membershipId: string }> {
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
      select ${membershipId}, r.id from permissions.roles r where r.code = 'organisation_admin'`;
    // The company-side tenant has no marketplace verification seam in
    // production; the synthetic one below is test-only.
    await tx.sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
    return { userId: profile.id, membershipId };
  }

  async function seed(tx: TransactionContext): Promise<World> {
    const { sql } = tx;
    const tenantI = await insertTenant(tx, "REC Investor Tenant");
    const tenantC = await insertTenant(tx, "REC Company Tenant");
    const orgI = await insertOrganisation(tx, tenantI, "Apex Ventures");
    const orgC = await insertOrganisation(tx, tenantC, "Alpha Rails Ltd");
    const investorMember = await insertMember(tx, tenantI, orgI);
    const founderMember = await insertMember(tx, tenantC, orgC);

    const companyId = randomUUID();
    await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, current_stage_code, headquarters_country, short_description, marketplace_visibility, marketplace_readiness_state)
      values (${companyId}, ${tenantC}, ${orgC}, 'Alpha Rails', ${`alpha-${companyId.slice(0, 8)}`}, 'seed', 'NG', 'Rails for payments.', 'network_visible', 'marketplace_ready')`;
    await sql`insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source)
      values (${tenantC}, 'COMPANY', ${companyId}, ${node("industry", "payments")}, 'user_selected')`;

    const investorOrgId = randomUUID();
    await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
      values (${investorOrgId}, ${tenantI}, ${orgI}, 'VC', 'Apex Ventures')`;
    const mandateId = randomUUID();
    await sql`insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, effective_from, created_by_user_id)
      values (${mandateId}, ${tenantI}, ${investorOrgId}, 'Seed Africa', 'ACTIVE', now(), ${investorMember.userId})`;

    const investorActor = ActorContextSchema.parse({
      userId: investorMember.userId,
      tenantId: tenantI,
      organisationId: orgI,
      membershipId: investorMember.membershipId,
      actorType: "HUMAN",
    });
    const founderActor = ActorContextSchema.parse({
      userId: founderMember.userId,
      tenantId: tenantC,
      organisationId: orgC,
      membershipId: founderMember.membershipId,
      actorType: "HUMAN",
    });
    const companiesWithSyntheticVerification = () =>
      createCompanyService({
        sql,
        transactions: nestedTransactions(tx),
        authorization: createAuthorizationService(
          createPostgresAuthorizationPolicySource({ sql }),
        ),
        organisations: createPostgresOrganisationQueryPort({ sql }),
        outbox: createOutboxWriter({
          registry: createEventRegistry([...COMPANY_EVENTS]),
        }),
        audit: createPostgresMaterialActionAuditWriter(),
        verification: createSyntheticVerificationClaimsPort({
          environment: "test",
          databaseUrl: TEST_DATABASE_URL,
          verifiedCompanyIds: [companyId],
        }),
      });

    const companies = createPostgresCompanyQueryPort({ sql });
    const investors = createPostgresInvestorOrganisationQueryPort({ sql });
    const mandates = createPostgresInvestorMandateQueryPort({ sql });
    const capital = createPostgresCapitalObjectiveQueryPort({ sql });
    const relationshipRepository = createPostgresRelationshipRepository();
    const relationshipEventRepository =
      createPostgresRelationshipEventRepository();
    const relationships: RelationshipQueryPort = {
      getById: (id) => relationshipRepository.findById(sql, id),
      findByParties: (c, i) => relationshipRepository.findByParties(sql, c, i),
      listEvents: (id, page = {}) =>
        relationshipEventRepository.listByRelationship(sql, id, {
          afterSequence: page.afterSequence,
          limit: page.limit ?? 100,
        }),
      getEventById: (id) => relationshipEventRepository.findById(sql, id),
    };
    const disclosurePorts = {
      companies,
      investors,
      mandates,
      capital,
      relationships,
    };
    const disclosure = createDisclosureAccessService({
      sql,
      policies: createPostgresDisclosurePolicyRepository(),
      resolvers: createDisclosureResourceResolverRegistry(
        createDefaultDisclosureResolvers(disclosurePorts),
      ),
      relationshipParties: createRelationshipPartyResolver(disclosurePorts),
      clock: systemDisclosureClock,
    });

    const service = createEligibilityService({
      ports: createDomainEligibilityPorts({
        sql,
        companies: createPostgresCompanyMarketplaceQueryPort({ sql }),
        assignments: createPostgresTaxonomyAssignmentRepository(),
        mandates,
        investorOrganisations: createPostgresInvestorOrganisationRepository(),
        relationships,
        disclosure,
      }),
      clock: () => new Date("2026-09-18T12:00:00.000Z"),
    });

    return {
      tx,
      investorActor,
      founderActor,
      companiesWithSyntheticVerification,
      tenantC,
      orgC,
      founderUserId: founderMember.userId,
      companyId,
      investorOrgId,
      mandateId,
      evaluate: async (companyIds) =>
        (await service.evaluate({ actor: investorActor, companyIds })).results,
    };
  }

  async function withWorld(work: (world: World) => Promise<void>) {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        await work(await seed(tx));
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  }

  it("A. a marketplace-ready, network-visible company under an ACTIVE mandate is ELIGIBLE across tenants", async () => {
    await withWorld(async ({ evaluate, companyId, mandateId }) => {
      const [r] = await evaluate([companyId]);
      expect(r?.decision).toBe("ELIGIBLE");
      expect(r?.reasonCodes).toEqual([]);
      expect(r?.mandateId).toBe(mandateId);
    });
  });

  it("B. not_assessed readiness makes the same company INELIGIBLE although it stays network-visible", async () => {
    await withWorld(async ({ tx, evaluate, companyId }) => {
      await tx.sql`update core.companies set marketplace_readiness_state = 'not_assessed' where id = ${companyId}`;
      const [r] = await evaluate([companyId]);
      expect(r?.decision).toBe("INELIGIBLE");
      expect(r?.reasonCodes).toEqual(["COMPANY_NOT_MARKETPLACE_ELIGIBLE"]);
    });
  });

  it("C/O. an organisation-private company in another tenant is INELIGIBLE and reveals nothing", async () => {
    await withWorld(async ({ tx, evaluate, companyId }) => {
      await tx.sql`update core.companies set marketplace_visibility = 'organisation_private' where id = ${companyId}`;
      const [r] = await evaluate([companyId]);
      expect(r?.decision).toBe("INELIGIBLE");
      expect(r?.reasonCodes).toEqual(["COMPANY_NOT_DISCOVERABLE_BY_INVESTOR"]);
      expect(JSON.stringify(r)).not.toContain("Alpha Rails");
    });
  });

  it("D/E. a declared taxonomy HARD_EXCLUSION removes the company; AVOID on the same node does not", async () => {
    await withWorld(
      async ({ tx, evaluate, companyId, mandateId, investorActor }) => {
        await tx.sql`insert into taxonomy.mandate_preferences (tenant_id, mandate_id, node_id, preference_strength, is_exclusion, source)
        values (${investorActor.tenantId}, ${mandateId}, ${node("industry", "payments")}, 'AVOID', false, 'user_selected')`;
        expect((await evaluate([companyId]))[0]?.decision).toBe("ELIGIBLE");

        await tx.sql`update taxonomy.mandate_preferences set preference_strength = 'HARD_EXCLUSION', is_exclusion = true
        where mandate_id = ${mandateId}`;
        const [r] = await evaluate([companyId]);
        expect(r?.decision).toBe("INELIGIBLE");
        expect(r?.reasonCodes).toEqual(["EXPLICIT_HARD_EXCLUSION"]);
      },
    );
  });

  it("eligibility.v2. a q_inferred classification on a hard-excluded node is not a FAIL; confirming it (user_selected) is", async () => {
    await withWorld(
      async ({
        tx,
        evaluate,
        companyId,
        tenantC,
        mandateId,
        investorActor,
      }) => {
        await tx.sql`insert into taxonomy.mandate_preferences (tenant_id, mandate_id, node_id, preference_strength, is_exclusion, source)
        values (${investorActor.tenantId}, ${mandateId}, ${node("business_model", "marketplace")}, 'HARD_EXCLUSION', true, 'user_selected')`;
        // The only business_model row is Q's inference, on the excluded node.
        await tx.sql`insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source)
        values (${tenantC}, 'COMPANY', ${companyId}, ${node("business_model", "marketplace")}, 'q_inferred')`;
        const [inferred] = await evaluate([companyId]);
        expect(inferred?.eligibilityPolicyVersion).toBe("eligibility.v2");
        expect(inferred?.decision).toBe("UNDETERMINED");
        expect(inferred?.reasonCodes).toEqual(["COMPANY_TAXONOMY_UNKNOWN"]);

        // Confirmation supersedes the suggestion with a user_selected row,
        // as the Taxonomy context's own workflow does.
        await tx.sql`update taxonomy.entity_assignments set status = 'SUPERSEDED', valid_to = clock_timestamp()
        where entity_id = ${companyId} and assignment_source = 'q_inferred' and status = 'ACTIVE'`;
        await tx.sql`insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source)
        values (${tenantC}, 'COMPANY', ${companyId}, ${node("business_model", "marketplace")}, 'user_selected')`;
        const [confirmed] = await evaluate([companyId]);
        expect(confirmed?.decision).toBe("INELIGIBLE");
        expect(confirmed?.reasonCodes).toEqual(["EXPLICIT_HARD_EXCLUSION"]);
      },
    );
  });

  it("F/G. a HARD_EXCLUSION stage rule: mismatch is INELIGIBLE, unknown stage is UNDETERMINED", async () => {
    await withWorld(
      async ({ tx, evaluate, companyId, mandateId, investorActor }) => {
        await tx.sql`insert into core.investor_mandate_constraints (tenant_id, mandate_id, dimension, operator, value_jsonb, importance, is_hard_exclusion)
        values (${investorActor.tenantId}, ${mandateId}, 'stage', 'NOT_IN', ${tx.sql.json({ kind: "codes", values: ["series_a"] })}, 'HARD_EXCLUSION', true)`;
        expect((await evaluate([companyId]))[0]?.reasonCodes).toEqual([
          "STAGE_OUTSIDE_HARD_MANDATE",
        ]);
        await tx.sql`update core.companies set current_stage_code = null where id = ${companyId}`;
        const [r] = await evaluate([companyId]);
        expect(r?.decision).toBe("UNDETERMINED");
        expect(r?.reasonCodes).toEqual(["COMPANY_STAGE_UNKNOWN"]);
      },
    );
  });

  it("H. a DRAFT mandate holding an exclusion has no effect while the ACTIVE one stands", async () => {
    await withWorld(
      async ({ tx, evaluate, companyId, investorOrgId, investorActor }) => {
        const draftId = randomUUID();
        await tx.sql`insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, created_by_user_id)
        values (${draftId}, ${investorActor.tenantId}, ${investorOrgId}, 'Draft', 'DRAFT', ${investorActor.userId})`;
        await tx.sql`insert into taxonomy.mandate_preferences (tenant_id, mandate_id, node_id, preference_strength, is_exclusion, source)
        values (${investorActor.tenantId}, ${draftId}, ${node("industry", "payments")}, 'HARD_EXCLUSION', true, 'user_selected')`;
        expect((await evaluate([companyId]))[0]?.decision).toBe("ELIGIBLE");
      },
    );
  });

  it("L/M/N. founder-private memory, a conversation summary and a public-web source change nothing; a canonical field does", async () => {
    await withWorld(
      async ({ tx, evaluate, companyId, tenantC, orgC, founderUserId }) => {
        const [before] = await evaluate([companyId]);
        expect(before?.decision).toBe("ELIGIBLE");

        const content = `${PRIVATE_MARKER}: the founder told Q this is really a gambling business`;
        const memoryId = randomUUID();
        await tx.sql`insert into q_knowledge.memory_items
        (id, tenant_id, owner_context_type, owner_context_id, subject_type, subject_id, memory_type, memory_key,
         content, content_sha256, write_mode, visibility_scope, sensitivity_class, status)
        values (${memoryId}, ${tenantC}, 'company', ${companyId}, 'COMPANY', ${companyId}, 'fact', 'rec.private_marker',
         ${content}, ${sha256(content)}, 'Q_PROPOSED', 'founder_private', 'CONFIDENTIAL', 'active')`;
        await tx.sql`insert into q_runtime.conversations (tenant_id, user_id, organisation_id, context_type, summary)
        values (${tenantC}, ${founderUserId}, ${orgC}, 'ORGANISATION', ${`${PRIVATE_MARKER}: the biggest customer is leaving and the founders know it`})`;
        await tx.sql`insert into evidence.sources (tenant_id, source_type, subject_type, subject_id, title, source_url, visibility_scope, sensitivity_class)
        values (${tenantC}, 'PUBLIC_WEB', 'COMPANY', ${companyId}, ${`${PRIVATE_MARKER}: article claims Alpha Rails runs a casino`.slice(0, 200)}, 'https://example.test/alpha-rails-casino', 'founder_private', 'CONFIDENTIAL')`;

        const [during] = await evaluate([companyId]);
        expect(during).toEqual(before);
        expect(JSON.stringify(during)).not.toContain(PRIVATE_MARKER);

        await tx.sql`delete from q_knowledge.memory_items where id = ${memoryId}`;
        const [after] = await evaluate([companyId]);
        expect(after).toEqual(before);

        await tx.sql`update core.companies set company_status = 'closed' where id = ${companyId}`;
        const [closed] = await evaluate([companyId]);
        expect(closed?.decision).toBe("INELIGIBLE");
        expect(closed?.reasonCodes).toEqual(["COMPANY_NOT_ACTIVE"]);
      },
    );
  });

  it("K. an existing DISCOVERED relationship does not remove the pair", async () => {
    await withWorld(
      async ({ tx, evaluate, companyId, investorOrgId, tenantC }) => {
        await tx.sql`insert into network.relationships (tenant_id, company_id, investor_organisation_id)
        values (${tenantC}, ${companyId}, ${investorOrgId})`;
        const [r] = await evaluate([companyId]);
        expect(r?.decision).toBe("ELIGIBLE");
      },
    );
  });

  it("MKT. readiness is the Companies context's answer: not_assessed and requirements_outstanding are rejected; a legitimately ready company passes that criterion while every other gate still applies", async () => {
    await withWorld(
      async ({
        tx,
        evaluate,
        companyId,
        founderActor,
        companiesWithSyntheticVerification,
      }) => {
        const criterion = (r: EligibilityResult | undefined) =>
          r?.criteria.find((c) => c.criterion === "MARKETPLACE_PARTICIPATION")
            ?.outcome;

        // The seed writes marketplace_ready directly; put the row back to
        // where every real company starts and let the domain move it.
        await tx.sql`update core.companies set marketplace_readiness_state = 'not_assessed' where id = ${companyId}`;
        let [r] = await evaluate([companyId]);
        expect(r?.decision).toBe("INELIGIBLE");
        expect(criterion(r)).toBe("FAIL");

        // Production seam: nothing is verified, so assessment lands on
        // requirements_outstanding and eligibility still rejects.
        const production = createCompanyService({
          sql: tx.sql,
          transactions: nestedTransactions(tx),
          authorization: createAuthorizationService(
            createPostgresAuthorizationPolicySource({ sql: tx.sql }),
          ),
          organisations: createPostgresOrganisationQueryPort({ sql: tx.sql }),
          outbox: createOutboxWriter({
            registry: createEventRegistry([...COMPANY_EVENTS]),
          }),
          audit: createPostgresMaterialActionAuditWriter(),
        });
        const outstanding = await production.assessMarketplaceReadiness({
          actor: founderActor,
          companyId: CompanyIdSchema.parse(companyId),
          correlationId: CORRELATION(),
        });
        expect(outstanding.state).toBe("requirements_outstanding");
        [r] = await evaluate([companyId]);
        expect(r?.decision).toBe("INELIGIBLE");
        expect(r?.reasonCodes).toEqual(["COMPANY_NOT_MARKETPLACE_ELIGIBLE"]);

        // The local synthetic seam, through the same policy and audit.
        const ready =
          await companiesWithSyntheticVerification().assessMarketplaceReadiness(
            {
              actor: founderActor,
              companyId: CompanyIdSchema.parse(companyId),
              correlationId: CORRELATION(),
            },
          );
        expect(ready.state).toBe("marketplace_ready");
        [r] = await evaluate([companyId]);
        expect(criterion(r)).toBe("PASS");
        expect(r?.decision).toBe("ELIGIBLE");

        // Marketplace ready ≠ automatically eligible: the other gates hold.
        await tx.sql`update core.companies set company_status = 'closed' where id = ${companyId}`;
        [r] = await evaluate([companyId]);
        expect(criterion(r)).toBe("PASS");
        expect(r?.decision).toBe("INELIGIBLE");
        expect(r?.reasonCodes).toEqual(["COMPANY_NOT_ACTIVE"]);
      },
    );
  });

  it("P. the same rows evaluated repeatedly give the same result", async () => {
    await withWorld(async ({ evaluate, companyId }) => {
      const first = await evaluate([companyId]);
      for (let i = 0; i < 5; i += 1) {
        expect(await evaluate([companyId])).toEqual(first);
      }
    });
  });
});
