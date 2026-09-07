#!/usr/bin/env node
/* global process, console, URL */
/**
 * Developer Q smoke (CQ-Q-006 §66-§67): real synthetic conversations through
 * the actual Q runtime — Context Firewall → Prompt Registry → Model Gateway
 * → provider — against the local database, printing Q's user-visible
 * answers and safe metadata only.
 *
 * Reads ONLY GEMINI_API_KEY and GROQ_API_KEY from `.env.local` (values never
 * printed) and runs apps/q-api's built dev entry against the LOCAL Supabase
 * database only (`pnpm db:start`); never a remote one. Override with
 * CQ_SMOKE_DATABASE_URL if the local stack listens elsewhere.
 *
 *   pnpm q:smoke                        all scenarios, default routing
 *   pnpm q:smoke -- --provider groq     route through one provider only
 *   pnpm q:smoke -- --message "..."     one ad-hoc synthetic message
 *   pnpm q:smoke -- --preset DIRECT     a communication preset
 *   pnpm q:smoke -- --scenario <id>     one named scenario
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
for (const name of ["GEMINI_API_KEY", "GROQ_API_KEY"]) {
  console.log(`${name}: ${env[name] === undefined ? "MISSING" : "PRESENT"}`);
}
env.NODE_ENV ??= "development";
env.CAPITAL_Q_ENV = "local";
// Synthetic rows are created and removed: local stack only, by construction.
env.DATABASE_URL =
  process.env.CQ_SMOKE_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
console.log(`database: ${new URL(env.DATABASE_URL).host} (local stack)`);

const entry = resolve(root, "apps", "q-api", "dist", "dev", "smoke.js");
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
