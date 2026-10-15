/**
 * Lane N (owner, 2026-10-15: "why do I have a reviewer if they need me to
 * approve every single message? That's the reviewer's job").
 *
 * Under the person's explicit scoped delegation (the RELATIONSHIP_ROUTINE
 * scope recorded on their instruction, `q_runtime` delegation row, audited),
 * who signs off one outward chat message: the REVIEWER (code's checks plus
 * the outward reviewer's pass) or the OWNER (a card for their yes).
 *
 * The list is code's, fixed here, and never widened by a grant, a guide or
 * a model. Live evidence (Zino, 12-15 Oct): a founder's reply restating
 * the founder's own declared traction ("two converted to $180k contracts")
 * was flagged "touches terms or money" by the planner and sat as the
 * founder's card for three days, lapsing twice. Declared, approved-shareable
 * facts are not terms; terms are.
 */

/** What the reviewer may sign off inside the delegation. */
export const ROUTINE_MESSAGE_KINDS = [
  /** Proposing or offering meeting times (never committing to one). */
  "PROPOSE_TIMES",
  /** Answering a factual question from the sender's approved-shareable facts. */
  "FACTUAL_ANSWER",
  /** Thanks, acknowledgements, a short reply or follow-up. */
  "ACKNOWLEDGEMENT",
] as const;
export type RoutineMessageKind = (typeof ROUTINE_MESSAGE_KINDS)[number];

/** What always goes to the owner, delegation or not. */
export const OWNER_ONLY = [
  /** Accepting or committing to a concrete time on their calendar. */
  "CALENDAR_COMMITMENT",
  /** Data that is not approved-shareable (a number or fact not on record). */
  "RESTRICTED_DATA",
  /** Valuation, terms, cheque sizes offered, equity, signing, money moves. */
  "COMMERCIAL_TERMS",
  /** The reviewer held it, or rated it under the bar. */
  "REVIEWER_FLAGGED",
  /** No explicit delegation on this instruction. */
  "NOT_DELEGATED",
] as const;
export type OwnerReason = (typeof OWNER_ONLY)[number];

export type MessageSignOff =
  | { readonly by: "REVIEWER"; readonly kind: RoutineMessageKind }
  | { readonly by: "OWNER"; readonly reason: OwnerReason };

/**
 * Commercial terms in the message's own words. Numbers alone are not terms:
 * a declared traction figure is a fact. These are.
 */
const COMMERCIAL_TERMS =
  /\b(?:valuation|pre[- ]money|post[- ]money|term[- ]?sheet|safe note|convertible|discount rate|valuation cap|\bcap table|equity|stake|dilution|pro[- ]rata|liquidation preference|board seat|warrants?|allocation|(?:we|i)(?:(?:'|’)(?:ll|d)| will| would| can| could)? (?:invest|commit|wire|transfer|sign|offer)|(?:our|my) (?:offer|commitment)|cheque of|check of|ticket of|wire|sign(?:ing)? (?:the|a|an)|letter of intent|\bloi\b|nda)\b/iu;

export function mentionsCommercialTerms(body: string): boolean {
  return COMMERCIAL_TERMS.test(body);
}

export type MessageSignOffInput = {
  /** The person switched on scoped delegation for this instruction. */
  readonly delegated: boolean;
  /** The reviewer's grade of this exact draft. */
  readonly reviewer: "PASSED" | "HELD" | "NOT_REVIEWED";
  readonly body: string;
  /** Code's check found every fact and number in the approved material. */
  readonly grounded: boolean;
  /** Code read the draft as accepting a concrete time. */
  readonly acceptsTime: boolean;
  /** Code read the draft as offering times. */
  readonly proposesTimes: boolean;
  /** It answers their question from declared facts. */
  readonly answersFromFacts: boolean;
};

/**
 * Who signs off this message. Order matters: every owner-only reason is
 * checked before anything routine, so a routine-looking message that also
 * commits a time or names terms still goes to the owner.
 */
export function messageSignOff(input: MessageSignOffInput): MessageSignOff {
  if (!input.delegated) return { by: "OWNER", reason: "NOT_DELEGATED" };
  if (input.acceptsTime) return { by: "OWNER", reason: "CALENDAR_COMMITMENT" };
  if (mentionsCommercialTerms(input.body)) {
    return { by: "OWNER", reason: "COMMERCIAL_TERMS" };
  }
  if (!input.grounded) return { by: "OWNER", reason: "RESTRICTED_DATA" };
  if (input.reviewer !== "PASSED") {
    return { by: "OWNER", reason: "REVIEWER_FLAGGED" };
  }
  return {
    by: "REVIEWER",
    kind: input.proposesTimes
      ? "PROPOSE_TIMES"
      : input.answersFromFacts
        ? "FACTUAL_ANSWER"
        : "ACKNOWLEDGEMENT",
  };
}

/**
 * Before the reviewer has graded (validation time): whether the planner's
 * "touches terms or money" flag alone may keep a delegated message from
 * the reviewer. Only real owner-only content does; the reviewer still has
 * to pass the draft before it goes (engine: `unreviewed`).
 */
export function termsFlagNeedsOwner(input: {
  readonly delegated: boolean;
  readonly body: string;
  readonly grounded: boolean;
  readonly acceptsTime: boolean;
}): boolean {
  return (
    messageSignOff({
      ...input,
      // Graded later; this asks only whether anything owner-only is there.
      reviewer: "PASSED",
      proposesTimes: false,
      answersFromFacts: false,
    }).by === "OWNER"
  );
}
