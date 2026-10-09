import { expect, test } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { awaits } from "../support/expected-red.js";
import { navigationReceipts, recordReceipts, send } from "../support/q.js";
import { answer, useScript } from "../support/script.js";
import { CAST, world } from "../support/stack.js";

/**
 * C's named-record navigation (INC-1 follow-up, the "Shiftwell" scenario).
 * Shiftwell lives in the hosted synthetic data, not in the local fictional
 * world, so locally the same three asks are made about a seeded company the
 * investor has a relationship with (Savanna Seed ↔ Ledgerfold, ACCEPTED).
 * CQ_RECOVERY_NAMED_COMPANY switches the name for a world that has it.
 *
 * Each ask must land on the right route (URL + page heading), and the
 * browser must report a DONE navigation receipt that q-api accepted
 * (POST /api/q-ui-acts → /v1/q/ui-act-receipts, response `accepted` ≥ 1).
 */
const KEY = process.env["CQ_RECOVERY_NAMED_COMPANY_KEY"] ?? "ledgerfold";
const company = world().company(KEY);
const NAME = process.env["CQ_RECOVERY_NAMED_COMPANY"] ?? company.name;

const ASKS = [
  {
    say: `Take me to ${NAME} relationship`,
    page: "RELATIONSHIP_COMPANY",
    route: new RegExp(`/relationships/company/${company.companyId}`, "u"),
  },
  {
    say: `Open ${NAME}`,
    page: "COMPANY",
    route: new RegExp(`/company/${company.companyId}`, "u"),
  },
  {
    say: `Show me the data room for ${NAME}`,
    page: "COMPANY_DATA_ROOM",
    route: new RegExp(`/company/${company.companyId}.*data-?room`, "iu"),
  },
] as const;

for (const ask of ASKS) {
  test(`"${ask.say}" lands on the right page with a DONE navigation receipt`, async ({
    browser,
  }) => {
    const page = await (await contextAs(browser, CAST.investor)).newPage();
    await recordReceipts(page);
    await useScript([
      {
        name: "reader",
        when: { task: "TURN_READER" },
        reply: {
          json: {
            kind: "QUESTION_TO_Q",
            confidence: "HIGH",
            transcript: "CLEAR",
            question: null,
            aboutNamedOther: true,
          },
        },
      },
      {
        name: "open",
        when: {
          task: "COMPANY_ANALYST",
          user: ask.say.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"),
          afterTool: null,
        },
        reply: {
          toolCalls: [
            { name: "open_page", arguments: { page: ask.page, name: NAME } },
          ],
        },
      },
      {
        name: "after-open",
        when: { task: "COMPANY_ANALYST", afterTool: "open_page" },
        reply: answer(`Here is ${NAME}.`),
      },
    ]);
    await page.goto("/home");
    await send(page, ask.say);
    await expect(page).toHaveURL(ask.route, { timeout: 60_000 });
    await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(
      NAME,
    );
    if (ask.page === "COMPANY_DATA_ROOM") {
      // The profile tab bar is links marked aria-current="page", not role=tab
      // (apps/web/src/features/company/profile-tabs.tsx:177).
      await expect(
        page.locator('[data-profile-tab="dataroom"]'),
      ).toHaveAttribute("aria-current", "page");
    }
    // Server side: a DONE navigation receipt for this route, accepted by q-api.
    const done = () =>
      navigationReceipts(page).navigations.some(
        (n) => n.status === "DONE" && ask.route.test(n.route ?? ""),
      );
    for (let i = 0; i < 40 && !done(); i += 1) await page.waitForTimeout(500);
    // The message names what WAS reported, so a miss is diagnosable.
    expect(
      done(),
      `a DONE navigation receipt for ${String(ask.route)}; seen ${JSON.stringify(navigationReceipts(page))}`,
    ).toBe(true);
    await expect
      .poll(() => Math.max(0, ...navigationReceipts(page).accepted), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
  });
}

test("a name that matches nothing is not navigated and not claimed", async ({
  browser,
}) => {
  awaits(
    ["C"],
    "NOT_AVAILABLE must produce a FAILED or no navigation, and Q must not say it opened it",
  );
  const page = await (await contextAs(browser, CAST.investor)).newPage();
  await recordReceipts(page);
  await useScript([
    {
      name: "open-missing",
      when: {
        task: "COMPANY_ANALYST",
        user: "Open Nonexistent Holdings",
        afterTool: null,
      },
      reply: {
        toolCalls: [
          {
            name: "open_page",
            arguments: { page: "COMPANY", name: "Nonexistent Holdings" },
          },
        ],
      },
    },
    {
      name: "after",
      when: { task: "COMPANY_ANALYST", afterTool: "open_page" },
      reply: answer("Here it is."),
    },
  ]);
  await page.goto("/home");
  await send(page, "Open Nonexistent Holdings");
  await page.waitForTimeout(8_000);
  await expect(page).toHaveURL(/\/home/u);
  expect(
    navigationReceipts(page).navigations.filter((n) => n.status === "DONE"),
  ).toEqual([]);
  await expect(page.getByText("Here it is.")).toHaveCount(0);
});
