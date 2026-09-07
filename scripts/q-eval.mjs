#!/usr/bin/env node
/* global process, console, URL */
/**
 * Q eval harness entry (CQ-Q-010 §135).
 *
 *   pnpm q:eval:lint                    dataset QA only
 *   pnpm q:eval:fast                    LOCAL_FAST: scripted model, local database, no spend
 *   pnpm q:eval:ci                      CI_CORE: every dataset, scripted model, no credentials
 *   pnpm q:eval:live -- [--provider google|groq] [--case A,B] [--show-answers]
 *                                       LIVE_MODEL: explicit opt-in through the real gateway
 *
 * Reads ONLY GEMINI_API_KEY and GROQ_API_KEY from `.env.local` (values never
 * printed) for the live profile, and runs against the LOCAL Supabase
 * database only (`pnpm db:start`); never a remote one. Reports are written
 * under artifacts/q-evals (git-ignored); baselines live in
 * packages/q-evals/baselines and change only with --update-baseline.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAMES = ["GEMINI_API_KEY", "GROQ_API_KEY"];
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const envFile = resolve(root, ".env.local");
const env = { ...process.env };
const args = process.argv.slice(2).filter((a) => a !== "--");
const live = args.includes("LIVE_MODEL");

if (live && existsSync(envFile)) {
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
if (!live) {
  // The deterministic profiles never see a key, whatever the shell holds.
  for (const name of NAMES) {
    delete env[name];
  }
}
env.NODE_ENV ??= "test";
env.CAPITAL_Q_ENV = "local";
env.DATABASE_URL =
  process.env.CQ_EVAL_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
console.log(`database: ${new URL(env.DATABASE_URL).host} (local stack)`);

const entry = resolve(root, "packages", "q-evals", "dist", "cli.js");
if (!existsSync(entry)) {
  console.error("Build first: pnpm build --filter=@capital-q/q-evals...");
  process.exit(2);
}
const result = spawnSync(process.execPath, [entry, ...args], {
  cwd: root,
  env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
