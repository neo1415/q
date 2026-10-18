import {
  billingAccountOf,
  type EntitlementService,
  type MeterSurface,
} from "@capital-q/billing";
import type { AnyQActionDefinition } from "@capital-q/q-actions";
import type { QEntitlementPort } from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

/**
 * BILLING (ADR 0034): the plan gate as q-api composes it.
 *
 * - Q's tools see the plan through `QEntitlementPort` (q-tools gates the
 *   proposal and research tools, and answers "what does my plan include").
 * - An approved action that IS the metered work (an errand, outreach, a
 *   stand-in) takes its unit when it executes, keyed by the action's own
 *   idempotency key, so a retry of the same approval is never a second
 *   unit; a plan that ran out between approval and execution fails the
 *   action plainly instead of running it.
 *
 * Deterministic code outside the model (doc 12 §51.1).
 */

export function createQEntitlementPort(
  entitlements: EntitlementService,
  surface: MeterSurface = "Q_TOOL",
): QEntitlementPort {
  const verdict = (
    decision: Awaited<ReturnType<EntitlementService["check"]>>,
  ) =>
    decision.allowed
      ? ({ allowed: true } as const)
      : ({ allowed: false, message: decision.refusal.message } as const);
  return {
    check: async (actor, feature) =>
      verdict(await entitlements.check(billingAccountOf(actor), feature)),
    consume: async (actor, feature, idempotencyKey) =>
      verdict(
        await entitlements.consume({
          account: billingAccountOf(actor),
          feature,
          idempotencyKey,
          actorUserId: actor.userId,
          surface,
        }),
      ),
    release: async (actor, feature, idempotencyKey) => {
      await entitlements.release({
        account: billingAccountOf(actor),
        feature,
        idempotencyKey,
        reason: "The metered work failed.",
      });
    },
    summary: async (actor: ActorContext) => {
      const summary = await entitlements.summary(billingAccountOf(actor));
      return {
        planName: summary.plan.name,
        source: summary.source,
        endsAt: summary.endsAt,
        features: summary.features.map((feature) => ({
          key: feature.key,
          name: feature.name,
          included: feature.included,
          limit: feature.limit,
          used: feature.used,
          unitSingular: feature.unitSingular,
          unitPlural: feature.unitPlural,
          resetsAt: feature.resetsAt,
        })),
      };
    },
  };
}

export const ENTITLEMENT_REQUIRED = "ENTITLEMENT_REQUIRED" as const;

/**
 * The approved action draws one unit of `feature` when it runs. Its own
 * authorize is checked first; the plan check at proposal and approval
 * means a person is told before they approve, and the consume at
 * execution is the authoritative, atomic step.
 */
export function meteredQAction(
  definition: AnyQActionDefinition,
  feature: string,
  entitlements: EntitlementService,
): AnyQActionDefinition {
  return {
    ...definition,
    authorize: async (payload, actor) => {
      const own = await definition.authorize(payload, actor);
      if (own.outcome !== "ALLOW") return own;
      const decision = await entitlements.check(
        billingAccountOf(actor),
        feature,
      );
      return decision.allowed
        ? own
        : { outcome: "DENY", code: ENTITLEMENT_REQUIRED };
    },
    executor: {
      execute: async (action, context) => {
        const account = billingAccountOf(context.approver);
        const idempotencyKey = `${action.actionType}:${action.idempotencyKey}`;
        const decision = await entitlements.consume({
          account,
          feature,
          idempotencyKey,
          actorUserId: context.approver.userId,
          surface: "Q_ACTION",
        });
        if (!decision.allowed) {
          return {
            outcome: "FAILED",
            failureCode: ENTITLEMENT_REQUIRED,
            retryable: false,
          };
        }
        const release = () =>
          entitlements
            .release({
              account,
              feature,
              idempotencyKey,
              reason: "The approved action did not run.",
            })
            .catch(() => false);
        try {
          const report = await definition.executor.execute(action, context);
          // A definite failure gives the unit back; UNKNOWN keeps it, since
          // the work may have happened (it is reconciled, never resent).
          if (report.outcome === "FAILED") await release();
          return report;
        } catch (error: unknown) {
          await release();
          throw error;
        }
      },
    },
  };
}
