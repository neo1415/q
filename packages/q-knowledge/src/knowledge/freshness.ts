import type { UtcTimestamp } from "@capital-q/contracts";

/**
 * Freshness (CQ-KNW-003 §21-§23).
 *
 * Stale is not false. A cash balance from May is a true statement about May;
 * what it is not is a safe answer to "how much cash do you have". The
 * distinction matters because the alternative — treating age as error — would
 * have Capital Q discard correct information, and the opposite — ignoring age
 * — would have it assert a five-month-old balance as current.
 *
 * Two rules keep this honest.
 *
 * Nothing goes stale from elapsed time alone unless a policy says how long
 * that metric stays useful. There are no universal TTLs here, because a
 * company's address and its cash position do not age at the same rate and
 * inventing a number for each would be inventing a fact about each.
 *
 * And staleness never touches permission. An old founder-private figure is
 * founder-private (§23); age is a reason to qualify an answer, never a reason
 * to widen who may hear it.
 */

export const KNOWLEDGE_FRESHNESS_POLICY_VERSION =
  "knowledge-freshness-v1" as const;

export type FreshnessRule = {
  readonly knowledgeKey: string;
  /**
   * How long this kind of understanding stays useful, in days, measured from
   * the later of its validity start and its last verification.
   */
  readonly usefulForDays: number;
  /** Why this number, in one line. Auditable, and arguable. */
  readonly rationale: string;
};

/**
 * The rules that exist, and only those.
 *
 * Deliberately short. Each entry is a claim about how fast a number stops
 * being a safe answer, and a claim nobody can defend is worse than an absent
 * one: a key with no rule never goes stale by time, and can still be marked
 * stale by a source event.
 */
export const KNOWLEDGE_FRESHNESS_RULES: readonly FreshnessRule[] = [
  {
    knowledgeKey: "financial.cash_balance",
    usefulForDays: 45,
    rationale:
      "A balance moves continuously and is spent; a figure older than about six weeks cannot answer 'how much do you have' without qualification.",
  },
  {
    knowledgeKey: "financial.burn_rate",
    usefulForDays: 90,
    rationale:
      "Burn is measured over months and changes with hiring, so a quarter is the point at which last quarter's rate stops describing this one.",
  },
  {
    knowledgeKey: "financial.arr",
    usefulForDays: 120,
    rationale:
      "ARR is reported around quarter ends; beyond a quarter plus reporting lag, the last figure describes a period that has closed.",
  },
  {
    knowledgeKey: "investor.mandate",
    usefulForDays: 365,
    rationale:
      "A declared mandate is reviewed on a fund's own cycle, and treating a year-old mandate as current is how an investor is shown deals they stopped wanting.",
  },
];

const BY_KEY = new Map(
  KNOWLEDGE_FRESHNESS_RULES.map((rule) => [rule.knowledgeKey, rule]),
);

export function freshnessRuleFor(knowledgeKey: string): FreshnessRule | null {
  return BY_KEY.get(knowledgeKey) ?? null;
}

export type FreshnessAssessment = {
  readonly stale: boolean;
  readonly reason:
    "NO_POLICY_FOR_KEY" | "WITHIN_USEFUL_LIFE" | "EXCEEDED_USEFUL_LIFE";
  /** The policy generation that decided, so an answer stays attributable. */
  readonly policyVersion: string;
  readonly ageDays: number | null;
};

/**
 * Whether an understanding has outlived its usefulness.
 *
 * Age is measured from the later of when the information started applying and
 * when it was last checked — re-verifying an old figure makes it current
 * again, which is the whole point of verifying it.
 */
export function assessFreshness(
  input: {
    readonly knowledgeKey: string;
    readonly validFrom: UtcTimestamp | null;
    readonly recordedAt: UtcTimestamp;
    readonly lastVerifiedAt: UtcTimestamp | null;
  },
  now: Date = new Date(),
): FreshnessAssessment {
  const rule = freshnessRuleFor(input.knowledgeKey);
  const anchor = Math.max(
    Date.parse(input.validFrom ?? input.recordedAt),
    input.lastVerifiedAt === null ? 0 : Date.parse(input.lastVerifiedAt),
  );
  const ageDays = Math.floor((now.getTime() - anchor) / 86_400_000);
  if (rule === null) {
    // No claim about this metric's useful life, so no claim that it expired.
    return {
      stale: false,
      reason: "NO_POLICY_FOR_KEY",
      policyVersion: KNOWLEDGE_FRESHNESS_POLICY_VERSION,
      ageDays,
    };
  }
  return {
    stale: ageDays > rule.usefulForDays,
    reason:
      ageDays > rule.usefulForDays
        ? "EXCEEDED_USEFUL_LIFE"
        : "WITHIN_USEFUL_LIFE",
    policyVersion: KNOWLEDGE_FRESHNESS_POLICY_VERSION,
    ageDays,
  };
}
