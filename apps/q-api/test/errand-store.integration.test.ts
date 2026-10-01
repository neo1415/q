import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import { createPostgresErrandStore } from "../src/composition/errands.js";
import { createCounterpartNudger } from "../src/composition/waiting.js";

/**
 * AUTO (2026-10-01/02) against the local database: the errand keeps the
 * times Q offered (once, never overwritten), and a silent counterpart's
 * people get one gentle reminder linking to their own inbox.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("errand store and reminders against PostgreSQL", () => {
  let db: RequestDatabase;
  const ids = {
    tenantCo: randomUUID(),
    tenantInv: randomUUID(),
    orgCo: randomUUID(),
    orgInv: randomUUID(),
    company: randomUUID(),
    investor: randomUUID(),
    relationship: randomUUID(),
    errand: randomUUID(),
  };
  const users: string[] = [];

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
      for (const [tenant, org, type] of [
        [ids.tenantCo, ids.orgCo, "company"],
        [ids.tenantInv, ids.orgInv, "investment_firm"],
      ] as const) {
        await sql`insert into identity.tenants (id, name) values (${tenant}, ${`Errand ${type}`})`;
        await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
          values (${org}, ${tenant}, ${type}, ${`Errand ${type}`}, ${`errand-${org.slice(0, 8)}`})`;
        await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
        const authId = randomUUID();
        await sql`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@errand.example.invalid`})`;
        const [profile] = await sql<{ id: string }[]>`
          select id from identity.user_profiles where auth_user_id = ${authId}`;
        if (profile === undefined)
          throw new Error("profile trigger did not run");
        await sql`insert into identity.organisation_memberships (tenant_id, organisation_id, user_id, membership_status)
          values (${tenant}, ${org}, ${profile.id}, 'active')`;
        users.push(profile.id);
      }
      await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
        values (${ids.company}, ${ids.tenantCo}, ${ids.orgCo}, 'Errand Co', ${`errand-co-${ids.company.slice(0, 8)}`})`;
      await sql`insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name)
        values (${ids.investor}, ${ids.tenantInv}, ${ids.orgInv}, 'VC', 'Errand Capital')`;
      await sql`insert into network.relationships (id, tenant_id, company_id, investor_organisation_id, current_state)
        values (${ids.relationship}, ${ids.tenantCo}, ${ids.company}, ${ids.investor}, 'INTEREST_EXPRESSED')`;
      await sql`insert into q_runtime.errands
          (id, tenant_id, user_id, q_action_id, relationship_id, counterpart_name, plan, expires_at)
        values (${ids.errand}, ${ids.tenantInv}, ${users[1] ?? ""}, ${randomUUID()}, ${ids.relationship},
                'Errand Co', ${sql.json({ relationshipId: ids.relationship })}, now() + interval '14 days')`;
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it("keeps the first offer of times, never overwriting it", async () => {
    const store = createPostgresErrandStore(db.sql);
    const first = ["2026-10-05T09:00:00.000Z", "2026-10-06T09:00:00.000Z"];
    await store.update(ids.errand, {
      proposedSlots: first,
      lastStep: "Offered.",
    });
    await store.update(ids.errand, {
      proposedSlots: ["2026-12-01T09:00:00.000Z"],
    });
    const [due] = (await store.dueFor?.(ids.relationship)) ?? [];
    expect(due?.proposed_slots).toEqual(first);
    const [row] = await db.sql<{ proposed_at: Date | null }[]>`
      select proposed_at from q_runtime.errands where id = ${ids.errand}`;
    expect(row?.proposed_at).not.toBeNull();
  });

  it("reminds the silent side's people once, linking to their own inbox", async () => {
    const nudger = createCounterpartNudger(db.sql);
    const input = {
      relationshipId: ids.relationship,
      waitingSide: "INVESTOR" as const,
      waitingName: "Ben",
      key: `errand:${ids.errand}`,
    };
    expect(await nudger.nudge(input)).toBe(1);
    expect(await nudger.nudge(input)).toBe(0);
    const [notice] = await db.sql<
      { user_id: string; link_path: string; kind: string }[]
    >`
      select user_id, link_path, kind from communication.notifications
       where dedupe_key = ${`waiting-nudge:errand:${ids.errand}`}`;
    expect(notice).toEqual({
      user_id: users[0],
      link_path: "/company/interest",
      kind: "REMINDER",
    });
  });
});
