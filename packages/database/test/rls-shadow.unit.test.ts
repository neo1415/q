import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";

import {
  createRlsShadowCounter,
  databaseClaimsFor,
  MAX_SHADOW_READS_PER_UNIT,
  shadowRead,
  type RlsShadowSettings,
} from "../src/rls-shadow.js";
import { createTransactionManager } from "../src/transaction.js";
import type { DatabaseClaims, TransactionContext } from "../src/types.js";

/**
 * W2-C step 3 (ADR 0082 §5): RLS shadow mode. A sampled claimed unit
 * repeats a read under cq_app inside a savepoint that is always rolled
 * back; the person's answer is the bypass read; a difference is logged as
 * counts only; a failure is logged and swallowed.
 */

type Row = { readonly title: string };

/**
 * A fake reserved connection with postgres.js's savepoint semantics: the
 * callback runs on an inner executor; a throw issues ROLLBACK TO and
 * rethrows. The role is tracked (and recorded per statement) so a test can
 * see it come back, and a failed statement aborts the transaction until
 * ROLLBACK TO, as Postgres does: COMMIT of an aborted one fails.
 */
function fakeDatabase(options: {
  readonly bypassRows: readonly Row[];
  readonly enforcedRows?: readonly Row[];
  readonly enforcedFails?: Error;
}) {
  const sent: string[] = [];
  const roles: string[] = [];
  const state = { role: "postgres", aborted: false };
  const answer = (
    text: string,
    values: unknown[],
  ): Promise<readonly unknown[]> => {
    if (state.aborted) {
      return Promise.reject(Object.assign(new Error("x"), { code: "25P02" }));
    }
    if (text.includes("set_config('role'")) {
      state.role = String(values[0]);
      return Promise.resolve([]);
    }
    if (text.includes("from workspace.board_items")) {
      if (state.role === "cq_app") {
        return options.enforcedFails === undefined
          ? Promise.resolve([...(options.enforcedRows ?? [])])
          : Promise.reject(options.enforcedFails);
      }
      return Promise.resolve([...options.bypassRows]);
    }
    return Promise.resolve([]);
  };
  const executor = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    sent.push(text);
    roles.push(state.role);
    return answer(text, values).catch((error: unknown) => {
      state.aborted = true;
      throw error;
    });
  };
  const tx = Object.assign(executor, {
    savepoint: async (work: (inner: typeof executor) => Promise<unknown>) => {
      sent.push("savepoint");
      roles.push(state.role);
      const roleBefore = state.role;
      try {
        const value = await work(executor);
        sent.push("release savepoint");
        return value;
      } catch (error) {
        sent.push("rollback to savepoint");
        state.role = roleBefore;
        state.aborted = false;
        throw error;
      }
    },
  });
  const sql = {
    begin: async (work: (inner: typeof tx) => Promise<unknown>) => {
      const value = await work(tx);
      if (state.aborted) {
        throw Object.assign(new Error("commit of an aborted transaction"), {
          code: "25P02",
        });
      }
      sent.push("commit");
      return value;
    },
  } as unknown as Sql;
  return { sql, sent, roles, state };
}

const CLAIMS: DatabaseClaims = databaseClaimsFor({
  tenantId: "c0000000-0000-4000-8000-000000000001",
  userId: "b0000000-0000-4000-8000-000000000001",
  actorType: "HUMAN",
});

const ITEMS = {
  schema: "workspace",
  table: "board_items",
  statementKind: "select",
} as const;

const readItems = (tx: TransactionContext) =>
  shadowRead(
    tx,
    ITEMS,
    (sql) => sql`select title from workspace.board_items where x = ${1}`,
  );

function recordingLogger() {
  const lines: { fields: Record<string, unknown>; message: string }[] = [];
  return {
    lines,
    logger: {
      warn: (fields: Record<string, unknown>, message: string) => {
        lines.push({ fields, message });
      },
    },
  };
}

