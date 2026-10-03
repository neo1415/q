import type {
  BillingFeatureStandingDto,
  QUsageDto,
} from "@capital-q/contracts";
import type { OwnMonthUsage } from "@capital-q/model-gateway";
import type { ActorContext } from "@capital-q/security";

/**
 * The person's own usage this month (lead 2026-10-03), composed from the
 * usage ledger (their user and tenant only), their own standing
 * instructions (names and budgets) and their plan's Q limits. Read-only.
 */

/** Plan features that are Q work (the rest of the plan is on Settings → Plan). */
const Q_FEATURE_PREFIXES = ["q.", "rehearsal", "research"];

export function createOwnUsage(dependencies: {
  readonly ownMonth: (
    who: { readonly userId: string; readonly tenantId: string },
    at: Date,
  ) => Promise<OwnMonthUsage>;
  /** Their own instructions by id: goal and monthly budget. */
  readonly instructions: (
    actor: ActorContext,
  ) => Promise<
    readonly {
      readonly id: string;
      readonly goal: string;
      readonly budgetUsdMonth: string;
    }[]
  >;
  readonly plan?:
    | ((actor: ActorContext) => Promise<{
        readonly name: string;
        readonly features: readonly BillingFeatureStandingDto[];
      } | null>)
    | undefined;
  readonly now?: (() => Date) | undefined;
}) {
  const now = dependencies.now ?? (() => new Date());
  return async (actor: ActorContext): Promise<QUsageDto> => {
    const at = now();
    const [month, instructions, plan] = await Promise.all([
      dependencies.ownMonth(
        { userId: actor.userId, tenantId: actor.tenantId },
        at,
      ),
      dependencies.instructions(actor).catch(() => []),
      dependencies.plan?.(actor).catch(() => null) ?? Promise.resolve(null),
    ]);
    const named = new Map(instructions.map((row) => [row.id, row]));
    return {
      month: at.toISOString().slice(0, 7),
      totalUsd: month.totalUsd,
      calls: month.calls,
      unpricedCalls: month.unpricedCalls,
      byTask: month.byPurpose.map((row) => ({ ...row })),
      // Only their own instructions are named; spend under an id that is not
      // theirs (never expected) is left in the INSTRUCTION total, unnamed.
      instructions: month.byInstruction
        .filter((row) => named.has(row.instructionId))
        .slice(0, 20)
        .map((row) => ({
          instructionId: row.instructionId,
          goal: (named.get(row.instructionId)?.goal ?? "").slice(0, 200),
          usd: row.usd,
          budgetUsdMonth: named.get(row.instructionId)?.budgetUsdMonth ?? null,
        })),
      plan:
        plan === null
          ? null
          : {
              name: plan.name.slice(0, 120),
              features: plan.features.filter((feature) =>
                Q_FEATURE_PREFIXES.some((prefix) =>
                  feature.key.startsWith(prefix),
                ),
              ),
            },
    };
  };
}

export type OwnUsage = ReturnType<typeof createOwnUsage>;
