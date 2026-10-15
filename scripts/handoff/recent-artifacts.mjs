#!/usr/bin/env node
/**
 * Read-only: the most recent Q artifacts on the HOSTED staging database
 * (id, type, status, time only; never content). Used to confirm on the
 * deployed stack that a "make me a PDF/deck" turn really produced an
 * artifact (R1).
 *
 *   DATABASE_URL=<hosted session pooler URL> node scripts/handoff/recent-artifacts.mjs [limit]
 *
 * DATABASE_URL comes from the environment only and is never printed. The
 * whole session runs inside a READ ONLY transaction.
 */
import { readFileSync } from "node:fs";
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
const limit = Math.min(Math.max(Number(process.argv[2] ?? 5) || 5, 1), 50);

const c = new pg.Client({
  connectionString: url,
  ssl: sslOptions(),
});
await c.connect();
await c.query("begin read only");
const r = await c.query(
  "select * from artifacts.artifacts order by created_at desc limit $1",
  [limit],
);
for (const row of r.rows) {
  console.log(
    JSON.stringify({
      id: row.id,
      type: row.artifact_type ?? row.type,
      status: row.status,
      created_at: row.created_at,
      run: row.run_id ?? row.source_run_id,
    }),
  );
}
await c.query("rollback");
await c.end();
