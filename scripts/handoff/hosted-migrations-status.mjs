#!/usr/bin/env node
/**
 * Read-only: which source-controlled migrations the HOSTED Supabase project
 * has not applied yet (and any it has that the repo does not know).
 *
 *   DATABASE_URL=<hosted session pooler URL> node scripts/handoff/hosted-migrations-status.mjs
 *
 * DATABASE_URL comes from the environment only (a cloud secret); it is never
 * read from a file and never printed. A URL that is not the hosted pooler is
 * refused so this cannot be pointed at the wrong database by accident.
 * Applying migrations is a separate, founder-approved step:
 *   supabase db push --db-url "$DATABASE_MIGRATION_URL" --dry-run   (then without --dry-run)
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const root = resolve(
  new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
);
const require = createRequire(resolve(root, "packages/database/package.json"));
const pg = require("pg");

// The Supabase pooler certificate chains to Supabase's own root CA, which is
// not in Node's default store. Set PGSSLROOTCERT to the CA file downloaded
// from the dashboard (Database settings, SSL) to verify it; without it the
// connection is still encrypted but the server is not authenticated, which
// is acceptable only for this read-only status check.
function sslOptions() {
  const ca = process.env.PGSSLROOTCERT;
  return ca ? { ca: readFileSync(ca, "utf8") } : { rejectUnauthorized: false };
}

const url = process.env.DATABASE_URL?.trim();
if (!url || !url.includes("pooler.supabase.com")) {
  console.error("DATABASE_URL must be set to the hosted Supabase pooler URL.");
  process.exit(2);
}

const client = new pg.Client({
  connectionString: url,
  ssl: sslOptions(),
});
await client.connect();
await client.query("begin read only");
const { rows } = await client.query(
  "select version from supabase_migrations.schema_migrations order by version",
);
await client.query("rollback");
await client.end();

const applied = new Set(rows.map((r) => r.version));
const local = readdirSync(resolve(root, "supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.split("_")[0]);
const missing = local.filter((v) => !applied.has(v));
const extra = [...applied].filter((v) => !local.includes(v));
console.log(`hosted applied: ${applied.size}, local: ${local.length}`);
console.log("missing on hosted:", missing.join(" ") || "none");
console.log("on hosted but not local:", extra.join(" ") || "none");
process.exit(missing.length === 0 ? 0 : 1);
