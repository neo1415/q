import { z } from "zod";

import { FOUNDER_QA_ENTRIES } from "./qa-bank-founder.js";
import { PRODUCT_QA_ENTRIES } from "./qa-bank-product.js";
import { SPOKEN_PARAPHRASES } from "./qa-bank-spoken.js";

/**
 * Q Pitch v6: the Q&A bank (owner, 16 Oct). Questions people are likely to
 * ask after or during the pitch, each with a prepared answer grounded in
 * the product sources, answered instantly by meaning: an in-memory BM25
 * over the question, its paraphrases and its keywords, with a small
 * synonym map. No model call, no network. Below the threshold nothing
 * matches, and the question goes to normal Q.
 *
 * Honest by construction: Capital Q is pre-seed and bootstrapping. An
 * answer never claims traction, customers, revenue, investors or a team
 * size (a test reads every answer), and every answer names its sources.
 */

export const QaSideSchema = z.enum(["INVESTOR", "FOUNDER", "BOTH"]);
export type QaSide = z.infer<typeof QaSideSchema>;

export const QaEntrySchema = z
  .object({
    id: z.string().regex(/^qa\.[a-z0-9][a-z0-9.-]{1,62}$/u),
    side: QaSideSchema,
    /** The question as people ask it. */
    question: z.string().trim().min(3).max(200),
    /** Other ways of asking: what the index matches against. */
    paraphrases: z.array(z.string().trim().min(3).max(200)).min(2).max(16),
    /** Spoken and shown as is: plain words, no markdown. */
    answer: z.string().trim().min(20).max(900),
    /** Repository paths (with a section) the answer is drawn from. */
    sources: z.array(z.string().trim().min(5).max(200)).min(1).max(6),
  })
  .strict();
export type QaEntry = z.infer<typeof QaEntrySchema>;

const PADL =
  "docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt";
const SPEC =
  "docs/product-sources/text/Real_CAPITAL_Q_PRODUCT_SPECIFICATION.txt";
const GATEQ =
  "docs/product-sources/text/CapitalQ_GateQ_Product_Feature_Specification.txt";
const INVESTIQ = "docs/ai-handoff/INVESTIQ-METHODOLOGY.md";
const LANDING = "docs/ai-handoff/LANDING-PROMISES.md";
const SECURITY = "docs/architecture/15_Capital_Q_Security_Architecture.md";
const Q_ARCH = "docs/architecture/12_Q_Technical_Architecture.md";
const RECS =
  "docs/architecture/19_Capital_Q_Discovery_Matching_Recommendation_Architecture.md";

