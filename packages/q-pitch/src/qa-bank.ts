import { z } from "zod";

import { FOUNDER_QA_ENTRIES } from "./qa-bank-founder.js";
import { PRODUCT_QA_ENTRIES } from "./qa-bank-product.js";

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

/** The bank. Grows by entries; the shape and the honesty tests stay. */
export const QA_BANK: readonly QaEntry[] = z.array(QaEntrySchema).parse([
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
]);

const STOP = new Set(
  "a an the of to and or in on for is are be it this that i me my you your we our do does can with about at as by from".split(
    " ",
  ),
);

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
  pay: "pricing",
  subscription: "pricing",
  revenue: "stage",
  monetise: "money",
  monetize: "money",
  earn: "money",
  rivals: "competitors",
  competitor: "competitors",
  competition: "competitors",
  competitive: "competitors",
  alternatives: "competitors",
  confidential: "privacy",
  confidentiality: "privacy",
  private: "privacy",
  secure: "privacy",
  security: "privacy",
  hallucinate: "accuracy",
  hallucinations: "accuracy",
  accurate: "accuracy",
  reliable: "accuracy",
  trust: "accuracy",
  scoring: "scores",
  score: "scores",
  investiq: "scores",
  investability: "scores",
  suitability: "scores",
  ranked: "ranking",
  rank: "ranking",
  order: "ranking",
  feed: "ranking",
  people: "team",
  raising: "raise",
  round: "raise",
  ask: "raise",
  timing: "now",
  traction: "stage",
  customers: "stage",
  users: "stage",
  gateway: "gateq",
  site: "website",
  apply: "gateq",
};

function tokens(text: string): string[] {
  const words = text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    // A negation changes the question ("what can't Q do" is not "what is
    // Q"), so it survives the apostrophe.
    .replace(/\b(?:can['’]t|cannot)\b/gu, "can not")
    .replace(/\bwon['’]t\b/gu, "will not")
    .replace(/n['’]t\b/gu, " not")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/u)
    // "q" is the analyst's name, the one single letter that means something.
    .filter((word) => (word.length > 1 || word === "q") && !STOP.has(word))
    .map((word) => SYNONYMS[word] ?? word.replace(/(?<=..)s$/u, ""));
  // "Capital Q" is one name: its own term, beside its two words.
  const names = words.flatMap((word, i) =>
    word === "capital" && words[i + 1] === "q" ? ["capital-q"] : [],
  );
  return [...words, ...names];
}

export type QaIndex = {
  readonly answer: (text: string) => QaEntry | null;
};

/** Minimum BM25 score for a match; tuned on the bank's own paraphrases. */
export const QA_THRESHOLD = 1.4;

/**
 * How far the best entry must lead the runner-up, as a share of its own
 * score. A close call is a guess, and a wrong prepared answer is worse
 * than none: below the margin the question goes to normal Q.
 */
export const QA_MARGIN = 0.1;

/**
 * Builds the in-memory index for one side (entries for that side and for
 * BOTH). Microseconds per question; nothing leaves the browser.
 */
export function buildQaIndex(
  side: Exclude<QaSide, "BOTH">,
  bank: readonly QaEntry[] = QA_BANK,
): QaIndex {
  const entries = bank.filter((e) => e.side === side || e.side === "BOTH");
  const docs = entries.map((e) =>
    tokens([e.question, ...e.paraphrases].join(" ")),
  );
  const avg =
    docs.reduce((sum, d) => sum + d.length, 0) / Math.max(1, docs.length);
  const df = new Map<string, number>();
  for (const doc of docs) {
    for (const term of new Set(doc)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const idf = (term: string) => {
    const n = df.get(term) ?? 0;
    return Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
  };
  // A question asked as stored (up to stop words, plurals and synonyms) is
  // that entry's, however close another entry scores. A wording stored by
  // two entries belongs to neither and falls through to scoring.
  const stored = new Map<string, QaEntry | null>();
  for (const entry of entries) {
    for (const asked of [entry.question, ...entry.paraphrases]) {
      const key = tokens(asked).join(" ");
      if (key === "") continue;
      const held = stored.get(key);
      stored.set(key, held === undefined || held === entry ? entry : null);
    }
  }
  const K1 = 1.2;
  const B = 0.75;
  return {
    answer: (text) => {
      const key = tokens(text).join(" ");
      const exact = key === "" ? undefined : stored.get(key);
      if (exact) return exact;
      const all = [...new Set(tokens(text))];
      const content = all.filter((term) => !INTERROGATIVE.has(term));
      const query = content.length <= 2 ? all : content;
      if (query.length === 0) return null;
      let best: QaEntry | null = null;
      let bestScore = 0;
      let runnerUp = 0;
      for (const [index, doc] of docs.entries()) {
        let score = 0;
        let matched = 0;
        let matchedContent = 0;
        for (const term of query) {
          const tf = doc.filter((t) => t === term).length;
          if (tf === 0) continue;
          matched += 1;
          if (!INTERROGATIVE.has(term)) matchedContent += 1;
          score +=
            (idf(term) * tf * (K1 + 1)) /
            (tf + K1 * (1 - B + (B * doc.length) / avg));
        }
        // One shared word is not a match ("data room" is not a privacy
        // question), unless that word is the whole question. A question
        // word alone never counts as the shared content.
        if (content.length > 0) {
          if (matchedContent < Math.min(2, content.length)) continue;
        } else if (matched === 0) continue;
        const entry = entries[index];
        if (entry === undefined) continue;
        if (score > bestScore) {
          runnerUp = bestScore;
          best = entry;
          bestScore = score;
        } else if (score > runnerUp) {
          runnerUp = score;
        }
      }
      if (bestScore < QA_THRESHOLD) return null;
      return bestScore - runnerUp >= QA_MARGIN * bestScore ? best : null;
    },
  };
}
