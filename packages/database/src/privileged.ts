import {
  resolveDatabaseUrl,
  type DatabaseConfig,
} from "@capital-q/config/database";

import { createPostgresClient } from "./internal/postgres.js";
import { createTransactionManager } from "./transaction.js";
import type { PrivilegedDatabase } from "./types.js";

/**
 * Elevated database access for a narrowly scoped server process.
 *
 * Reached only through `@capital-q/database/privileged`, so every import site
 * says what it is asking for. The name is deliberate: this is a
 * security-sensitive path, and a reviewer should be able to find every use of
 * it by searching for the word.
 *
 * Elevated at the database is not authorised at the application. Bypassing
 * row-level security removes a defence-in-depth layer; it does not remove the
 * obligation to run ActorContext, AuthorizationService and tenant-ownership
 * checks. There is no `if (privileged) return ALLOW` anywhere, and there must
 * never be.
 *
 * Outside local and test environments this requires DATABASE_PRIVILEGED_URL
 * and fails at creation without it. It never falls back to the request
 * credential in a deployed environment.
 */
export function createPrivilegedDatabaseClient(
  config: DatabaseConfig,
): PrivilegedDatabase {
  const sql = createPostgresClient(
    resolveDatabaseUrl(config, "PRIVILEGED_SERVICE"),
    config,
    "PRIVILEGED_SERVICE",
  );

  return {
    accessClass: "PRIVILEGED_SERVICE",
    sql,
    transactions: createTransactionManager(sql),
    close: () => sql.end(),
  };
}
