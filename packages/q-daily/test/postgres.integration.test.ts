import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import type { QDailyEdition } from "@capital-q/contracts";

import {
  createDailyReaderService,
  createPostgresDailyReaderStore,
  createPostgresDailyWorkerStore,
  readInterestProfile,
} from "../src/index.js";

/**
 * The Q Daily against PostgreSQL (migration 20261114000000): each person's
 * topics come from their own organisation's records only; due readers are
 * claimed once; editions are read back by their owner only. Editions are
 * history, so this suite leaves its rows: run it against a scratch or
 * local database (CQ_TEST_DATABASE_URL).
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("@capital-q/q-daily against PostgreSQL", () => {
  let db: RequestDatabase;
  const ids = {
    tenantCo: randomUUID(),
    tenantInv: randomUUID(),
    orgCo: randomUUID(),
    orgInv: randomUUID(),
    company: randomUUID(),
    investor: randomUUID(),
    mandate: randomUUID(),
  };
  const users: string[] = [];

  beforeAll(async () => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "4",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
    await db.transactions.run(async (tx) => {
      const sql = tx.sql;
      for (const [tenant, org, type, name] of [
        [ids.tenantCo, ids.orgCo, "company", "Ada Obi"],
        [ids.tenantInv, ids.orgInv, "investment_firm", "Kola Bee"],
      ] as const) {
        await sql`insert into identity.tenants (id, name) values (${tenant}, ${`Daily ${type}`})`;
        await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
          values (${org}, ${tenant}, ${type}, ${`Daily ${type}`}, ${`daily-${org.slice(0, 8)}`})`;
        await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
        const authId = randomUUID();
        await sql`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@fictional.capitalq.local`})`;
        const [profile] = await sql<{ id: string }[]>`
          select id from identity.user_profiles where auth_user_id = ${authId}`;
        if (profile === undefined)
          throw new Error("profile trigger did not run");
        await sql`update identity.user_profiles set display_name = ${name}, timezone = 'Africa/Lagos' where id = ${profile.id}`;
        await sql`insert into identity.organisation_memberships (tenant_id, organisation_id, user_id, membership_status)
          values (${tenant}, ${org}, ${profile.id}, 'active')`;
        users.push(profile.id);
      }
      await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug, headquarters_country, current_stage_code)
        values (${ids.company}, ${ids.tenantCo}, ${ids.orgCo}, 'Daily Pay', ${`daily-pay-${ids.company.slice(0, 8)}`}, 'NG', 'seed')`;
      await sql`insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source)
        select ${ids.tenantCo}, 'COMPANY', ${ids.company}, n.id, 'user_selected'
          from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
         where v.code = 'industry' and n.canonical_code = 'financial_services'`;
      await sql`insert into core.capital_objectives (tenant_id, company_id, target_amount, currency_code, target_stage, created_by_user_id)
        values (${ids.tenantCo}, ${ids.company}, 1500000, 'USD', 'seed', ${users[0] ?? ""})`;
      await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name, hq_country)
        values (${ids.investor}, ${ids.tenantInv}, ${ids.orgInv}, 'VC', 'Daily Capital', 'KE')`;
      await sql`insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, status, effective_from, min_stage_code, created_by_user_id)
        values (${ids.mandate}, ${ids.tenantInv}, ${ids.investor}, 'Main', 'ACTIVE', now(), 'seed', ${users[1] ?? ""})`;
      await sql`insert into core.investor_mandate_constraints (tenant_id, mandate_id, dimension, operator, value_jsonb, importance)
        values (${ids.tenantInv}, ${ids.mandate}, 'sector', 'IN', '{"kind":"codes","values":["financial_services","healthcare"]}', 'STRONG'),
               (${ids.tenantInv}, ${ids.mandate}, 'geography.country', 'IN', '{"kind":"codes","values":["NG"]}', 'MUST'),
               (${ids.tenantInv}, ${ids.mandate}, 'sector', 'IN', '{"kind":"codes","values":["energy"]}', 'AVOID')`;
      await sql`insert into network.relationships (tenant_id, company_id, investor_organisation_id, current_state)
        values (${ids.tenantCo}, ${ids.company}, ${ids.investor}, 'CONNECTED')`;
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it("reads each person's topics from their own records only", async () => {
    const founder = await readInterestProfile(
      db.sql,
      users[0] ?? "",
      ids.tenantCo,
    );
    expect(founder).toMatchObject({
      role: "FOUNDER",
      readerName: "Ada",
      sectors: ["Financial Services"],
      stages: ["Seed"],
      markets: ["Nigeria"],
      ownName: "Daily Pay",
      knownNames: ["Daily Capital"],
      raise: "Seed, 1500000 USD",
    });
    const investor = await readInterestProfile(
      db.sql,
      users[1] ?? "",
      ids.tenantInv,
    );
    expect(investor).toMatchObject({
      role: "INVESTOR",
      sectors: ["Financial Services", "Healthcare"],
      stages: ["Seed"],
      markets: ["Nigeria"],
      ownName: "Daily Capital",
      knownNames: ["Daily Pay"],
      raise: null,
    });
    // The wrong tenant reads nothing.
    expect(
      await readInterestProfile(db.sql, users[0] ?? "", ids.tenantInv),
    ).toBeNull();
  });

  it("gives defaults, claims a due reader once, stores and reads back editions by owner", async () => {
    const worker = createPostgresDailyWorkerStore(db.sql);
    const now = new Date();
    await worker.ensureDefaults(now, 500);
    const [row] = await db.sql<
      { frequency: string; next_due_at: Date | null }[]
    >`
      select frequency, next_due_at from q_runtime.daily_preferences where user_id = ${users[0] ?? ""}`;
    expect(row?.frequency).toBe("WEEKLY");
    expect(row?.next_due_at).not.toBeNull();

    const reader = createDailyReaderService({
      store: createPostgresDailyReaderStore(db.sql),
    });
    const founder = { userId: users[0] ?? "", tenantId: ids.tenantCo };
    expect((await reader.request(founder, now)).status).toBe("QUEUED");
    expect((await reader.home(founder, null, now)).preparing).toBe(true);

    const due = await worker.claimDue(new Date(now.getTime() + 1_000), 50);
    const mine = due.filter((item) => item.userId === founder.userId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      frequency: "WEEKLY",
      requested: true,
      timeZone: "Africa/Lagos",
    });
    // Claimed: a second claim does not return it again.
    const again = await worker.claimDue(new Date(now.getTime() + 2_000), 50);
    expect(again.some((item) => item.userId === founder.userId)).toBe(false);

    const key = "f".repeat(63) + "0";
    const issue = await worker.saveClusterIssue({
      clusterKey: key,
      issueDate: now.toISOString().slice(0, 10),
      topics: ["Financial Services"],
      stories: [],
      searchesUsed: 2,
      modelCallsUsed: 1,
    });
    const same = await worker.saveClusterIssue({
      clusterKey: key,
      issueDate: now.toISOString().slice(0, 10),
      topics: ["Financial Services"],
      stories: [],
      searchesUsed: 9,
      modelCallsUsed: 9,
    });
    expect(same.id).toBe(issue.id);

    const number = await worker.nextNumber(founder.userId);
    const editionId = randomUUID();
    const content: QDailyEdition = {
      id: editionId,
      number,
      editionDate: "2026-10-05",
      frequency: "WEEKLY",
      readerName: "Ada",
      topics: ["Financial Services"],
      lead: null,
      sections: [],
      briefs: [],
      chart: null,
      qTake: null,
      generatedAt: now.toISOString(),
    };
    expect(
      await worker.saveEdition({
        id: editionId,
        userId: founder.userId,
        tenantId: founder.tenantId,
        clusterIssueId: issue.id,
        content,
        searchesUsed: 2,
        modelCallsUsed: 1,
      }),
    ).toBe(editionId);
    await worker.markEmailed(editionId, { ok: true });
    await worker.reschedule(
      founder.userId,
      new Date(now.getTime() + 86_400_000),
    );

    const home = await reader.home(founder, null, now);
    expect(home.latest?.id).toBe(editionId);
    expect(home.archive.map((item) => item.id)).toContain(editionId);
    expect(home.preparing).toBe(false);
    expect((await reader.request(founder, now)).status).toBe("TOO_SOON");
    // Another person, and the right person in the wrong tenant, read nothing.
    expect(
      await reader.edition(
        { userId: users[1] ?? "", tenantId: ids.tenantInv },
        editionId,
      ),
    ).toBeNull();
    expect(
      await reader.edition(
        { userId: founder.userId, tenantId: ids.tenantInv },
        editionId,
      ),
    ).toBeNull();

    const saved = await reader.setPreferences(
      founder,
      { frequency: "DAILY", email: false },
      now,
    );
    expect(saved).toMatchObject({ frequency: "DAILY", email: false });
    expect(saved.sections).toHaveLength(5);
  });
});
