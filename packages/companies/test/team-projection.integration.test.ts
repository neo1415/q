import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import { createPostgresCompanyTeamProjection } from "../src/index.js";

/**
 * ADR 0041 against PostgreSQL: the investor-facing team read selects only
 * the projection's inputs. A founder profile's background summary, the
 * person's email and anything about another tenant's company never appear,
 * and a member who has left is not listed.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const SECRET = "founder-private-4b7d";

class Rollback extends Error {}

describe("the investor-facing team read", () => {
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

  it("lists current members with declared fields only, and nothing across tenants", async () => {
    let checked = false;
    await db.transactions
      .run(async ({ sql }) => {
        const tenant = randomUUID();
        const otherTenant = randomUUID();
        const org = randomUUID();
        const otherOrg = randomUUID();
        const company = randomUUID();
        const otherCompany = randomUUID();
        await sql`insert into identity.tenants (id, name) values (${tenant}, 'Team A'), (${otherTenant}, 'Team B')`;
        for (const [id, t] of [
          [org, tenant],
          [otherOrg, otherTenant],
        ] as const) {
          await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
            values (${id}, ${t}, 'company', 'Team org', ${`team-${id.slice(0, 8)}`})`;
          await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${t}, ${id})`;
        }
        await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
          (${company}, ${tenant}, ${org}, 'Team Co', ${`team-co-${company.slice(0, 8)}`}),
          (${otherCompany}, ${otherTenant}, ${otherOrg}, 'Other Co', ${`other-co-${otherCompany.slice(0, 8)}`})`;

        const person = async (name: string) => {
          const auth = randomUUID();
          await sql`insert into auth.users (id, email) values (${auth}, ${`${SECRET}-${auth.slice(0, 6)}@example.invalid`})`;
          const [row] = await sql<{ id: string }[]>`
            select id from identity.user_profiles where auth_user_id = ${auth}`;
          const id = row?.id ?? "";
          await sql`update identity.user_profiles set display_name = ${name} where id = ${id}`;
          return id;
        };
        const ada = await person("Ada Obi");
        const left = await person("Gone Person");
        const stranger = await person("Other Tenant");

        await sql`insert into core.company_members (tenant_id, company_id, user_id, relationship_type, business_title, is_founder)
          values (${tenant}, ${company}, ${ada}, 'team_member', 'CEO', true)`;
        await sql`insert into core.company_members (tenant_id, company_id, user_id, relationship_type, is_founder, is_current, ended_at)
          values (${tenant}, ${company}, ${left}, 'advisor', false, false, now())`;
        await sql`insert into core.company_members (tenant_id, company_id, user_id, relationship_type, is_founder)
          values (${otherTenant}, ${otherCompany}, ${stranger}, 'team_member', true)`;
        await sql`insert into core.founder_profiles (tenant_id, user_id, primary_company_id, professional_summary, background_summary)
          values (${tenant}, ${ada}, ${company}, 'Built grid storage at two utilities.', ${SECRET})`;

        const team = await createPostgresCompanyTeamProjection({
          sql,
        }).teamForNetwork({ tenantId: tenant, companyId: company });
        expect(team).toEqual([
          {
            name: "Ada Obi",
            relationshipType: "team_member",
            businessTitle: "CEO",
            isFounder: true,
            shortBio: "Built grid storage at two utilities.",
          },
        ]);
        expect(JSON.stringify(team)).not.toContain(SECRET);
        expect(JSON.stringify(team)).not.toContain("@");

        // The company id under another tenant is nobody's team.
        await expect(
          createPostgresCompanyTeamProjection({ sql }).teamForNetwork({
            tenantId: otherTenant,
            companyId: company,
          }),
        ).resolves.toEqual([]);
        checked = true;
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
    expect(checked).toBe(true);
  });
});
