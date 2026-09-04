import type { Sql } from "postgres";

import { DatabaseError, toDatabaseError } from "./errors.js";

/** Postgres.js and socket errors carry a `code`; application errors do not. */
function isDriverFailure(error: unknown): boolean {
  if (error instanceof DatabaseError) {
    return true;
  }
  return (
    typeof error === "object" &&
    error !== null &&
    ("code" in error || "errno" in error)
  );
}
import type { TransactionContext, TransactionManager } from "./types.js";

/**
 * A TransactionManager whose units are savepoints inside an existing
 * transaction. This is how one bounded context's use case runs inside
 * another's transaction (an onboarding step committing a canonical company
 * write): the nested unit commits or rolls back with the outer one, a
 * failure inside it releases only its own savepoint, and no second
 * top-level transaction is ever opened from inside the first.
 */
export function createSavepointTransactionManager(
  outer: TransactionContext,
): TransactionManager {
  return {
    run: async (work) => {
      try {
        const { value } = await outer.sql.savepoint(async (inner) => ({
          value: await work({ sql: inner }),
        }));
        return value;
      } catch (error) {
        throw isDriverFailure(error) ? toDatabaseError(error) : error;
      }
    },
  };
}

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
        // Only driver failures are translated. An application error thrown
        // inside the boundary -- a validation failure, a business rule, a
        // deliberate abort -- is the caller's own: the rollback has already
        // happened and the error propagates unchanged, so callers can match
        // on their own types instead of unwrapping `cause`.
        throw isDriverFailure(error) ? toDatabaseError(error) : error;
      }
    },
  };
}
