/* eslint-disable no-console */
import { loadDatabaseConfig } from "@capital-q/config/database";
import { createRequestDatabaseClient } from "@capital-q/database";
import {
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
  createRelationshipStateProjector,
  RELATIONSHIP_PROJECTOR_VERSION,
} from "@capital-q/network";

/**
 * Relationship state rebuild from history (CQ-NET-012).
 *
 *   cd apps/workers
 *   node --import ../../scripts/dev-env.mjs src/dev/rebuild-relationship-states.ts [--all]
 *
 * An operator command over the worker's own database identity. It runs
 * the same deterministic projector the event consumer runs: every
 * relationship whose cached state is behind its history (or, with --all,
 * every relationship -- how a new projector version is rolled out) is
 * re-folded from its full history and written compare-and-set. History is
 * only read. Safe to run twice; the second run changes nothing. Not an
 * HTTP endpoint and never will be.
 */

async function main(): Promise<number> {
  const all = process.argv.includes("--all");
  const database = createRequestDatabaseClient(loadDatabaseConfig());
  try {
    const projector = createRelationshipStateProjector({
      sql: database.sql,
      repositories: {
        relationships: createPostgresRelationshipRepository(),
        events: createPostgresRelationshipEventRepository(),
      },
    });
    const result = await projector.rebuild({ all });
    console.log(
      JSON.stringify({
        projector: RELATIONSHIP_PROJECTOR_VERSION,
        scope: all ? "all" : "behind",
        ...result,
      }),
    );
    return 0;
  } finally {
    await database.close();
  }
}

process.exitCode = await main();