/** The written entries, before the spoken paraphrases are merged in. */
const WRITTEN: readonly QaEntry[] = [
  {
    id: "qa.what-is-it",
    side: "BOTH",
    question: "What is Capital Q?",
    paraphrases: [
      "explain capital q in one sentence",
      "what does capital q do",
      "what is this product",
      "describe the platform",
      "is this a marketplace or a crm",
    ],
    answer:
      "Capital Q is an AI-native investment intelligence operating system for private capital. It helps investors find, understand and act on the companies that fit their mandate, and helps founders become investable and reach the investors most likely to back them. It is not a marketplace, a directory or a CRM: its product is trusted investment intelligence.",
    sources: [`${PADL} Decision #001`, `${SPEC} 3.1`],
  },
  {
    id: "qa.problem",
    side: "BOTH",
    question: "What problem are you solving?",
    paraphrases: [
      "what is the problem",
      "why does this need to exist",
      "what pain point do you address",
      "what is broken in private capital today",
      "why is fundraising hard",
    ],
    answer:
      "Private capital runs on information asymmetry. Every business presents itself differently, so investors start from scratch each time and spend too long searching and screening, while good companies are missed. Founders, for their part, cannot see what stops them from raising or which investors genuinely fit them. Capital Q standardises the picture and reduces that asymmetry.",
    sources: [`${SPEC} 3.1`, `${LANDING} LP-05 to LP-07`],
  },
  {
    id: "qa.how-it-works",
    side: "BOTH",
    question: "How does it work?",
    paraphrases: [
      "walk me through how it works",
      "what happens step by step",
      "how does a company get onto the platform",
      "what does q do with my information",
      "how does matching work",
    ],
    answer:
      "Q learns each investor's thesis and onboards each business through a conversation, from the materials it already has. It turns every company into the same standard structure, assesses it on its evidence, and matches it against each investor's declared mandate. Investors discover and interrogate companies with Q; founders see what to improve and which investors fit. Investors can also set a gateway, so applicants arrive already qualified.",
    sources: [`${LANDING} LP-14 to LP-20`, `${GATEQ} overview`],
  },
  {
    id: "qa.scores",
    side: "BOTH",
    question: "How are the scores calculated?",
    paraphrases: [
      "what do investability and suitability mean",
      "how does investiq work",
      "explain the scoring methodology",
      "what does the score out of a hundred mean",
      "why is this company ranked above that one",
      "is the score a measure of quality",
      "what is the difference between investability and suitability",
    ],
    answer:
      "There are two scores, never blended. Investability asks how investable a company is on its evidence; it is the InvestIQ method over investor-eligible evidence, the same for every investor, with its coverage and confidence shown. Suitability asks how well it fits this investor's mandate, and differs per investor. When too little is known, there is no number at all: unknown stays unknown and is never read as poor.",
    sources: [`${INVESTIQ} Two scores, never one`, `${PADL} InvestIQ`],
  },
  {
    id: "qa.ai-accuracy",
    side: "BOTH",
    question: "How accurate is the AI? Can it hallucinate?",
    paraphrases: [
      "can i trust q's answers",
      "what if the ai makes things up",
      "how do you prevent hallucinations",
      "is q's analysis verified",
      "how reliable is the ai",
    ],
    answer:
      "Q is held to evidence before opinion. Every finding is labelled with what it rests on: a founder's own claim, a document, or verification, and Q's inferences are marked as Q's view, never as fact. When evidence is missing Q says so instead of guessing, and contradictions are shown side by side rather than resolved quietly. Q is an analyst, not the source of truth.",
    sources: [`${PADL} Decision #006`, `${Q_ARCH} evidence`],
  },
  {
    id: "qa.privacy",
    side: "BOTH",
    question: "Is my data private? Who can see what?",
    paraphrases: [
      "how do you handle data privacy",
      "can investors see my private documents",
      "what about confidentiality",
      "is my information shared",
      "who has access to my data",
      "can founders see my notes about them",
      "security of the platform",
      "who can see my deal flow",
      "will founders see my opinion of them",
    ],
    answer:
      "Every piece of information carries a setting for who may see it, and that is enforced on our side at every layer, not just hidden on screen. Founder-private material never reaches an investor, and never quietly changes how an investor ranks or sees a company. What Q knows is not the same as what you may see: Q filters by permission before it reasons, and a data room opens only when the founder shares it.",
    sources: [
      `${SECURITY} context firewall`,
      `${PADL} Q knowledge vs data room`,
    ],
  },
  {
    id: "qa.why-now",
    side: "BOTH",
    question: "Why now?",
    paraphrases: [
      "why is this the right time",
      "what has changed",
      "why couldn't this be built before",
      "timing of the market",
    ],
    answer:
      "Two things changed. AI can now read a deck, a pitch and a data room and reason over them like an analyst, at a cost that makes it available to every investor and founder, not only the largest firms. And deal flow keeps growing while investors' time does not, so the bottleneck has moved from finding opportunities to understanding them quickly and fairly.",
    sources: [`${LANDING} LP-01, LP-05 to LP-07`, `${SPEC} 3.1`],
  },
  {
    id: "qa.moat",
    side: "BOTH",
    question: "What is your moat?",
    paraphrases: [
      "what makes this defensible",
      "why can't someone copy this",
      "what is your competitive advantage",
      "what stops a big player from doing this",
      "what if a competitor copies you",
      "what is proprietary here",
    ],
    answer:
      "The defensibility is in the trusted structure, not the model: one trusted record per company and investor, evidence and its origin on every fact, a proprietary assessment framework, and relationship history that compounds with use. Generic AI tools can summarise a deck; they cannot hold a permissioned, comparable, evidence-labelled record that both sides trust.",
    sources: [`${PADL} Decision #85`, `${LANDING} LP-25`],
  },
  {
    id: "qa.business-model",
    side: "BOTH",
    question: "What is the business model? How do you make money?",
    paraphrases: [
      "how will you charge",
      "what is your pricing",
      "how much does it cost",
      "how do you monetise",
      "is it a subscription",
      "do companies pay to be ranked",
    ],
    answer:
      "The model is layered. Diagnosis is the core: Q assesses, explains and benchmarks freely, because trust comes first. Deeper strategic intelligence, such as a capital readiness blueprint, is the paid layer, and specialist human execution is optional on top. Ranking is never for sale: there is no pay-to-rank. Pricing levels themselves are not set yet.",
    sources: [
      `${PADL} Decision #85`,
      "CLAUDE.md Recommendations: no pay-to-rank",
    ],
  },
  {
    id: "qa.stage",
    side: "BOTH",
    question: "What stage is Capital Q at? Do you have traction?",
    paraphrases: [
      "how far along are you",
      "do you have customers",
      "what traction do you have",
      "how much revenue",
      "how many users",
      "are you funded",
    ],
    answer:
      "Capital Q is pre-seed and bootstrapped. What you have seen is the working product on its own platform, with demonstration companies clearly labelled as demo data. There is no traction, revenue or customer figure to claim yet, and I won't invent one.",
    sources: ["docs/specs/q-pitch/CERTIFICATION_MANIFEST.md scene 16 rule"],
  },
  {
    id: "qa.team",
    side: "BOTH",
    question: "Who is the team?",
    paraphrases: [
      "tell me about the founders",
      "how big is the team",
      "who is building this",
      "who are the people behind it",
    ],
    answer:
      "The team is not what this pitch is about right now, and I won't make claims about its size. Capital Q comes from FDN Capital Partners; the founders can speak to the team themselves.",
    sources: [`${LANDING} capture notes (FDN Capital Partners)`],
  },
  {
    id: "qa.ask",
    side: "BOTH",
    question: "What are you raising?",
    paraphrases: [
      "what is the ask",
      "how much are you raising",
      "what is the round",
      "how will you use the money",
    ],
    answer:
      "Capital Q's record states a USD 2 million raise. That is the founders' own claim, shown as a claim like anyone else's, and the terms are for the founders to discuss directly.",
    sources: ["Capital Q company record (raise: founder claim)"],
  },
  {
    id: "qa.competition",
    side: "BOTH",
    question: "Who are your competitors?",
    paraphrases: [
      "how are you different from a crm",
      "how are you different from a deal flow tool",
      "why not use a document storage tool",
      "competitive landscape",
    ],
    answer:
      "Capital Q is deliberately not a CRM, a marketplace, a directory or a document store, and those are where the incumbents are. Generic AI assistants can summarise, but they hold no single trusted record with permissions, and no label for how well each fact is supported. Capital Q's category is investment intelligence: one trusted, comparable view of each opportunity, built for both sides.",
    sources: [`${PADL} Decision #001`, `${SPEC} 3.1`],
  },
  {
    id: "qa.ranking-fairness",
    side: "BOTH",
    question: "How do you decide what investors see first?",
    paraphrases: [
      "how does the feed rank companies",
      "can a company pay to appear higher",
      "is the feed optimised for engagement",
      "why did i see this company",
    ],
    answer:
      "The feed follows fixed, explainable rules: eligibility from your declared rules first, then fit against your mandate, evidence and freshness, then a little diversity. No model decides the order, nothing is optimised for watch time, and no company can pay to rank. Every card can tell you why it is there.",
    sources: [`${RECS} ranking order`, "CLAUDE.md Recommendations"],
  },
  {
    id: "qa.gateq",
    side: "BOTH",
    question: "What is GateQ?",
    paraphrases: [
      "how does the gateway work",
      "what is the investor gateway",
      "how do founders apply to an investor",
      "how do i apply to a vc fund",
      "what is the interview before the interview",
    ],
    answer:
      "GateQ is the investor's front door. The investor sets the criteria a business must meet; a founder who matches applies through it, and Q interviews them first. The investor receives every application in the same structure: the founder's own words, Q's reading, and a dossier, so the first meeting starts with alignment, not discovery. The decision always stays with the investor.",
    sources: [`${GATEQ} overview`, `${LANDING} LP-18, LP-19`],
  },
  {
    id: "qa.go-to-market",
    side: "BOTH",
    question: "What is your go-to-market?",
    paraphrases: [
      "how will you acquire users",
      "who are your first customers going to be",
      "how do you get both sides on board",
      "distribution strategy",
    ],
    answer:
      "Capital Q is offered through FDN Capital Partners, with a waitlist and demos for investors and businesses. The plan beyond that is not something I will state as fact; the founders can take you through it.",
    sources: [`${LANDING} LP-04`],
  },
  {
    id: "qa.onboarding",
    side: "BOTH",
    question: "How does onboarding work?",
    paraphrases: [
      "how do i get started",
      "how do you learn about my company",
      "how do you learn my mandate",
      "do i have to fill in long forms",
      "how does q get to know me",
      "what happens when i sign up",
    ],
    answer:
      "From the start, Q interviews you to onboard you. It learns as much as it can about you and your company, or about your mandate as an investor, from a conversation and from what you already have, such as a deck. There is no long questionnaire: you can skip anything, unknown stays unknown, and Q asks you to confirm what it extracted before it becomes part of your record.",
    sources: [`${LANDING} LP-15`, "CLAUDE.md Onboarding"],
  },
  {
    id: "qa.investor.value",
    side: "INVESTOR",
    question: "What does Capital Q do for me as an investor?",
    paraphrases: [
      "why would an investor use this",
      "how does this save me time",
      "what do i get as an investor",
      "how does it help my deal flow",
    ],
    answer:
      "It brings you the companies that fit your mandate, already in one comparable structure, and lets you interrogate each one with Q before you spend time on a call. You can set a gateway so applicants arrive qualified, keep every relationship's history in one place, and let Q act for you within the approval rules you set.",
    sources: [`${LANDING} LP-03, LP-17 to LP-20`],
  },
  {
    id: "qa.founder.value",
    side: "FOUNDER",
    question: "What does Capital Q do for me as a founder?",
    paraphrases: [
      "why would a founder use this",
      "how does this help me raise",
      "what do i get as a founder",
      "how will this help my fundraising",
      "what does capital q offer a founder",
    ],
    answer:
      "Q works first: upload what you already have and it builds your company record, tells you what may stop you from raising and what to improve next, and shows you the investors whose mandates you actually match. You can apply through their gateways, rehearse with an investor persona, and keep every conversation in one place.",
    sources: [`${LANDING} LP-15, LP-16`, `${SPEC} founder onboarding`],
  },
  ...FOUNDER_QA_ENTRIES,
  ...PRODUCT_QA_ENTRIES,
];

