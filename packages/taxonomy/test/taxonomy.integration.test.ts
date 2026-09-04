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
  AuthorizationDeniedError,
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

import { TAXONOMY_EVENTS } from "../src/events/index.js";
import {
  createTaxonomyService,
  REFERENCE_TAXONOMY,
  referenceNode,
  TaxonomyNodeIdSchema,
  TaxonomyNodeNotSelectableError,
  TaxonomySubjectNotFoundError,
  type TaxonomyNodeId,
  type TaxonomyService,
} from "../src/index.js";

/**
 * The taxonomy against the real local database: reference data equals the
 * TypeScript source id for id (stable across resets), hierarchy queries,
 * confirmed company classification with history and raw language, declared
 * cross-tenant
 * and authority rules, and event/audit privacy. Every test runs in one
 * rolled-back transaction with a savepoint-backed TransactionManager.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const RAW_TEXT_MARKER = "PRIVATE-TAXONOMY-SOURCE-TEXT-DO-NOT-EMIT";
const RAW_STATEMENT = `We build rails that let rural cooperative banks launch mobile transfers. ${RAW_TEXT_MARKER}`;

class Rollback extends Error {}

const registry = createEventRegistry([...TAXONOMY_EVENTS]);

const node = (vocabulary: string, code: string): TaxonomyNodeId =>
  TaxonomyNodeIdSchema.parse(referenceNode(vocabulary, code).id);

type World = {
  readonly tx: TransactionContext;
  readonly taxonomy: TaxonomyService;
  readonly tenantA: string;
  readonly tenantB: string;
  readonly founderA: ActorContext;
  readonly memberA: ActorContext;
  readonly companyA: CompanyId;
  readonly companyB: CompanyId;
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

describe("@capital-q/taxonomy against local PostgreSQL", () => {
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
  ): Promise<{
    principal: AuthenticatedPrincipal;
    userId: string;
    membershipId: string;
  }> {
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
      userId: profile.id,
      membershipId,
    };
  }

  async function resolveActor(
    tx: TransactionContext,
    principal: AuthenticatedPrincipal,
  ) {
    const resolution = await resolveHumanActorContext(
      createPostgresActorContextResolver({ sql: tx.sql }),
      { principal },
    );
    if (resolution.status !== "RESOLVED") {
      throw new Error(`context not resolved: ${resolution.status}`);
    }
    return resolution.context;
  }

  async function seedWorld(tx: TransactionContext): Promise<World> {
    const tenantA = await insertTenant(tx, "Taxonomy Company Tenant");
    const tenantB = await insertTenant(tx, "Taxonomy Investor Tenant");
    const orgA = await insertOrganisation(tx, tenantA, "company", "Alpha");
    const founder = await insertMember(tx, tenantA, orgA, "organisation_admin");
    const member = await insertMember(tx, tenantA, orgA, "organisation_member");

    const companyAId = randomUUID();
    await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
      values (${companyAId}, ${tenantA}, ${orgA}, 'Alpha Rails', ${`alpha-${companyAId.slice(0, 8)}`})`;
    // The member is a founder with a CEO title; neither grants company.edit.
    await tx.sql`insert into core.company_members (tenant_id, company_id, user_id, business_title, is_founder)
      values (${tenantA}, ${companyAId}, ${member.userId}, 'CEO', true)`;
    const orgB2 = await insertOrganisation(tx, tenantB, "company", "Beta");
    const companyBId = randomUUID();
    await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
      values (${companyBId}, ${tenantB}, ${orgB2}, 'Beta Co', ${`beta-${companyBId.slice(0, 8)}`})`;

    const authorization = createAuthorizationService(
      createPostgresAuthorizationPolicySource({ sql: tx.sql }),
    );
    const outbox = createOutboxWriter({ registry });
    const audit = createPostgresMaterialActionAuditWriter();
    const transactions = nestedTransactions(tx);
    const taxonomy = createTaxonomyService({
      sql: tx.sql,
      transactions,
      authorization,
      companies: createPostgresCompanyQueryPort({ sql: tx.sql }),
      outbox,
      audit,
    });
    return {
      tx,
      taxonomy,
      tenantA,
      tenantB,
      founderA: await resolveActor(tx, founder.principal),
      memberA: await resolveActor(tx, member.principal),
      companyA: CompanyIdSchema.parse(companyAId),
      companyB: CompanyIdSchema.parse(companyBId),
    };
  }

  async function withWorld(
    work: (world: World) => Promise<void>,
  ): Promise<void> {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        await work(await seedWorld(tx));
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

  const count = async (query: Promise<{ count: number }[]>) =>
    (await query)[0]?.count;

  // -------------------------------------------------------------------------
  // Reference data
  // -------------------------------------------------------------------------

  it("the database equals the TypeScript reference set id for id (stable across resets)", async () => {
    const rows = await db.sql<
      {
        id: string;
        vocabulary: string;
        canonical_code: string;
        parent_node_id: string | null;
        depth: number;
        display_name: string;
      }[]
    >`
      select n.id, v.code as vocabulary, n.canonical_code, n.parent_node_id, n.depth, n.display_name
        from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
       order by v.code, n.canonical_code`;
    const expected = [...REFERENCE_TAXONOMY.nodes]
      .sort((a, b) =>
        a.vocabularyCode === b.vocabularyCode
          ? a.canonicalCode.localeCompare(b.canonicalCode)
          : a.vocabularyCode.localeCompare(b.vocabularyCode),
      )
      .map((n) => ({
        id: n.id,
        vocabulary: n.vocabularyCode,
        canonical_code: n.canonicalCode,
        parent_node_id: n.parentNodeId,
        depth: n.depth,
        display_name: n.displayName,
      }));
    expect(rows).toEqual(expected);
    const vocabularies = await db.sql<
      { id: string; code: string; version: number }[]
    >`
      select id, code, version from taxonomy.vocabularies order by code`;
    expect(vocabularies).toEqual(
      [...REFERENCE_TAXONOMY.vocabularies]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((v) => ({ id: v.id, code: v.code, version: v.version })),
    );
    expect(
      await count(db.sql`select count(*)::int as count from taxonomy.aliases`),
    ).toBe(REFERENCE_TAXONOMY.aliases.length);
    expect(
      await count(
        db.sql`select count(*)::int as count from taxonomy.node_edges`,
      ),
    ).toBe(REFERENCE_TAXONOMY.edges.length);
  });

  it("answers hierarchy, alias, canonical-code and version-set queries deterministically", async () => {
    await withWorld(async ({ taxonomy }) => {
      const query = taxonomy.query;
      const roots = await query.listNodes({
        vocabularyCode: "industry",
        parentNodeId: null,
        limit: 100,
      });
      expect(roots.items.every((n) => n.depth === 0)).toBe(true);
      expect(roots.items.map((n) => n.canonicalCode)).toContain(
        "financial_services",
      );
      expect(roots.items.map((n) => n.canonicalCode)).toContain("healthcare");

      const fintech = await query.findNodeByCanonicalCode(
        "industry",
        "fintech",
      );
      expect(fintech?.id).toBe(node("industry", "fintech"));
      const children = await query.listChildren(node("industry", "payments"));
      expect(children.map((n) => n.canonicalCode).sort()).toEqual([
        "cross_border_payments",
        "embedded_payments",
        "merchant_payments",
        "payment_infrastructure",
      ]);
      const detail = await query.getNodeDetail(
        node("industry", "payment_infrastructure"),
      );
      expect(detail.ancestors.map((n) => n.canonicalCode)).toEqual([
        "financial_services",
        "fintech",
        "payments",
      ]);
      expect(detail.aliases.map((a) => a.normalizedAlias)).toContain(
        "payments rails",
      );
      expect(detail.edges.length).toBeGreaterThan(0);
      const descendants = await query.listDescendants(
        node("industry", "financial_services"),
      );
      expect(descendants.map((n) => n.canonicalCode)).toContain(
        "payment_infrastructure",
      );

      // Ambiguous alias: two vocabularies answer; the caller disambiguates.
      const rails = await query.findNodesByAlias("Payments  Rails");
      expect(rails.map((n) => n.vocabularyCode).sort()).toEqual([
        "industry",
        "product_category",
      ]);

      const page = await query.listNodes({
        vocabularyCode: "geography",
        limit: 5,
      });
      expect(page.items).toHaveLength(5);
      expect(page.nextCursor).toBeDefined();
      const next = await query.listNodes({
        vocabularyCode: "geography",
        limit: 5,
        cursor: page.nextCursor,
      });
      expect(next.items[0]?.id).not.toBe(page.items[0]?.id);

      const versions = await query.getVersionSet();
      expect(versions).toEqual({
        business_model: 1,
        company_stage: 1,
        customer_type: 1,
        geography: 1,
        impact_theme: 1,
        industry: 1,
        product_category: 1,
        regulatory_profile: 1,
        technology: 1,
      });
      expect(await query.getVersionSet()).toEqual(versions);
    });
  });

  it("a deprecated node stays loadable and interpretable but is not offered as a default selection (§175-176)", async () => {
    await withWorld(async ({ tx, taxonomy, founderA, companyA }) => {
      const legacy = node("industry", "wealthtech");
      const first = await taxonomy.replaceCompanyAssignments({
        actor: founderA,
        companyId: companyA,
        vocabularyCode: "industry",
        nodes: [{ nodeId: legacy }],
        correlationId: CORRELATION(),
      });
      expect(first.added).toBe(1);
      await tx.sql`update taxonomy.nodes set status = 'DEPRECATED', valid_to = now() where id = ${legacy}`;
      await tx.sql`insert into taxonomy.node_edges (from_node_id, to_node_id, edge_type)
        values (${node("industry", "digital_banking")}, ${legacy}, 'successor_of')`;
      const loaded = await taxonomy.query.getNodeById(legacy);
      expect(loaded.status).toBe("DEPRECATED");
      const active = await taxonomy.query.listNodes({
        vocabularyCode: "industry",
        parentNodeId: node("industry", "fintech"),
        limit: 50,
      });
      expect(active.items.map((n) => n.id)).not.toContain(legacy);
      const withDeprecated = await taxonomy.query.listNodes({
        vocabularyCode: "industry",
        parentNodeId: node("industry", "fintech"),
        status: "DEPRECATED",
        limit: 50,
      });
      expect(withDeprecated.items.map((n) => n.id)).toContain(legacy);
      // Historical assignment is untouched: no automatic rewrite to the successor.
      const current = await taxonomy.listCompanyAssignments({
        actor: founderA,
        companyId: companyA,
      });
      expect(current.map((a) => a.nodeId)).toEqual([legacy]);
      await expect(
        taxonomy.replaceCompanyAssignments({
          actor: founderA,
          companyId: companyA,
          vocabularyCode: "industry",
          nodes: [{ nodeId: legacy }, { nodeId: node("industry", "fintech") }],
          correlationId: CORRELATION(),
        }),
      ).rejects.toMatchObject({ reason: "DEPRECATED" });
    });
  });

  // -------------------------------------------------------------------------
  // Company assignments
  // -------------------------------------------------------------------------

  it("multi-label classification across vocabularies preserves raw language and the marker never leaves the table (§161-166)", async () => {
    await withWorld(async ({ tx, taxonomy, founderA, companyA, tenantA }) => {
      const correlationId = CORRELATION();
      await taxonomy.replaceCompanyAssignments({
        actor: founderA,
        companyId: companyA,
        vocabularyCode: "industry",
        nodes: [{ nodeId: node("industry", "financial_services") }],
        correlationId,
      });
      await taxonomy.replaceCompanyAssignments({
        actor: founderA,
        companyId: companyA,
        vocabularyCode: "product_category",
        nodes: [
          {
            nodeId: node("product_category", "payment_infrastructure"),
            rawSourceText: RAW_STATEMENT,
          },
          { nodeId: node("product_category", "developer_api") },
        ],
        correlationId,
      });
      const tech = await taxonomy.replaceCompanyAssignments({
        actor: founderA,
        companyId: companyA,
        vocabularyCode: "technology",
        nodes: [{ nodeId: node("technology", "api_platform") }],
        correlationId,
      });
      expect(tech.added).toBe(1);

      const all = await taxonomy.listCompanyAssignments({
        actor: founderA,
        companyId: companyA,
      });
      expect(all.map((a) => `${a.vocabularyCode}/${a.canonicalCode}`)).toEqual([
        "industry/financial_services",
        "product_category/developer_api",
        "product_category/payment_infrastructure",
        "technology/api_platform",
      ]);
      const rails = all.find(
        (a) => a.canonicalCode === "payment_infrastructure",
      );
      expect(rails?.rawSourceText).toBe(RAW_STATEMENT);
      expect(rails?.assignmentSource).toBe("user_selected");
      expect(rails?.confirmedByUserId).toBe(founderA.userId);
      expect(rails?.confidence).toBeNull();
      expect(rails?.status).toBe("ACTIVE");

      // Replace technology: api_platform stays (same row), AI added, no duplicate.
      const before = all.find((a) => a.canonicalCode === "api_platform")?.id;
      const replaced = await taxonomy.replaceCompanyAssignments({
        actor: founderA,
        companyId: companyA,
        vocabularyCode: "technology",
        nodes: [
          { nodeId: node("technology", "api_platform") },
          { nodeId: node("technology", "artificial_intelligence") },
        ],
        correlationId,
      });
      expect(replaced).toMatchObject({ added: 1, removed: 0 });
      expect(replaced.current.map((a) => a.canonicalCode)).toEqual([
        "api_platform",
        "artificial_intelligence",
      ]);
      expect(
        replaced.current.find((a) => a.canonicalCode === "api_platform")?.id,
      ).toBe(before);

      // Remove developer_api: superseded with history retained.
      const removed = await taxonomy.replaceCompanyAssignments({
        actor: founderA,
        companyId: companyA,
        vocabularyCode: "product_category",
        nodes: [{ nodeId: node("product_category", "payment_infrastructure") }],
        correlationId,
      });
      expect(removed).toMatchObject({ added: 0, removed: 1 });
      const history = await taxonomy.listCompanyAssignments({
        actor: founderA,
        companyId: companyA,
        vocabularyCode: "product_category",
        includeHistory: true,
      });
      expect(history.map((a) => [a.canonicalCode, a.status])).toEqual([
        ["payment_infrastructure", "ACTIVE"],
        ["developer_api", "SUPERSEDED"],
      ]);
      expect(history[1]?.validTo).not.toBeNull();
      // Unchanged set is not a change: no new audit/event.
      const noop = await taxonomy.replaceCompanyAssignments({
        actor: founderA,
        companyId: companyA,
        vocabularyCode: "product_category",
        nodes: [{ nodeId: node("product_category", "payment_infrastructure") }],
        correlationId,
      });
      expect(noop).toMatchObject({ added: 0, removed: 0 });

      const audits = await tx.sql<{ metadata: Record<string, unknown> }[]>`
        select metadata from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid and action_type = 'taxonomy.company_assignments.updated' order by occurred_at`;
      expect(audits).toHaveLength(5);
      expect(audits[1]?.metadata).toEqual({
        vocabularyCode: "product_category",
        addedCount: 2,
        removedCount: 0,
      });
      const events = await tx.sql<{ payload: { data: unknown } }[]>`
        select payload from events.outbox where payload ->> 'correlationId' = ${correlationId} and event_type = 'taxonomy.entity_assignments.changed'`;
      expect(events).toHaveLength(5);
      expect(events[1]?.payload.data).toEqual({
        subjectType: "COMPANY",
        subjectId: companyA,
        changedVocabularyCodes: ["product_category"],
      });
      expect(
        await count(
          tx.sql`select count(*)::int as count from events.outbox where payload::text like ${`%${RAW_TEXT_MARKER}%`}`,
        ),
      ).toBe(0);
      expect(
        await count(
          tx.sql`select count(*)::int as count from audit.material_actions where metadata::text like ${`%${RAW_TEXT_MARKER}%`}`,
        ),
      ).toBe(0);
      expect(
        await count(
          tx.sql`select count(*)::int as count from taxonomy.entity_assignments where tenant_id = ${tenantA} and raw_source_text like ${`%${RAW_TEXT_MARKER}%`}`,
        ),
      ).toBe(1);
    });
  });

  it("refuses cross-tenant subjects, founders without company.edit, wrong-vocabulary or duplicate nodes (§167-169, §171)", async () => {
    await withWorld(
      async ({ taxonomy, founderA, memberA, companyA, companyB }) => {
        const command = {
          actor: founderA,
          vocabularyCode: "industry" as const,
          nodes: [{ nodeId: node("industry", "fintech") }],
          correlationId: CORRELATION(),
        };
        await expect(
          taxonomy.replaceCompanyAssignments({
            ...command,
            companyId: companyB,
          }),
        ).rejects.toBeInstanceOf(TaxonomySubjectNotFoundError);
        await expect(
          taxonomy.replaceCompanyAssignments({
            ...command,
            companyId: randomUUID(),
          }),
        ).rejects.toBeInstanceOf(TaxonomySubjectNotFoundError);
        await expect(
          taxonomy.replaceCompanyAssignments({
            ...command,
            actor: memberA,
            companyId: companyA,
          }),
        ).rejects.toBeInstanceOf(AuthorizationDeniedError);
        await expect(
          taxonomy.replaceCompanyAssignments({
            ...command,
            companyId: companyA,
            nodes: [{ nodeId: node("geography", "nigeria") }],
          }),
        ).rejects.toMatchObject({ reason: "WRONG_VOCABULARY" });
        await expect(
          taxonomy.replaceCompanyAssignments({
            ...command,
            companyId: companyA,
            nodes: [
              { nodeId: node("industry", "fintech") },
              { nodeId: node("industry", "fintech") },
            ],
          }),
        ).rejects.toBeInstanceOf(TaxonomyNodeNotSelectableError);
        await expect(
          taxonomy.replaceCompanyAssignments({
            ...command,
            companyId: companyA,
            nodes: [{ nodeId: TaxonomyNodeIdSchema.parse(randomUUID()) }],
          }),
        ).rejects.toMatchObject({ reason: "UNKNOWN_NODE" });
        // The command has no assignmentSource, tenant or organisation input at all.
        await expect(
          taxonomy.replaceCompanyAssignments({
            ...command,
            companyId: companyA,
            assignmentSource: "admin_curated",
          } as never),
        ).rejects.toThrow();
        expect(
          await taxonomy.listCompanyAssignments({
            actor: founderA,
            companyId: companyA,
          }),
        ).toEqual([]);
        await expect(
          taxonomy.listCompanyAssignments({
            actor: founderA,
            companyId: companyB,
          }),
        ).rejects.toBeInstanceOf(TaxonomySubjectNotFoundError);
      },
    );
  });
});
