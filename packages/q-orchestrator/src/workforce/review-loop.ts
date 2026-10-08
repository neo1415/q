import type {
  DraftIntegrityRuleV2,
  DraftRubricCriterion,
} from "@capital-q/q-core";

/**
 * The writer → reviewer loop (founder brief J2, 2026-10-06).
 *
 * Every outward draft is graded before it can go anywhere. Code first
 * checks that it responds to what their latest message left open (thread
 * consistency); the reviewer (a model) scores each rubric criterion 0-5
 * and passes or fails each integrity rule; this code turns that into one
 * score, out of 100, by fixed weights, and decides. Below the bar, a
 * numbered fix list goes back to the writer for one redraft (two rounds
 * at most). Only a draft that passes comes out as PASSED; anything else
 * is HELD with the reason, for the person to see. An integrity or thread
 * failure is never averaged away, and a reviewer that cannot be reached
 * holds the draft: nothing outward goes ungraded.
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

/**
 * At most two rounds: the first draft and one redraft from the fix list
 * (Zino, 2026-10-08: "Draft 1 below the bar 6.0/7.5" over and over). A
 * draft that still misses after the second round is held with its reason,
 * whatever a job's stored `maxRedrafts` says.
 */
export const REVIEW_ROUNDS_MAX = 2;

export const DEFAULT_REVIEW_POLICY: ReviewPolicy = {
  threshold: 75,
  maxRedrafts: REVIEW_ROUNDS_MAX - 1,
};

/** The reviewer's sheet, as either prompt version returns it. */
export type ReviewSheet = {
  readonly criteria: readonly {
    readonly criterion: DraftRubricCriterion;
    readonly score: number;
    readonly note: string;
  }[];
  readonly integrity: readonly {
    readonly rule: DraftIntegrityRuleV2;
    readonly ok: boolean;
    readonly note: string;
  }[];
  readonly feedback: string;
};

export type Grade = {
  readonly score: number;
  readonly passed: boolean;
  readonly failedIntegrity: readonly DraftIntegrityRuleV2[];
  readonly criteria: ReviewSheet["criteria"];
  readonly integrity: ReviewSheet["integrity"];
  /** Below the bar: the numbered fix list the writer was given. */
  readonly feedback: string;
  /** Code's thread-consistency fixes; any one fails the draft. */
  readonly threadProblems?: readonly string[] | undefined;
};

const NOTE_MAX = 300;
const FEEDBACK_MAX = 1_000;

