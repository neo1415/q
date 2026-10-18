import type { PromptDefinition } from "../definition.js";
import {
  REHEARSAL_TURN_SCHEMA_NAME,
  REHEARSAL_TURN_V8_SCHEMA_VERSION,
  RehearsalTurnV8ResultSchema,
  RehearsalTurnV8VariablesSchema,
  type RehearsalTurnV8Result,
  type RehearsalTurnV8Variables,
} from "../schemas/rehearsal.js";
import { INVESTOR_TWIN_TURN_V9 } from "./investor-twin-turn.v9.js";

const V9_INVESTOR =
  "- As an INVESTOR: ask what they would really ask -- the persona's likely questions, hardest first, and questions from the founder's own pitch transcripts, deck and record below (\"In your pitch you said...\"). Press (FOLLOW_UP) on a vague, unsupported or dodged answer. Throw a curve ball now and then (a competitor, a bad scenario, a number that does not add up).";
const V10_INVESTOR = `${V9_INVESTOR}
- Question the way HOW THIS PERSON QUESTIONS says: their opening, their order, their habits and how many follow-ups they give a thread before moving on. Two different investors must never sound alike.
- One question at a time. Build on their last answer: pick up their exact words ("you said forty percent -- of what?"), never re-ask what they already answered, and when a number or claim conflicts with something earlier in the meeting or the material, say so.
- Keep track of threads: an important question they dodged comes back later, in this person's way ("Going back to churn -- you didn't answer that"). A strong answer earns a brief, specific acknowledgement before you move on, never generic praise.
- Never open two turns the same way; vary how you start, as a real person does.`;

const V9_SCREEN =
  "- A frame of their shared screen is attached when screenShared is true: look at it and react or ask about what is on it, as the person would.";
const V10_SCREEN = `${V9_SCREEN}
- screenNote: when screenShared is true and the screen shows something new since THE MEETING SO FAR (a new slide, a model, a demo), fill shows (what it shows, numbers copied exactly as written, one or two sentences) and take (a short coaching note for their review, out of character: a missing source, a number that conflicts with what they said, a cluttered slide, the one thing to fix). Otherwise null. Never describe people or faces in it.`;

const V9_RESPOND =
  "(appraisal, line, move, mood, intensity, reaction, conclusion, presence, askedToSee, wantsToEnd, onlyNoise).";
const V10_RESPOND =
  "(appraisal, line, move, mood, intensity, reaction, conclusion, presence, askedToSee, wantsToEnd, onlyNoise, screenNote).";

const V9_TEMPERAMENT = "YOUR TEMPERAMENT (composed by code)";
const V10_TEMPERAMENT = `HOW THIS PERSON QUESTIONS (composed by code)
{{questioning}}

YOUR TEMPERAMENT (composed by code)`;

function replaced(template: string): string {
  let out = template;
  for (const [from, to] of [
    [V9_INVESTOR, V10_INVESTOR],
    [V9_SCREEN, V10_SCREEN],
    [V9_RESPOND, V10_RESPOND],
    [V9_TEMPERAMENT, V10_TEMPERAMENT],
  ] as const) {
    if (!out.includes(from)) {
      throw new Error(`INVESTOR_TWIN_TURN v10: v9 text moved: ${from}`);
    }
    out = out.replace(from, to);
  }
  return out;
}

/**
 * INVESTOR_TWIN_TURN v10 -- founder brief P3 and P5 (2026-10-06): each
 * played investor questions in a distinct, code-composed style (opening,
 * order, habits, follow-up depth) and tracks threads across the meeting;
 * a shared screen gets a private coaching note (screenNote) kept for the
 * person's review.
 */
export const INVESTOR_TWIN_TURN_V10: PromptDefinition<
  RehearsalTurnV8Variables,
  RehearsalTurnV8Result
> = {
  ...INVESTOR_TWIN_TURN_V9,
  version: 10,
  status: "ACTIVE",
  changeDescription:
    "Founder brief P3/P5 2026-10-06: distinct questioning styles composed by code, thread tracking and specific follow-ups; screenNote for the review when a screen is shared.",
  effectiveFrom: "2026-10-06",
  variables: {
    ...INVESTOR_TWIN_TURN_V9.variables,
    schema: RehearsalTurnV8VariablesSchema,
  },
  output: {
    kind: "STRUCTURED",
    schemaName: REHEARSAL_TURN_SCHEMA_NAME,
    schemaVersion: REHEARSAL_TURN_V8_SCHEMA_VERSION,
    schema: RehearsalTurnV8ResultSchema,
  },
  template: replaced(INVESTOR_TWIN_TURN_V9.template),
};
