import type { GateQStatementOp } from "@capital-q/q-core";

import {
  reading,
  type PromptSeen,
  type Script,
} from "../support/statement-world.js";

/**
 * The long journey (design 2026-11-14 §7): thirty-four scripted founder
 * turns with the reading a model would give for each. Readings name only
 * the handles Q was actually shown (resolved from the rendered prompt), so
 * every link the server writes is one the server issued.
 *
 * What it covers: evolving traction, a real correction, a code-detected
 * disagreement left open, a disagreement on the raise (decision 91) settled
 * by a correction, an unknown that never erases, stated zeros, small talk,
 * a question for Q, an invented handle, a reply that claims "noted" when
 * nothing was recorded, a model failure retried, a model failure the
 * founder walks away from (the orphan), a resumed session and sector
 * phrases split into statements.
 */

type Op = Partial<GateQStatementOp> &
  Pick<GateQStatementOp, "dimension" | "value" | "words">;
const st = (op: Op): GateQStatementOp => ({
  op: "NEW",
  target: null,
  turn: null,
  quantity: null,
  asOf: null,
  provenance: "APPLICANT_PROVIDED",
  ...op,
});

export type JourneyTurn = {
  readonly id: string;
  readonly say: string;
  /** "FAIL": the model is unavailable for this turn. */
  readonly script: Script | "FAIL";
  /** After a failure: the founder sends the same turn again. */
  readonly retryWith?: Script | undefined;
  /** Statements this turn should record: their words, and who said them. */
  readonly records?: readonly {
    readonly words: string;
    readonly dimension: string;
    /** The client turn id that said it, when not this one (an orphan). */
    readonly saidIn?: string;
  }[];
  /** Fresh service instances before this turn: a resumed session. */
  readonly resumeBefore?: true;
};

const NOV1 = "2026-11-01";

