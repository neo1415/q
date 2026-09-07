#!/usr/bin/env node
/* global process, console, URL */
/**
 * Vector store developer commands (CQ-RAG-003 §78-§79).
 *
 *   pnpm rag:embed:backfill -- [--tenant <id>] [--limit 50] [--fake]
 *   pnpm rag:semantic:smoke -- [--k 5] [--rows 2000] [--fake]
 *
 * Runs against the LOCAL Supabase database only, and against the local
 * embedding runtime configured by Q_EMBEDDING_BASE_URL. No account, no API
 * key, no external service. `--fake` swaps in the deterministic provider so
 * the storage and search path can be exercised without the model running.
 *
 * The smoke seeds a synthetic tenant inside a transaction and rolls it back,
 * so it leaves nothing behind. Build first:
 *   pnpm build --filter=@capital-q/q-knowledge...
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const entry = resolve(root, "packages", "q-knowledge", "dist", "dev", "rag.js");
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
console.log(
  `embedding runtime: ${env.Q_EMBEDDING_BASE_URL ?? "http://127.0.0.1:8080"} (local, no credential)`,
);

const args = process.argv.slice(2).filter((a) => a !== "--");
const result = spawnSync(process.execPath, [entry, ...args], {
  cwd: root,
  env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
