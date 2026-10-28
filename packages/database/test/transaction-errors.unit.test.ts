import type { Sql } from "postgres";
import { describe, expect, it } from "vitest";

import { DatabaseError } from "../src/errors.js";
import { createTransactionManager } from "../src/transaction.js";

/** A client whose transaction runs the callback and lets its throw through. */
function fakeSql(): Sql {
  return {
    begin: async (work: (sql: unknown) => Promise<unknown>) => work({}),
  } as unknown as Sql;
}

async function thrownBy(error: Error): Promise<unknown> {
  try {
    await createTransactionManager(fakeSql()).run(() => Promise.reject(error));
  } catch (caught: unknown) {
    return caught;
  }
  throw new Error("expected the unit to fail");
}

describe("what a transaction lets through unchanged (live 2026-10-28)", () => {
  it("an application error with its own lower-case code propagates as itself", async () => {
    // The onboarding refusal that holds an answer until the firm exists.
    class ContextRequired extends Error {
      readonly code = "onboarding_context_required";
    }
    const error = new ContextRequired("kept until the firm is set up");
    const caught = await thrownBy(error);
    expect(caught).toBe(error);
    expect(caught).not.toBeInstanceOf(DatabaseError);
  });

  it("a driver failure (SQLSTATE, errno or driver code) is still wrapped", async () => {
    for (const shape of [
      { code: "23505" },
      { code: "ECONNRESET", errno: -104 },
      { code: "CONNECTION_CLOSED" },
    ]) {
      const caught = await thrownBy(
        Object.assign(new Error("select secret"), shape),
      );
      expect(caught).toBeInstanceOf(DatabaseError);
    }
  });
});
