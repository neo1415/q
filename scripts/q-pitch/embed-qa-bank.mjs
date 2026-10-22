// Q Story ending, tier 2: embed the Q&A bank once and calibrate.
//
// A LIVE, PAID call (OpenAI text-embedding-3-small through the reviewed
// adapter in @capital-q/q-embeddings): about 2,400 short strings, roughly
// 30,000 tokens, about $0.001 at $0.02 per million tokens. It needs a stated
// reason and the lead's or owner's approval, and runs only with --live.
//
// Usage (after `pnpm exec turbo run build --filter=@capital-q/q-pitch
// --filter=@capital-q/q-embeddings`):
//   NODE_USE_ENV_PROXY=1 node scripts/q-pitch/embed-qa-bank.mjs --live
//
// It embeds every stored wording of the bank and every question in
// packages/q-pitch/test/data/qa-heldout.json, then:
// 1. calibrates tier 2 on the tuning set (heldOut + notInBank): the answer
//    threshold and margin that answer no unrelated question with at least
//    95% precision, and the lowest clarify floor that asks "Do you mean …?"
//    for at most 5% of unrelated questions;
// 2. measures tier 1 + tier 2 on the blind set (written after tuning);
// 3. writes packages/q-pitch/data/qa-bank-vectors.json (bank vectors,
//    thresholds, content hash, model) and
//    packages/q-pitch/test/data/qa-heldout-vectors.json (test questions);
// 4. prints the strings, characters and estimated cost.
// The key is read from OPENAI_API_KEY and never printed.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STORED_DIMENSION = 512;
const PRICE_PER_MILLION_TOKENS_USD = 0.02;

if (!process.argv.includes("--live")) {
  console.error(
    "Refusing: this makes a paid embedding call. Re-run with --live once approved.",
  );
  process.exit(2);
}

const qp = await import(join(ROOT, "packages/q-pitch/dist/index.js"));
const qe = await import(join(ROOT, "packages/q-embeddings/dist/index.js"));
const {
  QA_BANK,
  buildQaIndex,
  combineQaTiers,
  encodeQaVector,
  qaBankContentHash,
  qaWordings,
  shortenQaVector,
  buildQaSemanticIndex,
  QA_VECTORS_FORMAT,
} = qp;
const { createOpenAIEmbeddingProvider, OPENAI_TE3_SMALL_1024_CONFIGURATION } =
  qe;

const heldOutPath = join(ROOT, "packages/q-pitch/test/data/qa-heldout.json");
const tests = JSON.parse(readFileSync(heldOutPath, "utf8"));

const bankTexts = QA_BANK.flatMap((e) => qaWordings(e));
const testTexts = [
  ...tests.heldOut.map(([q]) => q),
  ...tests.notInBank,
  ...tests.blind.map(([q]) => q),
  ...tests.blindNotInBank,
];
const all = [...new Set([...bankTexts, ...testTexts])];
const characters = all.reduce((n, t) => n + t.length, 0);
const tokens = Math.ceil(characters / 4);
console.log(
  `embedding ${String(all.length)} strings, ${String(characters)} characters, ~${String(tokens)} tokens, ~$${((tokens / 1e6) * PRICE_PER_MILLION_TOKENS_USD).toFixed(4)}`,
);

const provider = createOpenAIEmbeddingProvider({
  apiKey: process.env.OPENAI_API_KEY,
  timeoutMs: 30_000,
});
const full = new Map();
const batch = OPENAI_TE3_SMALL_1024_CONFIGURATION.maxBatchItems;
for (let i = 0; i < all.length; i += batch) {
  const inputs = all.slice(i, i + batch);
  const result = await provider.embedDocuments({ inputs });
  result.embeddings.forEach((e, j) => full.set(inputs[j], e.vector));
}
const short = (text) => shortenQaVector(full.get(text), STORED_DIMENSION);

const entries = QA_BANK.map((e) => ({
  id: e.id,
  vectors: qaWordings(e).map((w) => encodeQaVector([...short(w)])),
}));

