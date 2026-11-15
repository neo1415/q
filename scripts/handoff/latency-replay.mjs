#!/usr/bin/env node
// RC3 (Q voice audit, 15 Nov 2026): a deterministic replay over the audit's
// recorded turns. No model, no network, no database: each recorded Q turn is
// routed through the real execution-class code (q-core dist) and costed
// before (as recorded) and after (this change's rules, applied to the
// recorded numbers). Prints a markdown report on stdout.
//
// Usage: node scripts/handoff/latency-replay.mjs > <out.md>
// Needs `packages/q-core/dist` (pnpm exec turbo run build --filter=@capital-q/q-core).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const audit = resolve(root, "docs/ai-handoff/audits/2026-11-15-q-voice-audit");
const { turnExecutionClassOf, EXECUTION_LANES } = await import(
  resolve(root, "packages/q-core/dist/index.js")
);
/**
 * The spoken form as asked of the model: about 60 words (SPOKEN_FORM_GUIDANCE),
 * ~330 characters; the hard bound is 480 (contracts Q_SPOKEN_FORM_MAX_LENGTH).
 */
const Q_SPOKEN_LIMIT = 330;

const lines = (file) =>
  readFileSync(resolve(audit, file), "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));

/** Reuse window: the evidence TTL (conversation-evidence.ts). */
const TTL_S = 180;
/**
 * Critical-path time of the wide reads + digest when they run (S3 profile in
 * index.ts: "~1 s"); saved only on a turn that reuses them.
 */
const WIDE_READS_S = 1.0;
/** Reads a reuse turn takes from evidence instead of reading again. */
const REUSABLE = new Set([
  "approvals.pending.list",
  "relationship.own.list",
  "q.work.list",
  "schedule.list",
  "company.get",
  "company.figures.read",
  "company.deck.read",
  "records.own.read",
  "app.own.read",
]);
const WEB = /public_web|research/u;

/** Names a turn says that the previous Q text did not (the reader's namedOther proxy). */
function namesSomethingNew(words, previousQ) {
  const said = (previousQ ?? "").toLowerCase();
  const names =
    (words ?? "").match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*/gu) ?? [];
  const openers = new Set([
    "I",
    "I'm",
    "Okay",
    "OK",
    "So",
    "And",
    "But",
    "What",
    "Why",
    "How",
    "Which",
    "Can",
    "Could",
    "Would",
    "Tell",
    "Give",
    "Show",
    "Is",
    "Are",
    "Do",
    "Does",
    "The",
    "That",
    "This",
    "Yes",
    "No",
    "Go",
    "Please",
    "Thank",
    "Thanks",
    "Q",
    "Hmm",
    "Um",
    "Uh",
    "Alright",
    "Right",
    "Let",
    "Now",
    "Then",
    "Also",
    "Just",
    "Who",
    "Where",
    "When",
    "It",
    "They",
    "Them",
    "My",
    "Me",
    "You",
    "Your",
  ]);
  return names.some((name) => {
    const first = name.split(/\s+/u)[0];
    if (openers.has(first) && name.split(/\s+/u).length === 1) return false;
    const rest = openers.has(first)
      ? name.split(/\s+/u).slice(1).join(" ")
      : name;
    return rest.length > 0 && !said.includes(rest.toLowerCase());
  });
}

/**
 * The audit stored no turn-reader output (an instrumentation gap it names),
 * so each turn's reading is reconstructed from the audit's own per-turn
 * classification and the person's words, field for field as the reader
 * would carry it; the class itself comes from the real code.
 */
function readingOf(category, words, previousQ, hasPrior) {
  const base = {
    kind: "QUESTION_TO_Q",
    confidence: "HIGH",
    hasPriorResult: hasPrior,
    namesSomethingNew: namesSomethingNew(words, previousQ),
  };
  const compareWords =
    /\b(compare|side by side|versus|vs\.?|against each other)\b/iu;
  switch (category) {
    case "F_follow_up":
    case "C contextual follow-up":
      return { ...base, answerKind: "FOLLOW_UP" };
    case "L_lookup":
    case "B account-state read":
      return {
        ...base,
        answerKind: "LOOKUP",
        questionKind: "THEIR_OWN_RECORDS",
      };
    case "R_research":
    case "F external research / firewall":
      return { ...base, kind: "RESEARCH_REQUEST" };
    case "C_compare_rank":
    case "E multi-entity ranking":
      return compareWords.test(words ?? "")
        ? { ...base, compare: true }
        : { ...base, questionKind: "FIT" };
    case "X_action":
    case "G action draft/approval":
      return { ...base, kind: "TOOL_REQUEST", asksAction: true };
    case "N_navigation":
    case "I navigation":
      return { ...base, kind: "TOOL_REQUEST", navigates: true };
    case "D single-entity analysis":
      return { ...base, answerKind: "ANALYSIS" };
    case "H long-running job":
      return { ...base, delegatesWork: true };
    default:
      return null;
  }
}

