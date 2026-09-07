#!/usr/bin/env node
/* global process, console, URL */
/**
 * Company Intelligence smoke (CQ-Q-020 §111, §112): four turns of one
 * conversation about a synthetic company, through the real Q path — the
 * orchestrator, the Context Firewall, the Safe Read tools, authorised Q
 * Knowledge, authorised hybrid retrieval, the Model Gateway and the
 * Company Intelligence specialist.
 *
 *   pnpm q:company-intelligence:smoke          scripted provider, no spend
 *   pnpm q:company-intelligence:smoke --live   the real gateway, existing keys
 *
 * Synthetic throughout. No new account, no new key, no external service.
 * Nothing survives the run. The default costs nothing; --live spends on the
 * providers already configured and is never what CI runs.
 */
/*
 * Runs against the LOCAL Supabase database only. Build first:
 *   pnpm build --filter=@capital-q/q-evals...
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const entry = resolve(
  root,
  "packages",
  "q-evals",
  "dist",
  "dev",
  "company-intelligence.js",
);
if (!existsSync(entry)) {
  console.error("Build first: pnpm build --filter=@capital-q/q-evals...");
  process.exit(2);
}

const args = process.argv.slice(2).filter((a) => a !== "--");
const live = args.includes("--live");

const env = { ...process.env };
env.NODE_ENV ??= "development";
env.CAPITAL_Q_ENV = "local";
env.DATABASE_URL =
  process.env.CQ_EVAL_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
console.log(`database: ${new URL(env.DATABASE_URL).host} (local stack)`);
if (live) {
  // Presence only. A key's VALUE is never printed, logged or written.
  const configured = ["GEMINI_API_KEY", "GROQ_API_KEY"].filter(
    (name) => (process.env[name] ?? "").length > 0,
  );
  if (configured.length === 0) {
    console.error(
      "--live needs an existing provider key in the environment; none is configured. Run without --live.",
    );
    process.exit(3);
  }
  console.log(`live providers configured: ${configured.join(", ")}`);
}

const result = spawnSync(process.execPath, [entry, ...args], {
  cwd: root,
  env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
