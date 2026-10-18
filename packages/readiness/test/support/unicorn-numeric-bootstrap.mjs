/** Fresh, localhost-only synthetic proof bootstrap. Never drops an existing DB.
 * Thin identity/billing/media parents are TEST FIXTURES, not full Supabase/RLS.
 * Apply real assessment and source-guard migrations, without pgTAP dependency.
 */
import assert from "node:assert/strict";
import console from "node:console";
import process from "node:process";
import { URL } from "node:url";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const url = new URL(
  process.env.CQ_UNICORN_NUMERIC_PROOF_DATABASE_URL ??
    "postgresql://agent@127.0.0.1:55439/cq_unicorn_numeric_proof",
);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/cq_unicorn_numeric_proof");
assert.equal(
  url.password,
  "",
  "Use an isolated local trust connection, never hosted credentials.",
);
const files = [
  new URL("./unicorn-numeric-thin-parents.sql", import.meta.url),
  new URL(
    "../../../../supabase/migrations/20261228200000_unicorn_potential.sql",
    import.meta.url,
  ),
  new URL(
    "../../../../supabase/migrations/20261228201500_unicorn_structured_source_guard.sql",
    import.meta.url,
  ),
];
const args = [
  "--host",
  url.hostname,
  "--port",
  url.port || "55439",
  "--username",
  url.username || "agent",
  "--dbname",
  "cq_unicorn_numeric_proof",
  "--no-psqlrc",
  "--set",
  "ON_ERROR_STOP=1",
  "--single-transaction",
];
const result = spawnSync(process.env.CQ_UNICORN_PROOF_PSQL ?? "psql", args, {
  input: files.map((file) => readFileSync(file, "utf8")).join("\n"),
  encoding: "utf8",
});
if (result.error) throw result.error;
assert.equal(result.status, 0, result.stderr);
console.log(
  "SYNTHETIC thin-parent bootstrap PASS; real assessment/source-guard migrations applied to dedicated localhost DB. Full Supabase/authserver verification remains separate.",
);