function shadowSettings(
  overrides: Partial<RlsShadowSettings> = {},
): RlsShadowSettings {
  return {
    schemas: ["workspace"],
    sample: 0.05,
    service: "api",
    random: () => 0,
    ...overrides,
  };
}

const MINE: readonly Row[] = [{ title: "A's private note" }];

describe("RLS shadow mode: configuration", () => {
  const base = {
    NODE_ENV: "test",
    CAPITAL_Q_ENV: "local",
    DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  };

  it("is off by default: no schemas, a 5% sample", () => {
    expect(parseDatabaseConfig(base).rlsShadow).toEqual({
      schemas: [],
      sample: 0.05,
    });
    expect(
      parseDatabaseConfig({ ...base, DATABASE_RLS_SHADOW: "" }).rlsShadow,
    ).toEqual({ schemas: [], sample: 0.05 });
  });

  it("DATABASE_RLS_SHADOW is a comma list of schema names, de-duplicated", () => {
    expect(
      parseDatabaseConfig({
        ...base,
        DATABASE_RLS_SHADOW: " workspace, media ,workspace,",
      }).rlsShadow?.schemas,
    ).toEqual(["workspace", "media"]);
  });

  it("refuses anything that is not a lower-case schema name", () => {
    for (const value of ["Workspace", "workspace;drop", "a b", "1abc", "*"]) {
      expect(() =>
        parseDatabaseConfig({ ...base, DATABASE_RLS_SHADOW: value }),
      ).toThrow();
    }
  });

  it("DATABASE_RLS_SHADOW_SAMPLE is a number from 0 to 1", () => {
    expect(
      parseDatabaseConfig({ ...base, DATABASE_RLS_SHADOW_SAMPLE: "0.5" })
        .rlsShadow?.sample,
    ).toBe(0.5);
    expect(
      parseDatabaseConfig({ ...base, DATABASE_RLS_SHADOW_SAMPLE: "1" })
        .rlsShadow?.sample,
    ).toBe(1);
    expect(
      parseDatabaseConfig({ ...base, DATABASE_RLS_SHADOW_SAMPLE: "0" })
        .rlsShadow?.sample,
    ).toBe(0);
    for (const value of ["1.5", "-0.1", "abc", "5%"]) {
      expect(() =>
        parseDatabaseConfig({ ...base, DATABASE_RLS_SHADOW_SAMPLE: value }),
      ).toThrow();
    }
  });
});

describe("RLS shadow mode: which units are shadowed", () => {
  const shadowed = async (
    managerOptions: Parameters<typeof createTransactionManager>[1],
    claims: DatabaseClaims | null = CLAIMS,
  ) => {
    const db = fakeDatabase({ bypassRows: MINE, enforcedRows: MINE });
    await createTransactionManager(db.sql, managerOptions).run(readItems, {
      claims: claims ?? undefined,
    });
    return db.sent.includes("savepoint");
  };

  it("a claimed unit inside the sample is shadowed", async () => {
    expect(
      await shadowed({
        rlsClaims: "on",
        rlsShadow: shadowSettings({ random: () => 0.049 }),
      }),
    ).toBe(true);
  });

  it("a claimed unit outside the sample is not", async () => {
    expect(
      await shadowed({
        rlsClaims: "on",
        rlsShadow: shadowSettings({ random: () => 0.05 }),
      }),
    ).toBe(false);
    expect(
      await shadowed({
        rlsClaims: "on",
        rlsShadow: shadowSettings({ sample: 0, random: () => 0 }),
      }),
    ).toBe(false);
  });

  it("nothing is shadowed with claims off, without claims, or with no schemas", async () => {
    expect(await shadowed({ rlsShadow: shadowSettings() })).toBe(false);
    expect(
      await shadowed({ rlsClaims: "off", rlsShadow: shadowSettings() }),
    ).toBe(false);
    expect(
      await shadowed({ rlsClaims: "on", rlsShadow: shadowSettings() }, null),
    ).toBe(false);
    expect(
      await shadowed({
        rlsClaims: "on",
        rlsShadow: shadowSettings({ schemas: [] }),
      }),
    ).toBe(false);
  });

  it("a read of a schema not in the list is not repeated", async () => {
    expect(
      await shadowed({
        rlsClaims: "on",
        rlsShadow: shadowSettings({ schemas: ["media"] }),
      }),
    ).toBe(false);
  });
});

