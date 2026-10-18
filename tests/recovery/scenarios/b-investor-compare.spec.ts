import { expect, test } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { awaits } from "../support/expected-red.js";
import {
  ask,
  expectLastTurnTerminal,
  expectReceipt,
  operateScreen,
  recordReceipts,
} from "../support/q.js";
import {
  answer,
  useScript,
  vendorMark,
  vendorRequestsSince,
} from "../support/script.js";
import { CAST } from "../support/stack.js";

/**
 * SPEC §5 Scenario B (investor profile and comparison): a founder on
 * Discover's investors list opens the second investor, selects the mandate
 * tab, and asks Q to compare it with the first. The comparison must come
 * from the two investors actually on screen, and every figure in it must
 * be one the model was given (no invented numbers, SPEC §4.8).
 */
test("Scenario B: investors list, open the second, mandate tab, compare", async ({
  browser,
}) => {
  awaits(
    ["C1", "C2", "C3", "E4", "B6", "G-R1"],
    "list.investors / tab.mandate controls, investor cards and comparison are not in the baseline",
  );
  const context = await contextAs(browser, CAST.founder);
  const page = await context.newPage();
  await recordReceipts(page);
  await page.goto("/investors");
  const items = page.locator(
    '[data-q-control="list.investors"] [data-q-control-item]',
  );
  await expect(items.nth(1)).toBeVisible();
  const first = (await items.nth(0).innerText()).split("\n")[0] ?? "";
  const second = (await items.nth(1).innerText()).split("\n")[0] ?? "";

  await useScript([
    {
      name: "open-second",
      when: {
        task: "COMPANY_ANALYST",
        user: "open the second",
        afterTool: null,
      },
      reply: {
        toolCalls: [
          operateScreen("SELECT_ITEM", "list.investors", { index: 2 }),
        ],
      },
    },
    {
      name: "after-open",
      when: {
        task: "COMPANY_ANALYST",
        user: "open the second",
        afterTool: "operate_screen",
      },
      reply: answer(`Here is ${second}.`),
    },
    {
      name: "mandate",
      when: { task: "COMPANY_ANALYST", user: "their mandate", afterTool: null },
      reply: { toolCalls: [operateScreen("SELECT_TAB", "tab.mandate")] },
    },
    {
      name: "after-mandate",
      when: {
        task: "COMPANY_ANALYST",
        user: "their mandate",
        afterTool: "operate_screen",
      },
      reply: answer("This is their mandate."),
    },
    {
      name: "compare",
      when: { task: "COMPANY_ANALYST", user: "compare them with the first" },
      reply: answer(`Comparing ${second} with ${first}.`),
    },
  ]);

  await ask(page, "open the second one");
  await expectReceipt(page, { target: "list.investors", status: "DONE" });
  await expect(page).toHaveURL(/\/investors\/[0-9a-f-]{36}/u);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(second);

  await ask(page, "show me their mandate");
  await expectReceipt(page, { target: "tab.mandate", status: "DONE" });
  await expect(page.getByRole("tab", { name: /Mandate/u })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  const mark = await vendorMark();
  const reply = await ask(page, "compare them with the first");
  const seen = (await vendorRequestsSince(mark))
    .map((request) => request.input ?? "")
    .join("\n");
  expect(seen, "the model was given both investors").toContain(first);
  expect(seen).toContain(second);
  // A comparison renders as a table or investor cards beside Q (E4).
  await expect(
    page
      .locator('[data-q-block="TABLE"], [data-q-block="INVESTOR_CARD"]')
      .first(),
  ).toBeVisible();
  // Every number Q shows was in what it was given.
  for (const figure of (await reply.innerText()).match(/\d[\d,.]*/gu) ?? []) {
    expect(seen, `figure ${figure} came from the data`).toContain(figure);
  }
  await expectLastTurnTerminal(page, ["ANSWERED"]);
  await context.close();
});
