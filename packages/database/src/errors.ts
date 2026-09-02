/**
 * The small set of failure classes an application boundary needs to tell
 * apart. Deliberately not one class per SQLSTATE, and deliberately carrying no
 * HTTP meaning: whether a unique violation is "already exists", "duplicate
 * idempotency key" or "invariant violated" depends on the domain, and the
 * domain decides.
 */
export const DATABASE_FAILURE_KINDS = [
  "CONNECTION",
  "TIMEOUT",
  "CONSTRAINT",
  "RETRYABLE",
  "UNEXPECTED",
] as const;

export type DatabaseFailureKind = (typeof DATABASE_FAILURE_KINDS)[number];

/**
 * A database failure with its credential and query text stripped.
 *
 * Postgres driver errors can carry the connection string, the failing SQL and
 * bound parameters. None of that may reach a log, an error tracker or a client,
 * so this wrapper keeps only the classification, the SQLSTATE and, where
 * present, the constraint name -- enough for the domain to translate, nothing
 * that leaks.
 */
export class DatabaseError extends Error {
  readonly kind: DatabaseFailureKind;
  readonly sqlState: string | undefined;
  readonly constraintName: string | undefined;

  constructor(
    kind: DatabaseFailureKind,
    options: {
      readonly sqlState?: string | undefined;
      readonly constraintName?: string | undefined;
      readonly cause?: unknown;
    } = {},
  ) {
    super(`Database operation failed (${kind}).`, { cause: options.cause });
    this.name = "DatabaseError";
    this.kind = kind;
    this.sqlState = options.sqlState;
    this.constraintName = options.constraintName;
  }
}

type DriverErrorShape = {
  readonly code?: unknown;
  readonly constraint_name?: unknown;
  readonly errno?: unknown;
};

const RETRYABLE_SQLSTATES: ReadonlySet<string> = new Set([
  "40001", // serialization_failure
  "40P01", // deadlock_detected
]);

/**
 * Classify a thrown driver error. Never rethrows the original message: a
 * Postgres.js error message can embed the SQL that failed.
 */
export function toDatabaseError(error: unknown): DatabaseError {
  if (error instanceof DatabaseError) {
    return error;
  }

  const shape: DriverErrorShape =
    typeof error === "object" && error !== null ? error : {};
  const sqlState = typeof shape.code === "string" ? shape.code : undefined;
  const constraintName =
    typeof shape.constraint_name === "string"
      ? shape.constraint_name
      : undefined;

  if (sqlState === undefined) {
    // Socket-level failures surface as Node errno codes, not SQLSTATEs.
    return new DatabaseError(
      typeof shape.errno === "number" || error instanceof Error
        ? "CONNECTION"
        : "UNEXPECTED",
      { cause: error },
    );
  }

  if (sqlState === "57014") {
    return new DatabaseError("TIMEOUT", { sqlState, cause: error });
  }

  if (RETRYABLE_SQLSTATES.has(sqlState)) {
    return new DatabaseError("RETRYABLE", { sqlState, cause: error });
  }

  if (sqlState.startsWith("23")) {
    return new DatabaseError("CONSTRAINT", {
      sqlState,
      constraintName,
      cause: error,
    });
  }

  if (sqlState.startsWith("08") || sqlState === "ECONNREFUSED") {
    return new DatabaseError("CONNECTION", { sqlState, cause: error });
  }

  return new DatabaseError("UNEXPECTED", { sqlState, cause: error });
}
