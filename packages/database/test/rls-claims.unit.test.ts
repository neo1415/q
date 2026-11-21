import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";

import {
  createTransactionManager,
  RLS_CLAIM_SETTINGS,
} from "../src/transaction.js";
import type { DatabaseClaims } from "../src/types.js";

/**
 * W2-C (ADR 0082): the request's claims as transaction-local settings, for
 * the non-bypass request role's policies. Off by default: nothing is sent.
 */

type Sent = { text: string; values: unknown[] };

function fakeTransactionSql(fail = false) {
  const sent: Sent[] = [];
  const tx = (strings: TemplateStringsArray, ...values: unknown[]) => {
    sent.push({ text: strings.join("?"), values });
    return fail
      ? Promise.reject(Object.assign(new Error("x"), { code: "22023" }))
      : Promise.resolve([]);
  };
  const sql = {
    begin: async (work: (inner: typeof tx) => Promise<unknown>) => work(tx),
  } as unknown as Sql;
  return { sql, sent };
}

const CLAIMS: DatabaseClaims = {
  tenantId: "c0000000-0000-4000-8000-000000000001",
  userId: "b0000000-0000-4000-8000-000000000001",
  organisationId: null,
  actorType: "HUMAN",
};

const work = async (context: { sql: (s: TemplateStringsArray) => unknown }) => {
  await context.sql`select 1`;
  return "done";
};

describe("RLS claims in the transaction helper", () => {
  it("are off by default: claims given are ignored and nothing extra is sent", async () => {
    const { sql, sent } = fakeTransactionSql();
    await createTransactionManager(sql).run(work, { claims: CLAIMS });
    expect(sent.map((s) => s.text)).toEqual(["select 1"]);
    const off = fakeTransactionSql();
    await createTransactionManager(off.sql, { rlsClaims: "off" }).run(work, {
      claims: CLAIMS,
    });
    expect(off.sent.map((s) => s.text)).toEqual(["select 1"]);
  });

  it("when on, are set transaction-local before the work, as bound values", async () => {
    const { sql, sent } = fakeTransactionSql();
    const value = await createTransactionManager(sql, {
      rlsClaims: "on",
    }).run(work, { claims: CLAIMS });
    expect(value).toBe("done");
    expect(sent).toHaveLength(2);
    expect(sent[0]?.text).toMatch(/set_config\(\?, \?, true\)/u);
    // Transaction-local (the third argument), so gone at COMMIT and safe
    // behind the transaction pooler.
    expect(sent[0]?.text.match(/, true\)/gu)).toHaveLength(4);
    expect(sent[0]?.values).toEqual([
      RLS_CLAIM_SETTINGS.tenantId,
      CLAIMS.tenantId,
      RLS_CLAIM_SETTINGS.userId,
      CLAIMS.userId,
      RLS_CLAIM_SETTINGS.organisationId,
      "",
      RLS_CLAIM_SETTINGS.actorType,
      "HUMAN",
    ]);
    expect(sent[1]?.text).toBe("select 1");
  });

  it("when on, a unit run without claims sets none", async () => {
    const { sql, sent } = fakeTransactionSql();
    await createTransactionManager(sql, { rlsClaims: "on" }).run(work);
    expect(sent.map((s) => s.text)).toEqual(["select 1"]);
  });

  it("go out beside the limits, each its own pipelined statement", async () => {
    const { sql, sent } = fakeTransactionSql();
    await createTransactionManager(sql, {
      limits: { statementTimeoutMs: 10_000, lockTimeoutMs: 5_000 },
      rlsClaims: "on",
    }).run(work, { claims: CLAIMS });
    expect(sent[0]?.text).toMatch(/statement_timeout/u);
    expect(sent[1]?.values[0]).toBe(RLS_CLAIM_SETTINGS.tenantId);
    expect(sent[2]?.text).toBe("select 1");
  });

  it("a failure to set them fails the unit", async () => {
    const { sql } = fakeTransactionSql(true);
    await expect(
      createTransactionManager(sql, { rlsClaims: "on" }).run(
        () => Promise.resolve("never kept"),
        { claims: CLAIMS },
      ),
    ).rejects.toMatchObject({ sqlState: "22023" });
  });

  it("the flag is DATABASE_RLS_CLAIMS, off unless it says on", () => {
    const base = {
      NODE_ENV: "test",
      CAPITAL_Q_ENV: "local",
      DATABASE_URL: "postgresql://u:p@localhost:5432/db",
    };
    expect(parseDatabaseConfig(base).rlsClaims).toBe("off");
    expect(
      parseDatabaseConfig({ ...base, DATABASE_RLS_CLAIMS: "on" }).rlsClaims,
    ).toBe("on");
    expect(() =>
      parseDatabaseConfig({ ...base, DATABASE_RLS_CLAIMS: "yes" }),
    ).toThrow();
  });
});
