/**
 * The paraphrase corpus. Each property is exercised by several phrasings
 * nobody tuned the product against: varied register, typos, disfluency,
 * run-ons, hedges. The transcripts under the directive are fixtures; the
 * sentences here deliberately are NOT their exact wording (except where a
 * directive case names one exactly, marked `directive`).
 *
 * An expectation names the AUTHORITATIVE outcome (a step's recorded value
 * or a database/tool effect), never Q's prose.
 */

/** A recorded answer expectation: step key -> what must (not) be recorded. */
export type Expect = {
  readonly step: string;
  /** At least one of these values is recorded for the step. */
  readonly anyOf?: readonly string[];
  /** None of these values is recorded for the step. */
  readonly noneOf?: readonly string[];
  /**
   * An explicit value the person stated must be recorded THAT turn and read
   * back in Q's reply (lead decision 2026-09-25: holding a person's own
   * explicit answer for a yes is a failure). Any one of these forms counts;
   * the reply is compared with thousands separators removed. A loose
   * oracle on the reply, alongside the authoritative recorded value.
   */
  readonly readBack?: readonly string[];
};

const READ_150K = [
  "150000",
  "150k",
  "150 thousand",
  "hundred and fifty thousand",
  "hundred fifty thousand",
];
const READ_10K = ["10000", "10k", "10 thousand", "ten thousand"];
const READ_250K = [
  "250000",
  "250k",
  "250 thousand",
  "quarter of a million",
  "quarter million",
  "two hundred and fifty thousand",
  "two hundred fifty thousand",
];
const READ_200K = ["200000", "200k", "200 thousand", "two hundred thousand"];
const READ_50K = ["50000", "50k", "50 thousand", "fifty thousand"];
const READ_120K = [
  "120000",
  "120k",
  "120 thousand",
  "hundred and twenty thousand",
  "hundred twenty thousand",
];

// ---------------------------------------------------------------------------
// Shared setup: an angel who has already said a few things.
// ---------------------------------------------------------------------------

export const INVESTOR_SETUP: readonly string[] = [
  "I'm an angel, I invest personally through Harrow Road Capital",
  "cheques from 25 to 100 thousand US dollars, seed stage mostly",
];

// ---------------------------------------------------------------------------
// P1 — an arbitrary explicit correction updates the intended fact.
// ---------------------------------------------------------------------------

export type CorrectionCase = {
  readonly id: string;
  readonly correction: string;
  readonly expect: readonly Expect[];
};

export const CORRECTIONS: readonly CorrectionCase[] = [
  {
    id: "max-cheque-shorthand",
    correction: "wait no, the top end is 150k, not 100. my bad",
    expect: [{ step: "I2.cheque_max", anyOf: ["150000"], readBack: READ_150K }],
  },
  {
    id: "currency-misspoke",
    correction:
      "sorry I misspoke earlier — all of that is in pounds, not dollars",
    expect: [{ step: "I2.currency", anyOf: ["gbp"], noneOf: ["usd"] }],
  },
  {
    id: "stage-swap",
    correction:
      "hmm actually, make that pre-seed. we don't really do seed any more, I was thinking of last year",
    expect: [{ step: "I2.stages", anyOf: ["pre_seed"], noneOf: ["seed"] }],
  },
  {
    id: "investor-type-reframe",
    correction:
      "correction, I'm not really a solo angel, I run a syndicate — a group of us pool money deal by deal",
    expect: [
      { step: "I0.investor_type", anyOf: ["syndicate"], noneOf: ["angel"] },
    ],
  },
  {
    id: "min-disfluent",
    correction: "uh, the minimum. did I say 25? it's ten. ten grand. sorry",
    expect: [{ step: "I2.cheque_min", anyOf: ["10000"], readBack: READ_10K }],
  },
  {
    id: "firm-rename",
    correction:
      "ignore the firm name I gave you, we rebranded — it's Tidewater Angels now",
    expect: [{ step: "I0.organisation_name", anyOf: ["Tidewater Angels"] }],
  },
  {
    id: "max-words",
    correction:
      "on the upper cheque, scratch that, call it a quarter of a million",
    expect: [{ step: "I2.cheque_max", anyOf: ["250000"], readBack: READ_250K }],
  },
];

