/**
 * Lane ov 2026-10-16 backfill: Q reads the transcripts of existing pitches
 * into the founder profile's sections, through the live path (Model
 * Gateway, pitch section reader, the same store the sweep writes).
 *
 *   node dist/backfill-pitch-sections.js                    # dry run: lists ids
 *   node dist/backfill-pitch-sections.js --apply            # reads ≤25, ≤$0.50
 *   node dist/backfill-pitch-sections.js --apply --max 100 --max-usd 2
 *
 * Runs with the workers' own environment. Prints ids, outcomes and spend
 * only, never a word of any transcript. Safe to run twice: a pitch already
 * read under the current prompt and section-list versions is skipped.
 */
import { randomUUID } from "node:crypto";

import { loadDatabaseConfig } from "@capital-q/config/database";
import { loadWorkerConfig } from "@capital-q/config/workers";
import { createRequestDatabaseClient } from "@capital-q/database";
import { createPitchSectionReader } from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";

import { backfillPitchSections } from "./media/pitch-section-readings.js";
import { composeWorkerModelGateway } from "./model-gateway.js";

function flag(name: string, fallback: number): number {
  const at = process.argv.indexOf(name);
  if (at === -1) return fallback;
  const value = Number(process.argv[at + 1]);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} needs a non-negative number`);
  }
  return value;
}

const apply = process.argv.includes("--apply");
const max = flag("--max", 25);
const maxUsd = flag("--max-usd", 0.5);
const config = loadWorkerConfig();
const databaseConfig = loadDatabaseConfig();
const logger = createLogger(
  {
    serviceName: "workers-pitch-section-backfill",
    environment: config.runtime.deploymentEnvironment,
    serviceVersion: config.observability.serviceVersion,
    region: config.observability.region,
  },
  { level: config.observability.logLevel },
);
const database = createRequestDatabaseClient(databaseConfig);

try {
  const { providers, gateway, dataPosture } = composeWorkerModelGateway({
    config,
    databaseUrl: databaseConfig.secrets.url,
    sql: database.sql,
    logger,
  });
  if (apply && providers.length === 0) {
    process.stderr.write("refused: no model provider key configured\n");
    process.exitCode = 2;
  } else {
    const result = await backfillPitchSections({
      apply,
      max,
      maxUsd,
      runId: randomUUID().slice(0, 8),
      reading: {
        sql: database.sql,
        reader: createPitchSectionReader({ gateway, logger, dataPosture }),
        logger,
      },
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} finally {
  await database.close();
}
