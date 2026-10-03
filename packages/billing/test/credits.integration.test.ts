import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import { createCreditLedger } from "../src/index.js";

/**
 * The credit ledger groundwork on the local database, inside one
 * transaction that is always rolled back (the migration is applied in it
 * when absent). No payment provider is involved.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const MIGRATION = fileURLToPath(
  new URL(
    "../../../supabase/migrations/20261127090000_billing_credit_ledger.sql",
    import.meta.url,
  ),
);

class Rollback extends Error {}

describe("the credit ledger", () => {
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

  it("records once per source event, signs usage, prices nothing", async () => {
    await expect(
      db.transactions.run(async ({ sql: tx }) => {
        const [present] = await tx<{ found: string | null }[]>`
          select to_regclass('billing.credit_entries')::text as found`;
        if (present?.found === null) await tx.file(MIGRATION);
        const authId = randomUUID();
        await tx`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@credit.example.invalid`})`;
        const [profile] = await tx<{ id: string }[]>`
          select id from identity.user_profiles where auth_user_id = ${authId}`;
        const account = { organisationId: null, userId: profile?.id ?? "" };
        const ledger = createCreditLedger({ sql: tx });
        const usage = {
          account,
          kind: "USAGE" as const,
          unit: "MODEL_COST_USD" as const,
          quantity: "0.01234567",
          source: "MODEL_USAGE",
          sourceRef: "model_usage:42",
          occurredAt: new Date("2026-10-05T10:00:00Z"),
        };
        expect(await ledger.record(usage)).toBe(true);
        expect(await ledger.record(usage)).toBe(false);
        expect(
          await ledger.record({
            ...usage,
            kind: "GRANT",
            quantity: "1",
            source: "ADMIN_GRANT",
            sourceRef: "grant:1",
          }),
        ).toBe(true);
        expect(await ledger.balance(account)).toEqual([
          { unit: "MODEL_COST_USD", quantity: "0.98765433", unrated: 2 },
        ]);
        await expect(
          ledger.record({ ...usage, quantity: "-1" }),
        ).rejects.toThrow(RangeError);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
