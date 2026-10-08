import { expect, test } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { awaits } from "../support/expected-red.js";
import { ask, expectLastTurnTerminal } from "../support/q.js";
import {
  answer,
  useScript,
  vendorMark,
  vendorRequestsSince,
} from "../support/script.js";
import { CAST } from "../support/stack.js";

/**
 * SPEC §5 Scenario F: "anything that needs my attention?" reads every
 * source (QAttentionReport), and a source that was not read is reported as
 * unread, never as "nothing" (SPEC §4.4; audit L-01, where an investor
 * waited while Q said nothing was waiting).
 *
 * The seed gives Ledgerfold's founder an ACCEPTED relationship with Savanna
 * Seed and PENDING interest from others, so "nothing" is false.
 */
test("Scenario F: what needs my attention names what is waiting, from the attention report", async ({
  browser,
}) => {
  awaits(["B1", "E1", "G-R4"], "the attention tool and its report are B1");
  const context = await contextAs(browser, CAST.founder);
  const page = await context.newPage();
  await page.goto("/home");
  const mark = await vendorMark();
  await useScript([
    {
      name: "attention",
      when: { user: "needs my attention", afterTool: null },
      reply: { toolCalls: [{ name: "read_attention", arguments: {} }] },
    },
    {
      name: "after-attention",
      when: { afterTool: "read_attention" },
      reply: answer("Two things need you."),
    },
  ]);
  await ask(page, "Is there anything that needs my attention?");
  const seen = await vendorRequestsSince(mark);
  // The model was offered the attention tool, and its report reached it.
  expect(
    seen.some((request) =>
      (request.tools ?? []).some((tool) => /attention/u.test(tool)),
    ),
  ).toBe(true);
  const reportText = seen.map((request) => request.input ?? "").join("\n");
  expect(reportText).toMatch(/"unread":\s*\[/u);
  // The interest waiting on the founder is named.
  expect(reportText).toMatch(/INTEREST_REQUEST|UNANSWERED_MESSAGE/u);
  await expectLastTurnTerminal(page, ["ANSWERED"]);
  await context.close();
});

test("L-01 regression: a model that says 'nothing' cannot hide what the report holds", async ({
  browser,
}) => {
  awaits(
    ["B1", "E1", "G-R4"],
    "attention items rendered from the report (not from the model's prose) are B1/E1",
  );
  const context = await contextAs(browser, CAST.founder);
  const page = await context.newPage();
  await page.goto("/home");
  // The model's words are wrong on purpose. The items come from the report,
  // which code builds from the database, so they still show.
  await useScript([
    {
      name: "nothing",
      when: { user: "needs my attention" },
      reply: answer("Nothing is waiting for you."),
    },
  ]);
  await ask(page, "Anything that needs my attention?");
  await expect(page.locator("[data-q-attention-item]").first()).toBeVisible();
  await context.close();
});
