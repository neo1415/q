/**
 * Whether a plan needs public research the reader did not ask for
 * (production, 12 Nov 2026: all 15 stored plans, including "Run diligence on
 * Ajopot" and "Check Ledgerline's unit economics … against comparables",
 * ran with research NONE, so none read a public source). The turn reader
 * sets `research` (turn-reader v72: NONE / MARKET / SELF / BOTH) but its
 * examples never show one, the schema defaults to NONE, and a yes to Q's
 * own offer is NONE by construction (answer.ts OFFERED_PLAN_ASK).
 *
 * Code adds MARKET only when the ask itself turns on the outside world --
 * markets and comparables, competition, industry, regulation, diligence or
 * valuation -- in the reader's own definition of MARKET ("public news of
 * their market, sector, regulation or the investors and companies in it").
 * Work on their own records stays NONE and fast: following up, approvals,
 * their pipeline, their raise. What leaves Capital Q is unchanged: the
 * research brief still sends only public-safe terms.
 */
const OUTSIDE_WORLD =
  /\b(?:markets?(?!place)|go[- ]to[- ]market|compar(?:e|es|ed|ing|ison|isons|able|ables)|benchmark(?:s|ed|ing)?|peers?|competitors?|competition|competitive|industry|industries|sector trends?|landscape|regulat(?:ion|ions|ory|or|ors)|licen[cs](?:e|es|ing)|due diligence|diligence|valuations?|multiples|public (?:sources|information|news)|in the news)\b/iu;

export function planNeedsPublicResearch(ask: string): boolean {
  return OUTSIDE_WORLD.test(ask);
}

/** The research a plan runs with: the reader's, or MARKET where code sees the need. */
export function planResearch(
  read: "NONE" | "MARKET" | "SELF" | "BOTH",
  ask: string,
): "NONE" | "MARKET" | "SELF" | "BOTH" {
  return read === "NONE" && planNeedsPublicResearch(ask) ? "MARKET" : read;
}
