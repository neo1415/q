import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  CompanyIdSchema,
  createPostgresCompanyQueryPort,
} from "@capital-q/companies";
import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import { InvestorOrganisationIdSchema } from "@capital-q/investors";
import { createPostgresRelationshipRepository } from "@capital-q/network";
import {
  createCompanyDisclosureResolver,
  createDisclosureResourceResolverRegistry,
} from "@capital-q/permissions";
import { TenantIdSchema } from "@capital-q/security";
import { createPostgresTaxonomyAssignmentRepository } from "@capital-q/taxonomy";

/**
 * S2: the set reads that replaced one-query-per-company loops return, row
 * for row, what the single reads return. Read-only over whatever the local
 * database holds (an empty database makes this trivially true).
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("set reads equal the single reads", () => {
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

  async function someCompanies() {
    const rows = await db.sql<{ id: string; tenant_id: string }[]>`
      select id, tenant_id from core.companies order by id limit 12`;
    return rows.map((r) => ({
      id: CompanyIdSchema.parse(r.id),
      tenantId: TenantIdSchema.parse(r.tenant_id),
    }));
  }

  it("company visibility: the set equals one by one, and a missing id is absent", async () => {
    const companies = createPostgresCompanyQueryPort({ sql: db.sql });
    const list = await someCompanies();
    const ids = list.map((c) => c.id);
    const many = await companies.findCanonicalCompanyVisibilities([
      ...ids,
      CompanyIdSchema.parse("00000000-0000-4000-8000-000000000001"),
    ]);
    const single = await Promise.all(
      ids.map((id) => companies.findCanonicalCompanyVisibility(id)),
    );
    const byId = new Map(many.map((m) => [m.id, m] as const));
    expect(many.length).toBe(ids.length);
    ids.forEach((id, index) => {
      expect(byId.get(id)).toEqual(single[index]);
    });
    expect(await companies.findCanonicalCompanyVisibilities([])).toEqual([]);
  });

  it("disclosure registry: resolveMany equals resolve per resource", async () => {
    const companies = createPostgresCompanyQueryPort({ sql: db.sql });
    const registry = createDisclosureResourceResolverRegistry([
      createCompanyDisclosureResolver(companies),
    ]);
    const list = await someCompanies();
    const resources = [
      ...list.map((c) => ({ type: "company" as const, id: c.id })),
      { type: "company" as const, id: "not-a-uuid" },
      { type: "company" as const, id: "00000000-0000-4000-8000-000000000001" },
    ];
    const many = await registry.resolveMany(resources);
    for (const resource of resources) {
      const one = await registry.resolve(resource);
      expect(many.get(`${resource.type}:${resource.id}`) ?? null).toEqual(one);
    }
  });

  it("taxonomy: listCurrentForSubjects equals listCurrent per subject, tenant paired", async () => {
    const repository = createPostgresTaxonomyAssignmentRepository();
    const list = await someCompanies();
    const many = await repository.listCurrentForSubjects(
      db.sql,
      "COMPANY",
      list.map((c) => ({ tenantId: c.tenantId, subjectId: c.id })),
    );
    for (const company of list) {
      const one = await repository.listCurrent(db.sql, company.tenantId, {
        subjectType: "COMPANY",
        subjectId: company.id,
      });
      expect(many.filter((a) => a.subjectId === company.id)).toEqual(one);
    }
    // The tenant must match its own id: crossed with another tenant, nothing.
    const [first] = list;
    const other = list.find((c) => c.tenantId !== first?.tenantId);
    if (first !== undefined && other !== undefined) {
      const crossed = await repository.listCurrentForSubjects(
        db.sql,
        "COMPANY",
        [{ tenantId: other.tenantId, subjectId: first.id }],
      );
      expect(crossed).toEqual([]);
    }
  });

  it("network: findByInvestorAndCompanies equals findByParties", async () => {
    const repository = createPostgresRelationshipRepository();
    const investors = await db.sql<{ investor_organisation_id: string }[]>`
      select distinct investor_organisation_id from network.relationships limit 3`;
    const list = await someCompanies();
    const companyIds = list.map((c) => c.id);
    for (const row of investors) {
      const investor = InvestorOrganisationIdSchema.parse(
        row.investor_organisation_id,
      );
      const many = await repository.findByInvestorAndCompanies(
        db.sql,
        investor,
        companyIds,
      );
      for (const companyId of companyIds) {
        const one = await repository.findByParties(db.sql, companyId, investor);
        expect(many.find((r) => r.companyId === companyId) ?? null).toEqual(
          one,
        );
      }
    }
  });
});
