import { founderStatedFacts } from "@capital-q/founder-onboarding";
import type { OwnOnboardingSummaryReader } from "@capital-q/onboarding";
import type { ReadinessClaimInput } from "@capital-q/readiness";
import type { ActorContext } from "@capital-q/security";

/**
 * QA QO-38/44 (23 Oct 2026): what a founder told Q in setup, for the
 * readers that otherwise said it was absent ("no raise target", "the
 * record doesn't show customers"). Read from their OWN onboarding session
 * for THIS company (the session's subject), by their own user id; never
 * another person's answers and never another company's.
 */
export type FounderStated = {
  readonly raise: {
    readonly target: string;
    readonly useOfFunds: boolean;
    readonly instrument: boolean;
    readonly valuation: boolean;
    readonly targetCloseDate: boolean;
  } | null;
  readonly claims: readonly ReadinessClaimInput[];
  /** One line per stated fact, for prompts: "Raise: 1500000 USD (SAFE)". */
  readonly lines: readonly string[];
};

const claim = (
  key: string,
  type: string,
  statement: string,
): ReadinessClaimInput => ({
  id: `stated:${key}`,
  claimType: type,
  claimKey: key,
  statement,
  truthClass: "USER_CLAIM",
  evidenceStatus: "SELF_REPORTED",
  lifecycleStatus: "CURRENT",
  stated: true,
});

export function createFounderStatedReader(dependencies: {
  readonly summaries: OwnOnboardingSummaryReader;
}) {
  return async (
    actor: ActorContext,
    companyId: string,
  ): Promise<FounderStated | null> => {
    const journeys = await dependencies.summaries.read(actor.userId);
    const founder = journeys.find(
      (journey) =>
        journey.journeyType === "founder" && journey.subjectId === companyId,
    );
    if (founder?.values === undefined) return null;
    const facts = founderStatedFacts(founder.values);
    const claims: ReadinessClaimInput[] = [];
    const lines: string[] = [];
    if (facts.raise !== null) {
      lines.push(
        `Raise: ${facts.raise.target}${facts.raise.instrument === null ? "" : ` (${facts.raise.instrument})`}`,
      );
    }
    if (facts.customers !== null) {
      claims.push(
        claim(
          "traction.customer_count",
          "customers",
          `${facts.customers} paying customers`,
        ),
      );
      lines.push(`Paying customers: ${facts.customers}`);
    }
    if (facts.pilots !== null) {
      claims.push(
        claim("traction.pilot_count", "traction", `${facts.pilots} pilots`),
      );
      lines.push(`Pilots: ${facts.pilots}`);
    }
    return {
      raise:
        facts.raise === null
          ? null
          : {
              target: facts.raise.target,
              useOfFunds: facts.raise.useOfFunds,
              instrument: facts.raise.instrument !== null,
              valuation: false,
              targetCloseDate: false,
            },
      claims,
      lines,
    };
  };
}
