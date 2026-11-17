import type { Sql } from "postgres";

import { DatabaseError, toDatabaseError } from "./errors.js";

/**
 * Postgres.js and socket errors carry a `code`: a SQLSTATE ("23505"), a
 * Node errno ("ECONNRESET") or a driver code ("CONNECTION_CLOSED"), always
 * upper case. An application error may carry its own lower-case code
 * ("onboarding_context_required"): it is the caller's, and propagates
 * unchanged. Live 2026-10-28: an investor's website answer, held until the
 * firm exists, was wrapped as an UNEXPECTED database failure and answered
 * 500 seven times, so the held queue read it as the service being down
 * and nothing behind it was saved.
 */
function isDriverFailure(error: unknown): boolean {
  if (error instanceof DatabaseError) {
    return true;
  }
  if (typeof error !== "object" || error === null) return false;
  if ("errno" in error) return true;
  if (!("code" in error)) return false;
  const code: unknown = error.code;
  return typeof code !== "string" || /^[0-9A-Z_]+$/u.test(code);
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
export type TransactionLimits = {
  readonly statementTimeoutMs: number;
  readonly lockTimeoutMs: number;
};

export function createTransactionManager(
  sql: Sql,
  options: {
    /**
     * Applied with SET LOCAL semantics at the start of every transaction
     * (behind a pooler, where startup parameters are dropped). Scoped to
     * the transaction, so safe under transaction pooling. Absent: none.
     */
    readonly limits?: TransactionLimits | undefined;
  } = {},
): TransactionManager {
  const limits = options.limits;
  return {
    run: async (work) => {
      try {
        // The driver unwraps an array-of-promises result; boxing the value
        // keeps `run` honest about returning exactly what `work` returned.
        const { value } = await sql.begin(async (transactionSql) => {
          // Sent ahead of the work's first statement on the same
          // connection, in order, without waiting for it: no extra round
          // trip before the work starts (pipelining inside a transaction
          // is safe behind the pooler: it keeps the server connection
          // until COMMIT). Its own failure still fails the unit (the
          // work's statements then fail as aborted too).
          const applied =
            limits === undefined
              ? undefined
              : transactionSql`
                  select set_config('statement_timeout', ${String(limits.statementTimeoutMs)}, true),
                         set_config('lock_timeout', ${String(limits.lockTimeoutMs)}, true)`.then(
                  () => undefined,
                );
          // Handled at once so an early failure is never an unhandled
          // rejection; still awaited below, where it propagates.
          void applied?.catch(() => undefined);
          const context: TransactionContext = { sql: transactionSql };
          let result: Awaited<ReturnType<typeof work>>;
          try {
            result = await work(context);
          } catch (error) {
            await applied?.catch(() => undefined);
            throw error;
          }
          await applied;
          return { value: result };
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
