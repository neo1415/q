import type { TurnExecutionClass } from "@capital-q/contracts";

/**
 * RC3 (Q voice audit, 15 Nov 2026): which execution class -- and so which
 * lane and budget -- one turn takes, from the turn reader's structured
 * reading. Deterministic: no model call, no word list of its own. The
 * reading is the reader's (TURN_READER), plus what code already knows of
 * the conversation (whether Q has given a result in it, whether the turn
 * carries files).
 *
 * Unknown stays unknown: an unread turn, or a low-confidence reading, never
 * takes a reduced lane -- it keeps the full path (COMPLEX_ANALYSIS), so a
 * shortcut is only ever taken when the reader positively said so.
 */
export type ExecutionReading = {
  /** TURN_READER `kind` (TurnKind). */
  readonly kind: string;
  readonly confidence?: "HIGH" | "MEDIUM" | "LOW" | undefined;
  /** v78 answerKind: CHAT, LOOKUP, FOLLOW_UP, ANALYSIS, COMPARISON, DOCUMENT. */
  readonly answerKind?: string | null | undefined;
  /** v81 parts: two or more is a compound ask. */
  readonly partsCount?: number | undefined;
  readonly questionKind?: string | null | undefined;
  /** K8: the question is about a subject prepared for this turn. */
  readonly preparedSubject?: string | null | undefined;
  /** v65 replyTo.kind. */
  readonly replyTo?: string | null | undefined;
  /** v62 workFromEarlier: "yes, go ahead" for work offered just before. */
  readonly workFromEarlier?: boolean | undefined;
  /** v31 appAction / v30 askedAction: a declared action asked for. */
  readonly asksAction?: boolean | undefined;
  /** v22 handOver / v58 meetingPrep. */
  readonly handOver?: boolean | undefined;
  /** A NAVIGATE tool or a record to open (v40 reference). */
  readonly navigates?: boolean | undefined;
  /** v62 compare. */
  readonly compare?: boolean | undefined;
  /** v54 fromShown: the turn points at something Q already showed. */
  readonly fromShown?: boolean | undefined;
  /** v78 asksForWeb. */
  readonly asksForWeb?: boolean | undefined;
  /** v49 teamJob / v70 planAsk. */
  readonly delegatesWork?: boolean | undefined;
  /** Discover, fit or investor-prospects asks code answers from the app. */
  readonly appQuery?: boolean | undefined;
  /**
   * v58 namedOther that is NOT among what Q already showed or said in this
   * conversation: new information is needed, so no follow-up reuse.
   */
  readonly namesSomethingNew?: boolean | undefined;
  /** Code: Q gave a result earlier in this conversation. */
  readonly hasPriorResult: boolean;
  /** Code: this turn carries attached documents (they must be read). */
  readonly carriesDocuments?: boolean | undefined;
  /**
   * v77/v79 references: a pointing phrase of the turn ("that", "it") is
   * bound to something this conversation already holds.
   */
  readonly refersBack?: boolean | undefined;
};

const ACK_KINDS: ReadonlySet<string> = new Set([
  "SMALL_TALK",
  "CONTROL",
  "OFF_TOPIC",
  "UNCLEAR_TRANSCRIPT",
]);

const APP_QUERY_QUESTIONS: ReadonlySet<string> = new Set([
  "DISCOVER_COMPANIES",
  "FIT",
  "INVESTOR_PROSPECTS",
]);

/** Questions the conversation core may send to the public web. */
const PUBLIC_QUESTIONS: ReadonlySet<string> = new Set([
  "PUBLIC_FACTS",
  "REAL_WORLD_EXAMPLE",
]);

const CONTEXT_QUESTIONS: ReadonlySet<string> = new Set([
  "THEIR_OWN_RECORDS",
  "PROGRESS",
  "ABOUT_CAPITAL_Q",
]);

export function turnExecutionClassOf(
  reading: ExecutionReading | null,
): TurnExecutionClass {
  if (reading === null) return "COMPLEX_ANALYSIS";
  if (
    reading.asksAction === true ||
    reading.handOver === true ||
    reading.replyTo === "WAITING_CARD" ||
    reading.kind === "CORRECTION"
  ) {
    return "CONSEQUENTIAL_ACTION";
  }
  if (ACK_KINDS.has(reading.kind)) return "CONVERSATIONAL_ACK";
  if (
    reading.kind === "RESEARCH_REQUEST" ||
    reading.asksForWeb === true ||
    (reading.questionKind != null && PUBLIC_QUESTIONS.has(reading.questionKind))
  ) {
    return "PUBLIC_RESEARCH";
  }
  if (reading.navigates === true && reading.kind === "TOOL_REQUEST") {
    return "NAVIGATION";
  }
  if (
    reading.delegatesWork === true ||
    reading.compare === true ||
    (reading.partsCount ?? 0) >= 2 ||
    reading.answerKind === "COMPARISON"
  ) {
    return "MULTI_SOURCE";
  }
  if (
    reading.appQuery === true ||
    (reading.questionKind != null &&
      APP_QUERY_QUESTIONS.has(reading.questionKind) &&
      reading.fromShown !== true)
  ) {
    return "STRUCTURED_QUERY";
  }
  const confident = reading.confidence !== "LOW";
  const pointsBack =
    reading.answerKind === "FOLLOW_UP" ||
    reading.fromShown === true ||
    reading.replyTo === "Q_QUESTION" ||
    reading.workFromEarlier === true;
  if (
    confident &&
    reading.hasPriorResult &&
    pointsBack &&
    reading.namesSomethingNew !== true &&
    reading.carriesDocuments !== true
  ) {
    return "CONTEXTUAL_FOLLOW_UP";
  }
  if (
    confident &&
    reading.carriesDocuments !== true &&
    reading.namesSomethingNew !== true &&
    ((reading.preparedSubject != null && reading.preparedSubject.length > 0) ||
      (reading.questionKind != null &&
        CONTEXT_QUESTIONS.has(reading.questionKind)) ||
      reading.answerKind === "CHAT" ||
      reading.answerKind === "LOOKUP")
  ) {
    return "ANSWER_FROM_CONTEXT";
  }
  return "COMPLEX_ANALYSIS";
}

