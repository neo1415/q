import { readFileSync, writeFileSync } from "node:fs";

import { parseDatabaseConfig } from "@capital-q/config/database";
import { toModelProviderSecrets } from "@capital-q/config/model-providers";
import { createRequestDatabaseClient } from "@capital-q/database";
import {
  ANTHROPIC_ANSWER_MODEL,
  createAnthropicModelProvider,
} from "@capital-q/model-gateway/providers/anthropic";
import { createOpenAIModelProvider } from "@capital-q/model-gateway/providers/openai";

import { Q_IQ_CATEGORIES, Q_IQ_DATASET } from "../datasets/q-iq/index.js";
import {
  bareModelQIqSubject,
  providerHelpfulnessJudge,
  runQIq,
  scriptedQIqSubject,
  type QIqRunResult,
} from "../runner/q-iq.js";
import { createQIqWorldSubject } from "../runner/q-iq-world.js";

/**
 * Q-IQ baseline (Q Intelligence Plan, step 0).
 *
 *   node packages/q-evals/dist/dev/q-iq-baseline.js            # scripted, free
 *   OPENAI_API_KEY_FILE=… node packages/q-evals/dist/dev/q-iq-baseline.js --live \
 *     [--budget 4.5] [--limit 150] [--out results.json]
 *   OPENAI_API_KEY_FILE=… ANTHROPIC_API_KEY_FILE=… \
 *     node packages/q-evals/dist/dev/q-iq-baseline.js --live --provider anthropic \
 *     [--budget 4.5] [--limit 150] [--out results.json]
 *
 * LIVE spends founder credit: Q (the real runtime on a LOCAL database with
 * fictional fixtures) and the bare model, the bare model at reasoning NONE.
 * The budget is shared and hard: Q may spend up to 75% of it, the bare
 * model and the helpfulness judge the rest, and a case starts only if the
 * dearest case so far would still fit. A subject that reaches its share
 * stops and reports the cases it ran. Keys are read from files and never
 * printed. Needs DATABASE_URL (local), NODE_USE_ENV_PROXY=1 in the cloud.
 *
 * --provider openai (default): both subjects on gpt-5.6-luna, production's
 * primary today.
 *
 * --provider anthropic (DECISIONS 62): the staged Claude routing policies
 * (20261231280000) are switched ON in the LOCAL database for the run and
 * OFF again afterwards -- the same single UPDATE the receipt gives for
 * production -- and Claude is the only adapter registered, so the Q
 * subject measures Claude and never a fallback. The bare subject runs on
 * claude-sonnet-5-5. The judge stays on gpt-5.6-luna for both providers,
 * so two runs are graded by the same judge. Claude spend is held to the
 * owner's $20 test cap: a --budget above it is refused, and Claude is
 * budgeted at its cache-write rate (1.25x input), the most an input token
 * can cost, because the gateway ledger prices cache writes at base rate.
 */

const MODEL = "gpt-5.6-luna";
// ai_ops.model_prices for gpt-5.6-luna (migration 20261008120000).
const PRICE = {
  inputPerMillion: 0.2,
  cachedInputPerMillion: 0.02,
  outputPerMillion: 1.2,
};
// ai_ops.model_prices for claude-sonnet-5-5 (20261231280000), with input
// at the 1.25x cache-write rate: an upper bound, for a hard budget.
const CLAUDE_BUDGET_PRICE = {
  inputPerMillion: 2.5,
  cachedInputPerMillion: 0.2,
  outputPerMillion: 10,
};
/** The owner's cap on Anthropic test and evaluation spend (DECISIONS 62). */
const CLAUDE_TEST_CAP_USD = 20;
/** The cache-write factor: ledger cost times this bounds real Claude spend. */
const CLAUDE_WRITE_FACTOR = 1.25;
/** The staged Claude policies; the receipt's switch names the same codes. */
export const CLAUDE_POLICY_CODES = [
  "normal_dialogue.v2",
  "evidence_synthesis.v2",
  "comparison.v2",
  "deep_investigation.v2",
  "fast_classification.v2",
  "structured_extraction.v2",
  "taxonomy_mapping.v2",
] as const;

function arg(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
}

