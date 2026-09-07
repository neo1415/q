/**
 * `q-eval` (CQ-Q-010 §76-§87, §135).
 *
 *   q-eval lint
 *   q-eval run --profile LOCAL_FAST|CI_CORE|LIVE_MODEL [--provider google|groq]
 *              [--case A,B] [--out <dir>] [--baseline <file>] [--update-baseline] [--show-answers]
 *   q-eval compare <baseline.json> <result.json>
 *
 * Exit codes: 0 when the gate passes (warnings allowed), 1 on a hard
 * invariant or deterministic failure, a blocked hard invariant, an invalid
 * dataset, or a runner fault. Live runs report key PRESENCE only.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadDatabaseConfig } from "@capital-q/config/database";
import { modelProviderConfigStatus } from "@capital-q/config/model-providers";
import { parseQApiConfig } from "@capital-q/config/q-api";
import { createRequestDatabaseClient } from "@capital-q/database";

import {
  QEvalBaselineSchema,
  QEvalProfileSchema,
  QEvalRunResultSchema,
  type QEvalProfile,
} from "./contracts/index.js";
import { lintDatasets, Q_EVAL_DATASETS } from "./datasets/index.js";
import { Q_EVAL_GRADERS } from "./graders/index.js";
import {
  datasetsForProfile,
  Q_EVAL_PROFILE_DEFINITIONS,
} from "./profiles/index.js";
import {
  compareToBaseline,
  renderComparison,
  renderSummary,
  toBaseline,
} from "./reporters/index.js";
import { runQEvals } from "./runner/index.js";

type Args = {
  readonly command: string;
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | true>>;
};

function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  let command = "";
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--") {
      continue;
    }
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i += 1;
      } else {
        flags[key] = true;
      }
    } else if (command === "") {
      command = arg;
    } else {
      positional.push(arg);
    }
  }
  return { command, positional, flags };
}

function lint(): number {
  const issues = lintDatasets(
    Q_EVAL_DATASETS,
    Q_EVAL_GRADERS.map((g) => g.id),
  );
  const cases = Q_EVAL_DATASETS.reduce((n, d) => n + d.cases.length, 0);
  for (const dataset of Q_EVAL_DATASETS) {
    console.log(
      `${dataset.datasetId}@v${dataset.version} ${dataset.type} ${dataset.role} ${dataset.privacyClass} cases=${dataset.cases.length}`,
    );
  }
  if (issues.length === 0) {
    console.log(
      `dataset lint: PASS (${cases} cases, ${Q_EVAL_GRADERS.length} graders)`,
    );
    return 0;
  }
  for (const issue of issues) {
    console.log(
      `dataset lint: ${issue.datasetId} ${issue.caseId ?? "-"}: ${issue.issue}`,
    );
  }
  console.log(`dataset lint: FAIL (${issues.length} issues)`);
  return 1;
}

async function run(args: Args): Promise<number> {
  if (lint() !== 0) {
    return 1;
  }
  const profile: QEvalProfile = QEvalProfileSchema.parse(
    args.flags["profile"] ?? "LOCAL_FAST",
  );
  const definition = Q_EVAL_PROFILE_DEFINITIONS[profile];
  if (!definition.implemented) {
    console.log(`profile ${profile}: ${definition.description}`);
    return 1;
  }
  const providerFlag = args.flags["provider"];
  const providerFilter =
    providerFlag === "google" || providerFlag === "groq"
      ? providerFlag
      : undefined;
  const secrets =
    definition.providerMode === "LIVE"
      ? parseQApiConfig(process.env).secrets.modelProviders
      : undefined;
  const keyPresence: Record<string, boolean> = {};
  if (definition.providerMode === "LIVE" && secrets !== undefined) {
    const status = modelProviderConfigStatus(secrets);
    for (const [code, configured] of Object.entries(status)) {
      const present = configured === "configured";
      keyPresence[code] = present;
      console.log(
        `${code === "google" ? "GEMINI_API_KEY" : "GROQ_API_KEY"}: ${present ? "PRESENT" : "MISSING"}`,
      );
    }
    if (!Object.values(keyPresence).some(Boolean)) {
      console.log("LIVE_MODEL: no provider key present; BLOCKED");
      return 1;
    }
  }
  // --case A,B narrows a run to named cases (a live subset, a single
  // regression); it never adds a case the profile excludes.
  const caseFlag = args.flags["case"];
  const onlyCases =
    typeof caseFlag === "string"
      ? new Set(caseFlag.split(",").map((id) => id.trim()))
      : undefined;
  const db = createRequestDatabaseClient(loadDatabaseConfig());
  try {
    const datasets =
      onlyCases === undefined
        ? datasetsForProfile(profile)
        : datasetsForProfile(profile)
            .map((dataset) => ({
              ...dataset,
              cases: dataset.cases.filter((c) => onlyCases.has(c.id)),
            }))
            .filter((dataset) => dataset.cases.length > 0);
    if (onlyCases !== undefined) {
      const found = new Set(datasets.flatMap((d) => d.cases.map((c) => c.id)));
      const unknown = [...onlyCases].filter((id) => !found.has(id));
      if (unknown.length > 0) {
        console.error(`unknown or excluded case(s): ${unknown.join(", ")}`);
        return 1;
      }
    }
    console.log(`profile ${profile}: ${definition.description}`);
    const result = await runQEvals(datasets, {
      db,
      profile,
      providerMode: definition.providerMode,
      providerFilter,
      secrets,
      keyPresence,
      keepAnswers: definition.providerMode === "LIVE",
      onCase: (c) => {
        console.log(
          `  ${c.caseId.padEnd(12)} ${c.status.padEnd(8)} ${c.suite}`,
        );
      },
    });
    console.log("");
    console.log(
      renderSummary(result, {
        showAnswers: args.flags["show-answers"] === true,
      }),
    );
    const outDir = resolve(
      typeof args.flags["out"] === "string"
        ? args.flags["out"]
        : "artifacts/q-evals",
    );
    mkdirSync(outDir, { recursive: true });
    const stamp = result.finishedAt.replace(/[:.]/g, "-");
    const file = resolve(outDir, `${profile.toLowerCase()}-${stamp}.json`);
    writeFileSync(
      file,
      JSON.stringify(QEvalRunResultSchema.parse(result), null, 2),
    );
    console.log(`\nreport: ${file}`);

    const baselinePath =
      typeof args.flags["baseline"] === "string"
        ? resolve(args.flags["baseline"])
        : resolve(
            "packages/q-evals/baselines",
            `${profile.toLowerCase()}.baseline.json`,
          );
    if (args.flags["update-baseline"] === true) {
      // Explicit and intentional (§80): never on failure, never implicitly.
      if (result.status === "FAIL" || result.status === "BLOCKED") {
        console.log("baseline NOT updated: the run did not pass");
      } else {
        mkdirSync(resolve(baselinePath, ".."), { recursive: true });
        writeFileSync(
          baselinePath,
          JSON.stringify(toBaseline(result), null, 2) + "\n",
        );
        console.log(`baseline written: ${baselinePath}`);
      }
    } else {
      try {
        const baseline = QEvalBaselineSchema.parse(
          JSON.parse(readFileSync(baselinePath, "utf8")),
        );
        console.log("");
        console.log(renderComparison(compareToBaseline(baseline, result)));
      } catch {
        console.log(
          `no baseline at ${baselinePath} (run with --update-baseline to record one)`,
        );
      }
    }
    return result.exitCode;
  } finally {
    await db.close();
  }
}

function compare(args: Args): number {
  const [baselineFile, resultFile] = args.positional;
  if (baselineFile === undefined || resultFile === undefined) {
    console.log("usage: q-eval compare <baseline.json> <result.json>");
    return 1;
  }
  const baseline = QEvalBaselineSchema.parse(
    JSON.parse(readFileSync(resolve(baselineFile), "utf8")),
  );
  const result = QEvalRunResultSchema.parse(
    JSON.parse(readFileSync(resolve(resultFile), "utf8")),
  );
  const comparison = compareToBaseline(baseline, result);
  console.log(renderComparison(comparison));
  return comparison.regressed ? 1 : 0;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case "lint":
      return lint();
    case "run":
      return run(args);
    case "compare":
      return compare(args);
    default:
      console.log(
        "usage: q-eval lint | run --profile <P> [--provider google|groq] [--case A,B] [--out dir] [--baseline file] [--update-baseline] [--show-answers] | compare <baseline> <result>",
      );
      return 1;
  }
}

main()
  .then((code) => {
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(
      `q-eval failed: ${error instanceof Error ? error.name : typeof error}`,
    );
    process.exit(1);
  });
