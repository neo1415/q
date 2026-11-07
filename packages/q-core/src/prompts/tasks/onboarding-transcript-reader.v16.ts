import { ONBOARDING_TRANSCRIPT_READER_V15 } from "./onboarding-transcript-reader.v15.js";

/**
 * ONBOARDING_TRANSCRIPT_READER v16 — the owner's mandatory set (DECISIONS
 * 79, 7 Nov 2026). Every field the profile shows is required now, the
 * website among them, with "no website yet" as unknown. v15 settled "I
 * don't have one" only for an optional step and left a required one out,
 * so Q would ask it again forever. A required step they say they do not
 * have goes under notKnown (recorded as unknown, never a value); an
 * optional one stays under declined, as before.
 */
const V15_DO_NOT_HAVE =
  "- When they say plainly that they do not have what an optional step asks for (no website yet, no revenue so far), that settles it: put it under declined with those words, never as a value, so it is not asked again.";
const V16_DO_NOT_HAVE =
  "- When they say plainly that they do not have what a step asks for (no website yet, no revenue so far), that settles it, never as a value, so it is not asked again: an optional step goes under declined with those words, and a required step under notKnown with those words.";

if (!ONBOARDING_TRANSCRIPT_READER_V15.template.includes(V15_DO_NOT_HAVE)) {
  throw new Error(
    "ONBOARDING_TRANSCRIPT_READER v16 extends v15, which lost an anchor",
  );
}

export const ONBOARDING_TRANSCRIPT_READER_V16: typeof ONBOARDING_TRANSCRIPT_READER_V15 =
  {
    ...ONBOARDING_TRANSCRIPT_READER_V15,
    version: 16,
    status: "ACTIVE",
    changeDescription:
      "DECISIONS 79 (mandatory set): a required step they say they do not have (no website yet) is not known, never left out to be asked again; an optional one is declined, as before.",
    effectiveFrom: "2026-11-07",
    template: ONBOARDING_TRANSCRIPT_READER_V15.template.replace(
      V15_DO_NOT_HAVE,
      V16_DO_NOT_HAVE,
    ),
  };
