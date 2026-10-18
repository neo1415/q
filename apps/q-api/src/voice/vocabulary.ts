/**
 * Words the recogniser should expect (CQ-Q-VOICE-001 D §52, rework). The
 * interview vocabulary, and the names and places a Nigerian or wider West
 * African founder is likely to say: a recogniser mis-hears a name it has
 * never been told about far more often than an accent. Shared by every
 * speech transport.
 */
export const ASR_KEYWORDS: readonly string[] = [
  "Capital Q",
  "Vaultlyne",
  "MRR",
  "ARR",
  "pre-seed",
  "seed",
  "Series A",
  "Series B",
  "Lagos",
  "Nairobi",
  "Nigeria",
  "Ghana",
  "Kenya",
  "naira",
  "Abuja",
  "Port Harcourt",
  "Ibadan",
  "Yaba",
  "Lekki",
  "Accra",
  "Kigali",
  "Kampala",
  "Cairo",
  "Johannesburg",
  "Cape Town",
  "Paystack",
  "Flutterwave",
  "Moniepoint",
  "OPay",
  "Interswitch",
  "Jumia",
  "Andela",
  "Y Combinator",
  "angel",
  "pre-money",
  "post-money",
  "SAFE",
  "convertible note",
  "cheque size",
  "ticket size",
  "LP",
  "GP",
  "fund of funds",
  "family office",
  "pilot",
  "design partner",
  "churn",
  "runway",
  "burn",
  "gross margin",
  "take rate",
  "GMV",
  "fintech",
  "agritech",
  "healthtech",
  "edtech",
  "proptech",
  "insurtech",
  "logistics",
  "mobility",
  "SaaS",
  "B2B",
];

/**
 * The names on a person's own records as recogniser terms (founder live
 * 2026-09-27, #6): their company's canonical and legal names, their firm's
 * and their own. Values from records, never from what they said; one of
 * each, however cased, and nothing a recogniser cannot use.
 */
export function ownRecordTerms(records: {
  readonly companyNames: readonly (string | null)[];
  readonly firmName: string | null;
  readonly personName: string | null;
}): readonly string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const name of [
    ...records.companyNames,
    records.firmName,
    records.personName,
  ]) {
    const term = name?.replace(/\s+/g, " ").trim() ?? "";
    const key = term.toLowerCase();
    if (term.length < 2 || term.length > 60 || seen.has(key)) continue;
    seen.add(key);
    terms.push(term);
  }
  return terms;
}
