/**
 * Loop protection: what has failed, how often, and whether to try again
 * (CQ-QX-005 §7, §8, §13).
 *
 * A degraded subsystem made Q unusable because every path reported the
 * same failure the same way and retried the same operation on the next
 * turn. Live: a research run that could not start, a question that went
 * to it anyway, "I couldn't take that just now", the person asking again,
 * the same run, the same line. The ledger is the memory the loop lacked.
 *
 * Per operation, not per turn: a model that cannot be reached says nothing
 * about research, and research being down says nothing about whether the
 * words could be read. One subsystem's count never blocks the others, and
 * that is what keeps the rest of Q usable while one part is not.
 *
 * Pure values. The consumer holds the ledger where it holds the rest of
 * its conversational state.
 */

export const FAILURE_OPERATIONS = [
  /** The reasoning model could not be reached or gave nothing usable. */
  "MODEL",
  /** A public-web research run failed or could not start. */
  "RESEARCH",
  /** A tool or action Q was asked to use. */
  "TOOL",
  /** Words that arrived but could not be placed against the job. */
  "PARSE",
  /** The owning service refused a write. */
  "WRITE",
  /** Speech recognition produced noise or fragments. */
  "TRANSCRIPT",
] as const;
export type FailureOperation = (typeof FAILURE_OPERATIONS)[number];

export type FailureLedger = Readonly<Record<FailureOperation, number>>;

export const EMPTY_FAILURES: FailureLedger = {
  MODEL: 0,
  RESEARCH: 0,
  TOOL: 0,
  PARSE: 0,
  WRITE: 0,
  TRANSCRIPT: 0,
};

/**
 * How many consecutive failures of one operation before Q stops retrying
 * it and falls back. Two: one is an accident, two is a condition.
 */
export const FAILURE_THRESHOLD = 2;

export function noteFailure(
  ledger: FailureLedger,
  operation: FailureOperation,
): FailureLedger {
  return { ...ledger, [operation]: ledger[operation] + 1 };
}

export function clearFailure(
  ledger: FailureLedger,
  operation: FailureOperation,
): FailureLedger {
  return ledger[operation] === 0 ? ledger : { ...ledger, [operation]: 0 };
}

/** True once the operation has failed often enough that retrying it is the loop. */
export function isExhausted(
  ledger: FailureLedger,
  operation: FailureOperation,
  threshold = FAILURE_THRESHOLD,
): boolean {
  return ledger[operation] >= threshold;
}

/**
 * Whether this failure is worth a sentence to the person.
 *
 * The first failure of an operation is: something they expected did not
 * happen. The one that exhausts it is: Q is going to stop trying. Every
 * failure between and after those is not, because a person told about
 * the same outage on every turn is a person being nagged by it.
 */
export function shouldNotify(
  ledger: FailureLedger,
  operation: FailureOperation,
  threshold = FAILURE_THRESHOLD,
): boolean {
  const count = ledger[operation];
  return count === 1 || count === threshold;
}

/**
 * What Q says about a subsystem, narrowly.
 *
 * Each names exactly the thing that failed and nothing else, so that a
 * reasoning failure is never described as a hearing problem and a
 * research outage is never described as Q not understanding. `stopping`
 * is the exhausted form: Q says it is leaving that operation alone and
 * carrying on with what still works.
 */
export function subsystemNotice(
  operation: FailureOperation,
  stopping: boolean,
): string {
  switch (operation) {
    case "MODEL":
      return stopping
        ? "My reasoning service still isn't answering, so I'll stop trying it for now. What you've already told me is safe; say it again in a minute and I'll pick it up."
        : "I can't reach my reasoning service just now, so I haven't taken that in. Say it again in a moment.";
    case "RESEARCH":
      return stopping
        ? "Live research isn't reachable at the moment, so I'll stop trying and answer from what I know instead."
        : "Live research isn't reachable just now. I'll answer from what I know and come back to the public sources when they're up.";
    case "TOOL":
      return stopping
        ? "That change still isn't going through, so I'll leave it for now and we can carry on."
        : "That didn't go through on my side. I'll try it again when you're ready.";
    case "PARSE":
      return stopping
        ? "I heard the words, but I'm not sure which preference you want me to record. Tell me in a different way, or pick from the screen."
        : "I heard the words, but I'm not sure which preference you want me to record.";
    case "WRITE":
      return stopping
        ? "That one still isn't saving, so I'll leave it and come back to it later rather than keep asking."
        : "That one didn't save. I'll come back to it.";
    case "TRANSCRIPT":
      return stopping
        ? "The line is breaking up on my side. If it keeps happening, tapping Type is the surest way through."
        : "That came through broken up. Could you say it once more?";
  }
}
