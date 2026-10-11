// Two-sided live acceptance: investor question -> founder inbox -> answer ->
// investor sees it. FICTIONAL accounts only. Run from the repo root once the
// built packages resolve:
//   CQ_PUBLIC_JSON=<file> CQ_SEED_ACCOUNT_PASSWORD=... \
//   NODE_USE_ENV_PROXY=1 node scripts/handoff/live/two-sided-questions.mjs [company]
// company: ledgerfold (connected: chat route) or ajopot (in diligence).
// Prints PASS/FAIL per step and exits 1 on any failure. Writes: one question
// set and one answer per run (idempotency keys are per run).
import { randomUUID } from "node:crypto";

import { signIn } from "./fictional-session.mjs";

// The built workspace package (pnpm exec turbo run build --filter=./packages/*).
const c = await import(
  new URL("../../../packages/api-client/dist/index.js", import.meta.url).href
);

const COMPANIES = {
  ledgerfold: { id: "84b9641f", founder: "founder.ledgerfold" },
  ajopot: { id: "91de2a77", founder: "founder.ajopot" },
};
const key = process.argv[2] ?? "ledgerfold";
const target = COMPANIES[key];
if (!target) throw new Error(`unknown company ${key}`);
const D = "@fictional.capitalq.local";

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed += 1;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const status = async (promise) => {
  try {
    await promise;
    return 200;
  } catch (error) {
    return (
      error?.status ??
      error?.problem?.status ??
      String(error?.message ?? error).slice(0, 80)
    );
  }
};

const investor = await signIn(`investor.savanna-seed${D}`);
const founder = await signIn(`${target.founder}${D}`);
const outsider = await signIn(`investor.lagoon-angels${D}`);
const otherFounder = await signIn(`founder.tarmacly${D}`);

const rels = await c.listInvestorRelationships(investor);
const rel = rels.items.find((r) => r.counterpart.id.startsWith(target.id));
check(
  "investor has a relationship with the company",
  rel !== undefined,
  rel?.state,
);
if (rel === undefined) process.exit(1);
const companyId = rel.counterpart.id;

const stamp = new Date().toISOString().slice(0, 16);
const question = `[live check ${stamp}] What was monthly burn last quarter, and what runway does this round buy?`;
const sendKey = `questions-live-${randomUUID()}`;
const t0 = Date.now();
const sent = await c.sendDiligenceQuestions(
  investor,
  rel.relationshipId,
  [question],
  sendKey,
  [null],
);
check(
  "investor sends one approved question",
  typeof sent.via === "string",
  `via ${sent.via} in ${Date.now() - t0} ms`,
);
const again = await c.sendDiligenceQuestions(
  investor,
  rel.relationshipId,
  [question],
  sendKey,
  [null],
);
check(
  "retry with the same key does not send twice",
  JSON.stringify(again) === JSON.stringify(sent),
);

const inbox = await c.getRequestInbox(founder, companyId);
const items = inbox.items.filter(
  (item) =>
    item.kind === "QUESTIONS" &&
    item.questions.some((q) => q.question === question),
);
check(
  "founder inbox shows the question exactly once",
  items.length === 1,
  `${items.length} items`,
);
const item = items[0];
check(
  "founder sees who asked",
  item !== undefined &&
    (item.requesterName !== null || item.investorOrganisationName !== null),
  item
    ? `${item.requesterName ?? "?"} · ${item.investorOrganisationName ?? "?"}`
    : "",
);
const asked = item?.questions.find((q) => q.question === question);

check(
  "an unrelated investor cannot send on this relationship",
  (await status(
    c.sendDiligenceQuestions(
      outsider,
      rel.relationshipId,
      ["Probe?"],
      `questions-live-${randomUUID()}`,
    ),
  )) !== 200,
);
check(
  "another company's founder cannot read this inbox",
  (await status(c.getRequestInbox(otherFounder, companyId))) !== 200,
);
const outsiderQs = await c
  .getInvestorQuestions(outsider, companyId)
  .catch(() => ({ questions: [] }));
check(
  "an unrelated investor does not see these questions",
  !outsiderQs.questions.some((q) => q.question === question),
);

if (asked !== undefined) {
  const answerKey = `answer-live-${randomUUID()}`;
  const answered = await c.answerInvestorQuestion(
    founder,
    asked.questionId,
    {
      answer:
        "Live check answer: burn and runway are in our monthly management accounts.",
      documentIds: [],
    },
    answerKey,
  );
  check(
    "founder answers",
    answered.evidenceStatus === "SELF_REPORTED",
    `recorded=${answered.recorded}`,
  );
  const mine = await c.getInvestorQuestions(investor, companyId);
  const back = mine.questions.find((q) => q.questionId === asked.questionId);
  check(
    "investor sees the answer, labelled the founder's claim",
    back?.answer?.truthClass === "USER_CLAIM",
    back?.answer?.evidenceStatus,
  );
  const board = await c
    .getCompanyAssumptions(investor, companyId)
    .catch(() => null);
  check(
    "assumption board read still works",
    board === null || Array.isArray(board.assumptions),
    board === null
      ? "no board (no confirmed deck reading)"
      : `${board.assumptions.length} claims`,
  );
  const fNotes = await c.listNotifications(founder);
  check(
    "founder was notified of the question",
    fNotes.items?.some?.((n) => /question/i.test(n.title)) ?? false,
    fNotes.items
      ?.slice(0, 3)
      .map((n) => n.title)
      .join(" | "),
  );
  const iNotes = await c.listNotifications(investor);
  check(
    "investor was notified of the answer",
    iNotes.items?.some?.((n) => /answer/i.test(n.title)) ?? false,
    iNotes.items
      ?.slice(0, 3)
      .map((n) => n.title)
      .join(" | "),
  );
}
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