function pct(n: number | null): string {
  if (n === null) return "not run";
  return `${(n * 100).toFixed(1)}%`;
}

function table(results: readonly QIqRunResult[]): string {
  const head = `| Category | ${results.map((r) => r.subject).join(" | ")} |`;
  const rule = `| --- | ${results.map(() => "---").join(" | ")} |`;
  const rows = Q_IQ_CATEGORIES.map(
    (c) =>
      `| ${c} | ${results.map((r) => pct(r.summary.byCategory[c].score)).join(" | ")} |`,
  );
  const m = (f: (r: QIqRunResult) => string, label: string): string =>
    `| ${label} | ${results.map(f).join(" | ")} |`;
  return [
    head,
    rule,
    ...rows,
    m((r) => `**${pct(r.summary.overall.score)}**`, "**Overall (turns)**"),
    m(
      (r) => `${r.summary.overall.casesPassed}/${r.summary.overall.cases}`,
      "Cases fully passed",
    ),
    m((r) => pct(r.summary.measures.referencesResolved), "References resolved"),
    m((r) => String(r.summary.measures.wrongEntityTurns), "Wrong-entity turns"),
    m(
      (r) => String(r.summary.measures.inventedFigureTurns),
      "Turns with an invented figure",
    ),
    m(
      (r) => pct(r.summary.measures.unknownsSaidUnknown),
      "Unknowns said as unknown",
    ),
    m(
      (r) => pct(r.summary.measures.ambiguousClarified),
      "Ambiguous asks clarified",
    ),
    m(
      (r) => pct(r.summary.measures.compoundAllParts),
      "Multi-part asks fully answered",
    ),
    m(
      (r) =>
        r.helpfulnessMean === null ? "n/a" : r.helpfulnessMean.toFixed(2),
      "Helpfulness (rubric, 1-5)",
    ),
    m(
      (r) =>
        r.latencyP50Ms === null
          ? "n/a"
          : `${(r.latencyP50Ms / 1000).toFixed(1)} s`,
      "Reply latency p50 (whole reply)",
    ),
    m(
      (r) =>
        r.latencyP95Ms === null
          ? "n/a"
          : `${(r.latencyP95Ms / 1000).toFixed(1)} s`,
      "Reply latency p95 (whole reply)",
    ),
    m((r) => `$${r.costUsd.toFixed(3)}`, "Cost (USD)"),
    m(
      (r) =>
        `${r.casesRun}/${r.casesPlanned}${r.stoppedForBudget ? " (budget stop)" : ""}`,
      "Cases run",
    ),
  ].join("\n");
}

