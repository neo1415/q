import type { PromptId } from "./definition.js";

/**
 * What a prompt variable says when there is nothing to put in it.
 *
 * An empty or absent value renders as "(not provided)" (definition.ts
 * formatValue). That is ambiguous wherever the prompt's own rules turn on
 * the field being empty: live 2026-10-29, RESEARCH_PLAN read "(not
 * provided)" under OPEN QUESTIONS as a later round with nothing open and
 * planned no questions, and JOB_PLAN read "(none)" beside a clear job as
 * nothing to plan. Each value below names the case in the words the
 * prompt's rule uses, so a model never has to guess what an empty field
 * means. formatValue itself is unchanged: every recorded prompt hash
 * depends on it.
 *
 * Code passes these through `orEmptyCase` at the call site. The audit
 * test (test/prompt-empty-cases.test.ts) renders each active prompt with
 * these values and checks the section states the case, and that every
 * section header which describes an empty case has an entry here.
 */
export const PROMPT_EMPTY_CASES = {
  INTERVIEW_AGENT: {
    // "WHAT YOU HAVE ALREADY DONE THIS TURN (...; empty before your first action)"
    thisTurn: "Empty: nothing yet, this is before your first action.",
    // "CONDUCT (... follow it exactly)": nothing to follow on an opening.
    conduct: "Nothing to follow this turn: no decision about small talk.",
    // "If WHAT ELSE THIS TURN ASKS says research is starting ..."
    turnNotes: "Nothing else: this turn asks for nothing beyond the setup.",
    // "Your recent replies began as listed under HOW YOUR LAST REPLIES BEGAN"
    openings: "None yet: you have not replied in this conversation.",
  },
  DELEGATION_READER: {
    // "THE STEP Q WAS ASKING (trusted; null when none)"
    askedStep: "null (Q was not asking about any one step)",
  },
  FIT_EXPLANATION: {
    // "Restate the supplied overall label ... or null if none was supplied."
    overallFit: "None was supplied.",
    // "... unless the supplied relationship state says so."
    relationshipState: "None recorded.",
  },
  TURN_READER: {
    // "SHOWN ... one line per earlier turn of yours"; "when nothing was shown yet"
    shown:
      "Nothing yet: you have said and shown nothing earlier in this conversation.",
  },
  GATEQ_INTERVIEWER: {
    // "WHAT THEY JUST SAID is empty on the first turn. That is your opening"
    utterance: "(empty: this is the first turn; they have said nothing yet)",
  },
  WORK_CONVERSE: {
    // "WHAT YOU MAY SAY (approved by ...; empty means nothing)"
    brief: "(empty: nothing is approved to say)",
    // "WHAT ... WANTS TO LEARN, still open (one per line; empty means nothing)"
    topicsOpen: "(empty: nothing is left to learn)",
  },
  MEETING_HOST_TURN: {
    // "WHAT IS SHOWN IN THE CALL (...; empty when nothing)"; "If nothing is shown, say ..."
    seen: "(empty: nothing is shown in the call right now)",
    // "PREPARED CONTEXT (...; empty when none)"
    prepared: "(empty: nothing was prepared for this call)",
    memory: "(empty: nothing is recorded yet)",
  },
  CALL_PREP: {
    // "If nothing is given, say this is the first contact."
    soFar:
      "Nothing is given: no messages, calls or meetings with them are on record.",
  },
  WELCOME_CONDUCTOR: {
    // "If KNOWN NAME is known, use it; if it is null, you may also ask ..."
    knownName: "null",
    knownOrganisation: "null",
  },
  JOB_PLAN: {
    // '"(none)" when it refers to none: then plan the job from its own words'
    priorAnswer: "(none)",
  },
  RESEARCH_PLAN: {
    // "OPEN QUESTIONS (...; on the first round it says it is the first round)"
    gaps: "None yet: this is the first round. Plan the full investigation the request needs.",
  },
  PLAN_WRITE: {
    // "MODE: NEW: write the plan. REDRAFT: rewrite PRIOR PLAN ..."
    priorPlan: "None: MODE is NEW, there is no prior plan.",
    fixes: "None.",
  },
} as const satisfies Partial<
  Record<PromptId, Readonly<Record<string, string>>>
>;

/** The value when there is one; otherwise the case said plainly. */
export function orEmptyCase(
  value: string | null | undefined,
  emptyCase: string,
): string {
  return value === null || value === undefined || value.trim().length === 0
    ? emptyCase
    : value;
}
