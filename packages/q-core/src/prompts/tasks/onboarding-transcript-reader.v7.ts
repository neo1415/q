import type { PromptDefinition } from "../definition.js";
import type {
  OnboardingTranscriptReaderV3Result,
  OnboardingTranscriptReaderVariables,
} from "../schemas/onboarding-transcript-reader.js";
import { ONBOARDING_TRANSCRIPT_READER_V6 } from "./onboarding-transcript-reader.v6.js";

/**
 * ONBOARDING_TRANSCRIPT_READER v7 — live 2026-10-30 (production 92a12534c,
 * Granary), two readings:
 *
 * - A long answer about what the company does was saved as the founder's
 *   raw words minus "so basically, um". The agreed behaviour (owner
 *   2026-10-17): a step told at length is saved as Q's summary that Q
 *   said back and they agreed to. The reading names Q's words for it once
 *   they agree; until then, their words, which are only held for their
 *   yes. Code checks that every word is in Q's line they answered.
 * - "No website yet" was given as the website's value, refused, and the
 *   website stayed open, asked again. A plain statement that they do not
 *   have what an optional step asks for settles it: declined, never a
 *   value, so unknown stays unknown and is not asked again.
 */
const V6_READ_BACK =
  "- When Q read something back or suggested a value and the person agreed to it in their very next line, that value is their answer: quote their agreeing words.";
const V7_READ_BACK = `${V6_READ_BACK}
- A step of kind LONG_TEXT is told at length (what the company does, the problem, how it makes money, and the like) and is saved only as Q's summary that they agreed to. When Q said back in its own words what they told it for such a step and they agreed in their next line without changing or adding to it, the value is Q's words for that step exactly as Q said them (only the part about that step), and the quote is their agreeing words. Until they have agreed to one, give what they said for it in their own words, with their words as the quote.`;
const V6_DECLINED =
  '- An optional step they plainly chose not to answer ("no preference", "skip that", "rather not say") goes under declined, with their words. A required step is never declined: leave it out.';
const V7_DECLINED = `${V6_DECLINED}
- When they say plainly that they do not have what an optional step asks for (no website yet, no revenue so far), that settles it: put it under declined with those words, never as a value, so it is not asked again.`;

for (const anchor of [V6_READ_BACK, V6_DECLINED]) {
  if (!ONBOARDING_TRANSCRIPT_READER_V6.template.includes(anchor)) {
    throw new Error(
      "ONBOARDING_TRANSCRIPT_READER v7 extends v6, which lost an anchor",
    );
  }
}

export const ONBOARDING_TRANSCRIPT_READER_V7: PromptDefinition<
  OnboardingTranscriptReaderVariables,
  OnboardingTranscriptReaderV3Result
> = {
  ...ONBOARDING_TRANSCRIPT_READER_V6,
  version: 7,
  status: "ACTIVE",
  changeDescription:
    "Live 2026-10-30 (Granary): a LONG_TEXT step is Q's summary they agreed to, in Q's words; a stated absence (no website yet) of an optional step is declined, never a value.",
  effectiveFrom: "2026-10-30",
  template: ONBOARDING_TRANSCRIPT_READER_V6.template
    .replace(V6_READ_BACK, V7_READ_BACK)
    .replace(V6_DECLINED, V7_DECLINED),
};
