import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { runQ } from "../support/flows.js";
import { tokenFor } from "../support/http.js";
import {
  READ_DISCOVER_FINTECH,
  asRun,
  cardCompanyIds,
  modelCallsSince,
  readRun,
  type RunView,
} from "../support/knowledge.js";
import { stack } from "../support/local-db.js";
import { useScript, vendorMark, vendorSettled } from "../support/script.js";
import { CAST, Q_API_URL } from "../support/stack.js";

/**
 * K Test 7: concurrency and recovery. Persistent knowledge is built once
 * (B Part 4 single-flight, D Parts 2-3) and the fast path does not depend
 * on a model being up; a run caught by a q-api restart still ends.
 */
const DISCOVER = "Show me three fintech companies";
const TERMINAL = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "AWAITING_APPROVAL",
  "EXPIRED",
]);

async function startRun(
  text: string,
  key: string,
): Promise<{ status: number; runId: string | null }> {
  const response = await fetch(`${Q_API_URL}/v1/q/runs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await tokenFor(CAST.investor)}`,
      "content-type": "application/json",
      "idempotency-key": key,
    },
    body: JSON.stringify({
      capability: "ANSWER",
      message: { text },
      modality: "TEXT",
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    runId?: unknown;
  } | null;
  return {
    status: response.status,
    runId: typeof body?.runId === "string" ? body.runId : null,
  };
}

async function settle(runId: string, timeoutMs = 90_000): Promise<RunView> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const run = await readRun(CAST.investor, runId).catch(() => null);
    if (run !== null && TERMINAL.has(run.status)) return run;
    if (Date.now() > deadline)
      throw new Error(`run ${runId} never ended (last ${String(run?.status)})`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

test("K7 the same request twice at once is one run", async () => {
  await useScript([READ_DISCOVER_FINTECH]);
  await vendorSettled();
  const key = `recovery-g-k7-${randomUUID()}`;
  const [a, b] = await Promise.all([
    startRun(DISCOVER, key),
    startRun(DISCOVER, key),
  ]);
  expect(
    [a.status, b.status].every((s) => s === 200 || s === 202),
    `statuses ${String(a.status)}/${String(b.status)}`,
  ).toBe(true);
  expect(a.runId, "one idempotency key, one run").toBe(b.runId);
});

test("K7 three concurrent discoveries agree, and knowledge is built once (no analyst calls)", async () => {
  // Green on int-merge 9050c90f: a regression guard, not expected red.
  await useScript([READ_DISCOVER_FINTECH]);
  await vendorSettled();
  const mark = await vendorMark();
  const started = await Promise.all(
    [1, 2, 3].map(() => startRun(DISCOVER, `recovery-g-k7-${randomUUID()}`)),
  );
  const runs = await Promise.all(started.map((s) => settle(String(s.runId))));
  for (const run of runs) expect.soft(run.status).toBe("COMPLETED");
  const sets = runs.map((run) =>
    JSON.stringify([...cardCompanyIds(run)].sort()),
  );
  expect.soft(new Set(sets).size, `card sets ${sets.join(" | ")}`).toBe(1);
  expect
    .soft(
      runs.every((run) => cardCompanyIds(run).length > 0),
      "every run has cards",
    )
    .toBe(true);
  const calls = await modelCallsSince(mark);
  expect
    .soft(
      calls.analyst,
      `analyst calls across 3 runs (${calls.tasks.join(", ")})`,
    )
    .toBe(0);
});

test("K7 discovery still answers while the analyst model is down", async () => {
  // Green on int-merge 9050c90f: a regression guard, not expected red.
  await vendorSettled();
  try {
    const result = await runQ(CAST.investor, DISCOVER, [
      // The reader is up (it routes the turn); only the analyst fails.
      READ_DISCOVER_FINTECH,
      {
        name: "outage-analyst",
        when: { task: "COMPANY_ANALYST" },
        reply: { status: 503 },
      },
    ]);
    const run = asRun(result.run);
    expect.soft(run.status, "answered without the analyst").toBe("COMPLETED");
    expect
      .soft(cardCompanyIds(run).length, "cards without the analyst")
      .toBeGreaterThan(0);
  } finally {
    await useScript([]);
    // The gateway's provider circuit stays open 30 s after failures
    // (packages/model-gateway/src/policy/health.ts); let it close.
    await new Promise((resolve) => setTimeout(resolve, 35_000));
  }
});

test("K7 a run caught by a q-api restart still ends, and the next discovery works", async () => {
  test.setTimeout(240_000);
  await useScript([
    {
      name: "hang",
      when: { task: "COMPANY_ANALYST", user: "slow question" },
      reply: { hang: true },
    },
  ]);
  await vendorSettled();
  const caught = await startRun(
    "A slow question about Ledgerfold's collections",
    `recovery-g-k7-${randomUUID()}`,
  );
  expect(caught.runId).not.toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  stack("stop", "q-api");
  stack("start", "q-api");
  const ended = await settle(String(caught.runId), 120_000);
  expect(
    TERMINAL.has(ended.status),
    `caught run ended as ${ended.status}`,
  ).toBe(true);
  const next = await runQ(CAST.investor, DISCOVER, [READ_DISCOVER_FINTECH]);
  expect(next.status, "the next turn after the restart").toBe("COMPLETED");
});
