import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  createRoundTripCounter,
  withRoundTripCounter,
  type RequestDatabase,
} from "@capital-q/database";

import {
  CompanyIdSchema,
  createPostgresCompanyQueryPort,
} from "../src/index.js";

/**
 * Coordinator 2026-10-26 (live trace: the fit read each shown company's
 * profile line one query at a time). findCanonicalCompanyProfiles returns,
 * in one round trip, exactly what findCanonicalCompanyProfile returns for
 * each id, and nothing for an id that is no company.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

describe("company profiles for many against local PostgreSQL", () => {
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

  it("reads many profiles in one round trip, each as the one-company read", async () => {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const { sql } = tx;
        const ids: string[] = [];
        for (const label of ["P One", "P Two"]) {
          const tenantId = randomUUID();
          const organisationId = randomUUID();
          await sql`insert into identity.tenants (id, name) values (${tenantId}, ${label})`;
          await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
            values (${organisationId}, ${tenantId}, 'company', ${label}, ${`pp-${organisationId.slice(0, 8)}`})`;
          await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${organisationId})`;
          const id = randomUUID();
          await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, short_description)
            values (${id}, ${tenantId}, ${organisationId}, ${label}, ${`pp-${id.slice(0, 8)}`}, ${`${label} does one thing`})`;
          ids.push(id);
        }
        const port = createPostgresCompanyQueryPort({ sql });
        const asked = [...ids, randomUUID()].map((id) =>
          CompanyIdSchema.parse(id),
        );
        const counter = createRoundTripCounter();
        const many = await withRoundTripCounter(
          counter,
          async () => (await port.findCanonicalCompanyProfiles?.(asked)) ?? [],
        );
        expect(counter.count).toBe(1);
        expect(many).toHaveLength(2);
        for (const id of ids) {
          expect(many.find((p) => p.id === id)).toEqual(
            await port.findCanonicalCompanyProfile(CompanyIdSchema.parse(id)),
          );
        }
        completed = true;
        throw new Rollback();
      });
    } catch (error: unknown) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  });
});
