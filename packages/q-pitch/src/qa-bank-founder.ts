import type { QaEntry } from "./qa-bank.js";

/**
 * Q Pitch v6: the FOUNDER side of the Q&A bank (Lane qpf). Questions a
 * founder audience is likely to ask after the founder track, each grounded
 * in the product sources and ADRs. Same rules as the rest of the bank: an
 * answer claims no traction, customers, revenue, investors or team size,
 * and names the files it is drawn from (the bank's tests read both).
 * Validated by QA_BANK's own schema, which includes these entries.
 */

const LANDING = "docs/ai-handoff/LANDING-PROMISES.md";
const GATEQ =
  "docs/product-sources/text/CapitalQ_GateQ_Product_Feature_Specification.txt";
const PADL =
  "docs/product-sources/text/Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt";

export const FOUNDER_QA_ENTRIES: readonly QaEntry[] = [
  {
    id: "qa.founder.which-investors",
    side: "FOUNDER",
    question: "How do you decide which investors match me?",
    paraphrases: [
      "why are these investors shown to me",
      "how are investors matched to my company",
      "which investors fit my startup",
      "how do i find investors that fit",
      "what does criteria met mean on an investor card",
    ],
    answer:
      "Only investors who chose to be found appear. Where an investor publishes a gate, I check your company against each of its published criteria and say met, not met, or not known yet. Their private mandate is never read and never shapes your list, and meeting a gate is not a promise of interest. Not known yet means your profile doesn't say yet, never a no.",
    sources: [
      "docs/adr/0023-founder-connection-requests.md",
      `${GATEQ} criteria`,
    ],
  },
  {
    id: "qa.founder.reach-investor",
    side: "FOUNDER",
    question: "Can I message an investor directly?",
    paraphrases: [
      "how do i contact an investor",
      "can i cold message investors",
      "how do i reach out to a fund",
      "what is a connection request",
    ],
    answer:
      "Not cold. You reach an investor in one of two structured ways: a Connection Request, which shows them your company and they accept or decline, or an application through their GateQ gate. Each investor decides whether they take requests at all. Once they accept, you are connected and can chat and book meetings from the shared record.",
    sources: ["docs/adr/0023-founder-connection-requests.md", `${GATEQ} modes`],
  },
  {
    id: "qa.founder.interview",
    side: "FOUNDER",
    question: "What happens in the GateQ interview?",
    paraphrases: [
      "what will the interviewer ask me after i apply",
      "how long is the application interview",
      "is the gateq interview a video call",
      "who interviews me when i apply to a fund",
    ],
    answer:
      "After you apply, Q interviews you on the investor's behalf in a short conversation, by voice or video, about what their gate cares about. The investor then receives your application in the same structure as every other: your own words, Q's reading of them and a dossier, with your claims labelled as your claims. The decision stays with the investor.",
    sources: [`${GATEQ} interview`, `${LANDING} LP-18, LP-19`],
  },
  {
    id: "qa.founder.rehearsal",
    side: "FOUNDER",
    question: "How do rehearsals work?",
    paraphrases: [
      "is the investor in the rehearsal real",
      "how does q coach me before a meeting",
      "what is the rehearsal persona",
      "can i practise my pitch with an investor",
    ],
    answer:
      "You pick who to practise with, and Q plays them by voice, from a persona built only from what you may already see about them. A persona is Q's inference about their style, never a fact about the person, and it is clearly labelled as a simulation. Afterwards Q reviews the call: what went right, what to improve, tips for that meeting and the full transcript.",
    sources: ["docs/adr/0029-rehearsal-personas-and-vision-frames.md"],
  },
  {
    id: "qa.founder.readiness",
    side: "FOUNDER",
    question: "How do I become more investable?",
    paraphrases: [
      "what stops me from raising",
      "what should i improve before fundraising",
      "how does q help me get ready to raise",
      "what is my readiness",
    ],
    answer:
      "Q assesses your company across the key investment-readiness factors on its evidence, says plainly what may prevent you from raising, and shows what to improve next, in order. Insufficient evidence lowers confidence; it never means a poor company, and anything unknown stays unknown until you add it.",
    sources: [
      `${LANDING} LP-16`,
      "docs/adr/0036-readiness-blueprint-and-plan-values.md",
    ],
  },
  {
    id: "qa.founder.express-interest",
    side: "FOUNDER",
    question: "Why can't I express interest in other founders' companies?",
    paraphrases: [
      "why is there no interest button for founders on explore",
      "can founders back other startups here",
      "why can i only watch other founders' pitches",
    ],
    answer:
      "Expressing interest is an investor action on the one canonical relationship between a company and an investor. As a founder, Explore lets you watch other founders' pitches and learn from them; your own way forward with investors is a Connection Request or a GateQ application.",
    sources: [
      "docs/adr/0023-founder-connection-requests.md",
      `${PADL} bilateral discovery`,
    ],
  },
  {
    id: "qa.founder.meetings",
    side: "FOUNDER",
    question: "Does Q join my investor meetings?",
    paraphrases: [
      "what happens in a meeting booked on capital q",
      "does q take notes in my calls",
      "what about commitments made in a meeting",
    ],
    answer:
      "Yes. Q attends meetings booked on Capital Q, keeps the transcript and a structured record of who attended and what was agreed, and afterwards asks you to confirm any commitments before they count. Commitments you confirm appear in Capital, beside your raise.",
    sources: ["docs/adr/0027-q-attends-every-capital-q-meeting.md"],
  },
  {
    id: "qa.founder.why-capital-q",
    side: "FOUNDER",
    question: "Why did Q pitch Capital Q instead of my company?",
    paraphrases: [
      "why was capital q the example company",
      "is capital q itself on the platform",
      "why present capital q in the founder tour",
    ],
    answer:
      "Because the subject everyone in the room knows is Capital Q itself. Q presented it on the same fourteen-section template every founder's overview uses, under the same rules: pre-seed and bootstrapping, the raise shown as the founders' own claim, and nothing invented about traction or team.",
    sources: [
      "docs/specs/q-pitch/V6-PLAN.md section 8",
      `${PADL} Decision #006`,
    ],
  },
];
