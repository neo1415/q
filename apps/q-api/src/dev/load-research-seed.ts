import { readFileSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { loadDatabaseConfig } from "@capital-q/config/database";
import { createPrivilegedDatabaseClient } from "@capital-q/database/privileged";

import { createPostgresKnownEntityStore } from "../composition/known-entities.js";
import { createPreparedVersionReader } from "../composition/prepared-entities.js";
import {
  loadPreparedSeed,
  parsePreparedSeed,
} from "../composition/prepared-entity-seed.js";

/**
 * Loads the prepared public research seed into the store (W5).
 *
 *   node --import scripts/dev-env.mjs apps/q-api/src/dev/load-research-seed.ts
 *   node ... load-research-seed.ts --seed path/to/other.v1.json --web-origin https://app.example
 *
 * Idempotent: a second run changes nothing. Writes global platform
 * reference data (public sources only, no tenant), so it uses the named
 * privileged connection, local by default; a hosted apply sets
 * DATABASE_PRIVILEGED_URL and `--web-origin` for the logo URLs.
 *
 * No provider call, no web fetch: it reads one JSON file and writes rows.
 */

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
};

const seedPath =
  flag("--seed") ??
  fileURLToPath(
    new URL(
      "../../../../scripts/seed/research/qatar-five.v1.json",
      import.meta.url,
    ),
  );
const webOrigin =
  flag("--web-origin") ??
  process.env["CQ_WEB_ORIGIN"] ??
  "http://localhost:3000";

const seed = parsePreparedSeed(JSON.parse(readFileSync(seedPath, "utf8")));
const database = createPrivilegedDatabaseClient(loadDatabaseConfig());
try {
  const store = createPostgresKnownEntityStore({
    sql: database.sql,
    transactions: database.transactions,
  });
  const version = createPreparedVersionReader(database.sql);
  const before = await version();
  const loaded = await loadPreparedSeed(store, seed, { webOrigin });
  const after = await version();
  process.stdout.write(
    `${JSON.stringify({
      seed: seed.seed_version,
      entities: loaded,
      storeVersionBefore: before,
      storeVersionAfter: after,
      changed: before !== after,
    })}\n`,
  );
} finally {
  await database.close();
}
