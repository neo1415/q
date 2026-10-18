/**
 * Founder 2026-10-07 ("they don't know how to woo an investor"): real
 * messages from the hosted seed (Zino Aviation <-> Ledgerline, Clearwater
 * Assurance, Tensorgate, Shiftwell, 6-7 Oct), each with the rewrite the new
 * prompts aim for. Fictional companies; no private data.
 *
 * BEFORE (founder side, written to Zino after he connected): direct pitch,
 * nothing about Zino, ends on a demand for time.
 * BEFORE (investor side, Q's drafts for Zino, withdrawn as stale): a cold
 * introduction although the founder had already written.
 */

/** What Zino Aviation's own material says (its declared mandate). */
export const ZINO_TERMS = ["pre-seed", "zino aviation"] as const;

export type WooFixture = {
  readonly name: string;
  readonly side: "FOUNDER_TO_INVESTOR" | "INVESTOR_TO_FOUNDER";
  readonly replying: boolean;
  readonly recipientTerms: readonly string[];
  readonly before: string;
  /** The code's verdict on the real message. */
  readonly problem: string;
  readonly after: string;
};

export const WOO_FIXTURES: readonly WooFixture[] = [
  {
    name: "Tensorgate -> Zino (founder)",
    side: "FOUNDER_TO_INVESTOR",
    replying: true,
    recipientTerms: ZINO_TERMS,
    before:
      "Thanks for connecting. Tensorgate is a policy gateway for LLM traffic in regulated industries: 4 design partners, 2 converted to $180k contracts, 31m requests served. Raising a $4m seed. Want the deck, or 20 minutes this week? Daniel",
    problem: "NOTHING_SPECIFIC",
    after:
      "Thank you for connecting, Zino. Your pre-seed to Series A focus is why we were glad to hear from Zino Aviation: Tensorgate is the policy gateway that lets regulated teams put LLM traffic into production safely. Two of our four design partners have already converted to $180k contracts, and we have served 31m requests. If it would be useful, we would be happy to share the deck here, and to find a time that suits you once you have had a look. Daniel",
  },
  {
    name: "Shiftwell -> Zino (founder)",
    side: "FOUNDER_TO_INVESTOR",
    replying: true,
    recipientTerms: ZINO_TERMS,
    before:
      "Thanks for connecting. Shiftwell runs scheduling and same-day pay for home-care agencies: $4.1m ARR, 290 agencies, 38,000 caregivers paid. We are raising a $15m Series A. Happy to send the deck or set up a call. Megan",
    problem: "NOTHING_SPECIFIC",
    after:
      "Thank you for reaching out, Zino. As Zino Aviation backs companies through Series A, we thought Shiftwell might be worth a look: we run scheduling and same-day pay for home-care agencies, and 290 agencies now use it, with 38,000 caregivers paid and $4.1m ARR. We would love to hear what drew you to us. If helpful, we are glad to share the deck here, and to make time whenever it suits you. Megan",
  },
  {
    name: "Ledgerline -> Zino (founder)",
    side: "FOUNDER_TO_INVESTOR",
    replying: true,
    recipientTerms: ZINO_TERMS,
    before:
      "Hi Zino, thanks for connecting. Ledgerline checks invoices at creation and files VAT for 1,140 Nigerian SMEs; we are raising a $1.8m seed. Happy to share the deck or find 20 minutes this week if useful. Tobenna",
    problem: "NOTHING_SPECIFIC",
    after:
      "Hi Zino, thank you for connecting. We were glad to see Zino Aviation backs pre-seed to Series A companies, because that is exactly where Ledgerline is: we check every invoice at the moment it is created and file VAT for 1,140 Nigerian SMEs, so compliance happens inside the workflow. If it would be helpful, we would be happy to share the deck here, and to answer anything it leaves open. Tobenna",
  },
  {
    name: "Zino -> Ledgerline (investor, Q's withdrawn draft)",
    side: "INVESTOR_TO_FOUNDER",
    replying: true,
    recipientTerms: ["invoice", "vat", "ledgerline"],
    before:
      "Hello Ledgerline team — checking every invoice at creation and filing VAT returns for Nigerian SMEs, with FIRS e-invoicing ahead, brings compliance into the workflow rather than leaving it until later. I came across the company through your Capital Q profile. How are SMEs responding to the product?",
    problem: "COLD_OPEN_IN_REPLY",
    after:
      "Thank you, Tobenna, and thanks for accepting. Checking each invoice the moment it is created, rather than at filing time, is a smart place to sit, and 1,140 SMEs already on it says the workflow lands. With FIRS e-invoicing ahead, I would love to understand how SMEs are responding. I would be glad to read the deck you offered whenever it is easy to share.",
  },
  {
    name: "Zino -> Clearwater Assurance (investor, Q's withdrawn draft)",
    side: "INVESTOR_TO_FOUNDER",
    replying: true,
    recipientTerms: ["validat", "credit", "clearwater"],
    before:
      "Hello Clearwater Assurance team — continuously validating UK banks’ credit and AI models, with the evidence supervisors ask for, addresses a clear challenge in regulated financial services. I came across the company through your Capital Q profile. How are banks using the validation work in practice?",
    problem: "COLD_OPEN_IN_REPLY",
    after:
      "Thank you, Helena, for writing so soon after connecting. Validating credit-risk models with the evidence supervisors ask for is hard, unglamorous work, and seven banks and building societies at 132% net revenue retention suggests they value it. I would be glad to read your validation methodology if you are happy to share it, and to hear how banks use the work in practice.",
  },
];

/** Drafts code must also catch, whoever wrote them. */
export const WOO_NEGATIVES: readonly {
  readonly body: string;
  readonly problem: string;
}[] = [
  {
    body: "Send me your deck and cap table by Friday so I can decide.",
    problem: "OPENS_WITH_DEMAND",
  },
  {
    body: "Hi Zino, you must see this: our Series A is closing soon, so act now before the allocation is gone.",
    problem: "PUSHY",
  },
  {
    body: "Hi Zino, want the deck, or 20 minutes this week?",
    problem: "OPENS_WITH_DEMAND",
  },
];
