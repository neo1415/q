import { describe, expect, it } from "vitest";

import {
  checkToolExpectations,
  withSmokeWorld,
  type SmokeRunResult,
} from "../src/dev/smoke-runner.js";
import {
  Q_TOOL_SCENARIOS,
  toolScenarioById,
} from "../src/dev/tool-scenarios.js";

/**
 * LIVE Q tool-use conversations (CQ-Q-007 §70-§75, §103-§106). Real
 * providers, real database, real Tool Registry over real query ports,
 * synthetic rows only. Run through `pnpm test:live-model` (which sets
 * CQ_LIVE_MODEL_TESTS=1 and supplies the two key names); the local
 * database must be up. Skipped otherwise, never faked.
 *
 * Deterministic checks only: which tools ran with which outcome, and what
 * the answer must and must not contain. Prose is read by a person from
 * `pnpm q:smoke -- --tools`.
 */

process.env["DATABASE_URL"] ??=
  process.env["CQ_SMOKE_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
process.env["CAPITAL_Q_ENV"] = "local";

const LIVE = process.env["CQ_LIVE_MODEL_TESTS"] === "1";
const KEYS =
  process.env["GEMINI_API_KEY"] !== undefined ||
  process.env["GROQ_API_KEY"] !== undefined;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function summarise(result: SmokeRunResult): string {
  const calls = result.observation?.toolCalls
    .map((c) => `${c.providerName}:${c.status}`)
    .join(",");
  return `${result.scenarioId}: ${result.status}${result.failureCode === null ? "" : ` (${result.failureCode})`} via ${result.observation?.providerCode ?? "-"}/${result.observation?.modelCode ?? "-"} tools=[${calls ?? ""}] modelCalls=${String(result.observation?.modelCalls ?? 0)}`;
}

describe.skipIf(!LIVE || !KEYS)(
  "live Q tool use through the full stack",
  () => {
    it(
      "meets every tool scenario's deterministic checks with default routing",
      async () => {
        const failures: string[] = [];
        await withSmokeWorld({}, async (world) => {
          expect(world.tools).toEqual([
            "capital_objective.get/v1",
            "company.get/v1",
            "company.search/v1",
            "investor_mandate.get/v1",
          ]);
          for (const scenario of Q_TOOL_SCENARIOS) {
            // Two model calls per scenario against per-minute limits; a 429
            // streak parks a provider for the gateway's 60s health window.
            await pause(60_000);
            const result = await world.runToolScenario(scenario);
            const checks = checkToolExpectations(scenario, result);
            console.log(`[live] ${summarise(result)}`);
            for (const check of checks.filter((c) => !c.ok)) {
              failures.push(
                `${scenario.id}: ${check.name}${check.detail === undefined ? "" : ` (${check.detail})`}`,
              );
            }
          }
        });
        expect(failures).toEqual([]);
      },
      12 * 60_000,
    );

    it(
      "routes a tool call through each configured provider: Gemini and Groq both project the registry",
      async () => {
        const seen: string[] = [];
        for (const provider of ["google", "groq"] as const) {
          if (
            process.env[
              provider === "google" ? "GEMINI_API_KEY" : "GROQ_API_KEY"
            ] === undefined
          ) {
            continue;
          }
          await withSmokeWorld({ provider }, async (world) => {
            await pause(15_000);
            const scenario = toolScenarioById("tool-a-company-profile");
            const result = await world.runToolScenario(scenario);
            console.log(`[live] ${provider}: ${summarise(result)}`);
            expect(result.status).toBe("COMPLETED");
            expect(result.observation?.providerCode).toBe(provider);
            expect(
              checkToolExpectations(scenario, result).filter((c) => !c.ok),
            ).toEqual([]);
            seen.push(provider);
          });
        }
        expect(seen.length).toBeGreaterThan(0);
      },
      6 * 60_000,
    );
  },
);
