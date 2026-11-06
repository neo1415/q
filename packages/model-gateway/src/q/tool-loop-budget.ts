import type { TurnAnswerKind } from "@capital-q/q-core";

/**
 * Q Intelligence Plan step 8: the tool loop's budget for one turn.
 *
 * Every turn keeps the standard loop (2 rounds, 10 calls; index.ts
 * Q_TOOL_LOOP_MAX_ROUNDS / Q_TOOL_LOOP_MAX_CALLS). A turn the reader read
 * as deep work (answerKind ANALYSIS, COMPARISON or DOCUMENT, in the turn or
 * one of its parts) AND that the existing task class already budgets as
 * synthesis gets more rounds, so Q can look something up, read what it
 * found, and look again until it has what the analysis needs.
 *
 * More rounds never means more tools or more scope: the tools offered, how
 * each is authorised and the Context Firewall are exactly the standard
 * turn's. The extra rounds stop at a wall-clock budget: once it is spent,
 * no round beyond the standard two starts, and Q answers from what it
 * holds. A round already running is never cut short.
 */

/** Rounds of tool proposals for a deep turn (the plan's 4–6). */
export const Q_DEEP_TOOL_LOOP_MAX_ROUNDS = 5;
/** Calls in total for a deep turn. */
export const Q_DEEP_TOOL_LOOP_MAX_CALLS = 16;
/** Past this, a deep turn starts no round beyond the standard ones. */
export const Q_DEEP_TOOL_LOOP_BUDGET_MS = 30_000;

/** The task classes that already budget an answer as synthesis. */
const DEEP_TASK_CLASSES = new Set(["EVIDENCE_SYNTHESIS", "COMPARISON"]);
const DEEP_KINDS = new Set<TurnAnswerKind>([
  "ANALYSIS",
  "COMPARISON",
  "DOCUMENT",
]);

export interface ToolLoopBudget {
  readonly deep: boolean;
  readonly maxCalls: number;
  /** Rounds allowed at `now`: the deep rounds only while time remains. */
  readonly maxRounds: (now: number) => number;
}

export function toolLoopBudget(input: {
  /** The reader's validated kinds (readAnswerKinds). */
  readonly kinds: readonly TurnAnswerKind[];
  /** The answer's budget class (answerTaskClass). */
  readonly taskClass: string;
  /** The standard loop, passed in so the two never drift apart. */
  readonly standardRounds: number;
  readonly standardCalls: number;
  /** When the loop started (ms, the same clock as `now`). */
  readonly startedAt: number;
}): ToolLoopBudget {
  const deep =
    DEEP_TASK_CLASSES.has(input.taskClass) &&
    input.kinds.some((kind) => DEEP_KINDS.has(kind));
  if (!deep) {
    return {
      deep,
      maxCalls: input.standardCalls,
      maxRounds: () => input.standardRounds,
    };
  }
  return {
    deep,
    maxCalls: Math.max(input.standardCalls, Q_DEEP_TOOL_LOOP_MAX_CALLS),
    maxRounds: (now) =>
      now - input.startedAt < Q_DEEP_TOOL_LOOP_BUDGET_MS
        ? Math.max(input.standardRounds, Q_DEEP_TOOL_LOOP_MAX_ROUNDS)
        : input.standardRounds,
  };
}
