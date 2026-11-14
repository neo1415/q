#!/usr/bin/env node
/**
 * GateQ atomic statements backfill (design 2026-11-14, slice 3 §6).
 *
 *   node scripts/gateq-backfill-statements.mjs                 # dry run, every application
 *   node scripts/gateq-backfill-statements.mjs --application <uuid> [--application <uuid>]
 *   node scripts/gateq-backfill-statements.mjs --apply         # writes
 *
 * Carries every current legacy fact that no statement accounts for into a
 * BACKFILL statement (backfill key `legacy-fact:<factId>`, the same key and
 * deterministic id the write path's carry and every reader's view use), so
 * a second run writes nothing. One transaction per application, under its
 * row lock. SUBMITTED applications are skipped: their frozen dossier is
 * what the investor received and is never rewritten.
 *
 * Dry run unless --apply. Needs the privileged database credential of the
 * environment it runs in (DATABASE_PRIVILEGED_URL outside local); it is
 * never printed. Build first: pnpm exec turbo run build --filter=./packages/*
 *
 * The logic and its tests live in @capital-q/gateq-intake
 * (statement-backfill.ts, test/statement-backfill.test.ts); this file only
 * connects it to a database.
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
// The API's own dependency graph resolves the workspace packages.
const require = createRequire(resolve(root, "apps/api/package.json"));
const load = (name) => import(pathToFileURL(require.resolve(name)).href);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function parseArgs(argv) {
  const options = { apply: false, only: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") options.apply = true;
    else if (arg === "--dry-run") options.apply = false;
    else if (arg === "--application") {
      const id = argv[index + 1];
      if (id === undefined || !UUID.test(id))
        throw new Error("--application needs an application uuid");
      options.only.push(id.toLowerCase());
      index += 1;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const [{ loadDatabaseConfig }, { createPrivilegedDatabaseClient }, intake] =
    await Promise.all([
      load("@capital-q/config/database"),
      load("@capital-q/database/privileged"),
      load("@capital-q/gateq-intake"),
    ]);
  const database = createPrivilegedDatabaseClient(loadDatabaseConfig());
  try {
    const report = await intake.runStatementBackfill({
      store: intake.createPostgresStatementBackfillStore({
        sql: database.sql,
        transactions: database.transactions,
      }),
      apply: options.apply,
      ...(options.only.length === 0 ? {} : { only: options.only }),
      log: (line) => console.log(line),
    });
    const counts = {};
    for (const row of report.applications)
      counts[row.outcome] = (counts[row.outcome] ?? 0) + 1;
    console.log(
      JSON.stringify({
        mode: report.apply ? "APPLY" : "DRY_RUN",
        applications: report.applications.length,
        outcomes: counts,
        statementsPlanned: report.statementsPlanned,
        statementsWritten: report.statementsWritten,
      }),
    );
  } finally {
    await database.close();
  }
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
