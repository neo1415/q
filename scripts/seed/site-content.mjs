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
 * No provider is called. The database URL is read from the environment and
 * never printed.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const dist = (name) => join(root, "packages", name, "dist", "index.js");
const { importSiteMarkdown } = await import(dist("contracts"));

const directory = join(root, "content", "defaults");
const pages = readdirSync(directory)
  .filter((file) => file.endsWith(".md") && file !== "README.md")
  .sort()
  .map((file) =>
    importSiteMarkdown(readFileSync(join(directory, file), "utf8")),
  );

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
