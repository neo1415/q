#!/usr/bin/env node
/* global process, console, URL */
/**
 * Extraction + chunking smoke (CQ-RAG-001 §77).
 *
 *   pnpm rag:extract-smoke -- --builtin deck|report|model|customers|notes|memo
 *   pnpm rag:extract-smoke -- ./some/synthetic/file.xlsx [--show-text]
 *
 * Runs the compiled worker's parser sandbox and the chunker on one file and
 * prints a safe summary. Needs no database, no storage credential and no
 * model key; the environment handed to the parser child is scrubbed by the
 * sandbox itself. Build first: pnpm build --filter=@capital-q/workers...
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const entry = resolve(
  root,
  "apps",
  "workers",
  "dist",
  "dev",
  "extract-smoke.js",
);
if (!existsSync(entry)) {
  console.error("Build first: pnpm build --filter=@capital-q/workers...");
  process.exit(2);
}
const args = process.argv.slice(2).filter((a) => a !== "--");
const result = spawnSync(process.execPath, [entry, ...args], {
  cwd: root,
  env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? "development" },
  stdio: "inherit",
});
process.exit(result.status ?? 1);
