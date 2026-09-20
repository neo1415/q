import { getMeter } from "@capital-q/observability";

import {
  EXPLORATION_POLICY_V1,
  PassReintroductionReasonSchema,
  type PassReintroductionReason,
  type RerankPolicy,
} from "./policy.js";
import type { PassReintroductionPort, RerankSignalsPort } from "./ports.js";

/**
 * Whether a company may be shown proactively (CQ-REC-009R).
 *
 *   historical recommendation record ≠ currently servable recommendation
 *
 * Passing on a company is a decision, and the decision has to hold at the
 * moment of serving rather than at the moment of building. REC-009 demotes
 * a passed company to the tail of the slate, which keeps the slate a
 * complete, reproducible permutation of the eligible pool — but a tail is
 * still reachable, and a pass recorded after a build would not be reflected
 * in that build at all. So the slate keeps the item and the reader refuses
 * to serve it, which is the same shape as REC-001's read-time guard: the
 * ordering is what was stored, and whether a company may be shown is
 * decided now.
 *
 * Nothing here deletes a slate, an item or an event. A suppressed company
 * is not a bad company, is not excluded from the investor's mandate, and is
 * still reachable through Saved if they saved it.
 */

/**
 * The one rule, in one place, so the build and the read cannot disagree.
 *
 * Fail closed: an unrecognised reason suppresses. The reranker refuses such
 * a reason outright, because a build can stop and be retried; a feed page
 * cannot, and turning a page into an error would be a worse answer than
 * withholding one company.
 */
export function suppressedFromProactiveDiscovery(
  policy: RerankPolicy,
  state: {
    readonly passed: boolean;
    readonly reintroduction: PassReintroductionReason | null;
  },
): boolean {
  if (!state.passed) return false;
  if (state.reintroduction === null) return true;
  return !policy.passSuppression.reintroductionReasons.includes(
    state.reintroduction,
  );
}

/**
 * Which of these companies must not be offered to this investor
 * organisation right now. Absent ids are not suppressed: no history means
 * nobody has passed on anything.
 */
export type ProactiveSuppressionPort = {
  readonly suppressedCompanyIds: (query: {
    readonly tenantId: string;
    readonly investorOrganisationId: string;
    /** The mandate being served: what MANDATE_VERSION_CHANGED would compare against. */
    readonly mandateId: string;
    readonly mandateVersion: number;
    readonly companyIds: readonly string[];
  }) => Promise<ReadonlySet<string>>;
};

export function createProactiveSuppression(dependencies: {
  readonly signals: RerankSignalsPort;
  /**
   * Absent in V1, and that is the honest state: nothing can currently
   * prove a reason to offer a passed company again (CQ-REC-009 §12). With
   * no source, every passed company stays suppressed.
   */
  readonly reintroductions?: PassReintroductionPort | undefined;
  readonly policy?: RerankPolicy | undefined;
}): ProactiveSuppressionPort {
  const { signals, reintroductions } = dependencies;
  const policy = dependencies.policy ?? EXPLORATION_POLICY_V1;
  const meter = getMeter("@capital-q/discovery");
  const suppressedCount = meter.createHistogram(
    "discovery.slates.page_items_suppressed",
  );

  return {
    suppressedCompanyIds: async (query) => {
      if (query.companyIds.length === 0) return new Set<string>();
      const history = await signals.forCompanies({
        tenantId: query.tenantId,
        investorOrganisationId: query.investorOrganisationId,
        companyIds: query.companyIds,
      });
      const passed = [...history.entries()]
        .filter(([, signal]) => signal.passed)
        .map(([companyId]) => companyId);
      if (passed.length === 0) {
        suppressedCount.record(0);
        return new Set<string>();
      }

      // Only asked about companies that were actually passed: there is
      // nothing to reintroduce for the rest.
      const reasons =
        reintroductions === undefined
          ? new Map<string, string>()
          : await reintroductions.reasonsFor({
              tenantId: query.tenantId,
              investorOrganisationId: query.investorOrganisationId,
              mandateId: query.mandateId,
              mandateVersion: query.mandateVersion,
              companyIds: passed,
            });

      const out = new Set<string>();
      for (const companyId of passed) {
        const raw = reasons.get(companyId);
        const parsed =
          raw === undefined
            ? null
            : PassReintroductionReasonSchema.safeParse(raw);
        const reintroduction: PassReintroductionReason | null =
          parsed === null || !parsed.success ? null : parsed.data;
        if (
          suppressedFromProactiveDiscovery(policy, {
            passed: true,
            reintroduction,
          })
        ) {
          out.add(companyId);
        }
      }
      suppressedCount.record(out.size);
      return out;
    },
  };
}
