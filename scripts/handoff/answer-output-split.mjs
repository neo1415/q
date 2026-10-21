// Turn latency round 5: where an answer object's output tokens go,
// estimated offline. No network, no provider. The objects below are
// REPRESENTATIVE answers built from COMPANY_ANALYST v26's schema and task
// text (field shapes, "basis is supplied fact labels or supporting
// statements", answerCards, gestures), sized to the measured totals
// (typed analysis ~1,100 tokens, comparison ~2,280; TURN-LATENCY row 15).
// They are not recorded outputs: production's split comes from the
// `outputSplit` field of "q answer produced" once deployed.
//
// Usage: node scripts/handoff/answer-output-split.mjs
import { readdirSync } from "node:fs";
import { outputSplitOf } from "../../packages/model-gateway/dist/q/output-split.js";

// js-tiktoken is a transitive dependency (not hoisted): o200k_base, the
// GPT-4o family's encoding. Without it, characters / 4.
const store = new URL("../../node_modules/.pnpm/", import.meta.url);
const found = readdirSync(store).find((name) =>
  name.startsWith("js-tiktoken@"),
);
const tiktoken = found
  ? await import(
      new URL(`${found}/node_modules/js-tiktoken/dist/index.js`, store).href
    ).catch(() => null)
  : null;
const enc = tiktoken?.getEncoding("o200k_base") ?? null;
console.log(
  `tokenizer: ${enc === null ? "characters / 4" : "js-tiktoken o200k_base"}`,
);
const tokens = (value) => {
  if (value === undefined || value === null) return 0;
  const text = JSON.stringify(value);
  return enc === null ? Math.ceil(text.length / 4) : enc.encode(text).length;
};

const words = (n, seed) => {
  const pool = (
    "the company declares seed stage revenue growth from enterprise pilots in Kenya and Nigeria " +
    "with a burn that the record does not state so runway is unknown and the team of fourteen " +
    "includes two founders with prior exits while the pipeline names three paying customers " +
    "and churn is not reported which matters for a seed investor judging repeatability"
  ).split(" ");
  return Array.from(
    { length: n },
    (_, i) => pool[(i * 7 + seed) % pool.length],
  ).join(" ");
};
const finding = (i, basisStatements) => ({
  type: ["TRACTION", "TEAM", "MARKET", "RISK", "FINANCIALS", "PRODUCT"][i % 6],
  statement: `${words(28, i)}.`,
  truthClass: i % 3 === 0 ? "Q_INFERENCE" : "USER_CLAIM",
  evidenceStatus: i % 2 === 0 ? "SELF_REPORTED" : "DOCUMENT_SUPPORTED",
  confidence: ["MEDIUM", "LOW", "HIGH"][i % 3],
  basis: [
    `F${String(i + 1)}`,
    ...Array.from(
      { length: basisStatements },
      (_, k) => `${words(16, i + k)}.`,
    ),
  ],
});
const gestures = (n) =>
  Array.from({ length: n }, (_, i) => ({
    sentence: i,
    gesture: ["NOD", "EMPHASIS", "OPEN_HANDS"][i % 3],
  }));
const card = (name, i) => ({
  name,
  line: words(14, i),
  reasons: [words(18, i), words(18, i + 1), words(16, i + 2)],
  measures: [
    { label: "Stage", level: "STRONG", value: "Seed" },
    { label: "Sector", level: "GOOD", value: "Fintech" },
    { label: "Geography", level: "STRONG", value: "Kenya" },
    { label: "Traction", level: "PARTIAL", value: "$31k MRR" },
    { label: "Round size", level: "UNKNOWN", value: null },
  ],
  view: words(14, i + 3),
  said: words(30, i + 4),
  citations: ["F1", "F2", "F4"],
});
const rest = {
  responseShape: "ANALYTICAL",
  missingEvidence: [words(14, 1), words(12, 2), words(14, 3)],
  contradictions: [],
  insufficientEvidence: false,
  recommendation: null,
  clarifyingQuestions: [],
  declined: false,
  actionTalk: [],
  proposalStatus: false,
  visual: null,
};

const typed = {
  answer: words(240, 0),
  findings: Array.from({ length: 5 }, (_, i) => finding(i, 1)),
  gestures: gestures(9),
  ...rest,
};
const comparison = {
  answer: words(320, 5),
  findings: Array.from({ length: 6 }, (_, i) => finding(i, 1)),
  answerCards: {
    shape: "SIDE_BY_SIDE",
    title: "Northwind Ledger and Halyard Health",
    cards: [card("Northwind Ledger", 1), card("Halyard Health", 2)],
    followUps: [
      "Which one fits my mandate better?",
      "Show their traction side by side",
    ],
  },
  gestures: gestures(12),
  ...rest,
};
const spoken = {
  answer: words(58, 9),
  findings: Array.from({ length: 3 }, (_, i) => finding(i, 1)),
  gestures: gestures(3),
  ...rest,
  responseShape: "CONCISE",
};

const row = (name, value) => {
  const split = outputSplitOf(value);
  const total = tokens(value);
  const t = {
    answer: tokens(value.answer),
    findings: tokens(value.findings),
    basis: (value.findings ?? []).reduce((s, f) => s + tokens(f.basis), 0),
    findingLabels: (value.findings ?? []).reduce(
      (s, f) =>
        s +
        tokens({
          type: f.type,
          truthClass: f.truthClass,
          evidenceStatus: f.evidenceStatus,
          confidence: f.confidence,
        }),
      0,
    ),
    cards: tokens(value.answerCards),
    cardMeasures: (value.answerCards?.cards ?? []).reduce(
      (s, c) => s + tokens(c.measures) + tokens(c.citations) + tokens(c.name),
      0,
    ),
    gestures: tokens(value.gestures),
  };
  t.other = total - t.answer - t.findings - t.cards - t.gestures;
  const pct = (n) => `${String(Math.round((n / total) * 100))}%`;
  console.log(
    `| ${name} | ${String(total)} | ${String(t.answer)} (${pct(t.answer)}) | ${String(t.findings)} (${pct(t.findings)}); basis ${String(t.basis)}, labels ${String(t.findingLabels)} | ${String(t.cards)} (${pct(t.cards)}); copied ${String(t.cardMeasures)} | ${String(t.gestures)} (${pct(t.gestures)}) | ${String(t.other)} (${pct(t.other)}) | ${String(split.total)} |`,
  );
};
console.log(
  "| object | tokens | answer | findings | cards | gestures | other | chars |",
);
console.log("| --- | --- | --- | --- | --- | --- | --- | --- |");
row("typed analysis", typed);
row("comparison of two", comparison);
row("spoken", spoken);
