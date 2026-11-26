import type { TransactionSql } from "postgres";

import type {
  DatabaseClaims,
  RlsShadowCounts,
  RlsShadowProbe,
  RlsShadowTarget,
  TransactionContext,
} from "./types.js";

/**
 * W2-C step 3 (ADR 0082 §5, owner-approved 26 Nov 2026): RLS shadow mode.
 *
 * Design. The ADR says the helper "runs the unit's reads of those schemas a
 * second time". Parsing arbitrary SQL inside a unit to find its reads would
 * be fragile (CTEs, joins across schemas, writes with RETURNING) and would
 * risk re-running a write. Instead a repository opts a plain read in
 * explicitly with `shadowRead(tx, { schema, table, statementKind }, query)`:
 * the read runs once, on the bypass connection, and that is always the
 * person's answer. On a sampled claimed unit the read is also recorded.
 *
 * The comparison runs when the work has finished, just before COMMIT, never
 * in the middle of the work: switching role is per connection, so a
 * savepoint running as cq_app while the work had another statement in
 * flight (a Promise.all inside the unit) would run that statement as
 * cq_app too and could change the person's answer. At the end nothing else
 * is in flight. Each recorded read then runs inside its own savepoint:
 * once as the bypass role and once after `set_config('role', 'cq_app',
 * true)` (SET LOCAL ROLE), both at the same point of the unit, so the
 * unit's own writes count the same on both sides. The savepoint is always
 * rolled back. Only the two row counts are compared.
 *
 * The savepoint is also what keeps a shadow failure out of the person's
 * unit: a statement error (no grant, a policy bug, a timeout) aborts only
 * the savepoint, ROLLBACK TO SAVEPOINT restores the transaction, the role
 * and any setting changed inside it, and the error is logged (SQLSTATE
 * only) and swallowed. The cost on a sampled unit is two short reads per
 * recorded read, at most MAX_SHADOW_READS_PER_UNIT of them.
 */

/** Postgres's identifier for the non-bypass request role (migration 20261231600100). */
const REQUEST_ROLE = "cq_app";

/** A unit's shadow work is bounded, whatever its loops read. */
export const MAX_SHADOW_READS_PER_UNIT = 8;

/** Thrown inside the savepoint so it always rolls back; never escapes. */
class ShadowRollback extends Error {}
const ALWAYS_ROLL_BACK = new ShadowRollback("rls-shadow: always rolled back");

export type RlsShadowLogger = {
  readonly warn: (fields: Record<string, unknown>, message: string) => void;
};

export type RlsShadowCounter = {
  readonly record: (
    schema: string,
    outcome: "MATCHED" | "WOULD_DENY" | "ERROR",
  ) => void;
  readonly read: () => RlsShadowCounts;
};

/** In memory, per schema, since the process started: counts only. */
export function createRlsShadowCounter(): RlsShadowCounter {
  const counts = new Map<
    string,
    { compared: number; wouldDeny: number; errors: number }
  >();
  return {
    record: (schema, outcome) => {
      const entry = counts.get(schema) ?? {
        compared: 0,
        wouldDeny: 0,
        errors: 0,
      };
      if (outcome === "ERROR") entry.errors += 1;
      else entry.compared += 1;
      if (outcome === "WOULD_DENY") entry.wouldDeny += 1;
      counts.set(schema, entry);
    },
    read: () =>
      Object.fromEntries(
        [...counts.entries()].map(([schema, entry]) => [schema, { ...entry }]),
      ),
  };
}

export type RlsShadowSettings = {
  /** The shadowed schemas; empty: shadow is off. */
  readonly schemas: readonly string[];
  /** The share of claimed units shadowed, 0 to 1. */
  readonly sample: number;
  /** The service name in a log line (api, q-api, workers). */
  readonly service?: string | undefined;
  readonly logger?: RlsShadowLogger | undefined;
  readonly counter?: RlsShadowCounter | undefined;
  /** Injectable for tests; Math.random otherwise. */
  readonly random?: (() => number) | undefined;
};

/** One unit's shadow: records reads during the work, compares them after. */
export type RlsShadowSession = {
  readonly probe: RlsShadowProbe;
  /** Never throws. Runs only after the work resolved, before COMMIT. */
  readonly compare: () => Promise<void>;
};

