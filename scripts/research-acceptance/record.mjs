#!/usr/bin/env node
// Records the research acceptance gate's golden cases (owner 2026-10-29):
// each case runs ONCE through the real deep-research step and report
// assembly, in-process, with the case's SYNTHETIC situation dossier, the
// real search providers (Serper/SerpApi + Brave, page reads) and the real
// OpenAI model through the Model Gateway. No production private data is
// read: only the provider keys (from the q-api service's Railway
// variables, never printed) and the model catalog (reference data).
//
// Writes apps/q-api/test/research-acceptance/fixtures/<id>.{web,models}.json
// and prints each case's code-checked verdicts. Search credits are spent
// once (DECISIONS 43): a recorded case is skipped unless --force.
//
//   node scripts/research-acceptance/record.mjs --dry-run
//   NODE_USE_ENV_PROXY=1 node scripts/research-acceptance/record.mjs [--case A-...] [--force]
//
// After recording: review the fixtures (public pages and synthetic context
// only), run `pnpm exec vitest run apps/q-api/test/research-acceptance`,
// and commit the fixtures with the case.
import {
  caseIds,
  catalogFile,
  credentialPresence,
  parseArgs,
  railwayKeys,
  recorded,
  runDriver,
} from "./live-env.mjs";

/** The job's search budget and the step's model-call cap (limit.ts, deep-research.ts). */
const SEARCHES_PER_CASE_MAX = 40;
const MODEL_CALLS_PER_CASE_MAX = 24 + 6;

const args = parseArgs(process.argv.slice(2));
const ids = caseIds(args.cases);
const toRecord = ids.filter((id) => args.force || !recorded(id));

console.log(
  `research acceptance RECORD: ${ids.length} case(s) selected, ${toRecord.length} to record`,
);
for (const id of ids)
  console.log(
    `  ${toRecord.includes(id) ? "record" : "skip  "} ${id}${recorded(id) ? " (recorded)" : ""}`,
  );
console.log(
  `at most ${toRecord.length * SEARCHES_PER_CASE_MAX} searches and ${toRecord.length * MODEL_CALLS_PER_CASE_MAX} model calls`,
);
const presence = credentialPresence();
for (const [name, present] of Object.entries(presence))
  console.log(`  ${name}: ${present ? "present" : "MISSING"}`);

if (args.dryRun) {
  console.log("dry run: no key read, no search, no model call");
  process.exit(0);
}
if (toRecord.length === 0) process.exit(0);
if (!presence.RAILWAY_API_TOKEN || !presence.SUPABASE_ACCESS_TOKEN) {
  console.error(
    "RAILWAY_API_TOKEN (or RAILWAY_TOKEN_FILE) and SUPABASE_ACCESS_TOKEN are required",
  );
  process.exit(2);
}

const keys = await railwayKeys(process.env.CQ_RA_RAILWAY_SERVICE ?? "q-api");
const catalog = await catalogFile();
try {
  const status = runDriver("record", toRecord, {
    ...keys,
    CQ_RA_CATALOG_FILE: catalog.file,
    ...(args.force ? { CQ_RA_FORCE: "1" } : {}),
  });
  process.exitCode = status;
} finally {
  catalog.cleanup();
}
