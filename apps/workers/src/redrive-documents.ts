/**
 * Re-drive documents blocked for want of a scanner (ADR 0042).
 *
 *   node dist/redrive-documents.js            # dry run: lists, enqueues nothing
 *   node dist/redrive-documents.js --apply    # enqueues one job per listed version
 *
 * Runs with the workers' own environment (database URL, CQ_MALWARE_POLICY,
 * CQ_PIPELINE_VERSION). Prints ids and counts only -- never a title or a
 * byte of any document. Safe to run twice: see documents/redrive.ts.
 */
import { loadDatabaseConfig } from "@capital-q/config/database";
import { loadWorkerConfig } from "@capital-q/config/workers";
import { createRequestDatabaseClient } from "@capital-q/database";

import { redriveBlockedDocuments } from "./documents/redrive.js";
import { createPgmqQueueClient } from "./queue/pgmq.js";

const apply = process.argv.includes("--apply");
const config = loadWorkerConfig();
const database = createRequestDatabaseClient(loadDatabaseConfig());

try {
  const result = await redriveBlockedDocuments({
    sql: database.sql,
    queues: createPgmqQueueClient(database.sql),
    pipelineVersion: config.documents.pipelineVersion,
    malwarePolicy: config.documents.malwarePolicy,
    apply,
  });
  if (result.kind === "REFUSED") {
    process.stderr.write(`refused: ${result.reason}\n`);
    process.exitCode = 2;
  } else {
    process.stdout.write(
      `${JSON.stringify(
        {
          mode: result.kind,
          pipelineVersion: result.pipelineVersion,
          selected: result.candidates.length,
          enqueued: result.enqueued,
          versions: result.candidates.map((candidate) => ({
            documentVersionId: candidate.documentVersionId,
            tenantId: candidate.tenantId,
            blockedUnder: candidate.blockedUnder,
          })),
        },
        null,
        2,
      )}\n`,
    );
    if (result.candidates.length === 0) {
      process.stdout.write(
        "Nothing selected. If versions are still blocked, CQ_PIPELINE_VERSION must differ from the version they were blocked under (each pipeline version runs a document once).\n",
      );
    }
  }
} finally {
  await database.close();
}
