import type { DatabaseExecutor } from "@capital-q/database";

/**
 * Q's routing decision per run, kept on the run (audit 15 Nov 2026, RC5:
 * routing, turn-reader and page-move evidence existed only in q-api logs,
 * which rotate with each deployment). Closed codes only -- the reader's
 * kind, research mode, tool and navigation -- never words, names or ids;
 * bounded as `runs.routing` is (20261231592000). Observability, never
 * authority: nothing reads it to decide anything.
 *
 * Scoped by tenant as well as id. A run already terminal is still written:
 * the decision is made at the start of the run and is history either way.
 */

const ROUTING_MAX_CHARS = 2_048;
/** Postgres undefined_column: the migration is not applied yet. */
const UNDEFINED_COLUMN = "42703";

export function createRunRoutingRecorder(options: {
  readonly sql: DatabaseExecutor;
}): (input: {
  readonly tenantId: string;
  readonly runId: string;
  readonly routing: Readonly<Record<string, string | boolean | null>>;
}) => Promise<void> {
  const { sql } = options;
  return async ({ tenantId, runId, routing }) => {
    const json = JSON.stringify(routing);
    if (json.length > ROUTING_MAX_CHARS) return;
    try {
      await sql`
        update q_runtime.runs
           set routing = ${json}::text::jsonb
         where id = ${runId}::uuid
           and tenant_id = ${tenantId}::uuid`;
    } catch (error: unknown) {
      const code: unknown =
        typeof error === "object" && error !== null
          ? Reflect.get(error, "code")
          : undefined;
      // Deployed before its migration: nothing to keep it in yet.
      if (code === UNDEFINED_COLUMN) return;
      throw error;
    }
  };
}
