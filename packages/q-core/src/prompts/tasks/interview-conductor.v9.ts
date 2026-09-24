import type { PromptDefinition } from "../definition.js";
import type {
  InterviewConductorV6Result,
  InterviewConductorV8Variables,
} from "../schemas/interview-conductor.js";
import { INTERVIEW_CONDUCTOR_V8 } from "./interview-conductor.v8.js";

/**
 * INTERVIEW_CONDUCTOR v9 — v8, with one turn allowed to do several things
 * (CQ-QX-005, acceptance walkthrough E1).
 *
 * "Yes that's right. Oh wait, actually the max is more like 300k, not
 * 250. And what would you look for in a company if you were me?" is a
 * confirmation, a correction and a question in one breath. v8 made the
 * reading one kind, so a model had to choose: read it as a question and
 * nothing it confirmed or corrected was written (while its reply said
 * "noted"), or read it as an answer and drop the question. The kind is
 * still one — it is what may write — but a writing turn may now carry
 * the person's question beside it, and the platform answers and resumes
 * exactly as it does for a question on its own.
 */
const ANCHOR = "- reading.clears:";

const SEVERAL_THINGS = `- One turn can confirm, correct and ask at once ("yes — actually 300k — what would you look for?"): the yes in confirmations, the change in answers, reading.kind CORRECTION, their question in reading.question; your reply answers it. Drop nothing; never say a change is noted unless it is in answers or confirmations.
`;

/**
 * Room for the rule above inside a small model's request budget: two
 * sentences of v8's acknowledgement rule said again more briefly, with
 * nothing of what they ask lost.
 */
const EXAMPLE_LONG = `Say something about an answer only when it adds something — what it means for them ("Both consumer and enterprise. That's broad enough that I won't narrow your discovery around customer type.") — and otherwise just ask the next thing. Never "Great!", "Thanks for sharing", "Here's what I understood", "I'm reading that now", or "I didn't catch that" as a reflex.`;
const EXAMPLE_SHORT = `Say something about an answer only when it adds meaning for them; otherwise just ask the next thing. Never "Thanks for sharing" or "I didn't catch that" as a reflex.`;

/**
 * askNext binds both ways (adversarial round 1, c): Q asked about sector
 * strength in its own words while declaring geography strength, and the
 * answer was recorded against geography. The declared step is the step
 * the reply's question asks, and nothing when it asks nothing.
 */
const ASK_NEXT_LONG = `- askNext: the step you ask in reply; prefer the current step, follow their lead when they're already on another. showOptions true only when options genuinely help (more than three plausible choices, or they seem unsure).`;
const ASK_NEXT_SHORT = `- askNext: exactly the step your reply's question asks, null if it asks none; prefer the current step, follow their lead when they're already on another. showOptions true only when options help (over three plausible choices, or they seem unsure).`;

if (!INTERVIEW_CONDUCTOR_V8.template.includes(ASK_NEXT_LONG)) {
  throw new Error(
    "INTERVIEW_CONDUCTOR v9 tightens v8's askNext rule, and v8 no longer carries it",
  );
}
if (!INTERVIEW_CONDUCTOR_V8.template.includes(EXAMPLE_LONG)) {
  throw new Error(
    "INTERVIEW_CONDUCTOR v9 shortens v8's acknowledgement rule, and v8 no longer carries it",
  );
}
if (!INTERVIEW_CONDUCTOR_V8.template.includes(ANCHOR)) {
  throw new Error(
    "INTERVIEW_CONDUCTOR v9 extends v8's reading rules, and v8 no longer carries the clears rule it follows",
  );
}

export const INTERVIEW_CONDUCTOR_V9: PromptDefinition<
  InterviewConductorV8Variables,
  InterviewConductorV6Result
> = {
  ...INTERVIEW_CONDUCTOR_V8,
  version: 9,
  status: "DEPRECATED",
  changeDescription:
    "CQ-QX-005 E1: a turn may confirm, correct and ask at once; the writing kind carries the person's question beside it, so nothing they confirmed or changed is dropped and the question is still answered in the turn.",
  effectiveFrom: "2026-09-24",
  template: INTERVIEW_CONDUCTOR_V8.template
    .replace(ANCHOR, `${SEVERAL_THINGS}${ANCHOR}`)
    .replace(EXAMPLE_LONG, EXAMPLE_SHORT)
    .replace(ASK_NEXT_LONG, ASK_NEXT_SHORT),
};
