#!/usr/bin/env node
/* global process, console, URL */
/**
 * Local embedding health and smoke (CQ-RAG-002 §49).
 *
 *   pnpm embedding:health          is the local runtime serving the model?
 *   pnpm rag:embedding:smoke       embed synthetic fixtures and rank them
 *
 * Talks only to the local embedding runtime configured by
 * Q_EMBEDDING_BASE_URL (default http://127.0.0.1:8080). No account, no API
 * key, no external service and no cost. Start the runtime with
 * `pnpm embedding:up`; the first start downloads the open-weight model.
 *
 * Build first: pnpm build --filter=@capital-q/q-embeddings...
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const entry = resolve(
  root,
  "packages",
  "q-embeddings",
  "dist",
  "dev",
  "smoke.js",
);
if (!existsSync(entry)) {
  console.error("Build first: pnpm build --filter=@capital-q/q-embeddings...");
  process.exit(2);
}

const env = { ...process.env };
env.NODE_ENV ??= "development";
env.CAPITAL_Q_ENV ??= "local";
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
