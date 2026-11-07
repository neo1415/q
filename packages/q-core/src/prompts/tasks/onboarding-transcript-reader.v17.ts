import { ONBOARDING_TRANSCRIPT_READER_V16 } from "./onboarding-transcript-reader.v16.js";

/**
 * ONBOARDING_TRANSCRIPT_READER v17 — every field the profile shows is
 * mandatory (DECISIONS 79, batch 7).
 *
 * - The investor's preference lists are required now, and "none" or "no
 *   preference" is the honest answer for many people. A required step was
 *   never declined, so "no preference" would be asked again forever. A
 *   required step marked "(none is an answer)" that they say has nothing
 *   for them goes under declined; Capital Q records it as "None".
 * - The founder's one-line summary and the investor's firm description are
 *   required now, and Q drafts them: when they have not given one but told
 *   enough elsewhere, the reader gives a short draft, source INFERRED, which
 *   Q puts to them for their yes (never saved as theirs unasked).
 */
const V16_REQUIRED_NEVER_DECLINED =
  "A required step is never declined: leave it out.";
const V17_REQUIRED_NEVER_DECLINED =
  'A required step is never declined: leave it out. The one exception: a required step whose question ends "(none is an answer)", when they say nothing applies to them (none, no preference, nothing to avoid or exclude, nothing else), goes under declined with their words; Capital Q records it as none.';
const V17_DRAFTS =
  "\n- A step asking for the company in one line, or for a description of the firm, that they have not answered but told you enough about elsewhere in the conversation: give a short draft as it should read on their profile, in plain words from what they said, ownWords false and source INFERRED. Q puts it to them for their yes; it is never saved as theirs unasked.";

if (
  !ONBOARDING_TRANSCRIPT_READER_V16.template.includes(
    V16_REQUIRED_NEVER_DECLINED,
  )
) {
  throw new Error(
    "ONBOARDING_TRANSCRIPT_READER v17 extends v16, which lost an anchor",
  );
}

export const ONBOARDING_TRANSCRIPT_READER_V17: typeof ONBOARDING_TRANSCRIPT_READER_V16 =
  {
    ...ONBOARDING_TRANSCRIPT_READER_V16,
    version: 17,
    status: "ACTIVE",
    changeDescription:
      'Batch 7 (DECISIONS 79): a required list marked "(none is an answer)" they say has nothing for them is declined (recorded as None); the one-line summary and the firm description are drafted from what they said, INFERRED, for their yes.',
    effectiveFrom: "2026-11-07",
    template: ONBOARDING_TRANSCRIPT_READER_V16.template.replace(
      V16_REQUIRED_NEVER_DECLINED,
      `${V17_REQUIRED_NEVER_DECLINED}${V17_DRAFTS}`,
    ),
  };