// ---------------------------------------------------------------------------
// P2 — one turn carrying a question AND an answer AND a correction.
// `topic` is a loose oracle that the question was engaged at all (any
// term); the recorded state is the real assertion.
// ---------------------------------------------------------------------------

export type MultiIntentCase = {
  readonly id: string;
  readonly setup: readonly string[];
  readonly turn: string;
  readonly expect: readonly Expect[];
  readonly topic: readonly string[];
};

export const MULTI_INTENT: readonly MultiIntentCase[] = [
  {
    id: "series-a-scope",
    setup: INVESTOR_SETUP,
    turn: "quick q — is series A even in scope for someone like me? anyway put us down as seed, and the 100k max I gave you is wrong, it's 200k",
    expect: [
      { step: "I2.stages", anyOf: ["seed"] },
      { step: "I2.cheque_max", anyOf: ["200000"], readBack: READ_200K },
    ],
    topic: ["series a", "series-a"],
  },
  {
    id: "visibility-currency-type",
    setup: INVESTOR_SETUP,
    turn: "do founders get to see my cheque sizes? also we actually write in euros, and I said angel but honestly we're a family office",
    expect: [
      { step: "I2.currency", anyOf: ["eur"] },
      { step: "I0.investor_type", anyOf: ["family_office"] },
    ],
    topic: ["see", "visible", "private", "share", "founder"],
  },
  {
    id: "min-with-cadence-question",
    setup: INVESTOR_SETUP,
    turn: "how many companies will I actually see a week? oh and the minimum is 50k — not 25 like I said before",
    expect: [{ step: "I2.cheque_min", anyOf: ["50000"], readBack: READ_50K }],
    topic: ["week", "companies", "feed", "see"],
  },
  {
    id: "follow-on-role-rename",
    setup: INVESTOR_SETUP,
    turn: "is it normal for angels to follow on? we mostly co-invest alongside a lead btw. and the firm's called Kestrel Lane, not what I told you",
    expect: [
      { step: "I2.investment_role", anyOf: ["co_invest"] },
      { step: "I0.organisation_name", anyOf: ["Kestrel Lane"] },
    ],
    topic: ["follow"],
  },
  {
    id: "change-later-geo",
    setup: [...INVESTOR_SETUP, "we look at Nigeria and Kenya"],
    turn: "can I change all this later? and actually drop Kenya — just Nigeria. oh and max is 120 not 100",
    expect: [
      { step: "I3.geography", anyOf: ["nigeria"], noneOf: ["kenya"] },
      { step: "I2.cheque_max", anyOf: ["120000"], readBack: READ_120K },
    ],
    topic: ["change", "later", "update", "edit", "anytime", "any time"],
  },
];

// ---------------------------------------------------------------------------
// P3 — clear acceptance of Q's proposal authorises it (the write exists).
// ---------------------------------------------------------------------------

export type AcceptanceCase = {
  readonly id: string;
  readonly ask: string;
  readonly accept: string;
  readonly kind: "typical-cheque" | "exclusions";
};

export const ACCEPTANCES: readonly AcceptanceCase[] = [
  {
    id: "typical-go-with-that",
    ask: "what would you suggest as my typical cheque?",
    accept: "fine, go with that",
    kind: "typical-cheque",
  },
  {
    id: "typical-sounds-right",
    ask: "no idea what my typical cheque is tbh, what's sensible?",
    accept: "yeah that sounds about right, lock it in",
    kind: "typical-cheque",
  },
  {
    id: "typical-whatever-you-think",
    ask: "you pick a typical cheque for me, you've seen more angels than I have",
    accept: "sure, whatever you think",
    kind: "typical-cheque",
  },
  {
    id: "exclusions-suggest-then-yes",
    ask: "what kinds of companies would you suggest I never see, given what you know?",
    accept: "yes, those. put them down",
    kind: "exclusions",
  },
  {
    id: "exclusions-directive",
    // directive: exact wording, delegation in one turn.
    ask: "Pick three exclusions you think fit me and go with those.",
    accept: "",
    kind: "exclusions",
  },
  {
    id: "exclusions-go-on-then",
    ask: "I haven't thought about hard no's. any you'd recommend for a first-time angel?",
    accept: "go on then, add them",
    kind: "exclusions",
  },
];

