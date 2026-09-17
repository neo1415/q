#!/usr/bin/env node
/* global console, process, URL */
/**
 * Apply the source-controlled migrations to the hosted Supabase project.
 *
 *   pnpm db:push              apply what is not yet applied
 *   pnpm db:push --dry-run    say what would be applied and stop
 *
 * Reads DATABASE_MIGRATION_URL from the shell or from .env.local: the
 * project's DIRECT connection string (Dashboard → Connect → Direct), with
 * the database password in it. The session and transaction poolers cannot
 * run migrations, and the CLI's `link` flow needs a personal access token
 * this script deliberately does not ask for. The URL is a secret: it is
 * handed to the CLI and never printed, and a value naming the local stack
 * is refused, because `supabase db reset` is how the local stack is
 * brought up to date.
 *
 * Every migration under supabase/migrations is immutable once applied here
 * (CLAUDE.md, Data rules): a fix is a new file, never an edit.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(
  new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);

function fileValue(key) {
  const file = resolve(root, ".env.local");
  if (!existsSync(file)) return undefined;
  const match = new RegExp(`^${key}=(.*)$`, "m").exec(
    readFileSync(file, "utf8"),
  );
  return match === null
    ? undefined
    : match[1].trim().replace(/^["']|["']$/g, "");
}

// DATABASE_MIGRATION_URL when it is set; otherwise DATABASE_URL, which on
// a hosted project is the session pooler and runs migrations just as well.
// (The direct host is IPv6-only and unreachable from many networks; the
// session pooler answers on IPv4. The transaction pooler cannot migrate.)
const url =
  process.env.DATABASE_MIGRATION_URL ??
  fileValue("DATABASE_MIGRATION_URL") ??
  process.env.DATABASE_URL ??
  fileValue("DATABASE_URL");
if (url === undefined || url.length === 0) {
  console.error(
    "[db:push] Neither DATABASE_MIGRATION_URL nor DATABASE_URL is set. Put the hosted project's session pooler connection string (with its password) in .env.local, then run this again.",
  );
  process.exit(1);
}
let host;
try {
  host = new URL(url).hostname;
} catch {
  console.error("[db:push] DATABASE_MIGRATION_URL is not a URL.");
  process.exit(1);
}
if (host === "127.0.0.1" || host === "localhost") {
  console.error(
    "[db:push] the connection string names the local stack; use `pnpm db:reset` for that.",
  );
  process.exit(1);
}
if (new URL(url).port === "6543") {
  console.error(
    "[db:push] that is the transaction pooler (port 6543), which cannot run migrations; use the session pooler (port 5432).",
  );
  process.exit(1);
}

// The CLI authenticates against the pooler only when TLS is asked for by
// name; without `sslmode=require` it reports a wrong password for a right
// one (seen 2026-09-17: the Node driver connected, the CLI did not).
const target = new URL(url);
if (!target.searchParams.has("sslmode")) {
  target.searchParams.set("sslmode", "require");
}

const dryRun = process.argv.includes("--dry-run");
console.log(
  `[db:push] ${dryRun ? "checking" : "applying"} migrations against …${host.slice(-24)}`,
);
const result = spawnSync(
  "supabase",
  [
    "db",
    "push",
    "--db-url",
    target.toString(),
    ...(dryRun ? ["--dry-run"] : []),
  ],
  { cwd: root, stdio: "inherit", shell: process.platform === "win32" },
);
process.exit(result.status ?? 1);
