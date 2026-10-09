import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createPostgresCapitalObjectiveQueryPort } from "@capital-q/capital";
import { createPostgresCompanyQueryPort } from "@capital-q/companies";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  QRunIdSchema,
  UtcTimestampSchema,
  type CorrelationId,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";
import { createPostgresCompanyKnowledge } from "@capital-q/discovery";
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
import { createLogger } from "@capital-q/observability";
import {
  createDefaultDisclosureResolvers,
  createDisclosureAccessService,
  createDisclosureResourceResolverRegistry,
  createPostgresDisclosurePolicyRepository,
  createRelationshipPartyResolver,
} from "@capital-q/permissions";
import { createContextFirewall } from "@capital-q/q-firewall";
import { createQTools } from "@capital-q/q-tools";
import {
  AuthUserIdSchema,
  createAuthorizationService,
  resolveHumanActorContext,
} from "@capital-q/security";
import {
  createPostgresActorContextResolver,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";

import { createPostgresCompanyCatalog } from "../src/composition/company-catalog.js";

/**
 * K1, Context Firewall-adjacent invariant, against the local database
 * through the real tool path: the Context Firewall's plan, the
 * `discovery.companies` tool, the q-api catalog over D's Tier B
 * projection, and the real disclosure service. The person's own
 * organisation's company -- network-visible, in the sector they asked
 * for -- never comes back from discovery; another organisation's does.
 * One rolled-back transaction.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const RUN = QRunIdSchema.parse("b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2");
const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
class Rollback extends Error {}

describe("discovery never returns their own organisation's company (K1)", () => {
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

  async function organisation(tx: TransactionContext, tenant: string) {
    const id = randomUUID();
    await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${id}, ${tenant}, 'company', 'Own test', ${`own-${id.slice(0, 8)}`})`;
    await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${id})`;
    return id;
  }

  it("lists another organisation's fintech company and never the founder's own", async () => {
    let checked = false;
    try {
      await db.transactions.run(async (tx) => {
        const { sql } = tx;
        const tenantOwn = randomUUID();
        const tenantOther = randomUUID();
        for (const tenant of [tenantOwn, tenantOther]) {
          await sql`insert into identity.tenants (id, name) values (${tenant}, 'Own test')`;
        }
        const orgOwn = await organisation(tx, tenantOwn);
        const orgOther = await organisation(tx, tenantOther);

        // The founder: an admin of their own company's organisation.
        const authUserId = randomUUID();
        await sql`insert into auth.users (id) values (${authUserId})`;
        const [profile] = await sql<{ id: string }[]>`
          select id from identity.user_profiles where auth_user_id = ${authUserId}`;
        if (profile === undefined)
          throw new Error("profile trigger did not run");
        const membershipId = randomUUID();
        await sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
          values (${membershipId}, ${tenantOwn}, ${orgOwn}, ${profile.id})`;
        await sql`insert into identity.membership_roles (membership_id, role_id)
          select ${membershipId}, r.id from permissions.roles r where r.code = 'organisation_admin'`;
        await sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;

        // Both companies network-visible fintech in Nigeria; one is theirs.
        const [fintech] = await sql<{ id: string }[]>`
          select n.id from taxonomy.nodes n
            join taxonomy.vocabularies v on v.id = n.vocabulary_id
           where v.code = 'industry' and n.canonical_code = 'fintech'`;
        if (fintech === undefined) throw new Error("no fintech node");
        const own = randomUUID();
        const other = randomUUID();
        for (const [id, tenant, org, name] of [
          [own, tenantOwn, orgOwn, "Own Fintech Test"],
          [other, tenantOther, orgOther, "Other Fintech Test"],
        ] as const) {
          await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug,
                      marketplace_visibility, company_status, headquarters_country)
            values (${id}, ${tenant}, ${org}, ${name}, ${`own-${id.slice(0, 8)}`},
                    'network_visible', 'active', 'NG')`;
          await sql`insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source)
            values (${tenant}, 'COMPANY', ${id}, ${fintech.id}, 'user_selected')`;
        }

        const resolution = await resolveHumanActorContext(
          createPostgresActorContextResolver({ sql }),
          { principal: { authUserId: AuthUserIdSchema.parse(authUserId) } },
        );
        if (resolution.status !== "RESOLVED") {
          throw new Error(`context not resolved: ${resolution.status}`);
        }
        const founder = resolution.context;

        const logger = createLogger(
          { serviceName: "q-api-test", environment: "test" },
          { level: "silent" },
        );
        const authorization = createAuthorizationService(
          createPostgresAuthorizationPolicySource({ sql }),
        );
        const companies = createPostgresCompanyQueryPort({ sql });
        const investors = createPostgresInvestorOrganisationQueryPort({ sql });
        const mandates = createPostgresInvestorMandateQueryPort({ sql });
        const capital = createPostgresCapitalObjectiveQueryPort({ sql });
        const relationshipRepository = createPostgresRelationshipRepository();
        const relationshipEvents = createPostgresRelationshipEventRepository();
        const relationships: RelationshipQueryPort = {
          getById: (id) => relationshipRepository.findById(sql, id),
          findByParties: (companyId, investorOrganisationId) =>
            relationshipRepository.findByParties(
              sql,
              companyId,
              investorOrganisationId,
            ),
          listEvents: (relationshipId, page = {}) =>
            relationshipEvents.listByRelationship(sql, relationshipId, {
              afterSequence: page.afterSequence,
              limit: page.limit ?? 100,
            }),
          getEventById: (id) => relationshipEvents.findById(sql, id),
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
        const tools = createQTools({
          ports: {
            companies,
            capital,
            mandates,
            investors,
            authorization,
            disclosure,
            companyCatalog: createPostgresCompanyCatalog({
              sql,
              knowledge: createPostgresCompanyKnowledge({ sql }),
            }),
          },
          logger,
        }).port;

        const decision = await firewall.plan({
          actor: founder,
          runId: RUN,
          correlationId: CORRELATION(),
          capability: "ANSWER",
          subjects: [],
        });
        if (decision.outcome !== "AUTHORISED") {
          throw new Error(`firewall denied: ${decision.reason}`);
        }
        const outcome = await tools.execute(
          {
            callId: "c1",
            name: "discover_companies",
            arguments: { sectors: ["fintech"], countries: ["NG"], limit: 24 },
          },
          {
            actor: founder,
            runId: RUN,
            correlationId: CORRELATION(),
            capability: "ANSWER",
            plan: decision.plan,
          },
        );
        expect(outcome.status).toBe("SUCCEEDED");
        const listed = (
          outcome.result as { data: { companies: { companyId: string }[] } }
        ).data.companies.map((company) => company.companyId);
        expect(listed).toContain(other);
        expect(listed).not.toContain(own);
        checked = true;
        throw new Rollback();
      });
    } catch (error: unknown) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(checked).toBe(true);
  });
});