// ---------------------------------------------------------------------------
// P4 — a persisted exclusion is never re-asked through another
// representation of the same concept, and the mandate-ready step settles.
// ---------------------------------------------------------------------------

export type ExclusionCase = {
  readonly id: string;
  /** Said at the exclusion question ("at") or volunteered early ("early"). */
  readonly when: "at" | "early";
  readonly say: string;
  readonly code: string;
};

export const EXCLUSIONS: readonly ExclusionCase[] = [
  {
    id: "adult-directive",
    when: "at",
    say: "Adult content.",
    code: "adult_content",
  },
  {
    id: "adult-oblique",
    when: "at",
    say: "nothing with porn or sex stuff obviously",
    code: "adult_content",
  },
  {
    id: "gambling-early",
    when: "early",
    say: "oh before I forget — never show me betting or gambling companies",
    code: "gambling",
  },
  {
    id: "tobacco-early",
    when: "early",
    say: "I won't touch tobacco. cigarettes, vapes, none of it",
    code: "tobacco",
  },
  {
    id: "weapons-at",
    when: "at",
    say: "guns, defence, that sort of thing. hard no",
    code: "weapons",
  },
];

// ---------------------------------------------------------------------------
// P5 — advisory questions never become declared preferences.
// ---------------------------------------------------------------------------

export const ADVISORY: readonly { id: string; say: string }[] = [
  {
    id: "who-backs-edtech",
    say: "who's actually backing edtech in Senegal these days?",
  },
  {
    id: "healthtech-crowded",
    say: "is healthtech overcrowded right now in your view?",
  },
  {
    id: "lagos-angels",
    say: "what do most angels in Lagos end up investing in?",
  },
  {
    id: "climate-bet",
    say: "would climate be a good bet for someone writing my size of cheque?",
  },
  {
    id: "if-you-were-me",
    say: "if you were me would you even look at agritech?",
  },
  {
    id: "kenya-hot",
    say: "which sectors are pulling the most seed money in Kenya atm",
  },
];

// ---------------------------------------------------------------------------
// P6 — imperative tool requests execute (a real artifact exists).
// ---------------------------------------------------------------------------

export const IMPERATIVES: readonly {
  id: string;
  say: string;
  followUp?: string;
}[] = [
  {
    id: "mandate-one-pager",
    say: "Put my mandate into a one-page PDF I can send my co-investors.",
  },
  { id: "mandate-pdf-terse", say: "export my mandate as a pdf pls" },
  {
    id: "thesis-memo",
    say: "I need a short memo of my investment thesis as a downloadable PDF. do it.",
  },
  {
    id: "zino-deck-directive",
    say: "Generate a PDF pitch deck for Zino Aviation from what you can find publicly.",
    // directive: exact wording, only if the first turn did not deliver.
    followUp: "Just give me the PDF.",
  },
];

// ---------------------------------------------------------------------------
// P7 — leave onboarding and return coherently.
// ---------------------------------------------------------------------------

export const TANGENTS: readonly { id: string; say: string }[] = [
  {
    id: "data-use",
    say: "hang on, what do you actually do with what I tell you?",
  },
  {
    id: "dog-barking",
    say: "sorry, dog's going mad, one sec... ok, who can see this stuff?",
  },
  {
    id: "bot-or-person",
    say: "real question — am I talking to a person or a bot?",
  },
  {
    id: "how-long",
    say: "before we go on, how long does this whole thing take?",
  },
  {
    id: "invite-partner",
    say: "unrelated but can I add my business partner to this account later?",
  },
];

// ---------------------------------------------------------------------------
// P8 — phrasing nobody listed is interpreted by the model.
// ---------------------------------------------------------------------------

