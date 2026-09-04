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
import {
  createPostgresMandateTaxonomyPreferencePort,
  referenceNode,
} from "@capital-q/taxonomy";

import { INVESTOR_EVENTS } from "../src/events/index.js";
import {
  createInvestorService,
  InvestorMandateNotFoundError,
  InvestorOrganisationIdSchema,
  InvestorOrganisationNotFoundError,
  InvestorVersionConflictError,
  type InvestorService,
} from "../src/index.js";

/**
 * Declared mandate taxonomy preferences (CQ-TAX-001) through the Investor
 * mandate command against the real local database: same canonical node ids
 * the Company side uses, the existing preference scale with AVOID ≠
 * HARD_EXCLUSION, version increment and `changeKinds: TAXONOMY` on the
 * existing mandate event, no values in audit or events, and the usual
 * authority and tenant rules. Every test runs in a rolled-back transaction.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const registry = createEventRegistry([...INVESTOR_EVENTS]);
const node = (vocabulary: string, code: string) =>
  referenceNode(vocabulary, code).id;

class Rollback extends Error {}

type World = {
  readonly tx: TransactionContext;
  readonly investors: InvestorService;
  readonly investorAdmin: ActorContext;
  readonly investorPartner: ActorContext;
  readonly founder: ActorContext;
  readonly investorOrg: ReturnType<typeof InvestorOrganisationIdSchema.parse>;
  readonly companyId: string;
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

describe("investor mandate taxonomy preferences against local PostgreSQL", () => {
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
    const tenantC = await insertTenant(tx, "Mandate Taxonomy Company Tenant");
    const tenantI = await insertTenant(tx, "Mandate Taxonomy Investor Tenant");
    const orgC = await insertOrganisation(tx, tenantC, "company", "Alpha");
    const orgI = await insertOrganisation(
      tx,
      tenantI,
      "investment_firm",
      "Apex",
    );
    const founderMember = await insertMember(
      tx,
      tenantC,
      orgC,
      "organisation_admin",
    );
    const adminMember = await insertMember(
      tx,
      tenantI,
      orgI,
      "organisation_admin",
    );
    const partnerMember = await insertMember(
      tx,
      tenantI,
      orgI,
      "organisation_member",
    );
    const companyId = randomUUID();
    await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
      values (${companyId}, ${tenantC}, ${orgC}, 'Alpha Rails', ${`alpha-${companyId.slice(0, 8)}`})`;
    // Company-side classification with the same node the mandate will prefer.
    await tx.sql`insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source)
      values (${tenantC}, 'COMPANY', ${companyId}, ${node("product_category", "payment_infrastructure")}, 'user_selected')`;
    const investorId = randomUUID();
    await tx.sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
      values (${investorId}, ${tenantI}, ${orgI}, 'VC', 'Apex Ventures')`;
    await tx.sql`insert into core.investor_representatives (tenant_id, investor_organisation_id, organisation_id, user_id, membership_id, business_title)
      values (${tenantI}, ${investorId}, ${orgI}, ${partnerMember.userId}, ${partnerMember.membershipId}, 'Partner')`;

    const investors = createInvestorService({
      sql: tx.sql,
      transactions: nestedTransactions(tx),
      authorization: createAuthorizationService(
        createPostgresAuthorizationPolicySource({ sql: tx.sql }),
      ),
      organisations: createPostgresOrganisationQueryPort({ sql: tx.sql }),
      outbox: createOutboxWriter({ registry }),
      audit: createPostgresMaterialActionAuditWriter(),
      taxonomy: createPostgresMandateTaxonomyPreferencePort(),
    });
    return {
      tx,
      investors,
      investorAdmin: await resolveActor(tx, adminMember.principal),
      investorPartner: await resolveActor(tx, partnerMember.principal),
      founder: await resolveActor(tx, founderMember.principal),
      investorOrg: InvestorOrganisationIdSchema.parse(investorId),
      companyId,
    };
  }

  async function withWorld(work: (world: World) => Promise<void>) {
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

  it("uses the same node ids as company classification and keeps AVOID ≠ HARD_EXCLUSION (§162, §178-179)", async () => {
    await withWorld(
      async ({ tx, investors, investorAdmin, investorOrg, companyId }) => {
        const shared = node("product_category", "payment_infrastructure");
        const created = await investors.createInvestorMandate({
          actor: investorAdmin,
          investorOrganisationId: investorOrg,
          idempotencyKey: randomUUID(),
          correlationId: CORRELATION(),
          input: {
            name: "Payments thesis",
            taxonomyPreferences: [
              {
                nodeId: shared,
                preferenceStrength: "MUST",
                isExclusion: false,
              },
              {
                nodeId: node("industry", "media_entertainment"),
                preferenceStrength: "AVOID",
                isExclusion: false,
              },
            ],
          },
        });
        expect(created.version).toBe(1);
        expect(
          created.taxonomyPreferences.map((p) => [
            p.canonicalCode,
            p.preferenceStrength,
            p.isExclusion,
          ]),
        ).toEqual([
          ["media_entertainment", "AVOID", false],
          ["payment_infrastructure", "MUST", false],
        ]);
        const [companyRow] = await tx.sql<{ node_id: string }[]>`
        select node_id from taxonomy.entity_assignments where entity_id = ${companyId}`;
        const [mandateRow] = await tx.sql<{ node_id: string }[]>`
        select node_id from taxonomy.mandate_preferences where mandate_id = ${created.id} and preference_strength = 'MUST'`;
        expect(mandateRow?.node_id).toBe(companyRow?.node_id);
        const sources = await tx.sql<{ source: string }[]>`
        select distinct source from taxonomy.mandate_preferences where mandate_id = ${created.id}`;
        expect(sources).toEqual([{ source: "user_selected" }]);
      },
    );
  });

  it("changes go through the versioned mandate command: version bump, TAXONOMY change kind, no values in audit or event (§182-183)", async () => {
    await withWorld(async ({ tx, investors, investorAdmin, investorOrg }) => {
      const shared = node("product_category", "payment_infrastructure");
      const created = await investors.createInvestorMandate({
        actor: investorAdmin,
        investorOrganisationId: investorOrg,
        idempotencyKey: randomUUID(),
        correlationId: CORRELATION(),
        input: {
          name: "Payments thesis",
          taxonomyPreferences: [
            { nodeId: shared, preferenceStrength: "MUST", isExclusion: false },
          ],
        },
      });
      const correlationId = CORRELATION();
      const updated = await investors.updateInvestorMandate({
        actor: investorAdmin,
        investorOrganisationId: investorOrg,
        mandateId: created.id,
        correlationId,
        input: {
          expectedVersion: 1,
          taxonomyPreferences: [
            { nodeId: shared, preferenceStrength: "MUST", isExclusion: false },
            {
              nodeId: node("industry", "media_entertainment"),
              preferenceStrength: "HARD_EXCLUSION",
              isExclusion: true,
            },
          ],
        },
      });
      expect(updated.version).toBe(2);
      expect(
        updated.taxonomyPreferences.find(
          (p) => p.canonicalCode === "media_entertainment",
        )?.isExclusion,
      ).toBe(true);
      const [event] = await tx.sql<
        {
          payload: { data: { changeKinds: string[]; changedFields: string[] } };
        }[]
      >`
        select payload from events.outbox where payload ->> 'correlationId' = ${correlationId} and event_type = 'core.investor_mandate.updated'`;
      expect(event?.payload.data.changeKinds).toEqual(["TAXONOMY"]);
      expect(event?.payload.data.changedFields).toEqual([
        "taxonomyPreferences",
      ]);
      expect(JSON.stringify(event?.payload)).not.toContain(
        "payment_infrastructure",
      );
      expect(JSON.stringify(event?.payload)).not.toContain(shared);
      expect(
        await count(
          tx.sql`select count(*)::int as count from events.outbox where event_type like 'taxonomy.mandate%'`,
        ),
      ).toBe(0);
      const audits = await tx.sql<{ metadata: Record<string, unknown> }[]>`
        select metadata from audit.material_actions where correlation_id = ${correlationId.slice(4)}::uuid`;
      expect(audits).toHaveLength(1);
      expect(JSON.stringify(audits[0]?.metadata)).not.toContain(
        "payment_infrastructure",
      );

      // Same set again: not a change, no version bump.
      const same = await investors.updateInvestorMandate({
        actor: investorAdmin,
        investorOrganisationId: investorOrg,
        mandateId: created.id,
        correlationId: CORRELATION(),
        input: {
          expectedVersion: 2,
          taxonomyPreferences: updated.taxonomyPreferences.map((p) => ({
            nodeId: p.nodeId,
            preferenceStrength: p.preferenceStrength,
            isExclusion: p.isExclusion,
          })),
        },
      });
      expect(same.version).toBe(2);
      // Clearing is a change.
      const cleared = await investors.updateInvestorMandate({
        actor: investorAdmin,
        investorOrganisationId: investorOrg,
        mandateId: created.id,
        correlationId: CORRELATION(),
        input: { expectedVersion: 2, taxonomyPreferences: [] },
      });
      expect(cleared.version).toBe(3);
      expect(cleared.taxonomyPreferences).toEqual([]);
    });
  });

  it("refuses stale versions, unknown nodes, a Partner without investor.mandate.edit and founder-side access (§147, §180-181)", async () => {
    await withWorld(
      async ({
        investors,
        investorAdmin,
        investorPartner,
        founder,
        investorOrg,
      }) => {
        const created = await investors.createInvestorMandate({
          actor: investorAdmin,
          investorOrganisationId: investorOrg,
          idempotencyKey: randomUUID(),
          correlationId: CORRELATION(),
          input: { name: "Thesis" },
        });
        const base = {
          investorOrganisationId: investorOrg,
          mandateId: created.id,
        };
        await expect(
          investors.updateInvestorMandate({
            ...base,
            actor: investorAdmin,
            correlationId: CORRELATION(),
            input: { expectedVersion: 5, taxonomyPreferences: [] },
          }),
        ).rejects.toBeInstanceOf(InvestorVersionConflictError);
        await expect(
          investors.updateInvestorMandate({
            ...base,
            actor: investorAdmin,
            correlationId: CORRELATION(),
            input: {
              expectedVersion: 1,
              taxonomyPreferences: [
                {
                  nodeId: randomUUID(),
                  preferenceStrength: "NICE",
                  isExclusion: false,
                },
              ],
            },
          }),
        ).rejects.toMatchObject({ reason: "UNKNOWN_NODE" });
        await expect(
          investors.updateInvestorMandate({
            ...base,
            actor: investorPartner,
            correlationId: CORRELATION(),
            input: {
              expectedVersion: 1,
              taxonomyPreferences: [
                {
                  nodeId: node("industry", "fintech"),
                  preferenceStrength: "NICE",
                  isExclusion: false,
                },
              ],
            },
          }),
        ).rejects.toBeInstanceOf(AuthorizationDeniedError);
        await expect(
          investors.getInvestorMandate({ ...base, actor: founder }),
        ).rejects.toBeInstanceOf(InvestorOrganisationNotFoundError);
        await expect(
          investors.updateInvestorMandate({
            ...base,
            actor: founder,
            correlationId: CORRELATION(),
            input: { expectedVersion: 1, taxonomyPreferences: [] },
          }),
        ).rejects.toSatisfy(
          (error: unknown) =>
            error instanceof InvestorOrganisationNotFoundError ||
            error instanceof InvestorMandateNotFoundError,
        );
        const reread = await investors.getInvestorMandate({
          ...base,
          actor: investorAdmin,
        });
        expect(reread.version).toBe(1);
        expect(reread.taxonomyPreferences).toEqual([]);
      },
    );
  });
});
