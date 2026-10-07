/**
 * Q.08 backfill: Q reads ready pitch decks that have no reading yet, through
 * the live pipeline (Model Gateway, deck reader, Write-Gate-pending store).
 *
 *   node dist/backfill-deck-readings.js                      # dry run: lists ids
 *   node dist/backfill-deck-readings.js --apply              # reads ≤25, ≤$1
 *   node dist/backfill-deck-readings.js --apply --max 50 --max-usd 2
 *
 * Runs with the workers' own environment. Prints ids, outcomes and spend
 * only — never a title or a byte of any deck. Safe to run twice: a version
 * already read is skipped. A founder still confirms before investors see it.
 */
import { randomUUID } from "node:crypto";

import { loadDatabaseConfig } from "@capital-q/config/database";
import { loadWorkerConfig } from "@capital-q/config/workers";
import { createRequestDatabaseClient } from "@capital-q/database";
import { createPostgresDataRoom } from "@capital-q/evidence";
import { createDeckReader } from "@capital-q/model-gateway/q";
import { createLogger } from "@capital-q/observability";
import { createPostgresChunkRepository } from "@capital-q/q-knowledge";

import { backfillDeckReadings } from "./evidence/deck-reading-backfill.js";
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
const maxUsd = flag("--max-usd", 1);
const config = loadWorkerConfig();
const databaseConfig = loadDatabaseConfig();
const logger = createLogger(
  {
    serviceName: "workers-deck-backfill",
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
    const chunkRepository = createPostgresChunkRepository();
    const result = await backfillDeckReadings({
      sql: database.sql,
      logger,
      apply,
      max,
      maxUsd,
      runId: randomUUID().slice(0, 8),
      reading: {
        sql: database.sql,
        reader: createDeckReader({ gateway, logger, dataPosture }),
        store: createPostgresDataRoom(),
        chunks: {
          listActiveByVersion: (executor, tenantId, documentVersionId) =>
            chunkRepository.listActiveByVersion(
              executor,
              tenantId as never,
              documentVersionId as never,
            ),
        },
        logger,
      },
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} finally {
  await database.close();
}
