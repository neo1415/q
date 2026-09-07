#!/usr/bin/env node
/* global process, console, URL */
/**
 * Chunk rebuild / inspection for one document version (CQ-RAG-001 §76).
 *
 *   pnpm rag:rebuild-chunks -- --tenant <id> --document-version <id> [--chunking-version v] [--list]
 *
 * Reads ONLY SUPABASE_URL and SUPABASE_SECRET_KEY from `.env.local` (values
 * never printed) for the private storage read, and runs against the LOCAL
 * database only. Build first: pnpm build --filter=@capital-q/workers...
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAMES = ["SUPABASE_URL", "SUPABASE_SECRET_KEY"];
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const envFile = resolve(root, ".env.local");
const env = { ...process.env };
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (
      match === null ||
      !NAMES.includes(match[1]) ||
      env[match[1]] !== undefined
    )
      continue;
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value.length > 0) env[match[1]] = value;
  }
}
env.NODE_ENV ??= "development";
env.CAPITAL_Q_ENV = "local";
env.DATABASE_URL =
  process.env.CQ_RAG_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
console.log(`database: ${new URL(env.DATABASE_URL).host} (local stack)`);
for (const name of NAMES) {
  console.log(`${name}: ${env[name] === undefined ? "MISSING" : "PRESENT"}`);
}

const entry = resolve(
  root,
  "apps",
  "workers",
  "dist",
  "dev",
  "rebuild-chunks.js",
);
if (!existsSync(entry)) {
  console.error("Build first: pnpm build --filter=@capital-q/workers...");
  process.exit(2);
}
const args = process.argv.slice(2).filter((a) => a !== "--");
const result = spawnSync(process.execPath, [entry, ...args], {
  cwd: root,
  env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
