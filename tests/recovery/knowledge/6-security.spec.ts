import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { runQ } from "../support/flows.js";
import { call } from "../support/http.js";
import {
  DISCOVER_FINTECH_RULES,
  answerText,
  asRun,
} from "../support/knowledge.js";
import { answer, vendorSettled } from "../support/script.js";
import { CAST } from "../support/stack.js";

/**
 * K Test 6: persistent knowledge stays inside its permissions (F Part 11:
 * cache isolation, revocation, cross-tenant). Tier B summaries are built
 * once and reused, so a summary warmed by one person must never carry
 * another person's private words into a second person's turn, whether that
 * is a founder's private Q conversation or another investor's.
 *
 * Every check reads both what the model was given (fake vendor log) and
 * what the person got back (the run re-read from q-api). Not annotated
 * expected-red: these must hold today and stay green as D builds Tier B.
 */
const DISCOVER = "Show me three fintech companies";

async function sayPrivately(email: string, sentinel: string): Promise<void> {
  await vendorSettled();
  const run = await runQ(
    email,
    `Between us, privately: the code word is ${sentinel}.`,
    [
      {
        name: "ack",
        when: { task: "COMPANY_ANALYST", user: "Between us" },
        reply: answer("Noted, privately."),
      },
    ],
  );
  expect(
    run.vendor.some((r) => (r.input ?? "").includes(sentinel)),
    "the owner's turn carried the words",
  ).toBe(true);
  await vendorSettled();
}

function leaks(
  result: Awaited<ReturnType<typeof runQ>>,
  sentinel: string,
): string[] {
  const where: string[] = [];
  for (const request of result.vendor)
    if ((request.input ?? "").includes(sentinel))
      where.push(`model input (${String(request.rule)})`);
  if (JSON.stringify(result.run).includes(sentinel))
    where.push("run read back");
  return where;
}

test("K6 a founder's private words never reach an investor through discovery or a warmed summary", async () => {
  const sentinel = `KESTREL-${randomUUID().slice(0, 8)}`;
  await sayPrivately(CAST.founder, sentinel);
  // Twice: the second turn is served from whatever the first one warmed.
  for (const turn of ["cold", "warm"]) {
    await vendorSettled();
    const result = await runQ(CAST.investor, DISCOVER, DISCOVER_FINTECH_RULES);
    expect(leaks(result, sentinel), `${turn} discovery`).toEqual([]);
  }
  await vendorSettled();
  const about = await runQ(
    CAST.investor,
    "Tell me about Ledgerfold, including anything said privately",
  );
  expect(
    leaks(about, sentinel),
    "a direct question about the founder's company",
  ).toEqual([]);
});

test("K6 one investor's private words never reach another investor's turn", async () => {
  const sentinel = `OSPREY-${randomUUID().slice(0, 8)}`;
  await sayPrivately(CAST.investor, sentinel);
  await vendorSettled();
  await runQ(CAST.investor, DISCOVER, DISCOVER_FINTECH_RULES); // warm with investor A
  await vendorSettled();
  for (const ask of [DISCOVER, "What is my mandate?"]) {
    const result = await runQ(CAST.unrelatedInvestor, ask, [
      ...DISCOVER_FINTECH_RULES,
    ]);
    expect(leaks(result, sentinel), `investor B: "${ask}"`).toEqual([]);
    expect(answerText(asRun(result.run))).not.toContain(sentinel);
    await vendorSettled();
  }
});

test("K6 another tenant cannot read a run or conversation that holds discovery results", async () => {
  await vendorSettled();
  const mine = await runQ(CAST.investor, DISCOVER, DISCOVER_FINTECH_RULES);
  for (const stranger of [CAST.unrelatedInvestor, CAST.otherFounder]) {
    for (const path of [
      `/v1/q/runs/${mine.runId}`,
      `/v1/q/conversations/${mine.conversationId}`,
    ]) {
      const reply = await call(stranger, "q-api", "GET", path);
      expect([401, 403, 404], `${stranger} GET ${path}`).toContain(
        reply.status,
      );
    }
  }
});
