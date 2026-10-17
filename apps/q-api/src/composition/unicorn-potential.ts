import {
  billingAccountOf,
  FEATURE_UNICORN_POTENTIAL,
  type EntitlementService,
} from "@capital-q/billing";
import type { UnicornPotentialDto } from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import {
  createPostgresUnicornPotentialStore,
  UNICORN_POTENTIAL_METHOD_VERSION,
} from "@capital-q/readiness";
import type { ActorContext } from "@capital-q/security";

/** Call only after the existing fit service admits the company's visibility.
 * No cross-request cache: every UI, Q and API read checks current entitlement.
 */
export function createUnicornPotentialComposition(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly entitlements: Pick<EntitlementService, "check">;
}) {
  const store = createPostgresUnicornPotentialStore(dependencies);
  const access = (actor: ActorContext) =>
    dependencies.entitlements.check(
      billingAccountOf(actor),
      FEATURE_UNICORN_POTENTIAL,
    );
  return {
    access,
    read: async (
      actor: ActorContext,
      companyIds: readonly string[],
    ): Promise<ReadonlyMap<string, UnicornPotentialDto>> => {
      if (companyIds.length === 0) return new Map();
      const decision = await access(actor);
      if (!decision.allowed) return new Map();
      return store.current(companyIds, UNICORN_POTENTIAL_METHOD_VERSION);
    },
  };
}
