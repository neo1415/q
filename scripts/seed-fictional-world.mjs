#!/usr/bin/env node
/**
 * Seed the fictional demo world (SEED): twelve invented companies with
 * stories, evidence and pitch decks, eight invented investors with
 * mandates, and the interest between them.
 *
 *   CQ_SEED_API_URL=http://127.0.0.1:3001 pnpm seed:fictional -- --local-stack
 *
 * Needs a running api (and workers, for verification and relationship
 * projections) against the same database. Build first:
 *   pnpm turbo run build --filter=@capital-q/q-api...
 *
 * Target: only explicit variables. `--local-stack` fills CQ_SEED_SUPABASE_*
 * and CQ_SEED_DATABASE_URL from `supabase status` (loopback only);
 * otherwise set CQ_SEED_SUPABASE_URL, CQ_SEED_SUPABASE_PUBLISHABLE_KEY,
 * CQ_SEED_SUPABASE_SECRET_KEY, CQ_SEED_DATABASE_URL and CQ_SEED_API_URL
 * yourself. Anything that is not loopback is refused unless --hosted is
 * passed.
 *
 * Hosted (the synthetic staging project only; the operator runs it):
 *   CQ_SEED_SUPABASE_URL=https://<ref>.supabase.co
 *   CQ_SEED_SUPABASE_PUBLISHABLE_KEY=...  CQ_SEED_SUPABASE_SECRET_KEY=...
 *   CQ_SEED_DATABASE_URL=<pooler url, sslmode=require>
 *   CQ_SEED_API_URL=https://<hosted api>
 *   CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF=<ref>
 *   CAPITAL_Q_SYNTHETIC_DEMO_ATTESTED=true
 *   CQ_SEED_ACCOUNT_PASSWORD=<12+ chars, for the demo accounts>
 *   pnpm seed:fictional -- --hosted
 * --hosted refuses unless the Supabase URL and the database URL are both
 * the project CAPITAL_Q_SYNTHETIC_SUPABASE_PROJECT_REF attests.
 *
 * R43 (TEMPORARY until BIZ-006 /ops): with that attestation the seed itself
 * decides its synthetic founders' verification requests through the
 * product's own synthetic decider, because hosted workers cannot hold the
 * attestation. Without it, requests stay PENDING. See
 * apps/q-api/src/dev/fictional-world/auto-verify.ts.
 *
 * Budget: the seed never calls a model. Every provider key in the child
 * process is still set to a NON-EMPTY disabled value, because an empty one
 * lets a .env.local fill in a real key. Values are never printed.
 *
 * Idempotent and additive; `--out <dir>` (default .tmp/fictional-world)
 * receives manifest.json and each deck as PDF and PPTX.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const entry = resolve(
  root,
  "apps",
  "q-api",
  "dist",
  "dev",
  "fictional-world",
  "seed.js",
);
if (!existsSync(entry)) {
  console.error(
    "Build first: pnpm turbo run build --filter=@capital-q/q-api...",
  );
  process.exit(2);
}

const args = process.argv.slice(2).filter((a) => a !== "--");
const env = { ...process.env };

if (args.includes("--local-stack")) {
  const status = spawnSync("npx", ["supabase", "status", "-o", "env"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  const stack = {};
  for (const line of String(status.stdout ?? "").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) stack[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  if (!stack.API_URL || !stack.DB_URL) {
    console.error("seed: could not read the local stack (supabase status)");
    process.exit(2);
  }
  env.CQ_SEED_SUPABASE_URL = stack.API_URL;
  env.CQ_SEED_SUPABASE_PUBLISHABLE_KEY = stack.PUBLISHABLE_KEY;
  env.CQ_SEED_SUPABASE_SECRET_KEY = stack.SECRET_KEY;
  env.CQ_SEED_DATABASE_URL = stack.DB_URL;
}

const DISABLED = "disabled-locally-000000000000";
for (const name of [
  "OPENAI_API_KEY",
  "OPEN_AI_API_KEY",
  "GEMINI_API_KEY",
  "GEMINI_API_KEY2",
  "GEMINI_API_KEY_2",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GROQ_API_KEY",
  "GROQ_API_KEY_2",
  "GROQ_API_KEY_3",
  "GROQ_API_KEY_4",
  "DEEPSEEK_API_KEY",
  "QWEN_API_KEY",
  "DASHSCOPE_API_KEY",
  "ANTHROPIC_API_KEY",
  "ELEVENLABS_API_KEY",
  "DEEPGRAM_API_KEY",
  "TAVILY_API_KEY",
  "BRIGHT_DATA_API_KEY",
  "SERP_API_KEY",
]) {
  env[name] = DISABLED;
}
env.NODE_ENV ??= "development";

const result = spawnSync(
  process.execPath,
  [entry, ...args.filter((a) => a !== "--local-stack")],
  { cwd: root, env, stdio: "inherit" },
);
process.exit(result.status ?? 1);
