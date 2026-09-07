import { describe, expect, it } from "vitest";

import { Q_CONVERSATION_SCENARIOS, scenarioById } from "@capital-q/q-core";

import {
  checkExpectations,
  withSmokeWorld,
  type SmokeRunResult,
} from "../src/dev/smoke-runner.js";

/**
 * LIVE Q smoke conversations (CQ-Q-006 §56-§66). Real providers, real
 * database, synthetic fixtures only. Run through `pnpm test:live-model`
 * (which sets CQ_LIVE_MODEL_TESTS=1 and supplies the two key names); the
 * local database must be up. Skipped otherwise, never faked.
 *
 * Deterministic checks only; prose quality is reviewed by a person from
 * `pnpm q:smoke` output. Scenario pacing respects developer-plan rate
 * limits, so this suite is slow by design.
 */

// Synthetic rows are created and removed: the LOCAL stack only, like `pnpm q:smoke`.
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
  return `${result.scenarioId}: ${result.status}${result.failureCode === null ? "" : ` (${result.failureCode})`} via ${result.observation?.providerCode ?? "-"}/${result.observation?.modelCode ?? "-"}`;
}

describe.skipIf(!LIVE || !KEYS)("live Q smoke through the full stack", () => {
  it(
    "meets every fixture's deterministic checks with default routing",
    async () => {
      const failures: string[] = [];
      await withSmokeWorld({}, async (world) => {
        for (const scenario of Q_CONVERSATION_SCENARIOS) {
          await pause(20_000);
          const result = await world.runScenario(scenario);
          const checks = checkExpectations(scenario, result);
          console.log(`[live] ${summarise(result)}`);
          for (const check of checks.filter((c) => !c.ok)) {
            failures.push(
              `${scenario.id}: ${check.name}${check.detail === undefined ? "" : ` (${check.detail})`}`,
            );
          }
          expect(
            result.promptBundleVersion === null ||
              result.promptBundleVersion.startsWith("q-system.v1_"),
          ).toBe(true);
        }
      });
      expect(failures).toEqual([]);
    },
    10 * 60_000,
  );

  it(
    "keeps one Q identity across providers: the same simple question answered by each configured provider",
    async () => {
      const answers: Record<string, SmokeRunResult> = {};
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
          answers[provider] = await world.runScenario(
            scenarioById("smoke-a-simple-factual"),
          );
        });
      }
      for (const [provider, result] of Object.entries(answers)) {
        console.log(`[live] identity ${provider}: ${summarise(result)}`);
        expect(result.status).toBe("COMPLETED");
        expect(result.observation?.providerCode).toBe(provider);
        const checks = checkExpectations(
          scenarioById("smoke-a-simple-factual"),
          result,
        );
        expect(checks.filter((c) => !c.ok)).toEqual([]);
      }
    },
    5 * 60_000,
  );
});