/** The bank. Grows by entries; the shape and the honesty tests stay. */
export const QA_BANK: readonly QaEntry[] = z.array(QaEntrySchema).parse(
  WRITTEN.map((entry) => ({
    ...entry,
    paraphrases: [
      ...entry.paraphrases,
      ...(SPOKEN_PARAPHRASES[entry.id] ?? []),
    ],
  })),
);

const STOP = new Set(
  [
    "a an the of to and or in on for is are be it this that i me my you your we our do does can with about at as by from",
    // Spoken fillers: a voice question carries them, a stored one does not.
    "so um uh uhm erm er hmm ah oh okay ok well basically actually just really yeah alright anyway",
    // Words every question can carry, which say nothing about which one.
    "guys guy folks up down out off over told tell tells said asked last week weeks month months ago yesterday today tomorrow earlier get gets got getting exactly thing things like would could should will there here any some all more much very way go going come comes want say tell let also still even ever them they their its us if then than has have had was were been being am please thanks sure guess maybe probably kinda gonna wanna lot lots bit whole these those people one",
  ]
    .join(" ")
    .split(" "),
);

/**
 * Spoken questions arrive through speech-to-text: filler phrases, and the
 * product's names heard as ordinary words ("gate queue", "capital cue").
 * Both are folded before tokens, the same way for the bank and the asker.
 */
