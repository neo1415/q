#!/usr/bin/env node
/* global process, console, URL */
/**
 * Knowledge Write Gate smoke (CQ-KNW-002 §49): claim and evidence in,
 * candidate through the deterministic gate, knowledge object out, read back
 * through the permission-aware query service — against the local database.
 *
 * Synthetic throughout. No provider, no cost, nothing survives the run.
 *
 *   pnpm knowledge:write:smoke
 */
/**
 * Authorised retrieval developer commands (CQ-RAG-004 §120).
 *
 *   pnpm rag:retrieval:smoke -- [--fake]
 *   pnpm rag:retrieval:eval  -- [--fake]
 *
 * Runs against the LOCAL Supabase database only, and against the local
 * embedding runtime configured by Q_EMBEDDING_BASE_URL. No account, no API
 * key, no external service. `--fake` swaps in the deterministic provider so
 * the storage and search path can be exercised without the model running.
 *
 * Both seed a synthetic tenant inside a transaction and roll it back, so they
 * leave nothing behind. Build first:
 *   pnpm build --filter=@capital-q/q-knowledge...
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const entry = resolve(
  root,
  "packages",
  "q-knowledge",
  "dist",
  "dev",
  "knowledge.js",
);
if (!existsSync(entry)) {
  console.error("Build first: pnpm build --filter=@capital-q/q-knowledge...");
  process.exit(2);
}

const env = { ...process.env };
env.NODE_ENV ??= "development";
env.CAPITAL_Q_ENV = "local";
env.DATABASE_URL =
  process.env.CQ_RAG_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
console.log(`database: ${new URL(env.DATABASE_URL).host} (local stack)`);

const args = process.argv.slice(2).filter((a) => a !== "--");
const result = spawnSync(process.execPath, [entry, ...args], {
  cwd: root,
  env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
