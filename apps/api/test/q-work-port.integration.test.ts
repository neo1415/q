import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import { createQWorkPagePort } from "../src/q-work-port.js";

/** WORK-58: the Work page's writes, in one rolled-back transaction. */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DISMISSALS = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261204090000_work_suggestion_dismissals.sql",
    import.meta.url,
  ),
);

class Rollback extends Error {}

describe("the Work page's writes (WORK-58)", () => {
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

  it("pauses and resumes only the owner's own, and Not now is additive", async () => {
    await expect(
      db.transactions.run(async ({ sql: tx }) => {
        const [present] = await tx<{ found: string | null }[]>`
          select to_regclass('q_runtime.work_suggestion_dismissals')::text as found`;
        if (present?.found === null) await tx.file(DISMISSALS);
        const tenant = randomUUID();
        await tx`insert into identity.tenants (id, name) values (${tenant}, 'Work port tenant')`;
        const users: string[] = [];
        for (let index = 0; index < 2; index += 1) {
          const authId = randomUUID();
          await tx`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@wp.example.invalid`})`;
          const [profile] = await tx<{ id: string }[]>`
            select id from identity.user_profiles where auth_user_id = ${authId}`;
          users.push(profile?.id ?? "");
        }
        const [ada = "", ben = ""] = users;
        const actor = {
          tenantId: tenant,
          userId: ada,
        } as unknown as ActorContext;
        const other = {
          tenantId: tenant,
          userId: ben,
        } as unknown as ActorContext;
        const id = randomUUID();
        await tx`
          insert into q_runtime.standing_instructions (id, tenant_id, user_id, goal_text, status, grant_version, next_fire_at)
          values (${id}, ${tenant}, ${ada}, 'Keep my founder conversations moving', 'ACTIVE', 1, now())`;
        const port = createQWorkPagePort(tx);

        expect(await port.pause(other, id)).toBe(false);
        expect(await port.pause(actor, id)).toBe(true);
        const [paused] = await tx<
          { status: string; next_fire_at: Date | null }[]
        >`
          select status, next_fire_at from q_runtime.standing_instructions where id = ${id}`;
        expect(paused).toEqual({ status: "PAUSED", next_fire_at: null });
        expect(await port.resume(other, id)).toBe(false);
        expect(await port.resume(actor, id)).toBe(true);
        expect(await port.resume(actor, id)).toBe(false);

        await port.dismiss(actor, "stalled_reply:abc");
        await port.dismiss(actor, "stalled_reply:abc");
        const rows = await tx<{ n: number }[]>`
          select count(*)::int as n from q_runtime.work_suggestion_dismissals where user_id = ${ada}`;
        expect(rows[0]?.n).toBe(1);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