// Calibrate on the tuning set, with the vectors as they will be stored.
const draft = {
  format: QA_VECTORS_FORMAT,
  configurationVersion: `${OPENAI_TE3_SMALL_1024_CONFIGURATION.configurationVersion}+prefix-${String(STORED_DIMENSION)}`,
  modelCode: OPENAI_TE3_SMALL_1024_CONFIGURATION.modelCode,
  dimension: STORED_DIMENSION,
  contentHash: qaBankContentHash(QA_BANK),
  createdAt: new Date().toISOString(),
  thresholds: { answer: 1, margin: 1, clarifyFloor: 1 },
  calibration: {},
  entries,
};
const sideOf = (id) => QA_BANK.find((e) => e.id === id)?.side;
const sideFor = (id) => (sideOf(id) === "FOUNDER" ? "FOUNDER" : "INVESTOR");
const indexes = (file) => ({
  INVESTOR: buildQaSemanticIndex("INVESTOR", file),
  FOUNDER: buildQaSemanticIndex("FOUNDER", file),
});
const sem = indexes(draft);
const top2 = (side, text) => {
  const r = sem[side].rank(short(text));
  return { first: r[0], second: r[1] };
};
const pos = tests.heldOut.map(([q, id]) => ({ id, ...top2(sideFor(id), q) }));
const neg = tests.notInBank.flatMap((q) =>
  ["INVESTOR", "FOUNDER"].map((side) => top2(side, q)),
);
const answers = (row, a, m) =>
  row.first !== undefined &&
  row.first.score >= a &&
  row.first.score - (row.second?.score ?? 0) >= m;
let best = null;
for (let a = 0.3; a <= 0.95; a += 0.005) {
  for (let m = 0; m <= 0.15; m += 0.005) {
    if (neg.some((n) => answers(n, a, m))) continue;
    const answered = pos.filter((p) => answers(p, a, m));
    const right = answered.filter((p) => p.first.entry.id === p.id).length;
    if (answered.length === 0 || right / answered.length < 0.95) continue;
    if (best === null || right > best.right) {
      best = { a, m, right, answered: answered.length };
    }
  }
}
if (best === null) {
  console.error(
    "No threshold answers anything with 0 negatives at 95% precision.",
  );
  process.exit(1);
}
let floor = best.a;
for (let c = best.a; c >= 0.2; c -= 0.005) {
  const asked = neg.filter(
    (n) =>
      !answers(n, best.a, best.m) &&
      n.first !== undefined &&
      n.first.score >= c,
  ).length;
  if (asked / neg.length > 0.05) break;
  floor = c;
}
const round = (x) => Math.round(x * 1000) / 1000;
const file = {
  ...draft,
  thresholds: {
    answer: round(best.a),
    margin: round(best.m),
    clarifyFloor: round(Math.min(floor, best.a)),
  },
};

// Measure tier 1 + tier 2 on both sets.
const final = indexes(file);
const tier1 = {
  INVESTOR: buildQaIndex("INVESTOR"),
  FOUNDER: buildQaIndex("FOUNDER"),
};
const measure = (positives, negatives) => {
  let right = 0,
    wrong = 0,
    offered = 0,
    negAnswered = 0,
    negAsked = 0;
  for (const [q, id] of positives) {
    const side = sideFor(id);
    const m = combineQaTiers(
      tier1[side].match(q),
      final[side].decide(short(q)),
    );
    if (m.kind === "ANSWER") {
      if (m.entry.id === id) right += 1;
      else wrong += 1;
    } else if (m.kind === "CLARIFY" && m.candidates.some((c) => c.id === id))
      offered += 1;
  }
  for (const q of negatives) {
    for (const side of ["INVESTOR", "FOUNDER"]) {
      const m = combineQaTiers(
        tier1[side].match(q),
        final[side].decide(short(q)),
      );
      if (m.kind === "ANSWER") negAnswered += 1;
      else if (m.kind === "CLARIFY") negAsked += 1;
    }
  }
  return {
    n: positives.length,
    right,
    wrong,
    offered,
    negChecks: negatives.length * 2,
    negAnswered,
    negAsked,
  };
};
const tuning = measure(tests.heldOut, tests.notInBank);
const blind = measure(tests.blind, tests.blindNotInBank);
file.calibration = {
  tuningRight: tuning.right,
  tuningWrong: tuning.wrong,
  tuningOffered: tuning.offered,
  tuningNegativesAnswered: tuning.negAnswered,
  blindRight: blind.right,
  blindWrong: blind.wrong,
  blindOffered: blind.offered,
  blindNegativesAnswered: blind.negAnswered,
  strings: all.length,
  estimatedUsd: round((tokens / 1e6) * PRICE_PER_MILLION_TOKENS_USD),
};

mkdirSync(join(ROOT, "packages/q-pitch/data"), { recursive: true });
writeFileSync(
  join(ROOT, "packages/q-pitch/data/qa-bank-vectors.json"),
  `${JSON.stringify(file)}\n`,
);
writeFileSync(
  join(ROOT, "packages/q-pitch/test/data/qa-heldout-vectors.json"),
  `${JSON.stringify({
    dimension: STORED_DIMENSION,
    contentHash: file.contentHash,
    vectors: Object.fromEntries(
      testTexts.map((t) => [t, encodeQaVector([...short(t)])]),
    ),
  })}\n`,
);
console.log("thresholds", file.thresholds);
console.log("tuning (tier 1 + 2)", tuning);
console.log("blind (tier 1 + 2)", blind);
