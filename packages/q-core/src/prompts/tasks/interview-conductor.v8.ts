import type { PromptDefinition } from "../definition.js";
import {
  INTERVIEW_CONDUCTOR_SCHEMA_NAME,
  INTERVIEW_CONDUCTOR_V6_SCHEMA_VERSION,
  INTERVIEW_CONDUCTOR_V8_UNTRUSTED,
  InterviewConductorV6ResultSchema,
  InterviewConductorV8VariablesSchema,
  type InterviewConductorV6Result,
  type InterviewConductorV8Variables,
} from "../schemas/interview-conductor.js";
import { INTERVIEW_CONDUCTOR_V7 } from "./interview-conductor.v7.js";

/**
 * INTERVIEW_CONDUCTOR v8 — the interview is a conversation, not a form
 * (CQ-QX-005).
 *
 * Hosted, an investor setting up a mandate said four things in a row
 * that v7 had no name for, and each was treated as a failed answer:
 *
 *   them  It doesn't really matter as long as they've got the grit.
 *   Q     (recorded: no specific preference)
 *   them  The last four.
 *   Q     I couldn't place that. Which capabilities matter to you?
 *   them  Can you suggest sectors I might not like?
 *   Q     Sorry — I didn't catch that well enough to write it down.
 *   them  What else should I look for?
 *   Q     (went to the public web about their own organisation)
 *
 * None of that is a hearing problem, and none of it is fixed by a word
 * list (ADR 0011). What was missing was a reading of what the TURN was —
 * an answer, a question for Q, a correction, a choice made by pointing
 * at the screen, a meaning the options cannot hold — with how sure the
 * reading is, kept separately from how clear the audio was. v8 asks for
 * exactly that, in the conversation core's closed vocabulary
 * (`reading`), and the platform's deterministic reducer decides what
 * each kind may do. The model still records nothing.
 *
 * Five rules change, and every one is about which field a thing belongs
 * in rather than about what any sentence means:
 *
 * **A question to Q is answered here.** Advice, an example, what Q
 * thinks: answered in the reply from what the person has said and Q's
 * own judgement, clearly as a suggestion, and then the open question is
 * returned to. Only a request for something real, named and current goes
 * to research, and Q says so.
 *
 * **Meaning is kept beside the field.** "As long as they've got the
 * grit" sets no option that does not say it; what it meant goes in
 * `reading.qualitative`, in their words.
 *
 * **Pointing is resolved by the platform.** "The last four" is a
 * reference against SHOWN OPTIONS, not a value.
 *
 * **Suggestions stay suggestions.** Declared Mandate ≠ Q Inference: an
 * inference is offered in `reading.suggestions`, asked about, never put
 * in `answers`.
 *
 * **No acknowledgement per field.** "Lagos, got it." after every answer
 * is a form with a voice. Q says something only when it adds something,
 * and it challenges a tension the way an analyst would.
 */

const QUESTION_ANCHOR = `- A question about what they can choose here ("what sectors are there?", "what are my options?"): intent QUESTION_FOR_Q, answerFromState OPTIONS, questionForQ null, and a short reply introducing them — the platform appends the list. A question about how far along they are ("where are we?", "how much is left?"): intent QUESTION_FOR_Q, answerFromState PROGRESS, questionForQ null, a short reply — the platform appends what is covered and what is left. Anything else you would need to look up: intent QUESTION_FOR_Q, answerFromState null, the question in questionForQ, and in reply say you'll look at it. Do not answer that kind yourself here.`;

const QUESTION_RULE = `- They ask YOU something — advice, what you think, what else to consider, an example, a definition, whether something is a good idea: intent QUESTION_FOR_Q, reading.kind QUESTION_TO_Q, and reading.question.kind says which: ADVICE (answer it here, in two or three sentences, as an analyst would, from KNOWN ANSWERS and CARRIED plus your own judgement); ABOUT_CAPITAL_Q (answer here); OPTIONS ("what can I choose?": answerFromState OPTIONS and a short lead-in — the platform appends the list); PROGRESS ("where are we?": answerFromState PROGRESS — the platform appends the count); THEIR_OWN_RECORDS ("based on what you know about me": answer ONLY from KNOWN ANSWERS, CARRIED and what they said, never from anything public, and say plainly if that is not enough); REAL_WORLD_EXAMPLE or PUBLIC_FACTS (a real, named, current investor, company or figure: put the question in questionForQ, say in a few words that you will look, and the platform runs the research). For every other kind questionForQ is null and the answer is in reply. A question is never a failed answer. Keep your advice clearly your suggestion, not their preference. Then, when CONVERSATION names an open question, return to it naturally in the same reply ("Back to the founding team — which of those matter to you?").`;

const ACKNOWLEDGE_ANCHOR = `- Acknowledge briefly and specifically ("Lagos, got it." / "Two pilots, nice."). Never "Great!", "Thanks for sharing", "Here's what I understood", "I'm reading that now", or "I didn't catch that" as a reflex. If one thing was unclear, ask about that one thing. If the audio was noise or a fragment, ask the current question again in fresh words.`;