export const OBLIQUE: readonly {
  id: string;
  say: string;
  expect: readonly Expect[];
}[] = [
  {
    id: "accra",
    say: "we only do deals in the country whose capital is Accra",
    expect: [{ step: "I3.geography", anyOf: ["ghana"] }],
  },
  {
    id: "quarter-million-quid",
    say: "cheques top out at a quarter of a million quid",
    expect: [
      { step: "I2.cheque_max", anyOf: ["250000"], readBack: READ_250K },
      { step: "I2.currency", anyOf: ["gbp"] },
    ],
  },
  {
    id: "round-before-a",
    say: "we come in at the round right before a Series A",
    expect: [{ step: "I2.stages", anyOf: ["seed"] }],
  },
  {
    id: "nairobi-currency",
    say: "everything's denominated in the currency they use in Nairobi",
    expect: [{ step: "I2.currency", anyOf: ["kes"] }],
  },
  {
    id: "farmers",
    say: "sector-wise, anything that helps smallholder farmers grow more food",
    expect: [{ step: "I3.sectors", anyOf: ["agritech", "agriculture"] }],
  },
  {
    id: "half-hundred",
    say: "smallest cheque I'd write is half of a hundred grand, in dollars",
    expect: [{ step: "I2.cheque_min", anyOf: ["50000"], readBack: READ_50K }],
  },
  {
    id: "employer-arm",
    say: "we invest through our employer's venture arm, it's a big telco",
    expect: [{ step: "I0.investor_type", anyOf: ["cvc"] }],
  },
];

// ---------------------------------------------------------------------------
// Home Q: memory within one conversation.
// ---------------------------------------------------------------------------

export const MEMORY: readonly {
  id: string;
  tell: string;
  ask: string;
  recall: string;
}[] = [
  {
    id: "meeting-day",
    tell: "heads up: I'm meeting a founder called Adaeze on Thursday about her cold-chain startup",
    ask: "remind me, which day is that meeting?",
    recall: "thursday",
  },
  {
    id: "co-investor-name",
    tell: "my co-investor on most deals is a guy called Tunde, keep that in mind",
    ask: "what was my co-investor called again?",
    recall: "tunde",
  },
  {
    id: "passed-on",
    tell: "fyi I already passed on a company called Lumora last month",
    ask: "which company did I say I'd passed on?",
    recall: "lumora",
  },
];

// ---------------------------------------------------------------------------
// The mover: plain answers per step, to walk an interview to completion.
// These are fixtures, not properties; a property's own sentence is what
// is under test.
// ---------------------------------------------------------------------------

export const MOVER: Readonly<Record<string, string>> = {
  "I0.investor_type": "angel investor",
  "I0.organisation_name": "Harrow Road Capital",
  "I0.business_title": "managing partner",
  "I1.deployment_status": "actively investing",
  "I1.mandate_context": "no document, let's skip that",
  "I2.stages": "pre-seed and seed",
  "I2.currency": "US dollars",
  "I2.cheque_min": "25 thousand",
  "I2.cheque_typical": "50 thousand",
  "I2.cheque_max": "100 thousand",
  "I2.investment_role": "we co-invest alongside a lead",
  "I3.geography": "Nigeria and Kenya",
  "I3.geography_strength": "that's a must",
  "I3.sectors": "fintech and logistics",
  "I3.sector_strength": "strong preference",
  "I3.sectors_avoid": "nothing to avoid",
  "I4.business_models": "no preference",
  "I4.customer_types": "no preference",
  "I4.capital_intensity": "no preference",
  "I4.regulatory_appetite": "no preference",
  "I4.revenue_state": "pre-revenue is fine",
  "I5.founder_preferences": "no preference",
  "I5.founder_strength": "nice to have",
  "I6.green_flags": "no preference",
  "I6.green_flag_strength": "nice to have",
  "I6.custom_criteria": "nothing else",
  "I7.avoid": "nothing beyond what I've said",
  "I7.hard_exclusions": "nothing beyond what I've said",
  "I7.sector_exclusions": "nothing beyond what I've said",
  "I8.portfolio": "skip that",
  "I9.discovery_mode": "balanced",
  "I10.inbound_preference": "qualified introductions only",
  "I11.additional_context": "nothing else",
  "I11.review": "yes, that's right",
  "I12.handoff": "yes",
};
