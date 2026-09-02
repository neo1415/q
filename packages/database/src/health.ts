import { toDatabaseError } from "./errors.js";
import type { DatabaseExecutor } from "./types.js";

export type DatabaseHealth =
  | { readonly reachable: true }
  | { readonly reachable: false; readonly failure: string };

/**
 * Can the database answer a trivial query?
 *
 * That is the whole claim. Reachability says nothing about tenant isolation,
 * row-level security or business authorization, and this result carries no
 * version, schema or host detail that a public health endpoint could leak.
 */
export async function checkDatabaseHealth(
  sql: DatabaseExecutor,
): Promise<DatabaseHealth> {
  try {
    await sql`select 1`;
    return { reachable: true };
  } catch (error) {
    return { reachable: false, failure: toDatabaseError(error).kind };
  }
}
