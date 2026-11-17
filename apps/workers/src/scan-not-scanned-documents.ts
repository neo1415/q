/**
 * Scan documents recorded NOT_SCANNED while no scanner existed (decision
 * 104; ADR 0042, reversal step 2).
 *
 *   node dist/scan-not-scanned-documents.js                 # dry run: lists, scans nothing
 *   node dist/scan-not-scanned-documents.js --apply         # scans up to 200, oldest first
 *   node dist/scan-not-scanned-documents.js --apply --limit=500
 *
 * Runs with the workers' own environment (database URL, SUPABASE_URL,
 * SUPABASE_SECRET_KEY, CLAMAV_HOST, CLAMAV_PORT). Refuses without
 * CLAMAV_HOST. Prints ids, counts and signature names only -- never a title
 * or a byte of any document. Safe to run twice: see
 * documents/scan-backfill.ts. Run it again until `selected` is 0.
 */
import { loadDatabaseConfig } from "@capital-q/config/database";
import { loadWorkerConfig } from "@capital-q/config/workers";
import { createRequestDatabaseClient } from "@capital-q/database";
import { createSupabaseDocumentStorageProvider } from "@capital-q/evidence";

import { createClamdScanner } from "./documents/clamd.js";
import {
  createPostgresScanBackfillStore,
  scanNotScannedDocuments,
  SCAN_BACKFILL_DEFAULT_LIMIT,
} from "./documents/scan-backfill.js";
import { WORKER_DATABASE_DEFAULTS } from "./statement-budget.js";

const apply = process.argv.includes("--apply");
const limitArg = process.argv
  .find((arg) => arg.startsWith("--limit="))
  ?.slice("--limit=".length);
const limit =
  limitArg === undefined
    ? SCAN_BACKFILL_DEFAULT_LIMIT
    : Number.parseInt(limitArg, 10);

const config = loadWorkerConfig();
const clamav = config.documents.clamav;
if (clamav === null) {
  process.stderr.write("refused: CLAMAV_HOST is not set on this service.\n");
  process.exit(2);
}
if (
  config.public.supabaseUrl === undefined ||
  config.secrets.supabaseSecretKey === undefined
) {
  process.stderr.write(
    "refused: SUPABASE_URL and SUPABASE_SECRET_KEY are needed to read the files.\n",
  );
  process.exit(2);
}
if (!Number.isInteger(limit) || limit < 1) {
  process.stderr.write("refused: --limit must be a positive integer.\n");
  process.exit(2);
}

const storage = createSupabaseDocumentStorageProvider({
  supabaseUrl: config.public.supabaseUrl,
  secretKey: config.secrets.supabaseSecretKey,
});
const database = createRequestDatabaseClient(
  loadDatabaseConfig(WORKER_DATABASE_DEFAULTS),
);

try {
  const result = await scanNotScannedDocuments({
    store: createPostgresScanBackfillStore({
      sql: database.sql,
      transactions: database.transactions,
    }),
    scanner: createClamdScanner({
      host: clamav.host,
      port: clamav.port,
      timeoutMs: clamav.timeoutMs,
      maxBytes: config.documents.maxDocumentBytes,
      openObject: async (target) =>
        (
          await storage.openObjectStream({
            bucket: target.bucket,
            key: target.key,
          })
        ).body,
    }),
    apply,
    limit,
  });
  if (result.kind === "REFUSED") {
    process.stderr.write(`refused: ${result.reason}\n`);
    process.exitCode = 2;
  } else {
    process.stdout.write(
      `${JSON.stringify({ mode: result.kind, ...result, kind: undefined }, null, 2)}\n`,
    );
    if (result.failed > 0) process.exitCode = 1;
  }
} finally {
  await database.close();
}
