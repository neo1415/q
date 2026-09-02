import type { Sql } from "postgres";

import { toDatabaseError } from "./errors.js";
import type { TransactionContext, TransactionManager } from "./types.js";

/**
 * Wrap a client in the transaction boundary.
 *
 * `sql.begin` reserves one connection from the pool for the callback's
 * lifetime and issues BEGIN; a normal return issues COMMIT; a throw issues
 * ROLLBACK and the error propagates. Nothing here catches, logs and commits
 * anyway -- a failure inside the boundary is a failure of the whole unit.
 *
 * There is no automatic retry. A serialization failure is retryable in
 * principle, but re-running a callback re-runs its business logic, and only
 * the use case knows whether that is safe. Bounded retry belongs at the
 * application boundary, applied to work proven idempotent.
 */
export function createTransactionManager(sql: Sql): TransactionManager {
  return {
    run: async (work) => {
      try {
        // The driver unwraps an array-of-promises result; boxing the value
        // keeps `run` honest about returning exactly what `work` returned.
        const { value } = await sql.begin(async (transactionSql) => {
          const context: TransactionContext = { sql: transactionSql };
          return { value: await work(context) };
        });
        return value;
      } catch (error) {
        throw toDatabaseError(error);
      }
    },
  };
}
