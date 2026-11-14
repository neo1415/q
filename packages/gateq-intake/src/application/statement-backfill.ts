import type { ApplicationFact, ApplicationId } from "../contracts/index.js";
import type { ApplicationStatement } from "../contracts/statements.js";
import { legacyCarry, type StatementContext } from "./statement-plan.js";

/**
 * The statements backfill (design 2026-11-14, slice 3 §6).
 *
 * Every current legacy fact that no statement accounts for is written as a
 * BACKFILL statement, honestly flagged, with the same backfill key
 * (`legacy-fact:<factId>`) and the same deterministic id the write path's
 * carry and every reader's view already give it. So it is idempotent: a
 * second run, or a run after a turn already carried a fact, finds the key
 * on record and writes nothing for it.
 *
 *   - dry run by default: nothing is written, the report says what would be;
 *   - one transaction per application, under the application's row lock,
 *     so it never interleaves with a turn or the form;
 *   - a SUBMITTED application is never touched: its frozen dossier is what
 *     the investor received, and the statements tables refuse writes after
 *     submission anyway.
 */

export type BackfillApplication = {
  readonly id: ApplicationId;
  readonly tenantId: string;
};

/** What one application's transaction may read and write. */
export type BackfillTransaction = {
  /** Locks the application row; null when it is gone. */
  readonly lockStatus: () => Promise<string | null>;
  readonly context: () => Promise<StatementContext>;
  readonly currentFacts: () => Promise<readonly ApplicationFact[]>;
  readonly append: (
    statements: readonly ApplicationStatement[],
  ) => Promise<void>;
};

export type BackfillStore = {
  /** Every application with at least one current legacy fact. */
  readonly applications: () => Promise<readonly BackfillApplication[]>;
  readonly inTransaction: <T>(
    application: BackfillApplication,
    work: (tx: BackfillTransaction) => Promise<T>,
  ) => Promise<T>;
};

export type BackfillOutcome =
  "WROTE" | "WOULD_WRITE" | "NOTHING_TO_CARRY" | "SKIPPED_SUBMITTED" | "GONE";

export type BackfillReport = {
  readonly apply: boolean;
  readonly applications: readonly {
    readonly applicationId: string;
    readonly outcome: BackfillOutcome;
    readonly statements: number;
    readonly backfillKeys: readonly string[];
  }[];
  readonly statementsWritten: number;
  readonly statementsPlanned: number;
};

/** The rows one application's backfill writes. Pure. */
export function backfillStatementsFor(input: {
  readonly applicationId: ApplicationId;
  readonly context: StatementContext;
  readonly legacyFacts: readonly ApplicationFact[];
}): readonly ApplicationStatement[] {
  return legacyCarry(input);
}

export async function runStatementBackfill(input: {
  readonly store: BackfillStore;
  /** False (the default) is a dry run: nothing is written. */
  readonly apply?: boolean | undefined;
  readonly only?: readonly string[] | undefined;
  readonly log?: ((line: string) => void) | undefined;
}): Promise<BackfillReport> {
  const apply = input.apply === true;
  const log = input.log ?? (() => undefined);
  const only = input.only === undefined ? null : new Set(input.only);
  const rows: BackfillReport["applications"][number][] = [];
  let written = 0;
  let planned = 0;
  for (const application of await input.store.applications()) {
    if (only !== null && !only.has(application.id)) continue;
    const row = await input.store.inTransaction(application, async (tx) => {
      const status = await tx.lockStatus();
      if (status === null)
        return {
          applicationId: application.id,
          outcome: "GONE" as const,
          statements: 0,
          backfillKeys: [],
        };
      if (status === "SUBMITTED")
        return {
          applicationId: application.id,
          outcome: "SKIPPED_SUBMITTED" as const,
          statements: 0,
          backfillKeys: [],
        };
      const carried = backfillStatementsFor({
        applicationId: application.id,
        context: await tx.context(),
        legacyFacts: await tx.currentFacts(),
      });
      const keys = carried.flatMap((s) =>
        s.backfillKey === null ? [] : [s.backfillKey],
      );
      if (carried.length === 0)
        return {
          applicationId: application.id,
          outcome: "NOTHING_TO_CARRY" as const,
          statements: 0,
          backfillKeys: [],
        };
      if (apply) await tx.append(carried);
      return {
        applicationId: application.id,
        outcome: apply ? ("WROTE" as const) : ("WOULD_WRITE" as const),
        statements: carried.length,
        backfillKeys: keys,
      };
    });
    if (row.outcome === "WROTE") written += row.statements;
    if (row.outcome === "WROTE" || row.outcome === "WOULD_WRITE")
      planned += row.statements;
    log(
      `${row.applicationId} ${row.outcome}${row.statements > 0 ? ` ${String(row.statements)} statement(s)` : ""}`,
    );
    rows.push(row);
  }
  return {
    apply,
    applications: rows,
    statementsWritten: written,
    statementsPlanned: planned,
  };
}
