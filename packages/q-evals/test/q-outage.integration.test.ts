import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import type { FakeBehaviour } from "@capital-q/model-gateway";

import { Q_IQ_DATASET } from "../src/datasets/q-iq/index.js";
import type { QIqCase } from "../src/datasets/q-iq/contracts.js";
import { runQIq } from "../src/runner/q-iq.js";
import { createQIqWorldSubject } from "../src/runner/q-iq-world.js";

/**
 * Premium Plan P1 chaos, through the REAL Q runtime: every scripted model
 * call fails with one failure class at a time. Each turn must still get a
 * reply, and that reply is either an answer code could give without a
 * model (a mandate recall) or an honest statement that Q's reasoning is
 * not available; never empty, never an invented answer.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const FAILURES: readonly { name: string; behaviour: FakeBehaviour }[] = [
  {
    name: "credit or quota spent",
    behaviour: {
      kind: "FAIL",
      failureClass: "PERMANENT",
      accountExhausted: true,
    },
  },
  {
    name: "key refused",
    behaviour: { kind: "FAIL", failureClass: "AUTHENTICATION" },
  },
  {
    name: "rate limited",
    behaviour: { kind: "FAIL", failureClass: "RATE_LIMIT" },
  },
  { name: "timed out", behaviour: { kind: "FAIL", failureClass: "TIMEOUT" } },
  {
    name: "provider 5xx",
    behaviour: { kind: "FAIL", failureClass: "PROVIDER_OUTAGE" },
  },
];

/** What Q may say when it has no model: plain, about itself, never a guess. */
const HONEST =
  /reasoning service|couldn't read that|haven't (?:started|taken)|send it again|say it again|didn't go through|isn't answering|try (?:it )?again/iu;

const MANDATE_RECALL = "What is my mandate?";

const RETRYABLE_PROVIDER_FAILURES = [
  "MODEL_PROVIDER_UNAVAILABLE",
  "MODEL_PROVIDER_TIMEOUT",
  "BUDGET_EXCEEDED",
];

describe("Q under a provider outage (scripted, local PostgreSQL)", () => {
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

  // Two everyday investor cases (the dataset's conversations are an
  // investor's), plus an investor's mandate recall.
  const investor = Q_IQ_DATASET.cases.find((c) => c.category === "FOLLOW_UPS");
  const other = Q_IQ_DATASET.cases.find((c) => c.category === "NUMBERS");
  if (investor === undefined || other === undefined) {
    throw new Error("Q-IQ dataset has no FOLLOW_UPS or NUMBERS case");
  }
  const recall: QIqCase = {
    ...investor,
    id: "QIQ-OUT-001",
    priorConversations: [],
    turns: investor.turns.map((turn, index) =>
      index === 0 ? { ...turn, user: MANDATE_RECALL } : turn,
    ),
  };

  for (const failure of FAILURES) {
    it(`${failure.name}: every turn is answered or honestly degraded`, async () => {
      const q = await createQIqWorldSubject({
        db,
        providerMode: "FAKE",
        memory: false,
        investorOwnOrganisation: true,
        outage: () => failure.behaviour,
      });
      try {
        const since = new Date();
        const result = await runQIq(q.subject, [investor, other, recall]);
        // A turn the inner answer could not write ends its run FAILED with
        // a retryable provider code, shown as "Q isn't available right now.
        // Please try again shortly" (contracts q/failure.ts); never stored
        // as an answer, never an internal error.
        const runs = await db.sql<
          { status: string; failure_code: string | null }[]
        >`
          select status, failure_code from q_runtime.runs
           where created_at >= ${since.toISOString()}::timestamptz
           order by created_at`;
        const turns = result.cases.flatMap((run) => run.replies);
        expect(runs).toHaveLength(turns.length);
        for (const run of runs) {
          if (run.status === "FAILED") {
            expect(RETRYABLE_PROVIDER_FAILURES).toContain(run.failure_code);
          } else {
            expect(run.status).toBe("COMPLETED");
          }
        }
        let index = 0;
        for (const run of result.cases) {
          expect(run.error, run.caseId).toBeNull();
          for (const [turn, reply] of run.replies.entries()) {
            const label = `${run.caseId}#${String(turn)}: ${reply.slice(0, 200)}`;
            const status = runs[index]?.status;
            index += 1;
            if (run.caseId === recall.id && turn === 0) {
              // A recall of their own declared record needs no model.
              expect(status, label).toBe("COMPLETED");
              expect(reply, label).not.toMatch(HONEST);
              continue;
            }
            if (reply === "(no reply)") {
              expect(status, label).toBe("FAILED");
            } else {
              expect(reply, label).toMatch(HONEST);
            }
          }
        }
      } finally {
        await q.close();
      }
    });
  }
});