async function main(): Promise<number> {
  const live = process.argv.includes("--live");
  const limit = Number(arg("--limit") ?? Q_IQ_DATASET.cases.length);
  const budget = Number(arg("--budget") ?? "4.5");
  const out = arg("--out");
  // Round-robin across categories, so a budget stop still samples every
  // category instead of dropping the last ones (first live run, 5 Nov).
  const byCategory = Q_IQ_CATEGORIES.map((c) =>
    Q_IQ_DATASET.cases.filter((x) => x.category === c),
  );
  const interleaved = Array.from({ length: 15 }, (_, i) =>
    byCategory.flatMap((list) => list.slice(i, i + 1)),
  ).flat();
  const cases = interleaved.slice(0, limit);
  const progress =
    (name: string) =>
    (run: { caseId: string; grade: { pass: boolean } }, spent: number) =>
      process.stdout.write(
        `  ${name} ${run.caseId} ${run.grade.pass ? "pass" : "FAIL"}  $${spent.toFixed(3)}\n`,
      );

  if (!live) {
    const result = await runQIq(scriptedQIqSubject(), cases);
    console.log(table([result]));
    return result.summary.overall.score === 1 ? 0 : 1;
  }

  const providerArg = arg("--provider") ?? "openai";
  if (providerArg !== "openai" && providerArg !== "anthropic") {
    throw new Error("--provider must be openai or anthropic");
  }
  const claude = providerArg === "anthropic";
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new Error("--budget must be a positive number of dollars");
  }
  if (claude && budget > CLAUDE_TEST_CAP_USD) {
    throw new Error(
      `--budget is above the $${String(CLAUDE_TEST_CAP_USD)} Anthropic test cap (DECISIONS 62)`,
    );
  }
  const readKey = (name: string): string => {
    const file = process.env[name];
    if (file === undefined) throw new Error(`${name} is required for --live`);
    return readFileSync(file, "utf8").trim();
  };
  // The judge is OpenAI for both providers, so two runs share one judge.
  const apiKey = readKey("OPENAI_API_KEY_FILE");
  const anthropicKey = claude ? readKey("ANTHROPIC_API_KEY_FILE") : undefined;
  const databaseUrl = process.env["DATABASE_URL"];
  if (
    databaseUrl === undefined ||
    !/127\.0\.0\.1|localhost/.test(databaseUrl)
  ) {
    throw new Error(
      "DATABASE_URL must be a LOCAL database: Q-IQ writes fixture rows",
    );
  }
  const db = createRequestDatabaseClient(
    parseDatabaseConfig({
      NODE_ENV: "test",
      CAPITAL_Q_ENV: "local",
      DATABASE_URL: databaseUrl,
      DATABASE_POOL_MAX: "8",
      DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
    }),
  );
  const provider = createOpenAIModelProvider({ apiKey });
  const judge = providerHelpfulnessJudge({
    provider,
    modelCode: MODEL,
    price: PRICE,
  });
  const results: QIqRunResult[] = [];
  // The receipt's switch, on the LOCAL database only (checked above).
  const setClaudeRoutes = async (
    status: "ACTIVE" | "RETIRED",
  ): Promise<void> => {
    const changed = await db.sql`
      update ai_ops.routing_policies set status = ${status}
       where code in ${db.sql([...CLAUDE_POLICY_CODES])}
      returning code`;
    if (changed.length !== CLAUDE_POLICY_CODES.length) {
      throw new Error(
        `expected ${String(CLAUDE_POLICY_CODES.length)} staged Claude policies, found ${String(changed.length)}: is 20261231280000 applied locally?`,
      );
    }
  };
  // For Claude, Q's share is divided by the cache-write factor, so the
  // ledger's base-rate pricing cannot carry real spend past the share.
  const factor = claude ? CLAUDE_WRITE_FACTOR : 1;
  // --bare-only: measure the bare model alone (e.g. bare Claude across all
  // 150 cases within the Anthropic test cap, while Q on Claude is parked).
  const bareOnly = process.argv.includes("--bare-only");
  try {
    if (claude && !bareOnly) await setClaudeRoutes("ACTIVE");
    if (!bareOnly)
      try {
        const q = await createQIqWorldSubject({
          db,
          providerMode: "LIVE",
          secrets: toModelProviderSecrets({
            OPENAI_API_KEY: apiKey,
            ...(anthropicKey === undefined
              ? {}
              : { ANTHROPIC_API_KEY: anthropicKey }),
          }),
          providerFilter: claude ? "anthropic" : "openai",
        });
        try {
          results.push(
            await runQIq(q.subject, cases, {
              budgetUsd: (budget * 0.75) / factor,
              judge,
              onCase: progress("Q"),
            }),
          );
        } finally {
          await q.close();
        }
      } finally {
        if (claude && !bareOnly) await setClaudeRoutes("RETIRED");
      }
    const bare =
      anthropicKey === undefined
        ? bareModelQIqSubject({ provider, modelCode: MODEL, price: PRICE })
        : bareModelQIqSubject({
            provider: createAnthropicModelProvider({ apiKey: anthropicKey }),
            modelCode: ANTHROPIC_ANSWER_MODEL,
            price: CLAUDE_BUDGET_PRICE,
          });
    results.push(
      await runQIq(bare, cases, {
        budgetUsd: Math.max(0, budget - (results[0]?.costUsd ?? 0) * factor),
        judge,
        onCase: progress("bare"),
      }),
    );
  } finally {
    await db.close();
  }
  console.log(table(results));
  const total = results.reduce((n, r) => n + r.costUsd, 0);
  console.log(`\nTotal cost: $${total.toFixed(3)}`);
  if (out !== undefined) writeFileSync(out, JSON.stringify(results, null, 1));
  return 0;
}

process.exit(await main());
