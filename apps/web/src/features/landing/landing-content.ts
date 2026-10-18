/**
 * The landing's words and its illustrations' fictional data, in one place
 * so the server markup and the scenes that animate it cannot drift.
 * Every name here is fictional; the page says so beside each illustration.
 */

export const SIGN_UP_HREF = "/auth/sign-up";
export const SIGN_IN_HREF = "/auth/sign-in";
export const GATEQ_ANCHOR = "gateq";
export const HOW_ANCHOR = "how";

export const HERO = {
  title: "Private capital, on evidence.",
  lede: "Q reads the evidence, prepares the next step, and acts only when you approve.",
} as const;

export const CONVERGE = {
  before: {
    title: "Everyone keeps their own version.",
    lede: "Decks as attachments, claims mixed with opinion, and a different stage in every tool.",
  },
  after: {
    title: "Capital Q keeps one.",
    lede: "One record per company and investor. Its stage follows what actually happened, never edited by hand.",
  },
} as const;

/** "Handle my seed introductions": the three messages Q prepares. */
export const INTRODUCTIONS = [
  {
    to: "Adaeze Bello",
    org: "Harbour Lane Ventures",
    subject: "Introduction: Fennel Pay, seed round",
    body: "Hi Adaeze, Fennel Pay is raising a $1.2M seed to expand merchant payments in Lagos and Nairobi. It matches the payments focus in your mandate. Would a 20-minute call next week be useful?",
  },
  {
    to: "Tomi Okafor",
    org: "Meridian Seed",
    subject: "Introduction: Fennel Pay, seed round",
    body: "Hi Tomi, Fennel Pay fits the seed-stage fintech focus you publish. Their revenue figures are document-supported. Happy to share the profile if useful.",
  },
  {
    to: "Ruth Mensah",
    org: "Kestrel Ventures",
    subject: "Introduction: Fennel Pay, seed round",
    body: "Hi Ruth, Fennel Pay matches your stage and sector. The founders would value 20 minutes with you next week.",
  },
] as const;

export type Side = "founder" | "investor";

export const STEPS: Readonly<
  Record<Side, readonly (readonly [title: string, detail: string])[]>
> = {
  investor: [
    [
      "State your mandate in a few minutes.",
      "Stage, sector, geography, cheque size. Skip anything.",
    ],
    [
      "See a feed ordered by fit and evidence.",
      "Never by payment. The reasons sit on every pitch.",
    ],
    [
      "Approve what Q prepares.",
      "Introductions, follow-ups and passes, each one yours to send.",
    ],
  ],
  founder: [
    [
      "Upload what you already have.",
      "A deck, accounts, a data pack. No questionnaire first.",
    ],
    [
      "Q works first.",
      "It shows what's known and how well supported, and asks only about the gaps.",
    ],
    [
      "Approve what Q prepares.",
      "Introductions to investors who fit, sent only after you approve them.",
    ],
  ],
};

export const PITCHES = [
  {
    name: "Fennel Pay",
    tags: "Seed · Payments · Lagos and Nairobi",
    why: "Fits your mandate on stage and sector. Revenue is document-supported.",
    hue: [38, 28],
  },
  {
    name: "Kestrel Grid",
    tags: "Pre-seed · Climate · Nairobi",
    why: "Sector fit. Revenue is unknown; that isn't counted against them.",
    hue: [160, 200],
  },
  {
    name: "Tallow Health",
    tags: "Seed · Health · London",
    why: "Stage fits. Health is outside your declared sectors.",
    hue: [250, 290],
  },
] as const;

/** Q's first reading of a deck, each figure waiting for confirmation. */
export const FIRST_READING = [
  { label: "Raising", value: "$1.2M seed", unknown: false },
  {
    label: "Monthly revenue",
    value: "Q read $84k from slide 9",
    unknown: false,
  },
  { label: "Markets", value: "Lagos, Nairobi", unknown: false },
  { label: "Monthly burn", value: "Not in the deck. Unknown.", unknown: true },
] as const;

export type ScriptLine = {
  readonly who: "you" | "q" | "back";
  readonly text: string;
};

export const REHEARSAL_SCRIPT: readonly ScriptLine[] = [
  {
    who: "you",
    text: "We run merchant payments for small retailers in Lagos and Nairobi.",
  },
  { who: "back", text: "Mm-hm." },
  {
    who: "you",
    text: "Volume has grown every month since we launched in March.",
  },
  { who: "back", text: "Go on." },
  { who: "you", text: "We're raising a $1.2M seed to add two more cities." },
  {
    who: "q",
    text: "How much of that volume comes from your three largest merchants?",
  },
  {
    who: "you",
    text: "Roughly forty percent today. We expect that to fall as we add cities.",
  },
  {
    who: "q",
    text: "Can you show that falling? An investor will ask for the cohort.",
  },
];

export const FAQ = [
  [
    "Can anyone pay to rank higher?",
    "No. There is no paid placement, and views or watch time are not ranking inputs. Viewing is not interest.",
  ],
  [
    "Will Q send anything without asking me?",
    "No. Q prepares the message and shows who it goes to. You approve that exact message, then it is sent. If it changes, it comes back to you.",
  ],
  [
    'What does "unknown" mean?',
    "That the evidence isn't there yet. Unknown is never turned into a zero or counted against you.",
  ],
  [
    "Is Capital Q a CRM or a marketplace?",
    "Neither. It keeps one record per company and investor, shows the evidence behind every fact, and gives you Q to do the reading.",
  ],
] as const;
