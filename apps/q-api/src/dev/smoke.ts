/* eslint-disable no-console -- a developer CLI whose whole purpose is to print Q's answer */
/**
 * `pnpm q:smoke` entry (CQ-Q-006 §67; CQ-Q-007 §70-§75). DEV ONLY; see
 * smoke-runner.ts.
 *
 * Prints, per scenario: Q's user-visible answer, then safe metadata on
 * separate lines (status, provider, model, prompt bundle, routing policy,
 * latency, tokens, estimated cost, structural flags, tools offered and
 * called with their outcomes, visible stages) and the fixture's
 * expectation checks. Never a key, never a prompt body, never a tool
 * argument or result, never internal reasoning.
 *
 *   pnpm q:smoke -- --tools        the tool-use scenarios (real registry)
 *   pnpm q:smoke -- --no-tools     the conversation scenarios without tools
 */
import {
  Q_COMMUNICATION_PRESETS,
  type QCommunicationPreset,
} from "@capital-q/contracts";
import { scenarioById, SYNTHETIC_COMPANY_FACTS } from "@capital-q/q-core";

import {
  checkExpectations,
  checkToolExpectations,
  SMOKE_SCENARIOS,
  withSmokeWorld,
  type Check,
  type SmokeRunResult,
} from "./smoke-runner.js";
import { Q_TOOL_SCENARIOS, toolScenarioById } from "./tool-scenarios.js";

type Args = {
  provider: "google" | "groq" | undefined;
  preset: QCommunicationPreset;
  message: string | undefined;
  scenario: string | undefined;
  /** undefined = conversation scenarios with the registry offered; true = tool scenarios. */
  tools: boolean | undefined;
};

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {
    provider: undefined,
    preset: "BALANCED",
    message: undefined,
    scenario: undefined,
    tools: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--provider":
        if (value === "google" || value === "groq") {
          args.provider = value;
        } else {
          throw new Error("--provider must be google or groq");
        }
        i += 1;
        break;
      case "--preset":
        if (
          (Q_COMMUNICATION_PRESETS as readonly string[]).includes(value ?? "")
        ) {
          args.preset = value as QCommunicationPreset;
        } else {
          throw new Error(
            `--preset must be one of ${Q_COMMUNICATION_PRESETS.join(", ")}`,
          );
        }
        i += 1;
        break;
      case "--message":
        args.message = value;
        i += 1;
        break;
      case "--scenario":
        args.scenario = value;
        i += 1;
        break;
      case "--tools":
        args.tools = true;
        break;
      case "--no-tools":
        args.tools = false;
        break;
      case undefined:
      case "--":
        // pnpm forwards the separator verbatim.
        break;
      default:
        throw new Error(`unknown argument ${flag}`);
    }
  }
  return args;
}

function print(result: SmokeRunResult, checks: readonly Check[]): void {
  const o = result.observation;
  console.log(`\n=== ${result.scenarioId} ===`);
  console.log(result.answer ?? "(no answer)");
  console.log("---");
  console.log(
    [
      `status=${result.status}${result.failureCode === null ? "" : ` failure=${result.failureCode}`}`,
      `provider=${o?.providerCode ?? "-"}`,
      `model=${o?.modelCode ?? "-"}`,
      `promptBundle=${result.promptBundleVersion ?? "-"}`,
      `routingPolicy=${result.modelPolicyVersion ?? "-"}`,
      `latencyMs=${o?.latencyMs ?? "-"}`,
      `tokens=${o?.usage.inputTokens ?? "-"}/${o?.usage.outputTokens ?? "-"}`,
      `estCostUsd=${o?.costUsd ?? "-"}`,
      `promptChars=${o?.promptCharacters ?? "-"}`,
      `shape=${o?.result.responseShape ?? "-"}`,
      `insufficientEvidence=${o?.result.insufficientEvidence ?? "-"}`,
      `contradictions=${o?.result.contradictions.length ?? "-"}`,
      `recommendation=${o?.result.recommendation === null ? "none" : (o?.result.recommendation?.confidence ?? "-")}`,
      `questions=${o?.result.clarifyingQuestions.length ?? "-"}`,
      `modelCalls=${o?.modelCalls ?? "-"}`,
      `toolsOffered=${o?.toolsOffered.join("|") ?? "-"}`,
      `toolCalls=${o?.toolCalls.map((c) => `${c.providerName}:${c.status}${c.failureCode === null ? "" : `(${c.failureCode})`}`).join("|") ?? "-"}`,
      `stages=${result.visibleStages.join(">") || "-"}`,
    ].join(" "),
  );
  for (const check of checks) {
    console.log(
      `  [${check.ok ? "ok" : "MISS"}] ${check.name}${check.detail === undefined ? "" : ` (${check.detail})`}`,
    );
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  let failures = 0;
  await withSmokeWorld(
    { provider: args.provider, tools: args.tools !== false },
    async (world) => {
      console.log(
        `configured providers: ${world.configuredProviders.join(", ") || "none"}`,
      );
      console.log(`registered tools: ${world.tools.join(", ")}`);
      if (args.tools === true) {
        const scenarios =
          args.scenario === undefined
            ? Q_TOOL_SCENARIOS
            : [toolScenarioById(args.scenario)];
        for (const scenario of scenarios) {
          // Two model calls per scenario against per-minute developer
          // limits; a 429 streak parks a provider for the gateway's 60s
          // health window. Pace past both.
          await new Promise((resolve) => setTimeout(resolve, 60_000));
          const result = await world.runToolScenario(scenario);
          const checks = checkToolExpectations(scenario, result);
          print(result, checks);
          failures += checks.some((c) => !c.ok) ? 1 : 0;
        }
        return;
      }
      if (args.message !== undefined) {
        const result = await world.run({
          scenarioId: "ad-hoc",
          capability: "ANSWER",
          message: args.message,
          facts: SYNTHETIC_COMPANY_FACTS,
          preset: args.preset,
        });
        print(result, [
          {
            name: "completed",
            ok: result.status === "COMPLETED",
            detail: result.failureCode ?? undefined,
          },
        ]);
        failures += result.status === "COMPLETED" ? 0 : 1;
        return;
      }
      const scenarios =
        args.scenario === undefined
          ? SMOKE_SCENARIOS
          : [scenarioById(args.scenario)];
      for (const scenario of scenarios) {
        // Developer-plan rate limits are per minute; do not make the gateway's
        // retries do the pacing.
        await new Promise((resolve) => setTimeout(resolve, 20_000));
        const result = await world.runScenario(scenario);
        const checks = checkExpectations(scenario, result);
        print(result, checks);
        failures += checks.some((c) => !c.ok) ? 1 : 0;
      }
    },
  );
  console.log(
    `\n${failures === 0 ? "all scenarios met their checks" : `${failures} scenario(s) missed a check`}`,
  );
  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "q smoke failed");
    process.exitCode = 1;
  });
