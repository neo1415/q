import { expect, test } from "@playwright/test";

import { awaits } from "../support/expected-red.js";
import { runQ } from "../support/flows.js";
import {
  BUDGET,
  answerText,
  mandateSectorNames,
  modelCallsOf,
  serverMs,
  asRun,
} from "../support/knowledge.js";
import { vendorSettled } from "../support/script.js";
import { CAST, world } from "../support/stack.js";

/**
 * K Test 2: mandate recall without a refetch. Q already knows the
 * investor's declared mandate (Tier B mandate summary, D Parts 2-3); "what
 * is my mandate" is answered from it: code-built or from the summary,
 * no analyst call, inside the recall budget, every time in the conversation
 * (the second ask must not be slower or make more model calls than the
 * first). The answer names the declared sectors as the database holds them.
 *
 * Not observable here: the DB query count per turn (nothing counts queries;
 * K-baseline.md "Gaps"). The refetch is judged by model calls and time.
 */
const ASK = "What is my mandate?";

test("K2 mandate recall: declared sectors, no analyst call, in budget, twice", async () => {
  awaits(
    ["D Parts 2-3", "B Part 8"],
    "no Tier B mandate summary and no recall fast path: the analyst re-reads the mandate each turn",
  );
  const mandateId = world().investor("savanna-seed").mandateId;
  const sectors = mandateSectorNames(mandateId);
  expect(sectors.length, "the seeded mandate declares sectors").toBeGreaterThan(
    0,
  );

  await vendorSettled();
  const first = await runQ(CAST.investor, ASK);
  await vendorSettled();
  const second = await runQ(
    CAST.investor,
    `${ASK} Remind me.`,
    [],
    first.conversationId,
  );
  for (const [label, result] of [
    ["first", first],
    ["second", second],
  ] as const) {
    const run = asRun(result.run);
    expect(run.status, label).toBe("COMPLETED");
    const text = answerText(run).toLowerCase();
    for (const sector of sectors)
      expect
        .soft(text, `${label}: names the declared sector "${sector}"`)
        .toContain(sector.toLowerCase());
    const calls = modelCallsOf(result.vendor);
    expect
      .soft(
        calls.analyst,
        `${label}: analyst calls (${calls.tasks.join(", ")})`,
      )
      .toBe(0);
    expect
      .soft(calls.total, `${label}: model calls`)
      .toBeLessThanOrEqual(BUDGET.fastPathModelCalls);
    expect
      .soft(serverMs(run) ?? Infinity, `${label}: server ms`)
      .toBeLessThanOrEqual(BUDGET.recallServerMs);
  }
  expect
    .soft(
      modelCallsOf(second.vendor).total,
      "the second ask makes no more model calls than the first",
    )
    .toBeLessThanOrEqual(modelCallsOf(first.vendor).total);
});
