import { readFileSync, writeFileSync } from "node:fs";

import { parseDatabaseConfig } from "@capital-q/config/database";
import { toModelProviderSecrets } from "@capital-q/config/model-providers";
import { createRequestDatabaseClient } from "@capital-q/database";
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
 *
 * LIVE spends founder credit: Q (the real runtime on a LOCAL database with
 * fictional fixtures) and the bare model, both on OpenAI gpt-5.6-luna —
 * production's primary — at reasoning NONE, the cheapest viable setting.
 * The budget is shared: Q may spend up to 75% of it, the bare model and
 * the helpfulness judge the rest. A subject that reaches its share stops
 * and reports the cases it ran. The key is read from a file and never
 * printed. Needs DATABASE_URL (local), NODE_USE_ENV_PROXY=1 in the cloud.
 */

const MODEL = "gpt-5.6-luna";
// ai_ops.model_prices for gpt-5.6-luna (migration 20261008120000).
const PRICE = {
  inputPerMillion: 0.2,
  cachedInputPerMillion: 0.02,
  outputPerMillion: 1.2,
};

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

  const keyFile = process.env["OPENAI_API_KEY_FILE"];
  if (keyFile === undefined)
    throw new Error("OPENAI_API_KEY_FILE is required for --live");
  const apiKey = readFileSync(keyFile, "utf8").trim();
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
  try {
    const q = await createQIqWorldSubject({
      db,
      providerMode: "LIVE",
      secrets: toModelProviderSecrets({ OPENAI_API_KEY: apiKey }),
      providerFilter: "openai",
    });
    try {
      results.push(
        await runQIq(q.subject, cases, {
          budgetUsd: budget * 0.75,
          judge,
          onCase: progress("Q"),
        }),
      );
    } finally {
      await q.close();
    }
    const bare = bareModelQIqSubject({
      provider,
      modelCode: MODEL,
      price: PRICE,
    });
    results.push(
      await runQIq(bare, cases, {
        budgetUsd: Math.max(0, budget - (results[0]?.costUsd ?? 0)),
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
