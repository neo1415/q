import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import type { QTurnReading } from "@capital-q/model-gateway/q";

import { Q_IQ_DATASET, type QIqCase } from "../src/datasets/q-iq/index.js";
import { runQIq } from "../src/runner/q-iq.js";
import { createQIqWorldSubject } from "../src/runner/q-iq-world.js";

/**
 * Prompt caching for Q on Claude, measured offline (DECISIONS 68: cost
 * first; live cache reads were about 30%).
 *
 * Several multi-turn conversations in ONE process, as a live run is, through
 * the real gateway, answer path, Anthropic SDK and adapter over the wire
 * double, whose cache model reads a prefix only when it was written byte for
 * byte at the same breakpoint. A scripted turn reader gives each turn its
 * own reading, as the live reader does, so the per-turn sections of the
 * answer prompt really change from turn to turn.
 *
 * Asserted: from the second conversation on, every turn after the first
 * reads at least 80% of its input from cache, and the cached prefix (tools,
 * system and the stable head of the prompt) is byte-identical across the
 * turns of a conversation.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const KINDS = ["LOOKUP", "FOLLOW_UP", "ANALYSIS", "COMPARISON"] as const;

/** Each turn read differently, as the live reader does. */
function reading(_evalCase: QIqCase, turn: number): QTurnReading {
  return {
    kind: "QUESTION_TO_Q",
    confidence: "HIGH",
    transcript: "CLEAR",
    question: null,
    aboutNamedOther: false,
    tool: null,
    answerKind: KINDS[turn % KINDS.length] ?? "LOOKUP",
  } as unknown as QTurnReading;
}

/** Sonnet's price (ai_ops.model_prices, 20261231280000), USD per million. */
const PRICE = { input: 2, write: 2.5, read: 0.2, output: 10 };

describe("Q on Claude: prompt caching across turns (scripted model, wire double)", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "8",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it("reads ≥80% from cache on turn 2+ and keeps the cached prefix byte-identical", async () => {
    const cases = Q_IQ_DATASET.cases
      .filter(
        (c) =>
          c.turns.length >= 3 &&
          c.category !== "DISCOVERY" &&
          c.category !== "ADVERSARIAL",
      )
      .slice(0, 4);
    expect(cases.length).toBe(4);
    const q = await createQIqWorldSubject({
      db,
      providerMode: "FAKE",
      wire: "anthropic",
      scriptedReader: reading,
      // A tool round before each answer, as live: 2+ Claude calls a turn.
      scriptedToolCalls: (evalCase) => [
        {
          name: "search_companies",
          arguments: { query: evalCase.turns[0]?.user.slice(0, 40) ?? "x" },
        },
      ],
    });
    try {
      // Exchanges and request bodies per case, by their positions.
      const marks: { caseId: string; from: number; to: number }[] = [];
      let from = 0;
      await runQIq(q.subject, cases, {
        onCase: (run) => {
          const to = q.world().wire?.exchanges().length ?? 0;
          marks.push({ caseId: run.caseId, from, to });
          from = to;
        },
      });
      const exchanges = q.world().wire?.exchanges() ?? [];
      if (process.env["CQ_WIRE_DUMP"] !== undefined) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(
          process.env["CQ_WIRE_DUMP"],
          JSON.stringify({ marks, bodies: q.world().wire?.bodies() ?? [] }),
        );
      }
      const bodies = q.world().wire?.bodies() ?? [];
      expect(bodies.length).toBe(exchanges.length);

      const lines: string[] = [];
      const shares: number[][] = [];
      for (const mark of marks) {
        let cost = 0;
        const perTurn: number[] = [];
        for (let i = mark.from; i < mark.to; i += 1) {
          const e = exchanges[i];
          if (e === undefined || e.outcome.kind !== "MESSAGE") continue;
          const o = e.outcome;
          const uncached =
            o.inputTokens - o.cacheReadTokens - o.cacheWriteTokens;
          cost +=
            (uncached * PRICE.input +
              o.cacheWriteTokens * PRICE.write +
              o.cacheReadTokens * PRICE.read +
              o.outputTokens * PRICE.output) /
            1_000_000;
          perTurn.push(o.cacheReadTokens / Math.max(1, o.inputTokens));
        }
        shares.push(perTurn);
        lines.push(
          `${mark.caseId}: $${cost.toFixed(4)} modelled, read share by turn ${perTurn
            .map((s) => s.toFixed(2))
            .join(" ")}`,
        );
      }
      process.stdout.write(`claude cache:\n  ${lines.join("\n  ")}\n`);

      // From the second conversation on, turn 2+ reads ≥ 80%.
      for (const perTurn of shares.slice(1)) {
        for (const share of perTurn.slice(1)) {
          expect(share).toBeGreaterThanOrEqual(0.8);
        }
      }

      // The cached prefix is byte-identical across a conversation's turns:
      // tools, system, and the first user message up to its first breakpoint.
      const cachedPrefix = (body: Record<string, unknown>): string => {
        const messages = body["messages"] as {
          content: { text?: string; cache_control?: unknown }[];
        }[];
        const first = messages[0]?.content ?? [];
        const head: string[] = [];
        for (const block of first) {
          head.push(block.text ?? "");
          if (block.cache_control !== undefined) break;
        }
        return JSON.stringify([body["tools"], body["system"], head]);
      };
      for (const mark of marks.slice(1)) {
        const prefixes = bodies.slice(mark.from, mark.to).map(cachedPrefix);
        for (const prefix of prefixes.slice(1)) {
          expect(prefix).toBe(prefixes[0]);
        }
      }
    } finally {
      await q.close();
    }
  });
});
