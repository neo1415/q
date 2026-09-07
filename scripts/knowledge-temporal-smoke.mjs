#!/usr/bin/env node
/* global process, console, URL */
/**
 * Time and disagreement smoke (CQ-KNW-003 §60): a metric with a history, a
 * definition beside it, a correction and a conflict — against the local
 * database, read back through the permission-aware query service.
 *
 * Synthetic throughout. No provider, no cost, nothing survives the run.
 *
 *   pnpm knowledge:temporal:smoke
 */
/*
 * Runs against the LOCAL Supabase database only. No account, no API key, no
 * external service. Build first:
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
  "temporal.js",
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
