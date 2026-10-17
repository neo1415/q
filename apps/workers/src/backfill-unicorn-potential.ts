/** Counts only by default. --apply --limit=10 is a bounded, paced first batch.
 * No provider calls, new companies, altered source facts or artificial grades.
 */
import { loadDatabaseConfig } from "@capital-q/config/database";
import { createRequestDatabaseClient } from "@capital-q/database";
import { composeUnicornPotential } from "./unicorn-potential/composition.js";

const rawLimit = process.argv
  .find((arg) => arg.startsWith("--limit="))
  ?.slice(8);
const limit = rawLimit === undefined ? 10 : Number(rawLimit);
if (!Number.isInteger(limit) || limit < 1 || limit > 100)
  throw new Error("Backfill limit must be an integer from 1 to 100");
const database = createRequestDatabaseClient(loadDatabaseConfig());
try {
  const { store, service } = composeUnicornPotential(
    database.sql,
    database.transactions,
  );
  if (!process.argv.includes("--apply")) {
    const ids = await store.listedCompanyIds(limit);
    process.stdout.write(
      `${JSON.stringify({ dryRun: true, eligibleBatch: ids.length, limit })}\n`,
    );
  } else {
    const result = await service.sweep({ limit, pauseMs: 250 });
    process.stdout.write(
      `${JSON.stringify({ applied: true, limit, ...result })}\n`,
    );
  }
} finally {
  await database.close();
}
