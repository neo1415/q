import { expect, test } from "@playwright/test";

import { runQ } from "../support/flows.js";
import { call } from "../support/http.js";
import {
  mandateReading,
  mandateSectorNames,
  modelCallsOf,
  asRun,
} from "../support/knowledge.js";
import { answer, vendorSettled, type ScriptRule } from "../support/script.js";
import { CAST, world } from "../support/stack.js";

/**
 * K Test 4: change propagation (D Part 5, event-driven invalidation). The
 * investor changes a declared mandate fact through the product's own path
 * (Q prepares propose_profile_answer_change, the person approves it, the
 * owning service writes it). The very next recall reflects the new fact:
 * no stale Tier B summary, no waiting for a TTL. The database is read
 * first to prove the write landed, so a red here is staleness, not a
 * failed write. The original sectors are restored the same way.
 */
const APPROVALS = "/v1/q/approvals";

function proposeSectors(value: readonly string[]): ScriptRule[] {
  return [
    {
      name: "propose-sectors",
      when: {
        task: "COMPANY_ANALYST",
        tool: "propose_profile_answer_change",
        afterTool: null,
      },
      reply: {
        toolCalls: [
          {
            name: "propose_profile_answer_change",
            arguments: { field: "sectors", value: [...value] },
          },
        ],
      },
    },
    {
      name: "after-propose",
      when: {
        task: "COMPANY_ANALYST",
        afterTool: "propose_profile_answer_change",
      },
      reply: answer("The change is on the card below for your approval."),
    },
  ];
}

async function changeSectors(value: readonly string[]): Promise<void> {
  await vendorSettled();
  const result = await runQ(
    CAST.investor,
    `Change my sectors to ${value.join(" and ")}`,
    proposeSectors(value),
  );
  const listed = await call(CAST.investor, "q-api", "GET", APPROVALS);
  const mine = (
    (listed.body as { items?: Array<{ approvalId: string; runId: string }> })
      .items ?? []
  ).find((item) => item.runId === result.runId);
  expect(
    mine,
    `an approval for the sectors change (run ${result.status})`,
  ).toBeDefined();
  const approved = await call(
    CAST.investor,
    "q-api",
    "POST",
    `${APPROVALS}/${String(mine?.approvalId)}/approve`,
    {},
  );
  expect(approved.status, approved.text.slice(0, 200)).toBeLessThan(300);
}

test("K4 a mandate change is reflected on the very next turn", async () => {
  // Green on int-merge 9050c90f: a regression guard, not expected red.
  const mandateId = world().investor("savanna-seed").mandateId;
  const original = mandateSectorNames(mandateId);
  expect(original.length).toBeGreaterThan(0);
  const target = ["Agritech"];
  try {
    await changeSectors(target);
    // Server truth first: the declared mandate changed.
    await expect
      .poll(() => mandateSectorNames(mandateId).map((s) => s.toLowerCase()), {
        timeout: 20_000,
      })
      .toEqual(["agritech"]);
    await vendorSettled();
    const ask = "What is my mandate?";
    const recall = await runQ(CAST.investor, ask, [mandateReading(ask)]);
    expect(asRun(recall.run).status).toBe("COMPLETED");
    // The reply's words are the scripted fake's; what Q prepared for the
    // model is the server-side truth. (Old sectors are not asserted absent:
    // memory and history may legitimately still mention them.)
    const calls = modelCallsOf(recall.vendor);
    const analystInput = calls.requests
      .filter((r) => /TASK: COMPANY_ANALYST\b/u.test(r.input ?? ""))
      .map((r) => (r.input ?? "").toLowerCase())
      .join("\n");
    expect
      .soft(analystInput, "the prepared mandate carries the new sector")
      .toContain("agritech");
    expect
      .soft(calls.analyst, "recall after the change: no tool round")
      .toBeLessThanOrEqual(1);
  } finally {
    await changeSectors(original);
    expect(mandateSectorNames(mandateId), "original sectors restored").toEqual(
      original,
    );
  }
});
