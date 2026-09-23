import type { PromptDefinition } from "../definition.js";
import {
  INTERVIEW_CONDUCTOR_SCHEMA_NAME,
  INTERVIEW_CONDUCTOR_V4_UNTRUSTED,
  INTERVIEW_CONDUCTOR_V5_SCHEMA_VERSION,
  InterviewConductorV4VariablesSchema,
  InterviewConductorV5ResultSchema,
  type InterviewConductorV4Variables,
  type InterviewConductorV5Result,
} from "../schemas/interview-conductor.js";
import { INTERVIEW_CONDUCTOR_V6 } from "./interview-conductor.v6.js";

/**
 * INTERVIEW_CONDUCTOR v7 — the turn is measured against the whole
 * objective, not against the one question in hand (Workstream A).
 *
 * Every version up to here asked the model to read the current step and
 * treated everything else as an aside. People do not talk that way.
 * Live, asked for a role:
 *
 *   them  I'm the founder. We just started investing. Mostly fintech and
 *         software, and we're open globally.
 *   Q     Thanks. And are you deploying capital right now?
 *
 * Four answers in one breath — title, deployment status, sectors,
 * geography — and the session recorded the title. Then it asked for the
 * deployment status it had just been given, and two questions later for
 * the sectors, and two after that for the geography. The person is not
 * being listened to; they are being processed.
 *
 * Three changes, and none of them is a new meaning the model invents.
 *
 * **Read the whole sentence against every open step.** answers already
 * takes twelve. It was being filled with one. The platform decides what
 * it can record and when; the model's job is not to pre-filter on the
 * platform's behalf, because it does not know the journey's order and
 * guessing at it is how information gets dropped.
 *
 * **Say when there is no restriction.** "Everywhere on the planet", "it
 * can be anyone", "no preference" are answers, not silence and not
 * skips. They are usually not expressible as option keys — the journey
 * records no geographic restriction as an empty geography — so the model
 * names the step in `unrestricted` and the step decides what that means.
 * Without it, "everywhere on the planet" reached the taxonomy
 * classifier, matched nothing, and the geography question came back.
 *
 * **Say when a figure has no scale.** "Maximum cheque is one hundred"
 * names the field perfectly and leaves the amount entirely open.
 * Recording 100 is wrong; guessing 100,000,000 is worse. clarity
 * SCALE_UNCLEAR, and the platform asks.
 *
 * And two rules about how Q sounds, both of which the live transcript
 * broke: never read a stored figure out as digits, and never say an
 * internal term like "mandate context" to somebody who came here to
 * describe how they invest.
 */

/** v1's one line about not re-asking, which was the whole turn model. */
const TURN_ANCHOR =
  "- Never re-ask what KNOWN ANSWERS, DOCUMENT PROPOSALS or this turn already answered. One sentence may answer several steps: take all of them.";

const TURN_RULE = `- EVERY TURN, read what they said against EVERY step in OPEN STEPS, not only the current one. One sentence commonly answers three or four ("I'm the founder, we just started investing, mostly fintech, and we're open globally" is a role, a deployment status, sectors and a geography). Put every one of them in answers, each under its own step key. Taking only the current step's part and letting the rest go is the single worst thing you can do here: the platform cannot recover what you did not read.
- Answer a step whether or not the journey has reached it. You do not know its order and you must not guess at it — record what they said, under the step it belongs to, and let the platform decide when it can be written. Something they volunteer early is held and used when its turn comes; it is never lost and never asked for again.
- Never re-ask what KNOWN ANSWERS, CARRIED, DOCUMENT PROPOSALS or this turn already answered. When a step you already have comes round, acknowledge it in a few words and move past it, or say nothing and move past it. Do not ask it again in different words.
- No restriction is an answer. "Everywhere on the planet", "anywhere", "it can be anyone", "we don't mind", "no preference": name that step in unrestricted, and do not also invent option keys or category phrases for it. The platform knows how each step records having no restriction.`;

/** v1's confirmation rule, which asked for a read-back of nearly everything. */
const CONFIRM_ANCHOR =
  "- confidence HIGH when the words map plainly; MEDIUM when inferred. Money, revenue, customer counts, cheque sizes and exclusions are always read back in reply and the person asked if that is right, in that same turn and before any other question; the platform holds them until confirmed.";

