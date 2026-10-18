import type { QAnswerCard, QResultBlock } from "@capital-q/contracts";

/**
 * Founder live 2026-10-08, conversation c10b845f (03:22-03:27 UTC): the
 * turns, the words Q said, and the cards it showed, as recorded in
 * q_runtime.conversation_messages. Ten cards, seven level at 8.8.
 */

const ROWS: readonly (readonly [string, number, string])[] = [
  ["Halyard Security", 8.8, "seed · United Kingdom"],
  ["Clearwater Assurance", 8.8, "Series A · United Kingdom"],
  ["Tensorgate", 8.8, "seed · United States"],
  ["Shiftwell", 8.8, "Series A · United States"],
  ["Railhead Robotics", 8.8, "Series A · United States"],
  ["Nixo", 8.8, "seed · United States"],
  ["Spheros", 8.8, "seed · United States"],
  ["Souqsheet", 7.6, "Series A · Egypt"],
  ["Ledgerline", 7.6, "seed · Nigeria"],
  ["Portside", 7.6, "seed · Nigeria"],
];

export const C10B_CARDS: readonly QAnswerCard[] = ROWS.map(
  ([name, score, line], index) => {
    const stage = line.split(" · ")[0] ?? "seed";
    return {
      key: name.toLowerCase().replace(/[^a-z]/gu, ""),
      name,
      line,
      hue: (index % 7) + 1,
      fit: { score, measured: 5, of: 7 },
      reasons: [
        `Raising ${stage}; you invest at pre-seed to Series A.`,
        "In one of your sectors.",
        "Cheque size not known yet.",
      ],
      measures: [
        { label: "Stage", level: "STRONG", value: null },
        { label: "Sector", level: "STRONG", value: null },
        { label: "Geography", level: "GOOD", value: null },
      ],
      view: null,
      said: `${name} is ${String(score)} out of 10, a good fit.`,
      sourceCount: 0,
      subject: null,
    };
  },
);

export const C10B_FIT_BLOCKS: readonly QResultBlock[] = [
  {
    kind: "ANSWER_CARDS",
    shape: "RANKED",
    title: "Fit against your mandate",
    cards: [...C10B_CARDS],
    followUps: [],
  },
];

export const C10B_OPEN_BLOCKS: readonly QResultBlock[] = [
  {
    kind: "UI_INTENT",
    intent: {
      id: "1ab2cc02-160f-4812-a6b1-8be7e43afd3e",
      kind: "OPEN_RECORD_PAGE",
      page: "COMPANY",
    },
  },
];

export const C10B_NAVIGATE_BLOCKS: readonly QResultBlock[] = [
  { kind: "UI_INTENT", intent: { kind: "NAVIGATE", destination: "DISCOVER" } },
];

export const C10B_TURNS = {
  topThree: {
    asked:
      "Show me the top three companies that are aligned against the mandate.",
    said: "I've scored your top 10 companies against your mandate. Halyard Security fits best, at 8.8 out of 10, then Clearwater Assurance at 8.8 out of 10. Pros and cons for each are on screen.",
  },
  third: {
    asked: "Tell me about the third company on the list.",
    said: 'Opening "Tensorgate".',
  },
  explore: {
    asked: "Take me to the explore page.",
    said: "Taking you to Discover.",
  },
} as const;
