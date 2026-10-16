/**
 * Investability backfill (owner 2026-10-16): assess every company listed to
 * the network under the current InvestIQ method. No model call, no
 * provider key, no outward message: deterministic code over
 * investor-eligible inputs only.
 *
 *   node dist/backfill-investability.js            # dry run: counts only
 *   node dist/backfill-investability.js --apply    # records revisions
 *
 * Paced (250 ms between companies) for the small shared database. Safe to
 * run twice: an unchanged company records nothing. Prints counts only,
 * never a company name or any of its evidence.
 */
import { loadDatabaseConfig } from "@capital-q/config/database";
import { createRequestDatabaseClient } from "@capital-q/database";
import { createPostgresInvestabilityStore } from "@capital-q/readiness";

import { composeInvestability } from "./investability/composition.js";

const apply = process.argv.includes("--apply");
const database = createRequestDatabaseClient(loadDatabaseConfig());

try {
  if (!apply) {
    const ids = await createPostgresInvestabilityStore({
      sql: database.sql,
    }).listedCompanyIds(5000);
    process.stdout.write(
      `${JSON.stringify({ dryRun: true, listedCompanies: ids.length })}\n`,
    );
  } else {
    const { service } = composeInvestability(database.sql);
    const result = await service.sweep({ pauseMs: 250, limit: 5000 });
    process.stdout.write(`${JSON.stringify({ applied: true, ...result })}\n`);
  }
} finally {
  await database.close();
}
