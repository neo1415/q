import type { PromptDefinition } from "../definition.js";
import type {
  GateQInterviewerResult,
  GateQInterviewerVariables,
} from "../schemas/gateq-interviewer.js";
import { GATEQ_INTERVIEWER_V3 } from "./gateq-interviewer.v3.js";

const RECORD_ANCHOR =
  "- asking: the dimension your question is about, or null.";
const CONTRADICTIONS_ANCHOR = "CONTRADICTIONS (trusted)\n{{contradictions}}";

/**
 * Live run 2026-11-13 (application 3ec9713b): "600 weekly" then "roughly
 * 1,500 weekly" was never raised, the later number simply replaced the
 * earlier, and "Yes, zero revenue so far. Of our roughly 1,500…" was not
 * read as the yes it was, so Q asked the same confirmation twice. Both are
 * now part of the one reading of the turn Q already makes: `conflicts` and
 * `readBackConfirmed`. Code keeps both statements and flags them; nothing
 * is decided by matching words.
 */
const template = GATEQ_INTERVIEWER_V3.template
  .replace(
    RECORD_ANCHOR,
    `${RECORD_ANCHOR}
- A new statement about something already on record ADDS to it unless they say it replaces it; then, and only then, set correction true.
- conflicts: when what they just said disagrees with something in KNOWN FACTS or RECENT TURNS about the same thing (two different user counts, two revenue figures, two dates) and they did not say which is right, list the dimension and quote their earlier words exactly in earlier. Never pick one of the two yourself, never repeat either back as settled, and ask them, in one short question naming both, which is right. A statement about something else ("we have not tested willingness to pay") is not a conflict.
- readBackConfirmed: when your last line in RECENT TURNS asked them to confirm a figure ("So that's USD 0 for revenue, right?"), true if their words agree with it, even when they go on to say more; false if they disagree, correct it or do not answer it. null when your last line asked no such thing. Once they have agreed, never ask the same confirmation again.`,
  )
  .replace(
    CONTRADICTIONS_ANCHOR,
    `${CONTRADICTIONS_ANCHOR}
Anything listed under CONTRADICTIONS that they have not yet settled is the next thing to ask about, in one short question naming both versions, unless they just answered it; their answer is recorded with correction true.`,
  );

export const GATEQ_INTERVIEWER_V4: PromptDefinition<
  GateQInterviewerVariables & { readonly recordableDimensions: string },
  GateQInterviewerResult
> = {
  ...GATEQ_INTERVIEWER_V3,
  version: 4,
  effectiveFrom: "2026-11-14",
  changeDescription:
    "Live run 2026-11-13: the turn reading also reports statements that disagree with the record (kept and flagged, never resolved) and whether the founder agreed to a figure Q read back, so a yes with more said is not asked again.",
  template,
};
