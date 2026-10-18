import { expect, test } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import {
  BUDGET,
  answerText,
  modelCallsSince,
  newestRun,
  nextSettledRun,
  serverMs,
  type RunView,
} from "../support/knowledge.js";
import { send } from "../support/q.js";
import {
  answer,
  useScript,
  vendorMark,
  vendorSettled,
} from "../support/script.js";
import { CAST, world } from "../support/stack.js";

/**
 * K Test 3: the current page (C Part 5). On a company's page, "here" and
 * "this company" mean that company: the run is about it (server subjects),
 * the model's context carries it (fake vendor log), and Q does not ask
 * which company. The page's entity is prefetched on navigation, so the
 * turn stays inside the analyst budget. Green on e4565008 (C's page
 * context already holds), so it is a regression guard, not expected red.
 */
test("K3 'this company' on a company page is that company, without asking", async ({
  browser,
}) => {
  const company = world().company("ledgerfold");
  const page = await (await contextAs(browser, CAST.investor)).newPage();
  await page.goto(`/company/${company.companyId}`);
  await expect(page.locator("h1").first()).toContainText(company.name, {
    timeout: 30_000,
  });
  await useScript([
    {
      name: "page-answer",
      when: { task: "COMPANY_ANALYST", user: "risk" },
      reply: answer(
        "The biggest open risk is the evidence behind its collections rate.",
      ),
    },
  ]);
  await vendorSettled();
  const before = (await newestRun(CAST.investor))?.runId ?? null;
  const mark = await vendorMark();
  await send(page, "What is the biggest risk with this company?");
  const run: RunView & { subjects?: unknown } = await nextSettledRun(
    CAST.investor,
    before,
  );
  expect
    .soft(
      JSON.stringify(run.subjects ?? null),
      "the run is about the page's company",
    )
    .toContain(company.companyId);
  const calls = await modelCallsSince(mark);
  const analyst = calls.requests.filter((r) =>
    /TASK: COMPANY_ANALYST\b/u.test(r.input ?? ""),
  );
  expect
    .soft(analyst.length, `analyst reached (${calls.tasks.join(", ")})`)
    .toBeGreaterThan(0);
  expect
    .soft(
      analyst.some((r) => (r.input ?? "").includes(company.name)),
      "the model's context names the page's company",
    )
    .toBe(true);
  expect
    .soft(answerText(run), "Q does not ask which company")
    .not.toMatch(/which company/iu);
  expect
    .soft(serverMs(run) ?? Infinity, "server ms")
    .toBeLessThanOrEqual(BUDGET.analystServerMs);
});
