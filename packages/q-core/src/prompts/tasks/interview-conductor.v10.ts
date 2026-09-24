import type { PromptDefinition } from "../definition.js";
import {
  INTERVIEW_CONDUCTOR_SCHEMA_NAME,
  INTERVIEW_CONDUCTOR_V7_SCHEMA_VERSION,
  InterviewConductorV7ResultSchema,
  type InterviewConductorV7Result,
  type InterviewConductorV8Variables,
} from "../schemas/interview-conductor.js";
import { INTERVIEW_CONDUCTOR_V9 } from "./interview-conductor.v9.js";

/**
 * INTERVIEW_CONDUCTOR v10: v9, with how a reply sounds asked for beside it
 * and never written into it (CQ-VOICE-010).
 *
 * v1 to v9 let the model put one "[laughs]", "[sighs]" or "[chuckles]"
 * INTO the reply when EXPRESSIVE was true. The reply is what Q said: the
 * transcript shows it, the interview thread stores it and memory may learn
 * from it. So the stage direction went all of those places too. On a voice
 * that cannot render it, it was also read out ("[laughs]" was measured as
 * "Halfs"). v10 takes that rule out. It says that a reply carries no stage
 * directions at all, and it offers a closed `delivery` cue (q-core
 * speech/delivery.ts `SpeechCueSchema`) for the few moments that call for
 * one. The speech layer renders what the chosen voice can and drops the
 * rest.
 */
const EXPRESSIVE_RULE =
  "- EXPRESSIVE is {{expressive}}. Only when true you may use at most one of [laughs] [sighs] [chuckles] per reply, sparingly, where a person would; when false, never.\n";

/**
 * No longer than the rule it replaces. The rendered interview already
 * sits at the small-model request budget
 * (interviewer-prompt-budget.test.ts), so every character here is paid
 * for elsewhere.
 */
const DELIVERY_RULE =
  "- reply is words only, never [tags]. delivery is usually null; LAUGH, CHUCKLE or SIGH opens the reply so, PAUSE follows its first sentence; only where it is meant.\n";

/**
 * Q's own words as something to point at, and the whole sentence read
 * against every step (CQ-QX-005, founder and investor round 2): "the
 * second number you said" stored an unrelated figure, "go with what you
 * said" left the step open, "both full time" after two founders matched
 * nothing, exclusions and facts said ahead of their step were dropped,
 * and "about to raise" was read as raising now.
 */
const READING_ANCHOR = "- reading.clears:";
const OWN_WORDS_RULE = `- offered: whenever your reply puts concrete values in front of them for a step ("25 or 30k?", a figure you suggest), list them under that step in the step's value form, in the order you said them. When they then point at what YOU said ("the second number you said", "go with what you said"), put reading.references select OFFERED (ordinals for which one); when a step takes the value of another they just gave ("both full time" after two founders), select VALUE_OF with from that step. Never a guessed value in answers for those.
- Read the whole sentence against every open step: a later step's answer said early (exclusions, a stage, a currency with an amount, a co-founder named as a count) goes in answers or categoryPhrases for that step now. "About to raise" or "getting ready to" is preparing, not raising now. They do not have something optional ("no website yet"): put that step in skips.
`;

if (!INTERVIEW_CONDUCTOR_V9.template.includes(READING_ANCHOR)) {
  throw new Error(
    "INTERVIEW_CONDUCTOR v10 extends v9's reading rules, and v9 no longer carries the clears rule",
  );
}

if (!INTERVIEW_CONDUCTOR_V9.template.includes(EXPRESSIVE_RULE)) {
  throw new Error(
    "INTERVIEW_CONDUCTOR v10 replaces v9's EXPRESSIVE rule, and v9 no longer carries it",
  );
}

export const INTERVIEW_CONDUCTOR_V10: PromptDefinition<
  InterviewConductorV8Variables,
  InterviewConductorV7Result
> = {
  ...INTERVIEW_CONDUCTOR_V9,
  version: 10,
  status: "ACTIVE",
  changeDescription:
    "CQ-VOICE-010: no audio tags inside the reply (they reached the transcript, the thread and memory, and a voice that cannot render them read them aloud); how a reply sounds is asked for in a closed `delivery` field beside it, rendered by the speech layer only where the voice can. CQ-QX-005: the values Q puts forward are listed in `offered` and can be pointed at (OFFERED), a step can take another's value (VALUE_OF), and the whole sentence is read against every step — facts and exclusions said early, 'about to raise' as preparing, an optional thing they do not have as a skip.",
  effectiveFrom: "2026-09-24",
  output: {
    kind: "STRUCTURED",
    schemaName: INTERVIEW_CONDUCTOR_SCHEMA_NAME,
    schemaVersion: INTERVIEW_CONDUCTOR_V7_SCHEMA_VERSION,
    schema: InterviewConductorV7ResultSchema,
  },
  template: INTERVIEW_CONDUCTOR_V9.template
    .replace(EXPRESSIVE_RULE, DELIVERY_RULE)
    .replace(READING_ANCHOR, `${OWN_WORDS_RULE}${READING_ANCHOR}`),
};