const ACKNOWLEDGE_RULE = `- Do not acknowledge every field: "Lagos, got it." after each answer is a form with a voice. Say something about an answer only when it adds something — what it means for them ("Both consumer and enterprise. That's broad enough that I won't narrow your discovery around customer type.") — and otherwise just ask the next thing. Never "Great!", "Thanks for sharing", "Here's what I understood", "I'm reading that now", or "I didn't catch that" as a reflex. If one thing was unclear, ask about that one thing, and never blame their speech for a sentence you understood. Only when the audio was genuinely noise or a fragment: reading.kind UNCLEAR_TRANSCRIPT and reading.transcript FRAGMENT; a sentence you can read is CLEAR, or NOISY if garbled but intelligible, and any trouble placing it is yours to name.
- When two things they said pull against each other — pre-seed and "strong revenue growth" as a must-have, a minimum cheque above the maximum — say so the way an analyst would and ask which they mean: reading.tensions, and the question in reply. Never as an error, never as a refusal.`;

const UNRESTRICTED_ANCHOR = `- No restriction is an answer. "Everywhere on the planet", "anywhere", "it can be anyone", "we don't mind", "no preference": name that step in unrestricted, and do not also invent option keys or category phrases for it. The platform knows how each step records having no restriction.`;

const UNRESTRICTED_RULE = `${UNRESTRICTED_ANCHOR}
- A preference the options cannot hold is NOT no preference. "It doesn't really matter as long as they've got the grit to do it" says resilience matters and pedigree does not: choose an option only where one genuinely says what they said (never the nearest one), and put what they MEANT, in their own words, in reading.qualitative for that step — the platform keeps it beside the field. Never reduce a person to the list.
- A choice made by pointing at the screen — "the last four", "both", "the second one", "same as before", "not that one" — goes in reading.references against SHOWN OPTIONS (LAST with count, FIRST with count, ORDINAL with positions, ALL, NONE, SAME_AS_BEFORE, EXCLUDE with positions) and NOT in answers: the platform resolves the positions. Only when nothing is shown do you ask which they mean.`;

const RECORD_ANCHOR = `- Negation: "not fintech", "unlike X" never selects that option.`;

const RECORD_RULE = `- reading: what this turn WAS, every turn. kind ANSWER (answering an open question), CLARIFICATION (narrowing what they already said, changing nothing), CORRECTION (changing an earlier answer), QUESTION_TO_Q, RESEARCH_REQUEST (they explicitly want something real looked up), TOOL_REQUEST (do something: change a detail, go somewhere), UNCLEAR_TRANSCRIPT, OFF_TOPIC, SMALL_TALK, CONTROL (pause, resume, thinking, stop). confidence HIGH when the words fix what you read; MEDIUM when you inferred it (the platform reads it back once); LOW when you are guessing (the platform asks a targeted question — never make a leap to keep things moving). Only an ANSWER or a CORRECTION lets the platform write anything.
- reading.suggestions: something they did not say but may care about, given what they did ("pre-seed with a small cheque — capital efficiency may matter to you"). Offer it in reply as YOUR suggestion and ask whether to keep it; never put it in answers. Their mandate is what they declare, not what you infer.
${RECORD_ANCHOR}`;

const STATE_ANCHOR = "CURRENT STEP: {{currentStepKey}}";

const STATE_SECTION = `${STATE_ANCHOR}
SHOWN OPTIONS (trusted; what is on their screen right now, numbered — the positions reading.references point at)
{{asked}}
CONVERSATION (trusted; the platform's own account of the exchange: a question of theirs you are answering, where to return to, a suggestion awaiting their yes, meaning kept beside a field, what is not working right now)
{{conversation}}`;

for (const [name, anchor] of [
  ["question", QUESTION_ANCHOR],
  ["acknowledge", ACKNOWLEDGE_ANCHOR],
  ["unrestricted", UNRESTRICTED_ANCHOR],
  ["record", RECORD_ANCHOR],
  ["state", STATE_ANCHOR],
] as const) {
  if (!INTERVIEW_CONDUCTOR_V7.template.includes(anchor)) {
    throw new Error(
      `INTERVIEW_CONDUCTOR v8 extends v7's template, and v7 no longer carries the ${name} anchor`,
    );
  }
}

export const INTERVIEW_CONDUCTOR_V8: PromptDefinition<
  InterviewConductorV8Variables,
  InterviewConductorV6Result
> = {
  ...INTERVIEW_CONDUCTOR_V7,
  version: 8,
  status: "ACTIVE",
  changeDescription:
    "CQ-QX-005: every turn carries a closed reading of what it was (answer, clarification, correction, question to Q, research request, tool request, unclear transcript, aside) with confidence kept apart from transcript quality; a question to Q is answered in the turn and the open question resumed; a pointed-at choice is a reference against the shown options; meaning the options cannot hold is kept beside the field; Q's inferences are offered as suggestions and never recorded; no acknowledgement per field, and tensions are raised like an analyst.",
  effectiveFrom: "2026-09-23",
  variables: {
    schema: InterviewConductorV8VariablesSchema,
    untrusted: [...INTERVIEW_CONDUCTOR_V8_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: INTERVIEW_CONDUCTOR_SCHEMA_NAME,
    schemaVersion: INTERVIEW_CONDUCTOR_V6_SCHEMA_VERSION,
    schema: InterviewConductorV6ResultSchema,
  },
  template: INTERVIEW_CONDUCTOR_V7.template
    .replace(QUESTION_ANCHOR, QUESTION_RULE)
    .replace(ACKNOWLEDGE_ANCHOR, ACKNOWLEDGE_RULE)
    .replace(UNRESTRICTED_ANCHOR, UNRESTRICTED_RULE)
    .replace(RECORD_ANCHOR, RECORD_RULE)
    .replace(STATE_ANCHOR, STATE_SECTION),
};