export const JOURNEY: readonly JourneyTurn[] = [
  {
    id: "turn-0001",
    say: "We're Ledgerly, a payments API for informal retailers, based in Lagos, Nigeria.",
    script: () =>
      reading({
        reply: "Ledgerly, got it. What stage are you at?",
        asking: "company.stage",
        statements: [
          st({
            dimension: "company.name",
            value: { kind: "TEXT", text: "Ledgerly" },
            words: "We're Ledgerly",
          }),
          st({
            dimension: "company.description",
            value: {
              kind: "TEXT",
              text: "a payments API for informal retailers",
            },
            words: "a payments API for informal retailers",
          }),
          st({
            dimension: "company.country",
            value: { kind: "CODE", code: "NG" },
            words: "based in Lagos, Nigeria",
          }),
        ],
      }),
    records: [
      { words: "We're Ledgerly", dimension: "company.name" },
      {
        words: "a payments API for informal retailers",
        dimension: "company.description",
      },
      { words: "based in Lagos, Nigeria", dimension: "company.country" },
    ],
  },
  {
    id: "turn-0002",
    say: "We're at seed.",
    script: () =>
      reading({
        reply: "Seed, nice. How many retailers use it each week?",
        asking: "claims.traction",
        statements: [
          st({
            dimension: "company.stage",
            value: { kind: "CODE", code: "seed" },
            words: "We're at seed",
          }),
        ],
      }),
    records: [{ words: "We're at seed", dimension: "company.stage" }],
  },
  {
    id: "turn-0003",
    say: "About 600 weekly active retailers as of 1 November.",
    script: () =>
      reading({
        reply: "Six hundred a week is a real start. How has that moved?",
        asking: "claims.traction",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "weekly_active_users",
            asOf: NOV1,
            provenance: "ESTIMATED",
            value: { kind: "COUNT", count: "600" },
            words: "About 600 weekly active retailers as of 1 November",
          }),
        ],
      }),
    records: [
      {
        words: "About 600 weekly active retailers as of 1 November",
        dimension: "claims.traction",
      },
    ],
  },
  {
    id: "turn-0004",
    say: "We went from 6 to 18 operators this quarter.",
    script: () =>
      reading({
        reply: "Tripling operators in a quarter. Does anybody pay yet?",
        asking: "claims.revenue",
        statements: [
          st({
            dimension: "claims.traction",
            value: {
              kind: "TEXT",
              text: "We went from 6 to 18 operators this quarter",
            },
            words: "We went from 6 to 18 operators this quarter",
          }),
        ],
      }),
    records: [
      {
        words: "We went from 6 to 18 operators this quarter",
        dimension: "claims.traction",
      },
    ],
  },
  {
    id: "turn-0005",
    say: "Nobody pays yet.",
    script: () =>
      reading({
        reply: "Understood. How much are you raising?",
        asking: "raise.amount",
        statements: [
          st({
            dimension: "claims.revenue",
            quantity: "revenue",
            value: { kind: "ZERO" },
            words: "Nobody pays yet",
          }),
        ],
      }),
    records: [{ words: "Nobody pays yet", dimension: "claims.revenue" }],
  },
  {
    id: "turn-0006",
    say: "We're raising $1,500,000 in US dollars.",
    script: () =>
      reading({
        reply: "One and a half million. What problem does Ledgerly solve?",
        asking: "company.problem",
        statements: [
          st({
            dimension: "raise.amount",
            quantity: "raise_amount",
            value: { kind: "MONEY", amount: "1500000", currency: "USD" },
            words: "We're raising $1,500,000",
          }),
          st({
            dimension: "raise.currency",
            value: { kind: "CODE", code: "USD" },
            words: "in US dollars",
          }),
        ],
      }),
    records: [
      { words: "We're raising $1,500,000", dimension: "raise.amount" },
      { words: "in US dollars", dimension: "raise.currency" },
    ],
  },
  {
    id: "turn-0007",
    say: "Retailers can't reconcile mobile money payments.",
    script: () =>
      reading({
        reply: "That's a painful one. Who is on the team?",
        asking: "company.team",
        statements: [
          st({
            dimension: "company.problem",
            value: {
              kind: "TEXT",
              text: "Retailers can't reconcile mobile money payments",
            },
            words: "Retailers can't reconcile mobile money payments",
          }),
        ],
      }),
    records: [
      {
        words: "Retailers can't reconcile mobile money payments",
        dimension: "company.problem",
      },
    ],
  },
  {
    // A real correction: only the 600 gives way; the operators line stays.
    id: "turn-0008",
    say: "Actually it's about 1,500 weekly active as of 1 November, I misread the dashboard.",
    script: (p: PromptSeen) =>
      reading({
        reply: "Fifteen hundred, thanks for fixing that. Who is on the team?",
        intent: "CORRECTION",
        asking: "company.team",
        statements: [
          st({
            op: "CORRECTS",
            target: p.statement("About 600 weekly active"),
            dimension: "claims.traction",
            quantity: "weekly_active_users",
            asOf: NOV1,
            provenance: "ESTIMATED",
            value: { kind: "COUNT", count: "1500" },
            words: "about 1,500 weekly active as of 1 November",
          }),
        ],
      }),
    records: [
      {
        words: "about 1,500 weekly active as of 1 November",
        dimension: "claims.traction",
      },
    ],
  },
  {
    // Small talk records nothing, whatever the model read into it.
    id: "turn-0009",
    say: "Ha, sorry, busy day.",
    script: () =>
      reading({
        reply: "No problem at all. Who is on the team?",
        intent: "SMALL_TALK",
        asking: "company.team",
        statements: [
          st({
            dimension: "company.team",
            value: { kind: "TEXT", text: "busy" },
            words: "busy day",
          }),
        ],
      }),
  },
  {
    id: "turn-0010",
    say: "Our team is three engineers and me.",
    script: () =>
      reading({
        reply: "A small, technical team. What is the market like?",
        asking: "company.market",
        statements: [
          st({
            dimension: "company.team",
            value: { kind: "TEXT", text: "three engineers and me" },
            words: "Our team is three engineers and me",
          }),
        ],
      }),
    records: [
      {
        words: "Our team is three engineers and me",
        dimension: "company.team",
      },
    ],
  },
  {
    id: "turn-0011",
    say: "Willingness to pay is not tested yet.",
    script: () =>
      reading({
        reply: "Fair. How big is the market?",
        asking: "company.market",
        statements: [
          st({
            dimension: "claims.traction",
            value: {
              kind: "TEXT",
              text: "Willingness to pay is not tested yet",
            },
            words: "Willingness to pay is not tested yet",
          }),
        ],
      }),
    records: [
      {
        words: "Willingness to pay is not tested yet",
        dimension: "claims.traction",
      },
    ],
  },
  {
    // UNKNOWN is a real answer and asked at most once more.
    id: "turn-0012",
    say: "I don't know the market size yet.",
    script: () =>
      reading({
        reply: "That's fine. Who are your customers?",
        intent: "UNKNOWN_OR_SKIP",
        asking: "company.market",
        statements: [
          st({
            dimension: "company.market",
            provenance: "UNKNOWN",
            value: { kind: "UNKNOWN", declined: false },
            words: "I don't know the market size yet",
          }),
        ],
      }),
    records: [
      {
        words: "I don't know the market size yet",
        dimension: "company.market",
      },
    ],
  },
  {
    // Read as NEW by the model; code finds the disagreement (same quantity
    // and date, different number) and links it.
    id: "turn-0013",
    say: "Our analytics say 1,450 weekly active as of 1 November.",
    script: () =>
      reading({
        reply: "So 1,450 or 1,500 weekly active on 1 November: which is right?",
        asking: "claims.traction",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "weekly_active_users",
            asOf: NOV1,
            value: { kind: "COUNT", count: "1450" },
            words: "1,450 weekly active as of 1 November",
          }),
        ],
      }),
    records: [
      {
        words: "1,450 weekly active as of 1 November",
        dimension: "claims.traction",
      },
    ],
  },
  {
    id: "turn-0014",
    say: "I'm not sure which is right, leave it open.",
    script: (p: PromptSeen) =>
      reading({
        reply: "I'll leave both as you said them. Who are your customers?",
        intent: "UNKNOWN_OR_SKIP",
        asking: "company.customers",
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "weekly_active_users",
            provenance: "UNKNOWN",
            value: { kind: "UNKNOWN", declined: false },
            words: "I'm not sure which is right",
          }),
        ],
        disagreementActions: [
          {
            disagreement: p.disagreement("claims.traction"),
            action: "LEAVE_OPEN",
            keep: null,
          },
        ],
      }),
    // Slice 3 (live 2026-11-14): "not sure, leave it open" with a
    // disagreement open on the dimension is the LEAVE_OPEN itself, never an
    // "I don't know" statement beside the two figures.
  },
  {
    id: "turn-0015",
    resumeBefore: true,
    say: "Back again. Customers are small retailers and wholesalers.",
    script: () =>
      reading({
        reply: "Welcome back. What will the money go on?",
        asking: "raise.use_of_funds",
        statements: [
          st({
            dimension: "company.customers",
            value: { kind: "TEXT", text: "small retailers and wholesalers" },
            words: "Customers are small retailers and wholesalers",
          }),
        ],
      }),
    records: [
      {
        words: "Customers are small retailers and wholesalers",
        dimension: "company.customers",
      },
    ],
  },
  {
    id: "turn-0016",
    say: "Hiring two engineers and a sales lead.",
    script: () =>
      reading({
        reply: "Clear. How do you make money?",
        asking: "company.business_model",
        statements: [
          st({
            dimension: "raise.use_of_funds",
            value: {
              kind: "TEXT",
              text: "Hiring two engineers and a sales lead",
            },
            words: "Hiring two engineers and a sales lead",
          }),
        ],
      }),
    records: [
      {
        words: "Hiring two engineers and a sales lead",
        dimension: "raise.use_of_funds",
      },
    ],
  },
  {
    // Invariant 7: the model says "Noted" and recorded nothing.
    id: "turn-0017",
    say: "Hmm, let me think about that one.",
    script: () =>
      reading({
        reply: "Noted! How do you make money?",
        asking: "company.business_model",
      }),
  },
  {
    id: "turn-0018",
    say: "We charge 1% per transaction.",
    script: () =>
      reading({
        reply: "One percent of flow. Anything to add on the team?",
        asking: "company.team",
        statements: [
          st({
            dimension: "company.business_model",
            value: { kind: "TEXT", text: "We charge 1% per transaction" },
            words: "We charge 1% per transaction",
          }),
        ],
      }),
    records: [
      {
        words: "We charge 1% per transaction",
        dimension: "company.business_model",
      },
    ],
  },
  {
    // A handle the server never issued: kept as NEW, never guessed.
    id: "turn-0019",
    say: "Sorry, the team is four engineers now, not three.",
    script: () =>
      reading({
        reply: "Four engineers. What about the raise?",
        intent: "CORRECTION",
        asking: "raise.amount",
        statements: [
          st({
            op: "CORRECTS",
            target: "S99",
            dimension: "company.team",
            value: { kind: "TEXT", text: "four engineers now" },
            words: "the team is four engineers now, not three",
          }),
        ],
      }),
    records: [
      {
        words: "the team is four engineers now, not three",
        dimension: "company.team",
      },
    ],
  },
  {
    // Decision 91: a qualifying fact in genuine disagreement.
    id: "turn-0020",
    say: "Some investors told us to raise $2,000,000 instead.",
    script: (p: PromptSeen) =>
      reading({
        reply: "So 1.5 million or 2 million: which are you raising?",
        asking: "raise.amount",
        statements: [
          st({
            op: "DISAGREES",
            target: p.statement("We're raising $1,500,000"),
            dimension: "raise.amount",
            quantity: "raise_amount",
            value: { kind: "MONEY", amount: "2000000", currency: "USD" },
            words: "raise $2,000,000 instead",
          }),
        ],
      }),
    records: [{ words: "raise $2,000,000 instead", dimension: "raise.amount" }],
  },
  {
    // The model fails; the founder sends the same message again.
    id: "turn-0021",
    say: "The market is every informal retailer in West Africa, about 2 million shops.",
    script: "FAIL",
    retryWith: () =>
      reading({
        reply: "Two million shops is a big base. So which raise is it?",
        asking: "raise.amount",
        statements: [
          st({
            dimension: "company.market",
            value: {
              kind: "TEXT",
              text: "every informal retailer in West Africa, about 2 million shops",
            },
            words:
              "every informal retailer in West Africa, about 2 million shops",
          }),
        ],
      }),
    records: [
      {
        words: "every informal retailer in West Africa, about 2 million shops",
        dimension: "company.market",
      },
    ],
  },
  {
    // The correction that settles the raise.
    id: "turn-0022",
    say: "To be clear, we're raising $2,000,000; the 1.5 was last year's plan.",
    script: (p: PromptSeen) =>
      reading({
        reply: "Two million it is. What's your website?",
        intent: "CORRECTION",
        asking: "company.website",
        statements: [
          st({
            op: "CORRECTS",
            target: p.statement("We're raising $1,500,000"),
            dimension: "raise.amount",
            quantity: "raise_amount",
            value: { kind: "MONEY", amount: "2000000", currency: "USD" },
            words: "we're raising $2,000,000; the 1.5 was last year's plan",
          }),
        ],
      }),
    records: [
      {
        words: "we're raising $2,000,000; the 1.5 was last year's plan",
        dimension: "raise.amount",
      },
    ],
  },
  {
    // A topic change: a question for Q records nothing.
    id: "turn-0023",
    say: "Can I ask what Acme looks for in a company?",
    script: () =>
      reading({
        reply:
          "They ask where you are, your stage and your raise, and read it themselves. What's your website?",
        intent: "QUESTION_FOR_Q",
        questionForQ: "what Acme looks for",
        asking: "company.website",
      }),
  },
  {
    id: "turn-0024",
    say: "Our website is ledgerly.example.",
    script: () =>
      reading({
        reply: "Thanks. Who am I talking to?",
        asking: "contact.name",
        statements: [
          st({
            dimension: "company.website",
            value: { kind: "TEXT", text: "ledgerly.example" },
            words: "Our website is ledgerly.example",
          }),
        ],
      }),
    records: [
      {
        words: "Our website is ledgerly.example",
        dimension: "company.website",
      },
    ],
  },
  {
    id: "turn-0025",
    say: "I'm Ada Obi, the CEO.",
    script: () =>
      reading({
        reply: "Good to meet you, Ada. How many wallets are live?",
        asking: "claims.traction",
        statements: [
          st({
            dimension: "contact.name",
            value: { kind: "TEXT", text: "Ada Obi" },
            words: "I'm Ada Obi",
          }),
          st({
            dimension: "contact.role",
            value: { kind: "TEXT", text: "CEO" },
            words: "the CEO",
          }),
        ],
      }),
    records: [
      { words: "I'm Ada Obi", dimension: "contact.name" },
      { words: "the CEO", dimension: "contact.role" },
    ],
  },
  {
    // A different quantity never contradicts weekly active users (D10).
    id: "turn-0026",
    say: "We now have 2,300 wallets.",
    script: () =>
      reading({
        reply: "2,300 wallets. Any partnerships?",
        asking: null,
        statements: [
          st({
            dimension: "claims.traction",
            quantity: "wallets",
            value: { kind: "COUNT", count: "2300" },
            words: "We now have 2,300 wallets",
          }),
        ],
      }),
    records: [
      { words: "We now have 2,300 wallets", dimension: "claims.traction" },
    ],
  },
  {
    // The model fails and the founder moves on: an orphan PERSON turn.
    id: "turn-0027",
    say: "We also signed a pilot with a large distributor.",
    script: "FAIL",
  },
  {
    // The orphan is read with its own turn id before this turn.
    id: "turn-0028",
    say: "And our monthly growth is 20%.",
    script: (p: PromptSeen) => {
      if (!p.unread().some((line) => line.includes("signed a pilot")))
        throw new Error("the orphaned turn was not offered for reading");
      return reading({
        reply:
          "A distributor pilot and 20% a month. Do you have a lead investor?",
        asking: "raise.lead_status",
        statements: [
          st({
            turn: "T1",
            dimension: "claims.traction",
            value: {
              kind: "TEXT",
              text: "signed a pilot with a large distributor",
            },
            words: "We also signed a pilot with a large distributor",
          }),
          st({
            dimension: "claims.traction",
            quantity: "growth_rate_monthly",
            value: { kind: "PERCENT", percent: "20" },
            words: "our monthly growth is 20%",
          }),
        ],
      });
    },
    records: [
      {
        words: "We also signed a pilot with a large distributor",
        dimension: "claims.traction",
        saidIn: "turn-0027",
      },
      { words: "our monthly growth is 20%", dimension: "claims.traction" },
    ],
  },
  {
    id: "turn-0029",
    say: "We don't have a lead investor yet.",
    script: () =>
      reading({
        reply: "Understood. What instrument?",
        asking: "raise.instrument",
        statements: [
          st({
            dimension: "raise.lead_status",
            value: { kind: "TEXT", text: "no lead investor yet" },
            words: "We don't have a lead investor yet",
          }),
        ],
      }),
    records: [
      {
        words: "We don't have a lead investor yet",
        dimension: "raise.lead_status",
      },
    ],
  },
  {
    id: "turn-0030",
    say: "It's a SAFE.",
    script: () =>
      reading({
        reply: "A SAFE. Which sector would you put yourselves in?",
        asking: "company.sector_phrases",
        statements: [
          st({
            dimension: "raise.instrument",
            value: { kind: "TEXT", text: "SAFE" },
            words: "It's a SAFE",
          }),
        ],
      }),
    records: [{ words: "It's a SAFE", dimension: "raise.instrument" }],
  },
  {
    // The same zero again is already on record: nothing new is written.
    id: "turn-0031",
    say: "And to repeat, revenue is still zero.",
    script: () =>
      reading({
        reply: "Still pre-revenue, understood. Which sector?",
        asking: "company.sector_phrases",
        statements: [
          st({
            dimension: "claims.revenue",
            quantity: "revenue",
            value: { kind: "ZERO" },
            words: "revenue is still zero",
          }),
        ],
      }),
  },
  {
    id: "turn-0032",
    say: "We're in Nigeria, Lagos.",
    script: () =>
      reading({
        reply: "Lagos, yes. Which sector?",
        asking: "company.sector_phrases",
        statements: [
          st({
            dimension: "company.country",
            value: { kind: "CODE", code: "NG" },
            words: "We're in Nigeria",
          }),
        ],
      }),
  },
  {
    id: "turn-0033",
    say: "Sector: fintech, payments infrastructure.",
    script: () =>
      reading({
        reply:
          "Fintech and payments infrastructure. Anything else before you submit?",
        asking: null,
        statements: [
          st({
            dimension: "company.sector_phrases",
            value: { kind: "TEXT", text: "fintech, payments infrastructure" },
            words: "fintech, payments infrastructure",
          }),
        ],
      }),
    records: [
      {
        words: "fintech, payments infrastructure",
        dimension: "company.sector_phrases",
      },
    ],
  },
  {
    id: "turn-0034",
    say: "That's everything, I'd like to submit.",
    script: () =>
      reading({
        reply: "Thank you, Ada. You can review and submit now.",
        intent: "SUBMIT_INTENT",
        readyToReview: true,
      }),
  },
];
