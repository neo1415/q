#!/usr/bin/env node
/**
 * Imports content/defaults/*.md into the site content store (decision 107)
 * as version 1 of each page. Idempotent: a page whose slug already exists
 * is skipped, never overwritten, so it is safe to run again after admins
 * have edited anything. Non-legal pages are published as they are
 * imported; legal pages stay DRAFT_PENDING_LEGAL_REVIEW until an admin
 * confirms a lawyer's approval and publishes them in the console.
 *
 *   pnpm exec turbo run build --filter=./packages/*   # dist must be current
 *   CQ_SEED_DATABASE_URL=postgresql://... node scripts/seed/site-content.mjs [--dry-run]
 *
 * Without a Postgres connection (the cloud sandbox), the same seed goes
 * through the Supabase management SQL API, as site-content-sql.mjs builds
 * it. A dry run by default: it reads which slugs exist (read-only) and
 * prints the plan; --apply writes, in one transaction.
 *
 *   SUPABASE_ACCESS_TOKEN=... NODE_USE_ENV_PROXY=1 \
 *     node scripts/seed/site-content.mjs --via-management-api [--hold-pricing] [--apply]
 *
 * --hold-pricing imports the pricing page but leaves it a draft (billing
 * may not exist yet); an admin publishes it in the console later. It is
 * offered on the management API path only.
 *
 * No provider is called. The database URL and the token are read from the
 * environment and never printed.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = (name) => join(root, "packages", name, "dist", "index.js");
const { importSiteMarkdown, parseSiteBlocks } = await import(dist("contracts"));

const directory = join(root, "content", "defaults");
const pages = readdirSync(directory)
  .filter((file) => file.endsWith(".md") && file !== "README.md")
  .sort()
  .map((file) =>
    importSiteMarkdown(readFileSync(join(directory, file), "utf8")),
  );

/** The Supabase management SQL API, as scripts/seed/demo-figures.mjs uses it. */
async function managementQuery(text, readOnly) {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("SUPABASE_ACCESS_TOKEN is required");
  const response = await fetch(
    "https://api.supabase.com/v1/projects/vcohxiqsmnkzxnvawgri/database/query",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: text, read_only: readOnly }),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `sql: HTTP ${String(response.status)} ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  return body;
}

const HOLD = process.argv.includes("--hold-pricing") ? ["pricing"] : [];

if (process.argv.includes("--via-management-api")) {
  const { planSiteContent, renderSiteContentPlan, renderSiteContentSql } =
    await import("./site-content-sql.mjs");
  const checked = pages.map((page) => ({
    ...page,
    // The same validation the connection path applies before insert.
    blocks: parseSiteBlocks(page.blocks),
  }));
  const existing = await managementQuery(
    "select slug from site_content.pages",
    true,
  );
  const plan = planSiteContent(
    checked,
    existing.map((row) => row.slug),
    { hold: HOLD },
  );
  console.log(renderSiteContentPlan(plan));
  const sql = renderSiteContentSql(plan);
  if (!process.argv.includes("--apply")) {
    console.log(
      `\nDry run: nothing written (${String(Buffer.byteLength(sql ?? ""))} bytes of SQL planned). --apply writes.`,
    );
    process.exit(0);
  }
  if (sql === null) {
    console.log("\nNothing to write.");
    process.exit(0);
  }
  await managementQuery(sql, false);
  const after = await managementQuery(
    "select slug, status from site_content.pages order by slug",
    true,
  );
  console.log(`\nApplied. ${String(after.length)} pages now:`);
  for (const row of after)
    console.log(`  ${row.slug.padEnd(28)} ${row.status}`);
  process.exit(0);
}
if (HOLD.length > 0) {
  console.error(
    "site-content seed: --hold-pricing is offered with --via-management-api only.",
  );
  process.exit(2);
}

if (process.argv.includes("--dry-run")) {
  for (const page of pages) {
    console.log(
      `${page.slug.padEnd(28)} ${page.kind.padEnd(16)} ${page.status.padEnd(27)} ${String(page.blocks.length)} blocks`,
    );
  }
  process.exit(0);
}

const url = process.env.CQ_SEED_DATABASE_URL ?? process.env.DATABASE_URL;
if (url === undefined || url === "") {
  console.error(
    "site-content seed: set CQ_SEED_DATABASE_URL (or DATABASE_URL).",
  );
  process.exit(2);
}
const { createRequestDatabaseClient } = await import(dist("database"));
const { parseDatabaseConfig } = await import(
  join(root, "packages", "config", "dist", "database.js")
);
const { seedSiteContent } = await import(dist("platform-admin"));

const db = createRequestDatabaseClient(
  parseDatabaseConfig({
    NODE_ENV: "production",
    CAPITAL_Q_ENV: process.env.CAPITAL_Q_ENV ?? "local",
    DATABASE_URL: url,
    DATABASE_POOL_MAX: "2",
    DATABASE_CONNECT_TIMEOUT_SECONDS: "10",
  }),
);
try {
  const outcome = await seedSiteContent(db.transactions, pages);
  console.log(
    `site-content seed: ${String(outcome.created.length)} created, ${String(outcome.skipped.length)} already present, ${String(outcome.published.length)} published`,
  );
  for (const slug of outcome.created) {
    console.log(
      `  + ${slug}${outcome.published.includes(slug) ? " (published)" : " (draft)"}`,
    );
  }
} finally {
  await db.close();
}
