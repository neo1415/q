import { ONBOARDING_TRANSCRIPT_READER_V17 } from "./onboarding-transcript-reader.v17.js";

/**
 * ONBOARDING_TRANSCRIPT_READER v18 — where they are based is a country
 * (owner, live voice onboarding 9 Nov).
 *
 * "It's based in San Francisco, California, in the USA" was refused on every
 * reading, and the owner's client is in Doha. A step asking which country
 * they or their firm or company is based in takes a country: the reader
 * gives the country's name, and for a city or state they name, the country
 * it is in. Capital Q reads that name against its one country list.
 */
const V17_DRAFTS_ANCHOR =
  "A step asking for the company in one line, or for a description of the firm";
const V18_COUNTRY =
  "\n- A step asking which country they, their firm or their company is based in: give the country's name as the value, never a city, state or region. When they name only a city or a state, give the country it is in (Doha: Qatar; Dubai: United Arab Emirates; Lagos: Nigeria; San Francisco or California: United States; London: United Kingdom). Their words are the quote.";

if (!ONBOARDING_TRANSCRIPT_READER_V17.template.includes(V17_DRAFTS_ANCHOR)) {
  throw new Error(
    "ONBOARDING_TRANSCRIPT_READER v18 extends v17, which lost an anchor",
  );
}

export const ONBOARDING_TRANSCRIPT_READER_V18: typeof ONBOARDING_TRANSCRIPT_READER_V17 =
  {
    ...ONBOARDING_TRANSCRIPT_READER_V17,
    version: 18,
    status: "ACTIVE",
    changeDescription:
      "Owner 9 Nov (live voice): a country step's value is the country; for a city or state they name, give the country it is in.",
    effectiveFrom: "2026-11-09",
    template: `${ONBOARDING_TRANSCRIPT_READER_V17.template}`.replace(
      /(\n- A step asking for the company in one line, or for a description of the firm[^\n]*)/u,
      `$1${V18_COUNTRY}`,
    ),
  };
