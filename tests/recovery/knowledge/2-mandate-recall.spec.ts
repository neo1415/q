import { expect, test } from "@playwright/test";

import { runQ } from "../support/flows.js";
import {
  BUDGET,
  mandateReading,
  mandateSectorCodes,
  modelCallsOf,
  serverMs,
  asRun,
} from "../support/knowledge.js";
import { vendorSettled } from "../support/script.js";
import { CAST, world } from "../support/stack.js";

/**
 * K Test 2: mandate recall without a refetch (B K8, D Parts 2-3). The
 * reader reads "what is my mandate" as a question about the prepared
 * mandate (scripted reading in MOCK; the live reading is LIVE-PENDING).
 * Q answers from the mandate prepared for the turn: at most one analyst
 * call with NO tool round (a refetch would be a second analyst call after
 * a tool), the declared sectors already in the analyst's context, inside
 * the recall budget, and the second ask no costlier than the first.
 *
 * The answer's words come from the scripted fake, so naming the sectors in
 * the reply is model behaviour (LIVE-PENDING); what is asserted is that the
 * model was given them. Not observable: the DB query count per turn.
 */
const ASK = "What is my mandate?";

/** A taxonomy code ("digital_lending") as code or words ("digital lending"). */
function mentions(input: string, code: string): boolean {
  const lower = input.toLowerCase();
  return lower.includes(code) || lower.includes(code.replace(/_/gu, " "));
}

test("K2 mandate recall: declared sectors prepared, no tool round, in budget, twice", async () => {
  // Green on int-merge 9050c90f: a regression guard, not expected red.
  const mandateId = world().investor("savanna-seed").mandateId;
  const sectors = mandateSectorCodes(mandateId);
  expect(sectors.length, "the seeded mandate declares sectors").toBeGreaterThan(
    0,
  );

  await vendorSettled();
  const first = await runQ(CAST.investor, ASK, [mandateReading(ASK)]);
  await vendorSettled();
  const second = await runQ(
    CAST.investor,
    `${ASK} Remind me.`,
    [mandateReading(ASK)],
    first.conversationId,
  );
  for (const [label, result] of [
    ["first", first],
    ["second", second],
  ] as const) {
    const run = asRun(result.run);
    expect(run.status, label).toBe("COMPLETED");
    const calls = modelCallsOf(result.vendor);
    const analystInput = calls.requests
      .filter((r) => /TASK: COMPANY_ANALYST\b/u.test(r.input ?? ""))
      .map((r) => r.input ?? "")
      .join("\n");
    for (const sector of sectors)
      expect
        .soft(
          mentions(analystInput, sector),
          `${label}: the analyst was given the declared sector "${sector}"`,
        )
        .toBe(true);
    expect
      .soft(
        calls.analyst,
        `${label}: analyst calls, no tool round (${calls.tasks.join(", ")})`,
      )
      .toBeLessThanOrEqual(1);
    expect
      .soft(calls.total, `${label}: model calls`)
      .toBeLessThanOrEqual(BUDGET.recallModelCalls);
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
