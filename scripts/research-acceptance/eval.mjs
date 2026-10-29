#!/usr/bin/env node
// Evaluates prompt or model changes against the research acceptance gate
// (owner 2026-10-29) without search credits: the RECORDED web pages are
// replayed (a query the recording lacks gets nothing and is counted) and
// the models are LIVE through the Model Gateway. Each case is scored by
// code's checks plus a short rubric for what code cannot judge. Nothing
// is written to the fixtures. Model calls cost money: run on demand.
//
//   node scripts/research-acceptance/eval.mjs --dry-run
//   NODE_USE_ENV_PROXY=1 node scripts/research-acceptance/eval.mjs [--case A-...]
import {
  caseIds,
  catalogFile,
  credentialPresence,
  parseArgs,
  railwayKeys,
  recorded,
  runDriver,
} from "./live-env.mjs";

const args = parseArgs(process.argv.slice(2));
const ids = caseIds(args.cases).filter((id) => recorded(id));

console.log(`research acceptance EVAL: ${ids.length} recorded case(s)`);
for (const id of ids) console.log(`  ${id}`);
const presence = credentialPresence();
for (const [name, present] of Object.entries(presence))
  console.log(`  ${name}: ${present ? "present" : "MISSING"}`);
if (args.dryRun || ids.length === 0) {
  console.log(
    ids.length === 0
      ? "nothing recorded yet: run record.mjs first"
      : "dry run: no model call",
  );
  process.exit(0);
}
if (!presence.RAILWAY_API_TOKEN || !presence.SUPABASE_ACCESS_TOKEN) {
  console.error(
    "RAILWAY_API_TOKEN (or RAILWAY_TOKEN_FILE) and SUPABASE_ACCESS_TOKEN are required",
  );
  process.exit(2);
}

const keys = await railwayKeys(process.env.CQ_RA_RAILWAY_SERVICE ?? "q-api");
const catalog = await catalogFile();
try {
  // Search keys are not passed: the web is replayed, never searched.
  process.exitCode = runDriver("eval", ids, {
    CQ_RA_OPENAI_KEY: keys.CQ_RA_OPENAI_KEY,
    CQ_RA_CATALOG_FILE: catalog.file,
  });
} finally {
  catalog.cleanup();
}