describe("RLS shadow mode: the rerun", () => {
  it("after the work, re-runs the read as the bypass role and as cq_app in a savepoint that is always rolled back; the answer is the bypass read", async () => {
    const db = fakeDatabase({ bypassRows: MINE, enforcedRows: MINE });
    const counter = createRlsShadowCounter();
    const { lines, logger } = recordingLogger();
    const rows = await createTransactionManager(db.sql, {
      rlsClaims: "on",
      rlsShadow: shadowSettings({ counter, logger }),
    }).run(readItems, { claims: CLAIMS });

    expect(rows).toEqual(MINE);
    const statements = db.sent.filter((text) => !text.includes("set_config(?"));
    expect(statements[0]).toMatch(/from workspace\.board_items/u);
    expect(statements.slice(1)).toEqual([
      "savepoint",
      statements[0],
      "select set_config('role', ?, true)",
      statements[0],
      "rollback to savepoint",
      "commit",
    ]);
    // The role is back to the bypass role after the savepoint.
    expect(db.state.role).toBe("postgres");
    expect(lines).toEqual([]);
    expect(counter.read()).toEqual({
      workspace: { compared: 1, wouldDeny: 0, errors: 0 },
    });
  });

  it("a difference is logged as RLS_WOULD_DENY with counts only, and the person still gets the bypass rows", async () => {
    const db = fakeDatabase({ bypassRows: MINE, enforcedRows: [] });
    const counter = createRlsShadowCounter();
    const { lines, logger } = recordingLogger();
    const rows = await createTransactionManager(db.sql, {
      rlsClaims: "on",
      rlsShadow: shadowSettings({ counter, logger }),
    }).run(readItems, { claims: CLAIMS });

    expect(rows).toEqual(MINE);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields).toEqual({
      alert: "RLS_WOULD_DENY",
      schema: "workspace",
      table: "board_items",
      statementKind: "select",
      service: "api",
      rowsBypass: 1,
      rowsEnforced: 0,
    });
    // Never a row, an id or a claim value.
    const logged = JSON.stringify(lines);
    expect(logged).not.toContain("private note");
    expect(logged).not.toContain(CLAIMS.tenantId);
    expect(logged).not.toContain(String(CLAIMS.userId));
    expect(counter.read()).toEqual({
      workspace: { compared: 1, wouldDeny: 1, errors: 0 },
    });
  });

  it("a failing shadow read is logged as RLS_SHADOW_ERROR (SQLSTATE only), rolled back, and the unit still commits", async () => {
    const failure = Object.assign(
      new Error('permission denied for table board_items: "A\'s private note"'),
      { code: "42501" },
    );
    const db = fakeDatabase({ bypassRows: MINE, enforcedFails: failure });
    const counter = createRlsShadowCounter();
    const { lines, logger } = recordingLogger();
    const value = await createTransactionManager(db.sql, {
      rlsClaims: "on",
      rlsShadow: shadowSettings({ counter, logger }),
    }).run(readItems, { claims: CLAIMS });

    // The failure aborted only the savepoint: it was rolled back, the
    // transaction was whole again and COMMIT succeeded (the fake refuses
    // to commit an aborted transaction, as Postgres does).
    expect(value).toEqual(MINE);
    const rollback = db.sent.indexOf("rollback to savepoint");
    expect(rollback).toBeGreaterThan(0);
    expect(db.sent.indexOf("commit")).toBeGreaterThan(rollback);
    expect(db.state.role).toBe("postgres");
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields).toEqual({
      alert: "RLS_SHADOW_ERROR",
      schema: "workspace",
      table: "board_items",
      statementKind: "select",
      service: "api",
      sqlState: "42501",
    });
    expect(JSON.stringify(lines)).not.toContain("private note");
    expect(counter.read()).toEqual({
      workspace: { compared: 0, wouldDeny: 0, errors: 1 },
    });
  });

  it("without a logger or counter, a difference or a failure still never reaches the person", async () => {
    const failing = fakeDatabase({
      bypassRows: MINE,
      enforcedFails: new Error("boom"),
    });
    await expect(
      createTransactionManager(failing.sql, {
        rlsClaims: "on",
        rlsShadow: shadowSettings({ service: undefined }),
      }).run(readItems, { claims: CLAIMS }),
    ).resolves.toEqual(MINE);
  });

  it("never runs a statement of the work as cq_app, even reads in parallel", async () => {
    const db = fakeDatabase({ bypassRows: MINE, enforcedRows: [] });
    const value = await createTransactionManager(db.sql, {
      rlsClaims: "on",
      rlsShadow: shadowSettings(),
    }).run(
      async (tx) => {
        const [first, second] = await Promise.all([
          readItems(tx),
          readItems(tx),
          tx.sql`select 'another statement'`,
        ]);
        return [first, second];
      },
      { claims: CLAIMS },
    );
    expect(value).toEqual([MINE, MINE]);
    const firstSavepoint = db.sent.indexOf("savepoint");
    expect(db.sent.indexOf("select 'another statement'")).toBeLessThan(
      firstSavepoint,
    );
    // Every statement before the comparison ran as the bypass role.
    expect(new Set(db.roles.slice(0, firstSavepoint))).toEqual(
      new Set(["postgres"]),
    );
    // Two recorded reads, compared one after the other.
    expect(db.sent.filter((text) => text === "savepoint")).toHaveLength(2);
  });

  it("compares at most MAX_SHADOW_READS_PER_UNIT reads in one unit", async () => {
    const db = fakeDatabase({ bypassRows: MINE, enforcedRows: MINE });
    await createTransactionManager(db.sql, {
      rlsClaims: "on",
      rlsShadow: shadowSettings(),
    }).run(
      async (tx) => {
        for (let i = 0; i < MAX_SHADOW_READS_PER_UNIT + 5; i += 1) {
          await readItems(tx);
        }
      },
      { claims: CLAIMS },
    );
    expect(db.sent.filter((text) => text === "savepoint")).toHaveLength(
      MAX_SHADOW_READS_PER_UNIT,
    );
  });

  it("a unit whose work fails compares nothing and fails as before", async () => {
    const db = fakeDatabase({ bypassRows: MINE, enforcedRows: [] });
    await expect(
      createTransactionManager(db.sql, {
        rlsClaims: "on",
        rlsShadow: shadowSettings(),
      }).run(
        async (tx) => {
          await readItems(tx);
          throw new Error("the work's own failure");
        },
        { claims: CLAIMS },
      ),
    ).rejects.toThrow("the work's own failure");
    expect(db.sent).not.toContain("savepoint");
  });

  it("outside a shadowed unit, shadowRead is just the read", async () => {
    const db = fakeDatabase({ bypassRows: MINE });
    const rows = await createTransactionManager(db.sql).run(readItems);
    expect(rows).toEqual(MINE);
    expect(db.sent).toEqual([expect.stringMatching(/board_items/u), "commit"]);
  });
});

describe("claims for an actor", () => {
  it("are built from the server-resolved actor; acting personally is a null organisation", () => {
    expect(
      databaseClaimsFor({
        tenantId: "t",
        userId: "u",
        organisationId: "o",
        actorType: "Q",
      }),
    ).toEqual({
      tenantId: "t",
      userId: "u",
      organisationId: "o",
      actorType: "Q",
    });
    expect(CLAIMS.organisationId).toBeNull();
  });
});
