import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import { liveContextPackage } from "../src/voice/live/context.js";
import { createPostgresPronunciationStore } from "../src/voice/live/pronunciations.js";

/**
 * W3 against the local database: a spoken correction is kept per
 * (name entity, person or organisation), shared across romanisations,
 * labelled as the person's own (never verified), isolated by tenant, and
 * offered to GPT-Live as hint lines.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("name pronunciations against PostgreSQL", () => {
  let db: RequestDatabase;
  const tenants = [randomUUID(), randomUUID()];
  const orgs = [randomUUID(), randomUUID()];
  const users: string[] = [];
  const actor = (index: number, organisation: boolean): ActorContext =>
    ({
      userId: users[index] ?? "",
      tenantId: tenants[index] ?? "",
      ...(organisation ? { organisationId: orgs[index] ?? "" } : {}),
      actorType: "HUMAN",
    }) as ActorContext;

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
      for (const index of [0, 1]) {
        const tenant = tenants[index] ?? "";
        const org = orgs[index] ?? "";
        await sql`insert into identity.tenants (id, name) values (${tenant}, ${`Names ${index}`})`;
        await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
          values (${org}, ${tenant}, 'company', ${`Names ${index}`}, ${`names-${org.slice(0, 8)}`})`;
        await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
        const authId = randomUUID();
        await sql`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@names.example.invalid`})`;
        const [profile] = await sql<{ id: string }[]>`
          select id from identity.user_profiles where auth_user_id = ${authId}`;
        if (profile === undefined) throw new Error("no profile trigger");
        users.push(profile.id);
      }
    });
  });

  afterAll(async () => {
    await db.sql`delete from q_runtime.name_pronunciations where tenant_id = any(${tenants}::uuid[])`;
    await db.close();
  });

  it("keeps a correction and serves it under every romanisation", async () => {
    const store = createPostgresPronunciationStore({ sql: db.sql });
    const me = actor(0, true);
    expect(
      await store.recordCorrection({
        actor: me,
        name: "Shadi Qishta",
        kind: "pronunciation",
        value: "SHAH-dee KISH-tah",
      }),
    ).toBe(true);
    // A later correction wins; history stays.
    await store.recordCorrection({
      actor: me,
      name: "Shady Kishta",
      kind: "pronunciation",
      value: "SHAH-dee KISH-ta",
    });
    const mine = await store.forActor(me);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      value: "SHAH-dee KISH-ta",
      source: "USER_CORRECTION",
      sourceRef: null,
    });
    const [row] = await db.sql<{ count: number }[]>`
      select count(*)::int as count from q_runtime.name_pronunciations
       where tenant_id = ${me.tenantId}`;
    expect(row?.count).toBe(2);
    const hints = await store.hintsFor(me);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain("as the user told Q");
    expect(hints[0]).not.toContain("verified");
  });

  it("a spelling correction is its own kind", async () => {
    const store = createPostgresPronunciationStore({ sql: db.sql });
    const me = actor(0, false);
    await store.recordCorrection({
      actor: me,
      name: "Qishta",
      kind: "spelling",
      value: "QISHTA",
    });
    const kinds = (await store.forActor(me)).map((p) => p.kind).sort();
    expect(kinds).toEqual(["pronunciation", "spelling"]);
  });

  it("a verified guide says so and needs its source", async () => {
    const store = createPostgresPronunciationStore({ sql: db.sql });
    const me = actor(0, true);
    await store.recordVerified({
      actor: me,
      name: "Muhannad Taslaq",
      kind: "pronunciation",
      value: "moo-HAN-nad",
      source: "VERIFIED_GUIDE",
      sourceRef: "profile-recording:1",
      forOrganisation: true,
    });
    const hints = await store.hintsFor(me);
    expect(hints[0]).toContain("(verified)");
    await expect(
      db.sql`insert into q_runtime.name_pronunciations
        (tenant_id, scope, user_id, name_key, display_name, kind, value, source, created_by)
        values (${me.tenantId}, 'user', ${me.userId}, 'k', 'K', 'pronunciation', 'K',
                'VERIFIED_GUIDE', ${me.userId})`,
    ).rejects.toThrow();
  });

  it("an organisation's entry reaches its members only, and a person's own wins", async () => {
    const store = createPostgresPronunciationStore({ sql: db.sql });
    const withOrg = actor(0, true);
    const personalOnly = actor(0, false);
    expect(
      (await store.forActor(withOrg)).some(
        (p) => p.displayName === "Muhannad Taslaq",
      ),
    ).toBe(true);
    // Same person acting without the organisation does not see its entries.
    expect(
      (await store.forActor(personalOnly)).some(
        (p) => p.displayName === "Muhannad Taslaq",
      ),
    ).toBe(false);
    await store.recordCorrection({
      actor: withOrg,
      name: "Muhannad Taslaq",
      kind: "pronunciation",
      value: "moo-HAH-nad",
    });
    const taslaq = (await store.forActor(withOrg)).filter(
      (p) => p.displayName === "Muhannad Taslaq",
    );
    expect(taslaq).toHaveLength(1);
    expect(taslaq[0]?.value).toBe("moo-HAH-nad");
  });

  it("cross-tenant negative: another tenant sees and gets nothing", async () => {
    const store = createPostgresPronunciationStore({ sql: db.sql });
    const other = actor(1, true);
    expect(await store.forActor(other)).toEqual([]);
    expect(await store.hintsFor(other)).toEqual([]);
    // Even naming the other tenant's organisation id in a forged actor.
    const forged = {
      ...actor(1, false),
      organisationId: orgs[0],
    } as ActorContext;
    expect(await store.forActor(forged)).toEqual([]);
  });

  it("the hints reach the Live context package, bounded and as data", async () => {
    const store = createPostgresPronunciationStore({ sql: db.sql });
    const hints = await store.hintsFor(actor(0, true));
    const context = liveContextPackage({
      facts: null,
      referents: [],
      pronunciations: hints,
    });
    expect(context).toContain("How these names are said or written");
    expect(context).toContain("Kishta");
    expect(context).toContain("as the user told Q");
    expect(context?.length ?? 0).toBeLessThanOrEqual(1_600);
  });
});
