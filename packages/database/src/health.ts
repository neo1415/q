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

/**
 * Readiness: the same claim, bounded in time. A pool that cannot get a
 * connection waits for its connect timeout (seconds), while a platform
 * health check gives up sooner, so a probe that never answers would read
 * as a hung process rather than a missing database. Past `timeoutMs` the
 * database counts as unreachable with failure TIMEOUT. The query itself is
 * not cancelled; it finishes or fails on its own.
 */
export async function checkDatabaseReadiness(
  sql: DatabaseExecutor,
  timeoutMs = 2_000,
): Promise<DatabaseHealth> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<DatabaseHealth>((resolve) => {
    timer = setTimeout(() => {
      resolve({ reachable: false, failure: "TIMEOUT" });
    }, timeoutMs);
  });
  try {
    return await Promise.race([checkDatabaseHealth(sql), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}
