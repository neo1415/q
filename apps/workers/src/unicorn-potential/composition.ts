import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  assessUnicornPotential,
  createPostgresUnicornPotentialStore,
  createUnicornPotentialService,
  UNICORN_POTENTIAL_METHOD_VERSION,
} from "@capital-q/readiness";
import { createInvestabilityDeckPort } from "../investability/composition.js";

/** Same investor-eligible input reader and evidence workflow; separate revisions. */
export function composeUnicornPotential(
  sql: DatabaseExecutor,
  transactions: TransactionManager,
) {
  const store = createPostgresUnicornPotentialStore({ sql, transactions });
  return {
    store,
    service: createUnicornPotentialService({
      store,
      deck: createInvestabilityDeckPort(sql),
      assess: assessUnicornPotential,
      methodVersion: UNICORN_POTENTIAL_METHOD_VERSION,
    }),
  };
}
