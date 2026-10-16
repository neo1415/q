import type { CapitalLedgerDto, ReadinessDto } from "@capital-q/contracts";

/**
 * Capital tab counts. Kept out of the "use client" Overview module: the
 * server-rendered tab bar calls them, and a server component calling an
 * export of a client module throws ("Attempted to call ... from the server"),
 * which took down founder Capital on 2026-10-16.
 */

/** Commitments waiting on the founder's own next step. */
export function needsYouCount(ledger: CapitalLedgerDto): number {
  return ledger.commitments.filter((item) => item.next !== null).length;
}

/** Open steps in the action plan's Now column. */
export function nowCount(readiness: ReadinessDto): number {
  return readiness.actions.filter(
    (action) => action.state === "OPEN" && action.priority === "NOW",
  ).length;
}
