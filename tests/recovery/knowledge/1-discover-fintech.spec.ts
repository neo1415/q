import { expect, test } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { runQ } from "../support/flows.js";
import {
  BUDGET,
  DISCOVER_FINTECH_RULES,
  answerText,
  cardCompanyIds,
  declaredFintech,
  keepDeclaredFintech,
  modelCallsOf,
  modelCallsSince,
  newestRun,
  nextSettledRun,
  serverMs,
  asRun,
  type RunView,
} from "../support/knowledge.js";
import { send } from "../support/q.js";
import { useScript, vendorMark, vendorSettled } from "../support/script.js";
import { CAST } from "../support/stack.js";

/**
 * K Test 1: "three fintech companies" (the 2026-10-09 production failure).
 * The answer is the declared fintech companies the investor may see, as
 * cards, code-built (Part 1 DISCOVER_COMPANIES fast path, Part 8 router):
 * no analyst model call, inside the latency budget, and honest when fewer
 * than three exist (0, 1 and 2 seeded through the harness, never prod).
 */
const ASK = "Show me three fintech companies";

async function discover(): Promise<{
  run: RunView;
  ms: number | null;
  calls: ReturnType<typeof modelCallsOf>;
}> {
  await vendorSettled();
  const result = await runQ(CAST.investor, ASK, DISCOVER_FINTECH_RULES);
  const run = asRun(result.run);
  return { run, ms: serverMs(run), calls: modelCallsOf(result.vendor) };
}

function expectFastPath(
  calls: ReturnType<typeof modelCallsOf>,
  ms: number | null,
): void {
  expect
    .soft(calls.analyst, `analyst calls (tasks: ${calls.tasks.join(", ")})`)
    .toBe(0);
  expect
    .soft(calls.total, `model calls (tasks: ${calls.tasks.join(", ")})`)
    .toBeLessThanOrEqual(BUDGET.fastPathModelCalls);
  expect.soft(ms, "server ms, createdAt → completedAt").not.toBeNull();
  expect.soft(ms ?? Infinity).toBeLessThanOrEqual(BUDGET.discoverServerMs);
}

test.describe("K1 three fintech companies (API, server state)", () => {
  test("as seeded: up to three declared-fintech cards, unique, code-built, in budget", async () => {
    // Green on int-merge 9050c90f: a regression guard, not expected red.
    const fintech = declaredFintech();
    expect(
      fintech.length,
      "the local seed declares fintech companies",
    ).toBeGreaterThan(0);
    const { run, ms, calls } = await discover();
    expect(run.status).toBe("COMPLETED");
    const ids = cardCompanyIds(run);
    expect.soft(ids.length, "cards").toBe(Math.min(3, fintech.length));
    for (const id of ids)
      expect.soft(fintech, `card ${id} is declared fintech`).toContain(id);
    expectFastPath(calls, ms);
  });

  for (const keep of [0, 1, 2]) {
    test(`${String(keep)} declared fintech: ${String(keep)} card(s), says so honestly, invents none`, async () => {
      // Green on int-merge 9050c90f: a regression guard, not expected red.
      const seeded = declaredFintech().length;
      expect(
        seeded,
        "the local seed declares enough fintech companies",
      ).toBeGreaterThanOrEqual(keep);
      // Keep companies the investor is shown as seeded, so the case tests
      // the count and honesty, not who is eligible to be seen.
      const visible = cardCompanyIds((await discover()).run);
      const restore = keepDeclaredFintech(keep, visible);
      try {
        const remaining = declaredFintech();
        expect(remaining, "the fixture left exactly that many").toHaveLength(
          keep,
        );
        const { run, ms, calls } = await discover();
        expect(run.status).toBe("COMPLETED");
        const ids = cardCompanyIds(run);
        expect.soft(ids.length, "cards").toBe(remaining.length);
        for (const id of ids) expect.soft(remaining).toContain(id);
        const text = answerText(run);
        expect.soft(text.length, "Q says something").toBeGreaterThan(0);
        if (keep === 0)
          expect
            .soft(text, "says there are none")
            .toMatch(
              /\b(no|none|not find|can.?t find|cannot find|couldn.t find|zero)\b/iu,
            );
        else
          expect
            .soft(text, "says there are fewer than three")
            .toMatch(/\b(only|one|two|1|2)\b/iu);
        expect
          .soft(text, "never claims three")
          .not.toMatch(/\bthree\b|\b3\b/iu);
        expectFastPath(calls, ms);
      } finally {
        restore();
      }
    });
  }
});

test("K1 in the browser: the first card renders inside the budget and matches the stored run", async ({
  browser,
}) => {
  const page = await (await contextAs(browser, CAST.investor)).newPage();
  await page.goto("/home?new=1");
  await useScript(DISCOVER_FINTECH_RULES);
  await vendorSettled();
  const before = (await newestRun(CAST.investor))?.runId ?? null;
  const mark = await vendorMark();
  const started = Date.now();
  await send(page, ASK);
  const first = page.locator("[data-ac-cards] [data-ac-card]").first();
  await expect(first).toBeVisible({ timeout: 90_000 });
  const firstCardMs = Date.now() - started;
  expect
    .soft(firstCardMs, "send → first card (ms)")
    .toBeLessThanOrEqual(BUDGET.discoverFirstCardBrowserMs);
  const dom = await page
    .locator("[data-ac-cards] [data-ac-card]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-ac-card") ?? ""),
    );
  const run = await nextSettledRun(CAST.investor, before);
  const ids = cardCompanyIds(run);
  expect.soft(dom.length, "rendered cards = stored cards").toBe(ids.length);
  expect.soft(ids.length).toBeLessThanOrEqual(3);
  const calls = await modelCallsSince(mark);
  expect
    .soft(calls.analyst, `analyst calls (${calls.tasks.join(", ")})`)
    .toBe(0);
});

/**
 * K1 timing: send → first rendered card, five runs, each in a fresh browser
 * context and a fresh conversation (/home?new=1; a repeat in the same
 * conversation measures a different path). Reports nearest-rank p50/p95
 * as an annotation; asserts the p50 against the provisional budget.
 */
test("K1 timing: send → first card, 5 fresh conversations, p50/p95", async ({
  browser,
}) => {
  test.setTimeout(600_000);
  const samples: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const context = await contextAs(browser, CAST.investor);
    const page = await context.newPage();
    await page.goto("/home?new=1");
    await useScript(DISCOVER_FINTECH_RULES);
    await vendorSettled();
    const started = Date.now();
    await send(page, ASK);
    await expect(
      page.locator("[data-ac-cards] [data-ac-card]").first(),
    ).toBeVisible({ timeout: 90_000 });
    samples.push(Date.now() - started);
    await context.close();
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = (p: number) =>
    sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] ?? Number.NaN;
  const line = `samples ${samples.join(", ")}; p50 ${String(rank(0.5))}; p95 ${String(rank(0.95))}`;
  test.info().annotations.push({ type: "k1-first-card-ms", description: line });
  console.log(`K1 first card ms: ${line}`);
  expect
    .soft(rank(0.5), "p50 send → first card (ms)")
    .toBeLessThanOrEqual(BUDGET.discoverFirstCardBrowserMs);
});
