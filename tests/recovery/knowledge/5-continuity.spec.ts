import { expect, test } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { awaits } from "../support/expected-red.js";
import {
  answerText,
  READ_DISCOVER_FINTECH,
  cardCompanyIds,
  cardNames,
  modelCallsSince,
  newestRun,
  nextSettledRun,
} from "../support/knowledge.js";
import { send } from "../support/q.js";
import {
  answer,
  useScript,
  vendorMark,
  vendorSettled,
} from "../support/script.js";
import { CAST } from "../support/stack.js";

/**
 * K Test 5: context continuity across navigation (C Part 5: clickable
 * cards, references across navigation). One conversation follows the
 * person: cards from "three fintech companies" open the company, "they"
 * then means that company, and "the first two you showed me" still
 * resolves on another page. Server state: the same conversation id, and
 * the model's context names the right companies.
 */
test("K5 references survive navigation in one conversation", async ({
  browser,
}) => {
  awaits(
    ["C Part 5", "B Part 1"],
    "cards are not navigable references yet; and no discovery fast path",
  );
  const page = await (await contextAs(browser, CAST.investor)).newPage();
  await useScript([
    READ_DISCOVER_FINTECH,
    {
      name: "they",
      when: { task: "COMPANY_ANALYST", user: "raising" },
      reply: answer("Here is what they have shared about the raise."),
    },
    {
      name: "compare",
      when: { task: "COMPANY_ANALYST", user: "compare" },
      reply: answer("Side by side, on what each has shared."),
    },
  ]);
  await page.goto("/home");
  const start = (await newestRun(CAST.investor))?.runId ?? null;
  await send(page, "Show me three fintech companies");
  const cards = page.locator("[data-ac-cards] [data-ac-card]");
  await expect(cards.first()).toBeVisible({ timeout: 90_000 });
  const listed = await nextSettledRun(CAST.investor, start);
  const ids = cardCompanyIds(listed);
  const names = cardNames(listed);
  expect(ids.length, "cards to refer back to").toBeGreaterThanOrEqual(2);
  const firstId = ids[0] ?? "";
  const conversation = listed.conversationId;

  // 1. The card opens its company.
  await cards.first().click();
  await expect(page, "the first card opens its company").toHaveURL(
    new RegExp(`/company/${firstId}`, "u"),
    { timeout: 30_000 },
  );

  // 2. "they" on that page is that company, in the same conversation.
  await vendorSettled();
  let mark = await vendorMark();
  await send(page, "How much are they raising?");
  const they = await nextSettledRun(CAST.investor, listed.runId);
  expect
    .soft(they.conversationId, "same conversation after navigating")
    .toBe(conversation);
  const firstName = names.get(firstId) ?? firstId;
  let calls = await modelCallsSince(mark);
  expect
    .soft(
      calls.requests.some(
        (r) =>
          /TASK: COMPANY_ANALYST\b/u.test(r.input ?? "") &&
          (r.input ?? "").includes(firstName),
      ),
      `"they" = ${firstName} in the model's context`,
    )
    .toBe(true);
  expect.soft(answerText(they)).not.toMatch(/which company/iu);

  // 3. On another page, "the first two you showed me" still resolves.
  await page.goto("/discover");
  await vendorSettled();
  mark = await vendorMark();
  await send(page, "Compare the first two companies you showed me");
  const compare = await nextSettledRun(CAST.investor, they.runId);
  expect
    .soft(compare.conversationId, "still the same conversation")
    .toBe(conversation);
  calls = await modelCallsSince(mark);
  const secondName = names.get(ids[1] ?? "") ?? String(ids[1]);
  const context = calls.requests.map((r) => r.input ?? "").join("\n");
  expect.soft(context, "first company in context").toContain(firstName);
  expect.soft(context, "second company in context").toContain(secondName);
  expect.soft(answerText(compare)).not.toMatch(/which (two|companies)/iu);
});