const median = (values) => {
  const v = values
    .filter((x) => typeof x === "number" && Number.isFinite(x))
    .sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};
const fmt = (x, digits = 1) => (x === null ? "n/a" : x.toFixed(digits));

const turns = [];

// --- Investor: one record per Q run ----------------------------------------
{
  const rows = lines("investor-turns.jsonl");
  const lastQ = new Map();
  const lastUser = new Map();
  const lastRun = new Map();
  const wroteSince = new Map();
  // Spoken rate, measured from the record's own words and spoken time.
  const rates = [];
  for (const r of rows) {
    const t = r.timings ?? {};
    if (
      r.kind === "q_run_reply" &&
      r.spoken_chars > 0 &&
      t.spoken_end_ms > 0 &&
      t.first_answer_audio_ms_est > 0
    ) {
      const seconds = (t.spoken_end_ms - t.first_answer_audio_ms_est) / 1000;
      if (seconds > 2) rates.push(r.spoken_chars / seconds);
    }
  }
  const rate = median(rates) ?? 15;
  for (const r of rows) {
    const session = r.session;
    if (r.kind === "user_utterance" || r.kind === "user_message") {
      lastUser.set(session, r.user_words);
      continue;
    }
    if (r.kind === "approval_decision" || r.state_change)
      wroteSince.set(session, true);
    if (r.kind !== "q_run_reply") continue;
    const at = Date.parse(
      String(r.ts).replace(" ", "T").replace(/\+00$/u, "Z"),
    );
    const words =
      r.understood_intent?.heard_as ?? lastUser.get(session) ?? null;
    const prev = lastRun.get(session);
    const hasPrior = prev !== undefined;
    const reading = readingOf(r.category, words, lastQ.get(session), hasPrior);
    const cls = turnExecutionClassOf(reading);
    const lane = EXECUTION_LANES[cls];
    const tools = r.tools ?? {};
    const t = r.timings ?? {};
    const stored = tools.stored_results ?? {};
    const toolCalls = tools.logged_calls ?? tools.stored_calls ?? 0;
    const repeated = r.reran?.calls ?? 0;
    const fresh =
      prev !== undefined &&
      (at - prev) / 1000 <= TTL_S &&
      wroteSince.get(session) !== true;
    const reuse = lane.reuseEvidence && fresh;
    const reusedCalls = reuse
      ? Math.min(
          repeated,
          Object.entries(stored)
            .filter(([name]) => REUSABLE.has(name))
            .reduce((n, [, c]) => n + c, 0),
        )
      : 0;
    const webCalls = Object.entries(stored)
      .filter(([name]) => WEB.test(name))
      .reduce((n, [, c]) => n + c, 0);
    const forcedWebDropped = !lane.publicWeb && webCalls > 0 ? webCalls : 0;
    const typed = r.channel !== "voice";
    const splitWriterDropped =
      typed && lane.answerModelCalls === 1 && (tools.model_calls ?? 0) >= 2
        ? 1
        : 0;
    const firstAnswer =
      typeof t.first_useful_answer_ms === "number"
        ? t.first_useful_answer_ms / 1000
        : null;
    const spokenBefore =
      typeof t.spoken_end_ms === "number" &&
      typeof t.first_answer_audio_ms_est === "number"
        ? Math.max(0, (t.spoken_end_ms - t.first_answer_audio_ms_est) / 1000)
        : null;
    const analystWrites = ![
      "STRUCTURED_QUERY",
      "NAVIGATION",
      "CONSEQUENTIAL_ACTION",
    ].includes(cls);
    const spokenAfter =
      spokenBefore === null
        ? null
        : analystWrites
          ? Math.min(spokenBefore, Q_SPOKEN_LIMIT / rate)
          : spokenBefore;
    turns.push({
      side: "investor",
      cls,
      followUp: r.category === "F_follow_up",
      modelBefore: tools.model_calls ?? null,
      modelAfter:
        tools.model_calls == null
          ? null
          : tools.model_calls - splitWriterDropped,
      toolsBefore: toolCalls,
      toolsAfter: Math.max(0, toolCalls - reusedCalls),
      reused: reusedCalls > 0,
      forcedWebDropped,
      firstBefore: firstAnswer,
      firstAfter:
        firstAnswer === null
          ? null
          : Math.max(0, firstAnswer - (reusedCalls > 0 ? WIDE_READS_S : 0)),
      spokenBefore,
      spokenAfter,
    });
    lastRun.set(session, at);
    lastQ.set(session, r.q_text ?? "");
    wroteSince.set(session, false);
  }
  turns.rate = rate;
}

