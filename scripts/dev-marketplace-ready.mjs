#!/usr/bin/env node
/* global process, console, URL */
/**
 * Make the local dev founder's company marketplace-ready through the real
 * readiness assessment, with a SYNTHETIC verification seam (CQ-MKT-001 §12).
 *
 *   pnpm dev:marketplace-ready [-- --company <uuid>]
 *
 * LOCAL Supabase only. The synthetic seam refuses any non-loopback database
 * and any CAPITAL_Q_ENV other than local/test before connecting, and every
 * readiness transition it produces is audited with
 * verificationSource = SYNTHETIC_LOCAL_FIXTURE. This is a developer fixture,
 * not a verification capability, and nothing here is reachable from a
 * browser or the API. Build the companies package first.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const entry = resolve(
  root,
  "packages",
  "companies",
  "dist",
  "dev",
  "marketplace-ready.js",
);
if (!existsSync(entry)) {
  console.error("Build first: pnpm build --filter=@capital-q/companies...");
  process.exit(2);
}

const env = { ...process.env };
env.NODE_ENV ??= "development";
env.CAPITAL_Q_ENV = "local";
env.DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
console.log(`database: ${new URL(env.DATABASE_URL).host} (local stack only)`);

const args = process.argv.slice(2).filter((a) => a !== "--");
const result = spawnSync(process.execPath, [entry, ...args], {
  cwd: root,
  env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
