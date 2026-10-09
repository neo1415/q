import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import { ActorContextSchema } from "@capital-q/security";

import { createPostgresCompanyCatalog } from "../src/composition/company-catalog.js";

/**
 * K1 against the local database: companies by declared sector (a sector's
 * sub-sectors included, confirmed assignments only), country, in name
 * order; never a private company, never an unconfirmed Q inference, never
 * the viewer's own organisation's. Isolated by a country no seed uses.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const COUNTRY = "TV";

describe("company catalog against PostgreSQL (K1)", () => {
  let db: RequestDatabase;
  const tenant = randomUUID();
  const org = randomUUID();
  const viewerTenant = randomUUID();
  const viewerOrg = randomUUID();
  const company = (name: string) => ({ id: randomUUID(), name });
  const rows = {
    fintech: company("Atoll Pay"),
    payments: company("Banyan Payments"),
    inferred: company("Coral Inferred"),
    private: company("Deep Private"),
    health: company("Eel Health"),
    own: company("Frigate Own"),
  };

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
    await db.transactions.run(async (tx) => {
      const sql = tx.sql;
      for (const [t, o] of [
        [tenant, org],
        [viewerTenant, viewerOrg],
      ] as const) {
        await sql`insert into identity.tenants (id, name) values (${t}, 'Catalog')`;
        await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
          values (${o}, ${t}, 'company', 'Catalog', ${`catalog-${o.slice(0, 8)}`})`;
        await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${t}, ${o})`;
      }
      const node = async (code: string) => {
        const [found] = await sql<{ id: string }[]>`
          select n.id from taxonomy.nodes n
            join taxonomy.vocabularies v on v.id = n.vocabulary_id
           where v.code = 'industry' and n.canonical_code = ${code}`;
        if (found === undefined) throw new Error(`no taxonomy node ${code}`);
        return found.id;
      };
      const place = async (
        row: { id: string; name: string },
        options: {
          visibility: string;
          sector: string;
          source: string;
          tenantId?: string;
          orgId?: string;
        },
      ) => {
        const t = options.tenantId ?? tenant;
        await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug,
                    marketplace_visibility, company_status, headquarters_country)
          values (${row.id}, ${t}, ${options.orgId ?? org}, ${row.name},
                  ${`catalog-${row.id.slice(0, 8)}`}, ${options.visibility}, 'active', ${COUNTRY})`;
        await sql`insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source)
          values (${t}, 'COMPANY', ${row.id}, ${await node(options.sector)}, ${options.source})`;
      };
      const open = { visibility: "network_visible", source: "user_selected" };
      await place(rows.fintech, { ...open, sector: "fintech" });
      await place(rows.payments, { ...open, sector: "payments" });
      await place(rows.inferred, {
        ...open,
        sector: "fintech",
        source: "q_inferred",
      });
      await place(rows.private, {
        ...open,
        sector: "fintech",
        visibility: "organisation_private",
      });
      await place(rows.health, { ...open, sector: "digital_health" });
      await place(rows.own, {
        ...open,
        sector: "fintech",
        tenantId: viewerTenant,
        orgId: viewerOrg,
      });
    });
  });

  afterAll(async () => {
    await db.close();
  });

  const viewer = () =>
    ActorContextSchema.parse({
      userId: randomUUID(),
      tenantId: viewerTenant,
      organisationId: viewerOrg,
      actorType: "HUMAN",
    });

  it("lists a sector with its sub-sectors, confirmed and network-visible only, in name order", async () => {
    const catalog = createPostgresCompanyCatalog({ sql: db.sql });
    const found = await catalog.find(viewer(), {
      sectors: ["fintech"],
      countries: [COUNTRY],
      stages: [],
      limit: 10,
    });
    expect(found.candidates.map((c) => c.name)).toEqual([
      "Atoll Pay",
      "Banyan Payments",
    ]);
    expect(found.sectors).toEqual([{ code: "fintech", name: "Fintech" }]);
    expect(found.unknownSectors).toEqual([]);
  });

  it("finds a sector by its alias, and says which sectors it does not know", async () => {
    const catalog = createPostgresCompanyCatalog({ sql: db.sql });
    const health = await catalog.find(viewer(), {
      sectors: ["healthtech"],
      countries: [COUNTRY],
      stages: [],
      limit: 10,
    });
    expect(health.candidates.map((c) => c.name)).toEqual(["Eel Health"]);
    const unknown = await catalog.find(viewer(), {
      sectors: ["space_mining"],
      countries: [COUNTRY],
      stages: [],
      limit: 10,
    });
    expect(unknown.candidates).toEqual([]);
    expect(unknown.unknownSectors).toEqual(["space_mining"]);
  });
});
