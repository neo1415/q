import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import { createPostgresProviderSpendReader } from "../src/index.js";

/**
 * The balance watch's spend read (DECISIONS 63) over the real ledger, in one
 * transaction that is always rolled back. Seeded catalogue ids; rows dated
 * in 2030 so nothing else in the ledger falls in the windows.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const GROQ = "a1000000-0000-4000-8000-000000000002";
const GROQ_MODEL = "a2000000-0000-4000-8000-000000000004";
const OPENAI = "a1000000-0000-4000-8000-000000000003";
const OPENAI_MODEL = "a2000000-0000-4000-8000-000000000009";

class Rollback extends Error {}

describe("provider spend since a stated balance", () => {
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

  it("sums one provider's priced spend since the balance and over the window, and counts unpriced calls", async () => {
    await expect(
      db.transactions.run(async ({ sql: tx }) => {
        const tenant = randomUUID();
        await tx`insert into identity.tenants (id, name) values (${tenant}, 'Spend')`;
        const row = (
          provider: string,
          model: string,
          cost: string | null,
          at: string,
          tokens = 100,
        ) => tx`
          insert into ai_ops.model_usage
            (tenant_id, task_class, provider_id, model_id, attempt, input_tokens,
             latency_ms, cost_usd, cost_basis, success, occurred_at)
          values (${tenant}, 'NORMAL_DIALOGUE', ${provider}, ${model}, 1, ${tokens},
                  10, ${cost}::numeric, ${cost === null ? "UNPRICED" : "PRICE_SNAPSHOT"},
                  true, ${at}::timestamptz)`;
        await row(GROQ, GROQ_MODEL, "5.000000", "2030-01-01T00:00:00Z"); // before the balance
        await row(GROQ, GROQ_MODEL, "1.250000", "2030-01-02T12:00:00Z"); // since, before window
        await row(GROQ, GROQ_MODEL, "0.500000", "2030-01-04T12:00:00Z"); // in window
        await row(GROQ, GROQ_MODEL, null, "2030-01-04T13:00:00Z"); // unpriced, in window
        await row(GROQ, GROQ_MODEL, null, "2030-01-04T14:00:00Z", 0); // a refusal: no tokens
        await row(OPENAI, OPENAI_MODEL, "9.000000", "2030-01-04T12:00:00Z"); // other provider
        const read = createPostgresProviderSpendReader({ sql: tx });
        const spend = await read({
          providerCode: "groq",
          since: new Date("2030-01-02T00:00:00Z"),
          windowStart: new Date("2030-01-04T00:00:00Z"),
        });
        expect(spend).toEqual({
          providerCode: "groq",
          spentSinceAsOfUsd: 1.75,
          windowSpentUsd: 0.5,
          unpricedCalls: 1,
        });
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
