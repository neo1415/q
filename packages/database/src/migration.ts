import {
  resolveDatabaseUrl,
  type DatabaseConfig,
} from "@capital-q/config/database";

import { createPostgresClient } from "./internal/postgres.js";
import { createTransactionManager } from "./transaction.js";
import type { MigrationDatabase } from "./types.js";

/**
 * Schema-administration access, for tooling.
 *
 * Reached only through `@capital-q/database/migration`, which lint keeps out of
 * every deployable. Supabase CLI migrations remain the authoritative schema
 * history -- this client exists for future tooling that must inspect or verify
 * schema, not to become a second migration runner.
 *
 * Migration work legitimately runs longer than an interactive request, which
 * is one more reason it is a separate class rather than a request client with
 * a bigger timeout.
 */
export function createMigrationDatabaseClient(
  config: DatabaseConfig,
): MigrationDatabase {
  const sql = createPostgresClient(
    resolveDatabaseUrl(config, "MIGRATION"),
    config,
    "MIGRATION",
  );

  return {
    accessClass: "MIGRATION",
    sql,
    transactions: createTransactionManager(sql),
    close: () => sql.end(),
  };
}
