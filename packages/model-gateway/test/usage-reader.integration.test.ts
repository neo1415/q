import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import { createPostgresUsageReader } from "../src/index.js";

/**
 * The usage read over the real ledger, inside one transaction that is
 * always rolled back (the purpose migration is applied in it when the
 * database lacks it). Seeded catalogue ids; no provider.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const PURPOSE_MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261126090000_model_usage_purpose.sql",
    import.meta.url,
  ),
);
const PROVIDER = "a1000000-0000-4000-8000-000000000002";
const MODEL = "a2000000-0000-4000-8000-000000000004";

class Rollback extends Error {}

describe("the usage read", () => {
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

  it("sums a person's own month by purpose and instruction, derives old rows, and the admin month by tenant, user and driver", async () => {
    await expect(
      db.transactions.run(async ({ sql: tx }) => {
        const [has] = await tx<{ n: number }[]>`
          select count(*)::int as n from information_schema.columns
           where table_schema = 'ai_ops' and table_name = 'model_usage' and column_name = 'purpose'`;
        if (has?.n === 0) await tx.file(PURPOSE_MIGRATION);
        const tenant = randomUUID();
        const other = randomUUID();
        await tx`insert into identity.tenants (id, name) values (${tenant}, 'Usage A'), (${other}, 'Usage B')`;
        const users: string[] = [];
        for (let i = 0; i < 2; i += 1) {
          const authId = randomUUID();
          await tx`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@usage.example.invalid`})`;
          const [p] = await tx<{ id: string }[]>`
            select id from identity.user_profiles where auth_user_id = ${authId}`;
          users.push(p?.id ?? "");
        }
        const [ada = "", ben = ""] = users;
        const instruction = randomUUID();
        const row = (
          tenantId: string,
          userId: string | null,
          cost: string | null,
          extra: {
            purpose?: string;
            correlation?: string;
            run?: string;
            at?: string;
          },
        ) => tx`
          insert into ai_ops.model_usage
            (tenant_id, user_id, q_run_id, task_class, provider_id, model_id, attempt,
             latency_ms, cost_usd, cost_basis, success, correlation_id, purpose, occurred_at)
          values (${tenantId}, ${userId}, ${extra.run ?? null}, 'NORMAL_DIALOGUE', ${PROVIDER}, ${MODEL}, 1,
                  10, ${cost}::numeric, ${cost === null ? "UNPRICED" : "PRICE_SNAPSHOT"}, true,
                  ${extra.correlation ?? "cor_x"}, ${extra.purpose ?? "OTHER"},
                  ${extra.at ?? "2026-10-05T10:00:00Z"})`;
        await row(tenant, ada, "0.100000", { purpose: "REHEARSAL" });
        await row(tenant, ada, "0.020000", { purpose: "REHEARSAL" });
        // Written before the purpose column: derived on read.
        await row(tenant, ada, "0.003000", {
          correlation: `cor_instr_${instruction}_abcd1234`,
        });
        await row(tenant, ada, "0.050000", { run: randomUUID() });
        await row(tenant, ada, null, { purpose: "RESEARCH" });
        // Another month, another person, another tenant: not Ada's month.
        await row(tenant, ada, "9.000000", {
          purpose: "RESEARCH",
          at: "2026-09-30T23:59:59Z",
        });
        await row(tenant, ben, "1.000000", { purpose: "CONVERSATION" });
        await row(other, ada, "2.000000", { purpose: "CONVERSATION" });
        await row(other, null, "0.500000", { purpose: "ONBOARDING" });

        const reader = createPostgresUsageReader(tx);
        const own = await reader.ownMonth(
          { userId: ada, tenantId: tenant },
          new Date("2026-10-20T00:00:00Z"),
        );
        expect(own.totalUsd).toBe("0.173000");
        expect(own.calls).toBe(5);
        expect(own.unpricedCalls).toBe(1);
        expect(own.failedCalls).toBe(0);
        expect(own.byPurpose).toEqual([
          { purpose: "REHEARSAL", usd: "0.120000", calls: 2 },
          { purpose: "CONVERSATION", usd: "0.050000", calls: 1 },
          { purpose: "INSTRUCTION", usd: "0.003000", calls: 1 },
          { purpose: "RESEARCH", usd: "0.000000", calls: 1 },
        ]);
        expect(own.byInstruction).toEqual([
          { instructionId: instruction, usd: "0.003000", calls: 1 },
        ]);

        const admin = await reader.adminMonth(new Date("2026-10-20T00:00:00Z"));
        const mine = admin.tenants.filter(
          (t) => t.tenantId === tenant || t.tenantId === other,
        );
        expect(mine).toEqual(
          expect.arrayContaining([
            { tenantId: other, usd: "2.500000", calls: 2 },
            { tenantId: tenant, usd: "1.173000", calls: 6 },
          ]),
        );
        expect(admin.users).toEqual(
          expect.arrayContaining([
            { tenantId: other, userId: null, usd: "0.500000", calls: 1 },
          ]),
        );
        expect(admin.drivers.some((d) => d.purpose === "REHEARSAL")).toBe(true);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
