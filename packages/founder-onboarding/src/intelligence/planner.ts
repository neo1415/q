import type { FounderFactKey } from "@capital-q/q-core";

import {
  FOUNDER_FOLLOW_UP_BUDGET,
  type FounderAmbiguity,
  type FounderConflict,
  type PlannedQuestion,
} from "./contracts.js";
import {
  factAppliesTo,
  FOUNDER_REQUIRED_FACTS,
  stepForFactKey,
  type BusinessShape,
} from "./mapping.js";

/**
 * The adaptive interview planner (CQ-Q-021 §24, §25, §41, §42).
 *
 * Deterministic, and deliberately so. A model may PROPOSE questions; this
 * decides which are asked, in what order, and how many. The reason is not
 * distrust of the model's taste — it is that four properties have to hold
 * every time, and a fluent proposer cannot guarantee any of them:
 *
 *   - A question is never asked about something already answered (§23).
 *     This is the packet's central promise: a founder who uploaded a deck
 *     and confirmed what Q read must not be asked to type it again.
 *   - A question is never asked about a metric this business does not
 *     produce (§26). No ARR from a pre-revenue company.
 *   - Every question maps to a real step of the pinned definition, so an
 *     answer lands in a field that has a schema, a validator and a write
 *     target. A model cannot introduce a question with nothing behind it.
 *   - The count is bounded (§42). Onboarding must feel finished.
 *
 * Ordering encodes what "material" means: what onboarding cannot complete
 * without, then genuine disagreements between a founder's own documents,
 * then figures whose meaning is unclear, then everything else. A
 * contradiction outranks a gap because a wrong number already in the record
 * does more damage than a missing one.
 */

export type PlannerInput = {
  /** Fact keys with a confirmed answer — a submitted response or a confirmed suggestion. */
  readonly answered: ReadonlySet<FounderFactKey>;
  /** Fact keys with a pending suggestion. Confirmation is a review, not a question. */
  readonly suggested: ReadonlySet<FounderFactKey>;
  readonly conflicts: readonly FounderConflict[];
  readonly ambiguities: readonly FounderAmbiguity[];
  /** Questions the model proposed. Filtered, never trusted for eligibility. */
  readonly proposed: readonly {
    readonly key: FounderFactKey;
    readonly question: string;
    readonly why: string;
  }[];
  /** Null when Capital Q does not yet know; nothing is excluded on a guess. */
  readonly shape: BusinessShape | null;
  readonly budget?: number | undefined;
};

const RANK: Readonly<Record<PlannedQuestion["reason"], number>> = {
  CONTRADICTION: 0,
  REQUIRED_AND_UNANSWERED: 1,
  AMBIGUITY: 2,
  MATERIAL_GAP: 3,
};

/** The neutral fallback wording when the model proposed nothing for a key. */
function defaultQuestion(key: FounderFactKey): string {
  return `Capital Q does not yet have ${key.replace(/_/g, " ")} for this company. What is it, if you know?`;
}

export function planFollowUpQuestions(
  input: PlannerInput,
): readonly PlannedQuestion[] {
  const budget = input.budget ?? FOUNDER_FOLLOW_UP_BUDGET;
  const planned: PlannedQuestion[] = [];
  const claimed = new Set<FounderFactKey>();

  const admit = (question: PlannedQuestion): void => {
    if (claimed.has(question.key)) {
      return;
    }
    claimed.add(question.key);
    planned.push(question);
  };

  /**
   * Eligibility, applied to every candidate question regardless of where it
   * came from. A key is asked only when the journey can ask it, this
   * business produces it, and nobody has answered it.
   */
  const eligible = (key: FounderFactKey, forConflict: boolean): boolean => {
    if (stepForFactKey(key) === null) {
      return false;
    }
    if (input.shape !== null && !factAppliesTo(key, input.shape)) {
      return false;
    }
    // A conflict is asked even when the fact is "answered": two sources
    // disagreeing is precisely a case where the recorded answer may be the
    // wrong one, and the question is which reading is right.
    if (forConflict) {
      return true;
    }
    return !input.answered.has(key) && !input.suggested.has(key);
  };

  // 1. Disagreements between the founder's own sources. Both readings
  //    travel with the question; nothing here picks one (§29).
  for (const conflict of input.conflicts) {
    if (!eligible(conflict.key, true)) {
      continue;
    }
    const stepKey = stepForFactKey(conflict.key);
    if (stepKey === null) {
      continue;
    }
    admit({
      key: conflict.key,
      stepKey,
      question: conflict.question,
      why: "Two of the documents you shared give different figures for this, and Capital Q will not choose between them.",
      reason: "CONTRADICTION",
      readings: conflict.readings.map((reading) => reading.value),
    });
  }

  // 2. What onboarding cannot complete without.
  for (const key of FOUNDER_REQUIRED_FACTS) {
    if (!eligible(key, false)) {
      continue;
    }
    const stepKey = stepForFactKey(key);
    if (stepKey === null) {
      continue;
    }
    const proposal = input.proposed.find((item) => item.key === key);
    admit({
      key,
      stepKey,
      question: proposal?.question ?? defaultQuestion(key),
      why: proposal?.why ?? "Capital Q needs this to describe the company.",
      reason: "REQUIRED_AND_UNANSWERED",
      readings: [],
    });
  }

  // 3. Figures whose meaning is unclear. Not missing and not wrong: a
  //    revenue number whose period nobody stated is worth one question.
  for (const ambiguity of input.ambiguities) {
    if (stepForFactKey(ambiguity.key) === null) {
      continue;
    }
    if (input.shape !== null && !factAppliesTo(ambiguity.key, input.shape)) {
      continue;
    }
    const stepKey = stepForFactKey(ambiguity.key);
    if (stepKey === null) {
      continue;
    }
    admit({
      key: ambiguity.key,
      stepKey,
      question: ambiguity.question,
      why: "The figure is on record but Capital Q cannot tell what it measures.",
      reason: "AMBIGUITY",
      readings: [],
    });
  }

  // 4. Everything else the model thought was worth asking, in its order,
  //    after the same eligibility check as everything above.
  for (const proposal of input.proposed) {
    if (!eligible(proposal.key, false)) {
      continue;
    }
    const stepKey = stepForFactKey(proposal.key);
    if (stepKey === null) {
      continue;
    }
    admit({
      key: proposal.key,
      stepKey,
      question: proposal.question,
      why: proposal.why,
      reason: "MATERIAL_GAP",
      readings: [],
    });
  }

  return [...planned]
    .sort((a, b) => RANK[a.reason] - RANK[b.reason])
    .slice(0, budget);
}

/**
 * Whether onboarding has what it needs (§43).
 *
 * The required facts, and nothing beyond them. Unknown information that is
 * not required stays an open gap the founder can fill later, which is a
 * truer statement about a young company than a completion percentage.
 */
export function requiredFactsOutstanding(
  answered: ReadonlySet<FounderFactKey>,
): readonly FounderFactKey[] {
  return FOUNDER_REQUIRED_FACTS.filter((key) => !answered.has(key));
}
