#!/usr/bin/env node
/* global process, console, URL */
/**
 * Public presence smoke (CQ-Q-PRESENCE-001): one real build through the
 * whole packet against the local database — the public web in parallel,
 * each page recorded as evidence, a model reading the excerpts, the
 * Knowledge Write Gate deciding what is held. Everything is created inside
 * one rolled-back transaction, so nothing is kept.
 *
 * It spends real search and model quota. Run it deliberately.
 *
 *   pnpm presence:smoke
 *   pnpm presence:smoke -- "Paystack" https://paystack.com
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const env = { ...process.env };
env.NODE_ENV ??= "development";
env.CAPITAL_Q_ENV = "local";
env.DATABASE_URL =
  process.env.CQ_SMOKE_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
console.log(`database: ${new URL(env.DATABASE_URL).host} (local stack)`);

const entry = resolve(
  root,
  "apps",
  "q-api",
  "dist",
  "dev",
  "presence-smoke-main.js",
);
if (!existsSync(entry)) {
  console.error("Build first: pnpm build --filter=@capital-q/q-api...");
  process.exit(2);
}
const devEnv = resolve(root, "scripts", "dev-env.mjs");
const result = spawnSync(
  process.execPath,
  ["--import", pathToFileURL(devEnv).href, entry, ...process.argv.slice(2)],
  {
    cwd: root,
    env,
    stdio: "inherit",
  },
);
process.exit(result.status ?? 1);
