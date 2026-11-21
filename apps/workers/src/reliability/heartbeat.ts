import type { ServiceHealthSummary } from "./health-watch.js";
import {
  jsonbParam,
  type DatabaseExecutor,
  type DatabasePoolReading,
} from "@capital-q/database";

/**
 * The workers' heartbeat for the console's System health (incident 19 Nov
 * 2026). The workers have no public port, so each operational check
 * upserts one row in platform_ops.service_heartbeats: the time, this
 * process's database pool (counts and ages only) and the check's finding
 * codes. One statement, so its transaction is as short as it can be.
 */

/** W1-B: the last operator alert the workers sent, in plain words. */
export type LastAlert = { readonly subject: string; readonly at: string };

export type OpsBeat = {
  readonly at: Date;
  /** The finding codes, or ["CHECK_FAILED"] when the check could not read. */
  readonly findings: readonly string[];
  /** W1-B: each probed service's health and counts; absent: none probed. */
  readonly services?: readonly ServiceHealthSummary[] | undefined;
  /** W1-B: the last alert sent; null: none since this process started. */
  readonly lastAlert?: LastAlert | null | undefined;
};

export type Heartbeat = (beat: OpsBeat) => Promise<void>;

export function heartbeatRow(
  beat: OpsBeat,
  pool: DatabasePoolReading | undefined,
): {
  readonly beatAt: string;
  readonly pool: Readonly<Record<string, unknown>>;
  readonly opsCheck: Readonly<Record<string, unknown>>;
} {
  return {
    beatAt: beat.at.toISOString(),
    pool: pool === undefined ? {} : { ...pool },
    opsCheck: {
      checkedAt: beat.at.toISOString(),
      findings: [...beat.findings],
      ...(beat.services === undefined
        ? {}
        : { services: beat.services.slice(0, 10) }),
      ...(beat.lastAlert === undefined || beat.lastAlert === null
        ? {}
        : { lastAlert: beat.lastAlert }),
    },
  };
}

export function createPostgresHeartbeat(options: {
  readonly sql: DatabaseExecutor;
  readonly pool: () => DatabasePoolReading | undefined;
}): Heartbeat {
  return async (beat) => {
    const row = heartbeatRow(beat, options.pool());
    await options.sql`
      insert into platform_ops.service_heartbeats (service, beat_at, pool, ops_check, updated_at)
      values ('workers', ${row.beatAt}::timestamptz, ${jsonbParam(options.sql, row.pool)},
              ${jsonbParam(options.sql, row.opsCheck)}, now())
      on conflict (service) do update
        set beat_at = excluded.beat_at,
            pool = excluded.pool,
            ops_check = excluded.ops_check,
            updated_at = excluded.updated_at`;
  };
}
