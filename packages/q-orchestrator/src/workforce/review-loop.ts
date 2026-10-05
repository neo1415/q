import type {
  DraftIntegrityRule,
  DraftReviewResult,
  DraftRubricCriterion,
} from "@capital-q/q-core";

/**
 * The writer → reviewer loop (founder brief J2, 2026-10-06).
 *
 * Every outward draft is graded before it can go anywhere. The reviewer
 * (a model) scores each rubric criterion 0-5 and passes or fails each
 * integrity rule; this code turns that into one score, out of 100, by
 * fixed weights, and decides. Below the bar, the reviewer's feedback goes
 * back to the writer for a redraft, at most `maxRedrafts` times. Only a
 * draft that passes comes out as PASSED; anything else is HELD with the
 * reason, for the person to see. An integrity failure is never averaged
 * away, and a reviewer that cannot be reached holds the draft: nothing
 * outward goes ungraded.
 */

export const RUBRIC_VERSION = "workforce-rubric/v1" as const;

/** Weights out of 100. The person's own style counts as much as warmth. */
export const RUBRIC_WEIGHTS: Readonly<Record<DraftRubricCriterion, number>> = {
  WARM_OPENING: 15,
  ASK_TIMING: 20,
  ANSWERS_THEM: 20,
  CONCISE_AND_CALM: 15,
  READS_SIGNALS: 15,
  PERSONAL_STYLE: 15,
};

export type ReviewPolicy = {
  /** The least score, out of 100, a draft needs to pass. */
  readonly threshold: number;
  readonly maxRedrafts: number;
};

export const DEFAULT_REVIEW_POLICY: ReviewPolicy = {
  threshold: 75,
  maxRedrafts: 2,
};

export type Grade = {
  readonly score: number;
  readonly passed: boolean;
  readonly failedIntegrity: readonly DraftIntegrityRule[];
  readonly criteria: DraftReviewResult["criteria"];
  readonly integrity: DraftReviewResult["integrity"];
  readonly feedback: string;
};

/**
 * One score from the reviewer's grades. A criterion the reviewer did not
 * grade counts as 0 (unknown is not a pass); a rule it did not check
 * counts as failed.
 */
export function gradeOf(review: DraftReviewResult, threshold: number): Grade {
  let score = 0;
  for (const [criterion, weight] of Object.entries(RUBRIC_WEIGHTS) as [
    DraftRubricCriterion,
    number,
  ][]) {
    const graded = review.criteria.find((one) => one.criterion === criterion);
    score += ((graded?.score ?? 0) / 5) * weight;
  }
  const rules: readonly DraftIntegrityRule[] = [
    "GROUNDED",
    "NO_COMMITMENTS",
    "NOTHING_PRIVATE",
    "HONEST_IDENTITY",
  ];
  const failedIntegrity = rules.filter(
    (rule) => review.integrity.find((one) => one.rule === rule)?.ok !== true,
  );
  const rounded = Math.round(score);
  return {
    score: rounded,
    passed: failedIntegrity.length === 0 && rounded >= threshold,
    failedIntegrity,
    criteria: review.criteria,
    integrity: review.integrity,
    feedback: review.feedback,
  };
}

export type ReviewLoopPorts = {
  /** The reviewer. Null: unavailable or unreadable. */
  readonly review: (body: string) => Promise<DraftReviewResult | null>;
  /** The writer's redraft from feedback. Null: no honest redraft. */
  readonly redraft: (body: string, feedback: string) => Promise<string | null>;
  /**
   * Code's own deterministic checks on a redraft (the same ones the first
   * draft passed). A string is the problem; null is clean.
   */
  readonly recheck?: ((body: string) => string | null) | undefined;
  /** Recording, for the workforce page. Failures never stop the loop. */
  readonly onDraft?:
    | ((draft: {
        readonly attempt: number;
        readonly body: string;
        readonly parentDraftId: string | null;
      }) => Promise<string | null>)
    | undefined;
  readonly onGrade?:
    ((draftId: string | null, grade: Grade) => Promise<void>) | undefined;
  readonly onHandoff?:
    | ((handoff: {
        readonly from: "WRITER" | "REVIEWER";
        readonly to: "WRITER" | "REVIEWER";
        readonly draftId: string | null;
        readonly note: string;
      }) => Promise<void>)
    | undefined;
};

