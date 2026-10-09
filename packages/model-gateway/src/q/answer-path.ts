/**
 * K8 (founder brief 2026-10-09): the cheapest correct path for a turn,
 * chosen by code from the turn's reading and what is already prepared,
 * with the full path whenever the choice is uncertain.
 *
 *   APP_QUERY           answered by code from a direct app read (companies
 *                       of a kind, computed fit, what needs them): no
 *                       analyst model call at all.
 *   PREPARED_CONTEXT    a question about something already read for this
 *                       turn (their mandate, the record on screen, Q's
 *                       work): one model call over that context, no tool
 *                       round.
 *   TARGETED_RETRIEVAL  a question about their own records or named
 *                       records: the model with the focused tools, the
 *                       ordinary dialogue budget.
 *   DEEP_ANALYSIS       advice, comparison, research, anything unread or
 *                       uncertain: the full path.
 *
 * The router never decides what a person may see -- every read is still
 * authorised under the run's plan -- only how much work answering takes.
 */

export type AnswerPath =
  "APP_QUERY" | "PREPARED_CONTEXT" | "TARGETED_RETRIEVAL" | "DEEP_ANALYSIS";

export type AnswerPathChoice = {
  readonly path: AnswerPath;
  /** A short code for the log, never shown to the person. */
  readonly because: string;
};

export type AnswerPathInput = {
  readonly turnKind: string | undefined;
  readonly questionKind: string | undefined;
  readonly preparedSubject:
    "MANDATE" | "ON_SCREEN_RECORD" | "Q_WORK" | undefined;
  readonly discover: boolean;
  readonly fit: boolean;
  readonly attention: boolean;
  readonly writingDocument: boolean;
  readonly askedAction: boolean;
  readonly researchMode: "EXPLICIT" | "ONLY_IF_EMPTY" | "OFFERED" | "NEVER";
  readonly aboutNamedOther: boolean;
  /** What is prepared for this turn, by subject. */
  readonly prepared: {
    readonly mandate: boolean;
    readonly onScreenRecord: boolean;
    readonly qWork: boolean;
  };
};

const RETRIEVAL_KINDS = new Set([
  "OPTIONS",
  "PROGRESS",
  "THEIR_OWN_RECORDS",
  "ABOUT_CAPITAL_Q",
]);

export function answerPathOf(input: AnswerPathInput): AnswerPathChoice {
  if (input.writingDocument) {
    return { path: "DEEP_ANALYSIS", because: "DOCUMENT" };
  }
  if (input.askedAction) {
    return { path: "DEEP_ANALYSIS", because: "ACTION" };
  }
  if (input.turnKind !== undefined && input.turnKind !== "QUESTION_TO_Q") {
    return { path: "DEEP_ANALYSIS", because: "NOT_A_QUESTION" };
  }
  if (input.discover || input.fit || input.attention) {
    return {
      path: "APP_QUERY",
      because: input.discover ? "DISCOVER" : input.fit ? "FIT" : "ATTENTION",
    };
  }
  if (input.researchMode === "EXPLICIT") {
    return { path: "DEEP_ANALYSIS", because: "RESEARCH" };
  }
  if (input.preparedSubject !== undefined && !input.aboutNamedOther) {
    const ready =
      input.preparedSubject === "MANDATE"
        ? input.prepared.mandate
        : input.preparedSubject === "ON_SCREEN_RECORD"
          ? input.prepared.onScreenRecord
          : input.prepared.qWork;
    // Not prepared: the full path reads it with its tools.
    return ready
      ? { path: "PREPARED_CONTEXT", because: input.preparedSubject }
      : { path: "DEEP_ANALYSIS", because: `${input.preparedSubject}_NOT_READ` };
  }
  if (
    input.questionKind !== undefined &&
    RETRIEVAL_KINDS.has(input.questionKind)
  ) {
    return { path: "TARGETED_RETRIEVAL", because: input.questionKind };
  }
  return {
    path: "DEEP_ANALYSIS",
    because: input.questionKind ?? "UNREAD",
  };
}
