#!/usr/bin/env node
/* global process, console, URL */
/**
 * Developer Q stream smoke (CQ-Q-009 §88-§90): a synthetic Q run driven
 * over real HTTP against a local q-api composition — create the run,
 * subscribe to `GET /v1/q/runs/:runId/events`, watch stages and text
 * arrive, disconnect on purpose, reconnect with Last-Event-ID, see the
 * replay, and converge on the persisted final message.
 *
 * Reads ONLY GEMINI_API_KEY and GROQ_API_KEY from `.env.local` (values never
 * printed) and runs apps/q-api's built dev entry against the LOCAL Supabase
 * database only (`pnpm db:start`); never a remote one.
 *
 *   pnpm q:stream-smoke                    real model when a key is present
 *   pnpm q:stream-smoke -- --synthetic     no model: the synthetic streaming answer
 *   pnpm q:stream-smoke -- --approval      the approval flow (test action, synthetic)
 *   pnpm q:stream-smoke -- --verbose       event ids and types alongside
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAMES = ["GEMINI_API_KEY", "GROQ_API_KEY"];
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const envFile = resolve(root, ".env.local");
const env = { ...process.env };

if (existsSync(envFile)) {
  const lines = readFileSync(envFile, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (
      match === null ||
      !NAMES.includes(match[1]) ||
      env[match[1]] !== undefined
    ) {
      continue;
    }
    let value = match[2];
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted) {
      value = value.slice(1, -1);
    }
    if (value.length > 0) {
      env[match[1]] = value;
    }
  }
}
for (const name of NAMES) {
  console.log(`${name}: ${env[name] === undefined ? "MISSING" : "PRESENT"}`);
}
env.NODE_ENV ??= "development";
env.CAPITAL_Q_ENV = "local";
env.DATABASE_URL =
  process.env.CQ_SMOKE_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
console.log(`database: ${new URL(env.DATABASE_URL).host} (local stack)`);

const entry = resolve(root, "apps", "q-api", "dist", "dev", "stream-smoke.js");
if (!existsSync(entry)) {
  console.error("Build first: pnpm build --filter=@capital-q/q-api...");
  process.exit(2);
}
const result = spawnSync(process.execPath, [entry, ...process.argv.slice(2)], {
  cwd: root,
  env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