export const HOLD_REASONS = [
  "BELOW_BAR",
  "INTEGRITY",
  "REVIEW_UNAVAILABLE",
  "WRITER_GAVE_UP",
  "CODE_CHECK",
] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

export type ReviewOutcome =
  | {
      readonly verdict: "PASSED";
      readonly body: string;
      readonly draftId: string | null;
      readonly grade: Grade;
      readonly attempts: number;
    }
  | {
      readonly verdict: "HELD";
      readonly reason: HoldReason;
      /** The last draft written, for the person to see. */
      readonly body: string;
      readonly draftId: string | null;
      readonly grade: Grade | null;
      readonly attempts: number;
    };

async function quietly<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch {
    return fallback;
  }
}

export async function writeWithReview(
  first: string,
  ports: ReviewLoopPorts,
  policy: ReviewPolicy = DEFAULT_REVIEW_POLICY,
): Promise<ReviewOutcome> {
  let body = first;
  let parent: string | null = null;
  let last: Grade | null = null;
  const maxRedrafts = Math.max(0, Math.min(policy.maxRedrafts, 5));
  for (let attempt = 1; attempt <= maxRedrafts + 1; attempt += 1) {
    const draftId: string | null = ports.onDraft
      ? await quietly(
          () =>
            ports.onDraft?.({ attempt, body, parentDraftId: parent }) ??
            Promise.resolve(null),
          null,
        )
      : null;
    const review = await ports.review(body).catch(() => null);
    if (review === null) {
      return {
        verdict: "HELD",
        reason: "REVIEW_UNAVAILABLE",
        body,
        draftId,
        grade: last,
        attempts: attempt,
      };
    }
    const grade = gradeOf(review, policy.threshold);
    last = grade;
    await quietly(
      () => ports.onGrade?.(draftId, grade) ?? Promise.resolve(),
      undefined,
    );
    if (grade.passed) {
      return { verdict: "PASSED", body, draftId, grade, attempts: attempt };
    }
    if (attempt > maxRedrafts) {
      return {
        verdict: "HELD",
        reason: grade.failedIntegrity.length > 0 ? "INTEGRITY" : "BELOW_BAR",
        body,
        draftId,
        grade,
        attempts: attempt,
      };
    }
    const feedback =
      grade.feedback.trim() === ""
        ? `Score ${String(grade.score)} is below ${String(policy.threshold)}.`
        : grade.feedback;
    await quietly(
      () =>
        ports.onHandoff?.({
          from: "REVIEWER",
          to: "WRITER",
          draftId,
          note: feedback.slice(0, 1_000),
        }) ?? Promise.resolve(),
      undefined,
    );
    const next = await ports.redraft(body, feedback).catch(() => null);
    if (next === null || next.trim() === "") {
      return {
        verdict: "HELD",
        reason: "WRITER_GAVE_UP",
        body,
        draftId,
        grade,
        attempts: attempt,
      };
    }
    const problem = ports.recheck?.(next) ?? null;
    if (problem !== null) {
      return {
        verdict: "HELD",
        reason: "CODE_CHECK",
        body: next,
        draftId,
        grade,
        attempts: attempt + 1,
      };
    }
    await quietly(
      () =>
        ports.onHandoff?.({
          from: "WRITER",
          to: "REVIEWER",
          draftId,
          note: "Redrafted from the reviewer's feedback.",
        }) ?? Promise.resolve(),
      undefined,
    );
    body = next;
    parent = draftId;
  }
  // Unreachable: the loop returns on its last attempt.
  return {
    verdict: "HELD",
    reason: "BELOW_BAR",
    body,
    draftId: parent,
    grade: last,
    attempts: maxRedrafts + 1,
  };
}