const SPOKEN: readonly (readonly [RegExp, string])[] = [
  [/\bgate\s*(?:q|queue|cue|que|cu|kyu)\b/gu, "gateq"],
  [/\bcapital\s+(?:queue|cue|que|cu|kyu)\b/gu, "capital q"],
  [/\b(?:hey|hi|okay|ok)\s+(?:queue|cue|q)\b/gu, " "],
  [/\binvest(?:\s*i\s*q|\s+iq|iq)\b/gu, "investiq"],
  [/\binvestib(?:ility|le)\b/gu, "investability"],
  [
    /(?<!\b(?:do|did|does|would|will|how|don t|dont)\s)\byou know\b|\b(?:i mean|kind of|sort of|quick question|real quick|i was wondering|i wanted to ask|let me ask|can you tell me|could you tell me|tell me|i guess|i think|if you don't mind|out of curiosity)\b/gu,
    " ",
  ],
];

/**
 * Question words carry intent in a short question ("Who is it for?" is
 * nothing but them) and are noise in a long one, so the index keeps them
 * and a query weighs them only while it has at most two other words.
 */
const INTERROGATIVE = new Set("who what where when why how which".split(" "));

/** Words that mean the same thing here, folded to one. */
const SYNONYMS: Readonly<Record<string, string>> = {
  defensible: "moat",
  defensibility: "moat",
  advantage: "moat",
  proprietary: "moat",
  copy: "moat",
  price: "pricing",
  prices: "pricing",
  cost: "pricing",
  costs: "pricing",
  charge: "pricing",
  charges: "pricing",
  pay: "pricing",
  pays: "pricing",
  paying: "pricing",
  paid: "pricing",
  subscription: "pricing",
  fees: "pricing",
  fee: "pricing",
  monetise: "money",
  monetize: "money",
  monetisation: "money",
  monetization: "money",
  earn: "money",
  earns: "money",
  competitor: "competitors",
  competition: "competitors",
  competitive: "competitors",
  rivals: "competitors",
  rival: "competitors",
  alternatives: "competitors",
  landscape: "competitors",
  confidential: "privacy",
  confidentiality: "privacy",
  private: "privacy",
  secure: "security",
  hack: "security",
  hacked: "security",
  hacker: "security",
  breach: "security",
  breaches: "security",
  attack: "security",
  encrypted: "security",
  encryption: "security",
  hallucinate: "accuracy",
  hallucinates: "accuracy",
  hallucination: "accuracy",
  hallucinations: "accuracy",
  accurate: "accuracy",
  reliable: "accuracy",
  trust: "accuracy",
  wrong: "accuracy",
  mistakes: "accuracy",
  score: "scores",
  scoring: "scores",
  investiq: "scores",
  investability: "scores",
  suitability: "scores",
  rating: "scores",
  ratings: "scores",
  ranked: "ranking",
  rank: "ranking",
  order: "ranking",
  ordering: "ranking",
  raising: "raise",
  round: "raise",
  timing: "now",
  traction: "stage",
  customers: "stage",
  revenue: "stage",
  gateway: "gateq",
  apply: "gateq",
  applying: "gateq",
  application: "gateq",
  applications: "gateq",
  inbound: "gateq",
  site: "website",
  difference: "different",
  differ: "different",
  differs: "different",
  versus: "different",
  vs: "different",
  server: "host",
  servers: "host",
  residency: "host",
  located: "host",
  location: "host",
  datacenter: "host",
  datacentre: "host",
  owns: "own",
  owner: "own",
  ownership: "own",
  rights: "own",
  deletion: "delete",
  erase: "delete",
  erased: "delete",
  remove: "delete",
  removed: "delete",
  wipe: "delete",
  certifications: "certification",
  certified: "certification",
  certify: "certification",
  cert: "certification",
  certs: "certification",
  soc: "certification",
  iso: "certification",
  accreditation: "certification",
  regulated: "regulation",
  regulator: "regulation",
  regulators: "regulation",
  licence: "regulation",
  license: "regulation",
  licensed: "regulation",
  compliance: "regulation",
  compliant: "regulation",
  broker: "regulation",
  prediction: "predict",
  predictions: "predict",
  forecast: "predict",
  forecasts: "predict",
  forecasting: "predict",
  shown: "show",
  showed: "show",
  showing: "show",
  winner: "predict",
  winners: "predict",
  remember: "memory",
  remembers: "memory",
  recall: "memory",
  recalls: "memory",
  memories: "memory",
  verified: "verify",
  verification: "verify",
  vetted: "verify",
  vet: "verify",
  vetting: "verify",
  kyc: "verify",
  biased: "bias",
  unfair: "bias",
  fairness: "bias",
  discriminate: "bias",
  discrimination: "bias",
  prejudice: "bias",
  learns: "learn",
  learning: "learn",
  smarter: "learn",
  improve: "learn",
  improves: "learn",
  improving: "learn",
  languages: "language",
  spanish: "language",
  french: "language",
  arabic: "language",
  english: "language",
  portuguese: "language",
  speak: "voice",
  speaking: "voice",
  talk: "voice",
  talking: "voice",
  microphone: "voice",
  mic: "voice",
  spoken: "voice",
  aloud: "voice",
  swipes: "swipe",
  swiping: "swipe",
  scroll: "swipe",
  scrolling: "swipe",
  integrates: "integrate",
  integration: "integrate",
  integrations: "integrate",
  sync: "integrate",
  syncs: "integrate",
  plugin: "integrate",
  connect: "integrate",
  connects: "integrate",
  plans: "roadmap",
  planned: "roadmap",
  future: "roadmap",
  postmoney: "valuation",
  premoney: "valuation",
  companies: "company",
  business: "company",
  businesses: "company",
  startup: "company",
  startups: "company",
  founders: "founder",
  entrepreneur: "founder",
  entrepreneurs: "founder",
  phone: "mobile",
  phones: "mobile",
  ios: "mobile",
  android: "mobile",
  iphone: "mobile",
  app: "mobile",
  information: "data",
  info: "data",
  meetings: "meeting",
  call: "meeting",
  calls: "meeting",
  colleagues: "team",
  colleague: "team",
  partners: "team",
};

/** A light stem: enough that "hosted", "hosting" and "hosts" meet. */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith("ied")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && word.endsWith("ed")) return word.slice(0, -2);
  if (word.length > 5 && word.endsWith("ly")) return word.slice(0, -2);
  return word.replace(/(?<=..[^s])s$/u, "");
}