/** The work a follow-up on Q's last answer may ask of it. */
const FOLLOW_UP_ANSWER_KINDS: ReadonlySet<string> = new Set([
  "FOLLOW_UP",
  "ANALYSIS",
  "LOOKUP",
]);

/**
 * Live 17 Nov 2026 (conversation ff20af7e): "Why does that matter for an
 * investor like me?" and "And what is the biggest risk in that?", right
 * after Q's answer on one company, were read as ADVICE with answerKind
 * ANALYSIS -- judgement, not "more of the same" -- so they took
 * COMPLEX_ANALYSIS (15.9 s and 13.3 s, ~7 model calls each) and never the
 * contextual follow-up fast path, and each searched the public web.
 *
 * Principle: a question that points back at what this conversation already
 * holds (its pointing words are bound to it), names nothing Q has not said,
 * carries no files and does not ask for the web, follows up Q's previous
 * answer whatever weight of judgement it asks. It is tried on the fast
 * path (whose miss falls back to its own class's full path, so its class
 * and lane are unchanged), and it does no outside research unless asked.
 * Read from the reading's structure, never a word list; a low-confidence
 * or unread turn never qualifies.
 */
export function followsUpPreviousAnswer(
  reading: ExecutionReading,
  executionClass: TurnExecutionClass,
): boolean {
  if (executionClass === "CONTEXTUAL_FOLLOW_UP") return true;
  if (
    executionClass !== "COMPLEX_ANALYSIS" &&
    executionClass !== "ANSWER_FROM_CONTEXT"
  ) {
    return false;
  }
  return (
    reading.kind === "QUESTION_TO_Q" &&
    reading.confidence !== "LOW" &&
    reading.hasPriorResult &&
    reading.refersBack === true &&
    reading.namesSomethingNew !== true &&
    reading.carriesDocuments !== true &&
    reading.asksForWeb !== true &&
    (reading.answerKind == null ||
      FOLLOW_UP_ANSWER_KINDS.has(reading.answerKind))
  );
}

/**
 * What each class may spend. `reuseEvidence`: the previous turns' authorised
 * reads in this conversation (same tenant, actor, conversation and access
 * context, fresh and not invalidated) stand in for re-reading the account
 * digest and the wide reads. `publicWeb`: whether the lane may go to the
 * public web without the reader asking. `answerModelCalls`: the target
 * number of model calls after the reader (one answer call for a follow-up).
 */
export type ExecutionLane = {
  readonly reuseEvidence: boolean;
  readonly publicWeb: boolean;
  readonly answerModelCalls: number;
};

export const EXECUTION_LANES: Readonly<
  Record<TurnExecutionClass, ExecutionLane>
> = {
  CONVERSATIONAL_ACK: {
    reuseEvidence: true,
    publicWeb: false,
    answerModelCalls: 1,
  },
  CONTEXTUAL_FOLLOW_UP: {
    reuseEvidence: true,
    publicWeb: false,
    answerModelCalls: 1,
  },
  // The conversation core's own research decision stands (a question
  // about their records rarely asks for the web; when it does, it is kept).
  ANSWER_FROM_CONTEXT: {
    reuseEvidence: true,
    publicWeb: true,
    answerModelCalls: 1,
  },
  NAVIGATION: { reuseEvidence: true, publicWeb: false, answerModelCalls: 0 },
  STRUCTURED_QUERY: {
    reuseEvidence: false,
    publicWeb: false,
    answerModelCalls: 1,
  },
  COMPLEX_ANALYSIS: {
    reuseEvidence: false,
    publicWeb: true,
    answerModelCalls: 2,
  },
  MULTI_SOURCE: { reuseEvidence: false, publicWeb: true, answerModelCalls: 2 },
  PUBLIC_RESEARCH: {
    reuseEvidence: false,
    publicWeb: true,
    answerModelCalls: 2,
  },
  // An action reuses the evidence it acts on (the offer's subject); the
  // action itself still runs through its own tool, authorize step and
  // approval -- reuse never stands in for those.
  CONSEQUENTIAL_ACTION: {
    reuseEvidence: true,
    publicWeb: true,
    answerModelCalls: 1,
  },
};
