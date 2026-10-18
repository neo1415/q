import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  createPostgresCompanyKnowledge,
  type CompanyKnowledgePort,
} from "../src/index.js";

/**
 * Recovery K (Tier B) against the local database (migration
 * 20261220181000): DISCOVER_COMPANIES through the port, the investor's own
 * mandate summary, the version that moves on a change, and the viewer
 * checks -- someone with no live membership reads nothing; another
 * tenant's mandate is "none".
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("company knowledge port against PostgreSQL", () => {
  let db: RequestDatabase;
  let port: CompanyKnowledgePort;
  let founder: ActorContext;
  let investor: ActorContext;
  let outsider: ActorContext;
  const ids = {
    tenantCo: randomUUID(),
    tenantInv: randomUUID(),
    orgCo: randomUUID(),
    orgInv: randomUUID(),
    company: randomUUID(),
    hidden: randomUUID(),
    investorOrg: randomUUID(),
    mandate: randomUUID(),
  };
  const name = `Knowledge Fintech ${ids.company.slice(0, 6)}`;

  beforeAll(async () => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "2",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
    port = createPostgresCompanyKnowledge({ sql: db.sql });
    const users: string[] = [];
    await db.transactions.run(async (tx) => {
      const sql = tx.sql;
      for (const [tenant, org, type] of [
        [ids.tenantCo, ids.orgCo, "company"],
        [ids.tenantInv, ids.orgInv, "investment_firm"],
      ] as const) {
        await sql`insert into identity.tenants (id, name) values (${tenant}, ${`K ${type}`})`;
        await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
          values (${org}, ${tenant}, ${type}, ${`K ${type}`}, ${`k-${org.slice(0, 8)}`})`;
        await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
        const authId = randomUUID();
        await sql`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@k.example.invalid`})`;
        const [profile] = await sql<{ id: string }[]>`
          select id from identity.user_profiles where auth_user_id = ${authId}`;
        if (profile === undefined)
          throw new Error("profile trigger did not run");
        await sql`insert into identity.organisation_memberships (tenant_id, organisation_id, user_id, membership_status)
          values (${tenant}, ${org}, ${profile.id}, 'active')`;
        users.push(profile.id);
      }
      await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug,
                  headquarters_country, current_stage_code, short_description, marketplace_visibility)
        values (${ids.company}, ${ids.tenantCo}, ${ids.orgCo}, ${name}, ${`k-co-${ids.company.slice(0, 8)}`},
                'NG', 'seed', 'Invoices for SMEs.', 'network_visible'),
               (${ids.hidden}, ${ids.tenantCo}, ${ids.orgCo}, ${`${name} hidden`}, ${`k-hd-${ids.hidden.slice(0, 8)}`},
                'NG', 'seed', 'Not listed.', 'organisation_private')`;
      await sql`insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source)
        select ${ids.tenantCo}, 'COMPANY', c.id, n.id, 'user_selected'
          from (values (${ids.company}::uuid), (${ids.hidden}::uuid)) c(id),
               taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
         where v.code = 'industry' and n.canonical_code = 'fintech'`;
      await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
        values (${ids.investorOrg}, ${ids.tenantInv}, ${ids.orgInv}, 'VC', 'K Capital')`;
      await sql`insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, effective_from,
                  min_cheque, max_cheque, currency_code, created_by_user_id)
        values (${ids.mandate}, ${ids.tenantInv}, ${ids.investorOrg}, 'Seed fintech', 'ACTIVE', now(),
                250000, 1000000, 'USD', ${users[1] ?? ""})`;
    });
    const actor = (userId: string, tenantId: string, organisationId: string) =>
      ActorContextSchema.parse({
        userId,
        tenantId,
        organisationId,
        actorType: "HUMAN",
      });
    founder = actor(users[0] ?? "", ids.tenantCo, ids.orgCo);
    investor = actor(users[1] ?? "", ids.tenantInv, ids.orgInv);
    // A real-looking id with no membership anywhere: no access.
    outsider = actor(randomUUID(), ids.tenantInv, ids.orgInv);
  });

  afterAll(async () => {
    await db.close();
  });

  it("three fintech companies in Nigeria: listed ones only, from the projection", async () => {
    const found = await port.discoverCompanies(investor, {
      sectorCodes: ["fintech"],
      geographyCodes: ["nigeria"],
      limit: 50,
    });
    const names = found.map((one) => one.name);
    expect(names).toContain(name);
    expect(names).not.toContain(`${name} hidden`);
    const ours = found.find((one) => one.companyId === ids.company);
    expect(ours).toMatchObject({
      countryCode: "NG",
      stageCode: "seed",
      evidenceStatus: "SELF_REPORTED",
    });
    expect(ours?.geographyCodes).toEqual(
      expect.arrayContaining(["nigeria", "west_africa", "africa"]),
    );
    // A region finds its countries; a parent sector finds its children.
    const wide = await port.discoverCompanies(investor, {
      sectorCodes: ["financial_services"],
      geographyCodes: ["africa"],
      limit: 50,
    });
    expect(wide.some((one) => one.companyId === ids.company)).toBe(true);
  });

  it("someone with no live membership reads nothing", async () => {
    expect(
      await port.discoverCompanies(outsider, {
        sectorCodes: ["fintech"],
        limit: 10,
      }),
    ).toEqual([]);
    expect((await port.companies(outsider, [ids.company])).size).toBe(0);
  });

  it("the investor's own mandate summary; anyone else's is none", async () => {
    const own = await port.mandateSummary(investor);
    expect(own).toMatchObject({
      mandateId: ids.mandate,
      mandateVersion: 1,
      minCheque: "250000",
      currencyCode: "USD",
    });
    expect(await port.mandateSummary(founder, ids.mandate)).toBeNull();
    expect(await port.fitSummary(founder, ids.mandate)).toBeNull();
    expect(await port.fitSummary(investor, ids.mandate)).toMatchObject({
      mandateVersion: 1,
    });
  });

  it("a change moves the version (Tier A's staleness check); unlisting makes it null", async () => {
    const before = (
      await port.versions(investor, "COMPANY", [ids.company])
    ).get(ids.company);
    await db.sql`update core.companies set short_description = 'Invoices and payments.'
                  where id = ${ids.company}`;
    const after = (await port.versions(investor, "COMPANY", [ids.company])).get(
      ids.company,
    );
    expect(before).not.toBeNull();
    expect(after).not.toBe(before);
    await db.sql`update core.companies set marketplace_visibility = 'organisation_private'
                  where id = ${ids.company}`;
    expect(
      (await port.versions(investor, "COMPANY", [ids.company])).get(
        ids.company,
      ),
    ).toBeNull();
    const mandateBefore = (
      await port.versions(investor, "MANDATE", [ids.mandate])
    ).get(ids.mandate);
    await db.sql`update core.investor_mandates set version = 2 where id = ${ids.mandate}`;
    expect(
      (await port.versions(investor, "MANDATE", [ids.mandate])).get(
        ids.mandate,
      ),
    ).not.toBe(mandateBefore);
    expect(
      (await port.versions(founder, "MANDATE", [ids.mandate])).get(ids.mandate),
    ).toBeNull();
  });
});