/** Postgres's SQLSTATE on a driver error, or null: never a message or a row. */
function sqlStateOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * The shadow for one unit, or undefined when the unit is not shadowed: no
 * claims, no shadowed schema, or not in the sample. Decided once per unit,
 * at BEGIN, so a unit is compared whole or not at all.
 */
export function rlsShadowSessionFor(
  sql: TransactionSql,
  settings: RlsShadowSettings | undefined,
  claimed: boolean,
): RlsShadowSession | undefined {
  if (!claimed || settings === undefined || settings.schemas.length === 0) {
    return undefined;
  }
  const random = settings.random ?? Math.random;
  if (!(random() < settings.sample)) return undefined;
  const schemas = new Set(settings.schemas);
  const recorded: {
    readonly target: RlsShadowTarget;
    readonly query: (sql: TransactionSql) => Promise<readonly unknown[]>;
  }[] = [];

  const compareOne = async (
    target: RlsShadowTarget,
    query: (sql: TransactionSql) => Promise<readonly unknown[]>,
  ): Promise<void> => {
    const fields = {
      schema: target.schema,
      table: target.table,
      statementKind: target.statementKind,
      service: settings.service ?? null,
    };
    // Filled inside the savepoint callback (an object, so the reads after
    // it are not narrowed away by control-flow analysis).
    const seen: { bypass?: number; enforced?: number } = {};
    try {
      await sql.savepoint(async (inner) => {
        seen.bypass = (await query(inner)).length;
        // Transaction-local, and undone by the ROLLBACK TO SAVEPOINT below:
        // the unit commits as the bypass role it started as.
        await inner`select set_config('role', ${REQUEST_ROLE}, true)`;
        seen.enforced = (await query(inner)).length;
        throw ALWAYS_ROLL_BACK;
      });
    } catch (error) {
      if (error !== ALWAYS_ROLL_BACK) {
        settings.counter?.record(target.schema, "ERROR");
        // The SQLSTATE only: a driver message can quote a value.
        settings.logger?.warn(
          { alert: "RLS_SHADOW_ERROR", ...fields, sqlState: sqlStateOf(error) },
          "RLS shadow read failed (no effect on the request)",
        );
        return;
      }
    }
    const rowsBypass = seen.bypass;
    const rowsEnforced = seen.enforced;
    if (rowsBypass === undefined || rowsEnforced === undefined) return;
    if (rowsEnforced === rowsBypass) {
      settings.counter?.record(target.schema, "MATCHED");
      return;
    }
    settings.counter?.record(target.schema, "WOULD_DENY");
    // Counts only: never a row, an id or a value.
    settings.logger?.warn(
      { alert: "RLS_WOULD_DENY", ...fields, rowsBypass, rowsEnforced },
      "RLS would change this read's rows (shadow mode; nothing was denied)",
    );
  };

  return {
    probe: (target, query) => {
      if (!schemas.has(target.schema)) return;
      if (recorded.length >= MAX_SHADOW_READS_PER_UNIT) return;
      recorded.push({ target, query });
    },
    compare: async () => {
      // One at a time: each savepoint holds the connection's role.
      for (const { target, query } of recorded.splice(0)) {
        try {
          await compareOne(target, query);
        } catch {
          // compareOne never throws; this only makes sure of it.
        }
      }
    },
  };
}

/**
 * A read of a table in an RLS-rolled-out schema. Always answers with the
 * bypass read; on a shadowed unit also records it for the comparison
 * (above). Use it for plain reads only: never a write, a RETURNING or a
 * locking read, because the comparison runs the query twice more.
 */
export async function shadowRead<Row extends readonly unknown[]>(
  tx: TransactionContext,
  target: RlsShadowTarget,
  query: (sql: TransactionSql) => Promise<Row>,
): Promise<Row> {
  const rows = await query(tx.sql);
  tx.rlsShadow?.(target, query);
  return rows;
}

/**
 * The claims for an authenticated actor. Built on the server from the
 * resolved ActorContext (its shape, structurally), never from client input.
 */
export function databaseClaimsFor(actor: {
  readonly tenantId: string;
  readonly userId: string;
  readonly organisationId?: string | undefined;
  readonly actorType: DatabaseClaims["actorType"];
}): DatabaseClaims {
  return {
    tenantId: actor.tenantId,
    userId: actor.userId,
    organisationId: actor.organisationId ?? null,
    actorType: actor.actorType,
  };
}
