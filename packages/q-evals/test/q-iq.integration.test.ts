import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import { Q_IQ_DATASET, Q_IQ_CATEGORIES } from "../src/datasets/q-iq/index.js";
import { runQIq } from "../src/runner/q-iq.js";
import { createQIqWorldSubject } from "../src/runner/q-iq-world.js";

/**
 * Q-IQ through the REAL Q runtime with the scripted model: one case per
 * category, multi-turn in one stored conversation. Proves the Q subject
 * carries the conversation, releases the authorised facts under the
 * firewall plan and returns what was persisted — at no cost.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("Q-IQ — Q subject against local PostgreSQL (scripted model)", () => {
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

  it("runs a case per category through the runtime and scores the reference replies", async () => {
    const cases = Q_IQ_CATEGORIES.flatMap((category) =>
      Q_IQ_DATASET.cases.filter((c) => c.category === category).slice(0, 1),
    );
    expect(cases).toHaveLength(Q_IQ_CATEGORIES.length);
    const q = await createQIqWorldSubject({ db, providerMode: "FAKE" });
    try {
      const result = await runQIq(q.subject, cases);
      for (const run of result.cases) {
        expect(run.error, run.caseId).toBeNull();
      }
      // Scripted providers only: any cost here is the gateway's own token
      // estimate priced at catalogue rates, never spend.
      expect(q.world().providerMode).toBe("FAKE");
      console.log(
        JSON.stringify(
          {
            estimatedUsd: result.costUsd,
            input: result.inputTokens,
            turns: result.summary.overall.turns,
            fails: result.cases.flatMap((r) =>
              r.grade.turns
                .filter((t) => !t.pass)
                .map(
                  (t) =>
                    `${r.caseId}#${t.turn}: ${t.reasons.join("; ")} :: ${r.replies[t.turn]?.slice(0, 160)}`,
                ),
            ),
          },
          null,
          1,
        ),
      );
      expect(result.summary.overall.score).toBe(1);
      // The facts reached the model: the answer prompt carries them.
      const prompts = q
        .world()
        .recorder.calls()
        .map((c) => JSON.stringify(c));
      expect(
        prompts.some((p) => p.includes("Ledgerfold annual recurring revenue")),
      ).toBe(true);
    } finally {
      await q.close();
    }
  }, 300_000);
});