function tokens(text: string): string[] {
  let spoken = text.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
  for (const [heard, meant] of SPOKEN) spoken = spoken.replace(heard, meant);
  const words = spoken
    // A negation changes the question ("what can't Q do" is not "what is
    // Q"), so it survives the apostrophe.
    .replace(/\b(?:can['’]t|cannot)\b/gu, "can not")
    .replace(/\bwon['’]t\b/gu, "will not")
    .replace(/n['’]t\b/gu, " not")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    // "q" is the analyst's name, the one single letter that means something.
    .filter((word) => (word.length > 1 || word === "q") && !STOP.has(word))
    .map((word) => SYNONYMS[word] ?? SYNONYMS[stem(word)] ?? stem(word));
  // "Capital Q" is one name: its own term, beside its two words.
  const names = words.flatMap((word, i) =>
    word === "capital" && words[i + 1] === "q" ? ["capital-q"] : [],
  );
  return [...words, ...names];
}

/**
 * What the bank does with a question:
 * - ANSWER: confident, the prepared answer at once;
 * - CLARIFY: a close call between entries (or one just short of
 *   confident), so Q asks "Do you mean …?" rather than guess;
 * - LEAVE_TO_Q: the bank does not hold it; normal Q answers.
 */
export type QaMatch =
  | { readonly kind: "ANSWER"; readonly entry: QaEntry; readonly score: number }
  | {
      readonly kind: "CLARIFY";
      readonly candidates: readonly [QaEntry, ...QaEntry[]];
      /** Spoken as is: "Do you mean …, or …?" */
      readonly prompt: string;
    }
  | { readonly kind: "LEAVE_TO_Q" };

export type QaIndex = {
  /** The full decision. */
  readonly match: (text: string) => QaMatch;
  /** The confident answer only (ANSWER), else null: the earlier API. */
  readonly answer: (text: string) => QaEntry | null;
  /** The closest entries and their similarity (0–1), best first. */
  readonly rank: (
    text: string,
  ) => readonly { readonly entry: QaEntry; readonly score: number }[];
};

/**
 * Similarity (0–1) at which the bank answers, and how far the best entry
 * must lead the runner-up. Calibrated on the held-out spoken questions and
 * the not-in-bank questions in the tests: a wrong prepared answer is worse
 * than none.
 */
export const QA_THRESHOLD = 0.65;
export const QA_MARGIN = 0.24;

/** Between this and QA_THRESHOLD, Q asks "Do you mean …?". */
export const QA_CLARIFY_FLOOR = 0.55;

const LEAVE: QaMatch = { kind: "LEAVE_TO_Q" };

/**
 * An instruction aimed at Q's rules is never a product question, whatever
 * words it shares with one: it goes to normal Q, which holds the rules.
 */
const NOT_A_QUESTION =
  /\b(?:ignore|forget|disregard|override|bypass)\b.*\b(?:rules?|instructions?|restrictions?|guidelines?|prompt)\b|\bpretend\b|\bsystem prompt\b|\bjailbreak\b|^\s*(?:go|take me|navigate|open|close|scroll|click|play|pause|stop|skip|show me the)\b/u;

/**
 * The bank speaks about Capital Q. A question about one company (or its
 * founder) on the screen ("the valuation of the company in the demo") belongs to normal Q,
 * which can read that company's record.
 */
const ABOUT_A_COMPANY =
  /\b(?:(?:is|was|does|did|has) the founders? (?:married|single|old|young|from|have a|live|got)|the founders?'s? (?:age|wife|husband|family|kids|children|phone|mobile|number|address|salary|background)|demo (?:company|startup|business|founder|video|pitch)|(?:company|startup|business|founder) (?:in|from) the (?:demo|video|pitch)|(?:company|startup|business|founder) you (?:just )?(?:showed|show|presented|mentioned)|in the demo pitch)\b/u;

function aQuestionForTheBank(text: string): boolean {
  const plain = text.toLowerCase().trim();
  return !NOT_A_QUESTION.test(plain) && !ABOUT_A_COMPANY.test(plain);
}

/** Edit distance, stopping once it exceeds `limit`. */
function within(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let low = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (prev[j] ?? 0) + 1,
        (row[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
      row.push(value);
      low = Math.min(low, value);
    }
    if (low > limit) return limit + 1;
    prev = row;
  }
  return prev[b.length] ?? limit + 1;
}

function asked(entry: QaEntry): string {
  const q = entry.question.replace(/[?.!]+$/u, "");
  return q.charAt(0).toLowerCase() + q.slice(1);
}

/** "Do you mean …?" for one entry, or "…, or …?" for two. */
export function clarifyPrompt(
  candidates: readonly [QaEntry, ...QaEntry[]],
): string {
  const [first, second] = candidates;
  return second !== undefined
    ? `Do you mean ${asked(first)}, or ${asked(second)}?`
    : `Do you mean ${asked(first)}?`;
}

/**
 * Builds the in-memory index for one side (entries for that side and for
 * BOTH). Each stored wording is a weighted set of terms (rarer terms weigh
 * more); a question is compared with every wording, and an entry scores its
 * closest one. Words the bank never uses count against a match, so a
 * question about something else ("the score in the Arsenal game") stays
 * far from every entry. Well under a millisecond per question; nothing
 * leaves the browser and no model is called.
 */
export function buildQaIndex(
  side: Exclude<QaSide, "BOTH">,
  bank: readonly QaEntry[] = QA_BANK,
): QaIndex {
  const entries = bank.filter((e) => e.side === side || e.side === "BOTH");
  const wordings = entries.flatMap((entry) =>
    [entry.question, ...entry.paraphrases].map((text) => ({
      entry,
      terms: new Set(tokens(text)),
    })),
  );
  // Rarity is counted per entry: a word every wording of one entry uses is
  // still that entry's word.
  const df = new Map<string, number>();
  for (const entry of entries) {
    const seen = new Set(
      tokens([entry.question, ...entry.paraphrases].join(" ")),
    );
    for (const term of seen) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const byInitial = new Map<string, string[]>();
  for (const word of df.keys()) {
    if (word.length < 4) continue;
    const initial = word.charAt(0);
    byInitial.set(initial, [...(byInitial.get(initial) ?? []), word]);
  }
  const weight = (term: string): number => {
    const n = df.get(term) ?? 0;
    const w = Math.log((entries.length + 1) / (n + 0.5));
    return INTERROGATIVE.has(term) ? w * 0.5 : w;
  };
  /**
   * A word the bank has never seen weighs more than the rarest known word:
   * "the score in the Arsenal game" is about Arsenal, whatever it shares.
   */
  const unseen = 1.5 * Math.log((entries.length + 1) / 0.5);
  const norms = wordings.map(({ terms }) =>
    Math.sqrt([...terms].reduce((sum, t) => sum + weight(t) ** 2, 0)),
  );
  // A misheard or misspelt word is read as the bank's nearest word when it
  // is close enough to be the same word: one edit from six letters, two
  // from ten, the first letter kept.
  const heard = new Map<string, string>();
  const nearest = (term: string): string => {
    if (df.has(term) || term.length < 6) return term;
    const known = heard.get(term);
    if (known !== undefined) return known;
    const limit = term.length >= 10 ? 2 : 1;
    let best = term;
    let distance = limit + 1;
    // Speech-to-text keeps a word's first sound far more often than not.
    for (const word of byInitial.get(term.charAt(0)) ?? []) {
      const d = within(term, word, limit);
      if (d < distance) {
        best = word;
        distance = d;
      }
    }
    heard.set(term, best);
    return best;
  };
  // A question asked as stored (up to fillers, stop words, plurals and
  // synonyms) is that entry's. A wording stored by two entries belongs to
  // neither and falls through to scoring.
  const stored = new Map<string, QaEntry | null>();
  for (const entry of entries) {
    for (const wording of [entry.question, ...entry.paraphrases]) {
      const key = tokens(wording).join(" ");
      if (key === "") continue;
      const held = stored.get(key);
      stored.set(key, held === undefined || held === entry ? entry : null);
    }
  }
  const rank = (text: string) => {
    if (!aQuestionForTheBank(text)) return [];
    const said = new Set(tokens(text).map(nearest));
    if (said.size === 0) return [];
    const queryNorm = Math.sqrt(
      [...said].reduce(
        (sum, t) => sum + (df.has(t) ? weight(t) : unseen) ** 2,
        0,
      ),
    );
    // One shared word is not a match ("data room" is not a privacy
    // question), unless the question has only one word that means anything.
    const content = [...said].filter((t) => !INTERROGATIVE.has(t)).length;
    // "Thanks, Q" names the analyst and asks nothing.
    if ([...said].every((t) => INTERROGATIVE.has(t) || t === "q")) return [];
    const needed = content >= 3 ? 2 : 1;
    const best = new Map<QaEntry, number>();
    for (const [i, { entry, terms }] of wordings.entries()) {
      let shared = 0;
      let sharedContent = 0;
      for (const term of said) {
        if (!terms.has(term)) continue;
        shared += weight(term) ** 2;
        if (!INTERROGATIVE.has(term)) sharedContent += 1;
      }
      if (shared === 0 || sharedContent < needed) continue;
      const score = shared / (queryNorm * (norms[i] ?? 1));
      if (score > (best.get(entry) ?? 0)) best.set(entry, score);
    }
    return [...best.entries()]
      .map(([entry, score]) => ({ entry, score }))
      .sort((a, b) => b.score - a.score);
  };
  const match = (text: string): QaMatch => {
    if (!aQuestionForTheBank(text)) return LEAVE;
    const said = tokens(text).map(nearest);
    const key = said.join(" ");
    const exact = key === "" ? undefined : stored.get(key);
    if (exact) return { kind: "ANSWER", entry: exact, score: 1 };
    const [first, second] = rank(text);
    if (first === undefined || first.score < QA_CLARIFY_FLOOR) return LEAVE;
    const lead = first.score - (second?.score ?? 0);
    // One meaningful word ("is it hot in here") is too little to be sure
    // of: unless it is a stored wording, the most it earns is a question.
    const sure =
      new Set(said.filter((t) => !INTERROGATIVE.has(t) && t !== "q")).size >= 2;
    if (sure && first.score >= QA_THRESHOLD && lead >= QA_MARGIN) {
      return { kind: "ANSWER", entry: first.entry, score: first.score };
    }
    const candidates: [QaEntry, ...QaEntry[]] =
      second !== undefined &&
      second.score >= QA_CLARIFY_FLOOR &&
      lead < QA_MARGIN
        ? [first.entry, second.entry]
        : [first.entry];
    return { kind: "CLARIFY", candidates, prompt: clarifyPrompt(candidates) };
  };
  return {
    match,
    rank,
    answer: (text) => {
      const decided = match(text);
      return decided.kind === "ANSWER" ? decided.entry : null;
    },
  };
}