const CONFIRM_RULE = `- confidence HIGH when the words map plainly; MEDIUM when inferred.
- clarity SETTLED when the words fix the value. clarity SCALE_UNCLEAR when a figure is given with no magnitude and the magnitude is the question — "maximum cheque is one hundred" could be a hundred thousand or a hundred million, and both recording a hundred and guessing a hundred million are wrong. clarity UNIT_UNCLEAR when the quantity is fixed and what it counts is not. Put what they actually said in value and let the platform ask; never resolve a scale yourself.
- Do not ask them to confirm things. "I'm the founder", "we invest globally", "fintech and software" are unambiguous, and reading each one back turns a conversation into a form. Acknowledge in a few words and ask the next thing you do not have. The platform decides on its own which values it must hold for confirmation — money and exclusions among them — and it composes that question itself, so you do not need to.`;

/** The numbers-and-plain-words rule, extended. */
const SPEECH_ANCHOR =
  'Numbers and money as a person says them aloud ("one and a half million dollars", "about forty customers").';

const SPEECH_RULE = `Numbers and money as a person says them aloud ("one and a half million dollars", "about forty customers"). NEVER write a bare stored figure — not 50000, not 3000000. Fifty thousand euros, or three million. If a value reaches you as digits, say it the way a person would.
- Plain words only, never the platform's internal vocabulary. Never say "mandate context", "step", "field", "option key", "reference select", "taxonomy", "journey" or "session" to them. Ask what you want to know the way an analyst would: "are we setting up your main investment strategy?" rather than anything about a mandate context. They came to describe how they invest.
- If they say they have already told you this, or that they are getting annoyed, they are almost certainly right and something you read did not go in. Do not repeat the question that failed. Say plainly what you are still missing, in ordinary words, and nothing else.`;

/** Where the platform's held-but-unrecorded readings are rendered. */
const CARRIED_ANCHOR = "PENDING CONFIRMATIONS (waiting for yes or no)";

const CARRIED_SECTION = `CARRIED (trusted; they told you these, the platform is holding them and still recording them — never ask for them again, and never say they are saved)
{{carried}}
${CARRIED_ANCHOR}`;

for (const anchor of [
  TURN_ANCHOR,
  CONFIRM_ANCHOR,
  SPEECH_ANCHOR,
  CARRIED_ANCHOR,
]) {
  if (!INTERVIEW_CONDUCTOR_V6.template.includes(anchor)) {
    throw new Error(
      `INTERVIEW_CONDUCTOR v7 extends v6's template, and v6 no longer carries: ${anchor.slice(0, 60)}`,
    );
  }
}

export const INTERVIEW_CONDUCTOR_V7: PromptDefinition<
  InterviewConductorV4Variables,
  InterviewConductorV5Result
> = {
  ...INTERVIEW_CONDUCTOR_V6,
  version: 7,
  status: "ACTIVE",
  changeDescription:
    "Workstream A: every turn is read against every open step rather than the current one, an answer volunteered before its step is recorded rather than dropped, no restriction is a reading of its own, a figure with no scale is asked about rather than guessed, confirmation is reserved for what the platform decides it must hold, and Q speaks figures and questions in plain words rather than digits and internal vocabulary.",
  effectiveFrom: "2026-09-23",
  variables: {
    schema: InterviewConductorV4VariablesSchema,
    untrusted: [...INTERVIEW_CONDUCTOR_V4_UNTRUSTED],
  },
  output: {
    kind: "STRUCTURED",
    schemaName: INTERVIEW_CONDUCTOR_SCHEMA_NAME,
    schemaVersion: INTERVIEW_CONDUCTOR_V5_SCHEMA_VERSION,
    schema: InterviewConductorV5ResultSchema,
  },
  template: INTERVIEW_CONDUCTOR_V6.template
    .replace(TURN_ANCHOR, TURN_RULE)
    .replace(CONFIRM_ANCHOR, CONFIRM_RULE)
    .replace(SPEECH_ANCHOR, SPEECH_RULE)
    .replace(CARRIED_ANCHOR, CARRIED_SECTION),
};
