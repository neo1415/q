import { execFileSync } from "node:child_process";

/**
 * Test setup against the LOCAL Supabase database only, through the local
 * container's psql (supabase_db_capital-q). Used for conditions a person
 * cannot cause in seconds, such as an approval reaching its expiry. Never a
 * hosted database: there is no connection string here at all.
 */
const CONTAINER =
  process.env["CQ_RECOVERY_DB_CONTAINER"] ?? "supabase_db_capital-q";

export function localSql(sql: string): string {
  if (!/^supabase_db_/u.test(CONTAINER))
    throw new Error("local database container only");
  return execFileSync(
    "docker",
    [
      "exec",
      CONTAINER,
      "psql",
      "-U",
      "postgres",
      "-tA",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    {
      encoding: "utf8",
    },
  ).trim();
}

/** Moves an approval's expiry into the past (the 24 h TTL, audit D-01). */
export function expireApproval(approvalId: string): void {
  if (!/^[0-9a-f-]{36}$/u.test(approvalId))
    throw new Error("not an approval id");
  localSql(
    // expires_at > requested_at is a constraint, so the request moves back too.
    `update q_runtime.approvals set requested_at = now() - interval '25 hours', expires_at = now() - interval '1 minute' where id = '${approvalId}'`,
  );
}

/** Runs scripts/recovery/local-stack.sh (stop/start a service mid-test). */
export function stack(command: "start" | "stop", service: string): void {
  execFileSync("bash", ["scripts/recovery/local-stack.sh", command, service], {
    cwd: new URL("../../..", import.meta.url).pathname,
    stdio: "ignore",
  });
}