function firstOf<T, K>(items: readonly T[], key: (item: T) => K): T[] {
  const seen = new Set<K>();
  return items.filter((item) => {
    const id = key(item);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * One score from the reviewer's grades. A criterion the reviewer did not
 * grade counts as 0 (unknown is not a pass); a rule it did not check
 * counts as failed. RESPONDS_TO_THREAD is required only when code found
 * something open in their latest message; a reviewer that reports it
 * failed fails the draft either way. Free text is cut to what the record
 * keeps, never refused (live 2026-10-07: a long note refused the grade).
 */
export function gradeOf(
  review: ReviewSheet,
  threshold: number,
  options: { readonly threadRule?: boolean | undefined } = {},
): Grade {
  const criteria = firstOf(review.criteria, (one) => one.criterion);
  const integrity = firstOf(review.integrity, (one) => one.rule);
  let score = 0;
  for (const [criterion, weight] of Object.entries(RUBRIC_WEIGHTS) as [
    DraftRubricCriterion,
    number,
  ][]) {
    const graded = criteria.find((one) => one.criterion === criterion);
    score += ((graded?.score ?? 0) / 5) * weight;
  }
  const rules: readonly DraftIntegrityRuleV2[] = [
    "GROUNDED",
    "NO_COMMITMENTS",
    "NOTHING_PRIVATE",
    "HONEST_IDENTITY",
    ...(options.threadRule === true ? (["RESPONDS_TO_THREAD"] as const) : []),
  ];
  const failedIntegrity: DraftIntegrityRuleV2[] = rules.filter(
    (rule) => integrity.find((one) => one.rule === rule)?.ok !== true,
  );
  if (
    options.threadRule !== true &&
    integrity.some((one) => one.rule === "RESPONDS_TO_THREAD" && !one.ok)
  ) {
    failedIntegrity.push("RESPONDS_TO_THREAD");
  }
  const rounded = Math.round(score);
  return {
    score: rounded,
    passed: failedIntegrity.length === 0 && rounded >= threshold,
    failedIntegrity,
    criteria: criteria.map((one) => ({
      ...one,
      note: one.note.slice(0, NOTE_MAX),
    })),
    integrity: integrity.map((one) => ({
      ...one,
      note: one.note.slice(0, NOTE_MAX),
    })),
    feedback: review.feedback.slice(0, FEEDBACK_MAX),
  };
}

/**
 * The writer's fix list, concrete and numbered: code's thread fixes
 * first, then each failed integrity rule's note, then each criterion the
 * reviewer scored 2 or less, then the reviewer's own feedback.
 */
export function fixList(grade: Grade, threshold: number): string {
  const fixes: string[] = [...(grade.threadProblems ?? [])];
  for (const rule of grade.failedIntegrity) {
    const note = grade.integrity.find((one) => one.rule === rule)?.note.trim();
    fixes.push(
      `${rule}: ${note === undefined || note === "" ? "the draft breaks this rule." : note}`,
    );
  }
  for (const one of grade.criteria) {
    if (one.score <= 2 && one.note.trim() !== "") {
      fixes.push(`${one.criterion}: ${one.note.trim()}`);
    }
  }
  const feedback = grade.feedback.trim();
  if (feedback !== "") fixes.push(feedback);
  if (fixes.length === 0) {
    fixes.push(
      `Score ${String(grade.score)} is below ${String(threshold)}: warmer, more specific, and answer what they said first.`,
    );
  }
  return fixes
    .slice(0, 8)
    .map((fix, index) => `${String(index + 1)}. ${fix}`)
    .join("\n")
    .slice(0, 2_000);
}

export type ReviewLoopPorts = {
  /** The reviewer. Null: unavailable or unreadable. */
  readonly review: (body: string) => Promise<ReviewSheet | null>;
  /** The writer's redraft from the fix list. Null: no honest redraft. */
  readonly redraft: (body: string, feedback: string) => Promise<string | null>;
  /**
   * Code's own deterministic checks on a redraft (the same ones the first
   * draft passed). A string is the problem; null is clean.
   */
  readonly recheck?: ((body: string) => string | null) | undefined;
  /**
   * Code's thread-consistency check: the fixes a draft needs to respond
   * to their latest message. Any one fails the draft, whatever it scores.
   */
  readonly consistency?: ((body: string) => readonly string[]) | undefined;
  /** Code found something open in their latest message (RESPONDS_TO_THREAD). */
  readonly threadRule?: boolean | undefined;
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
  /** It still didn't respond to what their latest message left open. */
  "THREAD_MISMATCH",
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
  const maxRedrafts = Math.max(
    0,
    Math.min(policy.maxRedrafts, REVIEW_ROUNDS_MAX - 1),
  );
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
    const graded = gradeOf(review, policy.threshold, {
      threadRule: ports.threadRule,
    });
    const problems = ports.consistency?.(body) ?? [];
    const failed: Grade =
      problems.length === 0
        ? graded
        : { ...graded, passed: false, threadProblems: problems };
    // Below the bar, what is recorded and handed back is the fix list.
    const fixes = failed.passed
      ? failed.feedback
      : fixList(failed, policy.threshold);
    const grade: Grade = { ...failed, feedback: fixes.slice(0, FEEDBACK_MAX) };
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
        reason:
          problems.length > 0 ||
          grade.failedIntegrity.includes("RESPONDS_TO_THREAD")
            ? "THREAD_MISMATCH"
            : grade.failedIntegrity.length > 0
              ? "INTEGRITY"
              : "BELOW_BAR",
        body,
        draftId,
        grade,
        attempts: attempt,
      };
    }
    await quietly(
      () =>
        ports.onHandoff?.({
          from: "REVIEWER",
          to: "WRITER",
          draftId,
          note: fixes.slice(0, 1_000),
        }) ?? Promise.resolve(),
      undefined,
    );
    const next = await ports.redraft(body, fixes).catch(() => null);
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
          note: "Redrafted from the reviewer's fix list.",
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
