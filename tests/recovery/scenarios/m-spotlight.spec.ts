import { expect, test } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { expectLastTurnTerminal, send } from "../support/q.js";
import { useScript } from "../support/script.js";
import { CAST } from "../support/stack.js";

/**
 * The card spotlight (founder, Dubai demo 2026-10-09), in Chromium on the
 * local stack, $0: the top-three answer is code-built from fits; the
 * follow-up's model call is slowed by the scripted vendor, so the
 * spotlight read here comes from the person naming a company, not from
 * an answer. Asserts the large card and the strip, and that every card
 * is still on screen (INC-1).
 */
const ASK = "What are the top three companies that fit my mandate?";
const READER_QUESTION = {
  name: "reader-question",
  when: { task: "TURN_READER" },
  reply: {
    json: {
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
    },
  },
} as const;
// Slow, never hung: a hung run would hold the shared investor account's
// conversation for the tests after this one.
const SLOW_FOLLOW_UP = {
  name: "slow-follow-up",
  when: { user: "Tell me more about" },
  reply: { text: "[scripted] spotlight follow-up", delayMs: 8_000 },
} as const;

test("naming a company puts it in the spotlight; the others shrink to a strip", async ({
  browser,
}) => {
  await useScript([READER_QUESTION, SLOW_FOLLOW_UP]);
  const page = await (await contextAs(browser, CAST.investor)).newPage();
  await page.goto("/home");
  await send(page, ASK);
  const cards = page.locator("[data-ac-cards] [data-ac-card]");
  await expect(cards).toHaveCount(3, { timeout: 90_000 });
  const keys = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-ac-card") ?? ""),
  );
  const second = keys[1] ?? "";
  const name = (
    (await page
      .locator(`[data-ac-card="${second}"] h3`)
      .first()
      .textContent()) ?? ""
  )
    .replace(/^Number \d+: /u, "")
    .trim();
  expect(name.length).toBeGreaterThan(0);

  await send(page, `Tell me more about ${name}`);
  const layout = page.locator('[data-ac-cards][data-layout="spotlight"]');
  await expect(layout).toHaveAttribute("data-spotlight", second, {
    timeout: 20_000,
  });
  await expect(
    page.locator("[data-ac-spot] [data-ac-spot-label]").first(),
  ).toHaveText("In focus");
  await expect(page.locator("[data-ac-cards] [data-ac-strip]")).toHaveCount(2);
  // Every card still on screen: one large, two small.
  await expect(cards).toHaveCount(3);
  // Leave the account as found: the follow-up ends before the next test.
  await expectLastTurnTerminal(page, undefined, 60_000);
  await useScript([]);
});