// --- Founder: one record per person's turn ----------------------------------
{
  const rows = lines("founder-turns.jsonl");
  let previous = null;
  const qText = new Map();
  for (const r of rows) {
    if (r.turn_kind === "q_initiated") {
      qText.set(r.session, r.q_text ?? "");
      continue;
    }
    if (r.turn_kind !== "user") continue;
    const letter = r.category.slice(0, 1);
    if (["J", "K"].includes(letter)) continue; // interview / rehearsal: not the Q answer seam
    const t = r.timings ?? {};
    const at = Date.parse(
      String(r.timings?.handoff ?? r.ts)
        .replace(" ", "T")
        .replace(/\+00$/u, "Z"),
    );
    const sameSession = previous !== null && previous.session === r.session;
    const reading = readingOf(
      r.category,
      r.user_words,
      qText.get(r.session),
      sameSession,
    );
    const cls = turnExecutionClassOf(reading);
    const lane = EXECUTION_LANES[cls];
    const tools = r.tools ?? [];
    const fresh =
      sameSession &&
      Number.isFinite(at) &&
      (at - previous.at) / 1000 <= TTL_S &&
      !previous.wrote;
    const before = new Set(previous?.tools ?? []);
    const reusedCalls =
      lane.reuseEvidence && fresh
        ? tools.filter((name) => REUSABLE.has(name) && before.has(name)).length
        : 0;
    const webCalls = tools.filter((name) => WEB.test(name)).length;
    const spokenBefore =
      typeof t.spoken_end_s === "number" &&
      typeof t.first_useful_answer_s === "number"
        ? Math.max(0, t.spoken_end_s - t.first_useful_answer_s)
        : null;
    const analystWrites = ![
      "STRUCTURED_QUERY",
      "NAVIGATION",
      "CONSEQUENTIAL_ACTION",
    ].includes(cls);
    turns.push({
      side: "founder",
      cls,
      followUp: letter === "C",
      modelBefore: null,
      modelAfter: null,
      toolsBefore: tools.length,
      toolsAfter: tools.length - reusedCalls,
      reused: reusedCalls > 0,
      forcedWebDropped: !lane.publicWeb && webCalls > 0 ? webCalls : 0,
      firstBefore: t.first_useful_answer_s ?? null,
      firstAfter:
        t.first_useful_answer_s == null
          ? null
          : Math.max(
              0,
              t.first_useful_answer_s - (reusedCalls > 0 ? WIDE_READS_S : 0),
            ),
      spokenBefore,
      spokenAfter:
        spokenBefore === null
          ? null
          : analystWrites
            ? Math.min(spokenBefore, Q_SPOKEN_LIMIT / turns.rate)
            : spokenBefore,
    });
    previous = { session: r.session, at, tools, wrote: r.state_change != null };
    qText.set(r.session, r.q_text ?? "");
  }
}

const out = [];
out.push(
  "| Side | Execution class | Turns | Reused evidence | Model calls med (before → after) | Tool calls med (before → after) | First useful answer s med (before → after est.) | Spoken s med (before → after est.) | Forced web calls dropped |",
);
out.push("| --- | --- | --: | --: | --- | --- | --- | --- | --: |");
for (const side of ["investor", "founder"]) {
  const mine = turns.filter((turn) => turn.side === side);
  const classes = [...new Set(mine.map((turn) => turn.cls))].sort();
  for (const cls of [...classes, "ALL"]) {
    const group =
      cls === "ALL" ? mine : mine.filter((turn) => turn.cls === cls);
    out.push(
      `| ${side} | ${cls === "ALL" ? "**all**" : cls} | ${group.length} | ${group.filter((t) => t.reused).length} | ${fmt(median(group.map((t) => t.modelBefore)), 0)} → ${fmt(median(group.map((t) => t.modelAfter)), 0)} | ${fmt(median(group.map((t) => t.toolsBefore)), 0)} → ${fmt(median(group.map((t) => t.toolsAfter)), 0)} | ${fmt(median(group.map((t) => t.firstBefore)))} → ${fmt(median(group.map((t) => t.firstAfter)))} | ${fmt(median(group.map((t) => t.spokenBefore)))} → ${fmt(median(group.map((t) => t.spokenAfter)))} | ${group.reduce((n, t) => n + t.forcedWebDropped, 0)} |`,
    );
  }
}
const followUps = turns.filter((turn) => turn.followUp);
out.push("");
out.push(
  `Audited short contextual follow-ups: ${followUps.length} (investor ${followUps.filter((t) => t.side === "investor").length}, founder ${followUps.filter((t) => t.side === "founder").length}); routed to CONTEXTUAL_FOLLOW_UP: ${followUps.filter((t) => t.cls === "CONTEXTUAL_FOLLOW_UP").length}; answered from evidence (fresh, unchanged, same conversation): ${followUps.filter((t) => t.reused).length}; tool calls med ${fmt(median(followUps.map((t) => t.toolsBefore)), 0)} → ${fmt(median(followUps.map((t) => t.toolsAfter)), 0)}.`,
);
out.push(
  `Spoken rate used for the spoken form: ${fmt(turns.rate)} characters per second (median of the investor records' own spoken words over their spoken time).`,
);
process.stdout.write(`${out.join("\n")}\n`);
