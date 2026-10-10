import { expect, test } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { call } from "../support/http.js";
import {
  answerText,
  cardCompanyIds,
  cardNames,
  declaredFintech,
  discoverReading,
  modelCallsSince,
  newestRun,
  nextSettledRun,
} from "../support/knowledge.js";
import { send } from "../support/q.js";
import {
  answer,
  useScript,
  vendorMark,
  vendorRequestsSince,
  vendorSettled,
} from "../support/script.js";
import { CAST } from "../support/stack.js";
import {
  READ_QUESTION,
  SKIM_OTHER,
  escapeRegex,
  skimDiscover,
} from "./journey-fixtures.js";

/**
 * Journey D, discovery and memory. "Show me three fintech companies"
 * returns exactly three distinct cards the investor may open, all from the
 * database's declared fintech set; the person leaves the page and comes
 * back; "tell me about the second one" is answered about card 2 from the
 * conversation, with no second discovery (counted in the fake vendor's
 * log: no discovery reading, no analyst tool round for companies).
 */
const ASK = "Show me three fintech companies";
const SECOND = "tell me about the second one";

test("D three fintech cards, away and back, 'the second one' is card 2 with no new discovery", async ({
  browser,
}) => {
  const eligible = declaredFintech();
  expect(
    eligible.length,
    "the seed declares at least three fintech companies",
  ).toBeGreaterThanOrEqual(3);
  const page = await (await contextAs(browser, CAST.investor)).newPage();
  await page.goto("/home");
  await useScript([
    skimDiscover(ASK, 3, ["fintech"]),
    discoverReading(ASK, 3, ["fintech"]),
  ]);
  await vendorSettled();
  const before = (await newestRun(CAST.investor))?.runId ?? null;
  // Typed like K1: the cards render on the Q stage, not in the Chat view.
  await send(page, ASK);
  const cards = page.locator("[data-ac-cards] [data-ac-card]");
  await expect(cards.first()).toBeVisible({ timeout: 90_000 });
  const run = await nextSettledRun(CAST.investor, before);
  const ids = cardCompanyIds(run);
  const names = cardNames(run);

  // Exactly three, distinct, declared fintech, each one the investor may open.
  expect(ids, "three distinct cards").toHaveLength(3);
  expect.soft(await cards.count(), "rendered cards = stored cards").toBe(3);
  for (const id of ids) {
    expect
      .soft(eligible, `card ${id} is declared fintech in the DB`)
      .toContain(id);
    const profile = await call(
      CAST.investor,
      "api",
      "GET",
      `/v1/companies/${id}/profile`,
    );
    expect
      .soft(profile.status, `card ${id} is the investor's to open`)
      .toBe(200);
  }
  const domIds = await cards.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute("data-ac-card") ?? ""),
  );
  const second = ids[1] ?? "";
  const secondName = names.get(second) ?? "";
  expect(secondName.length, "card 2 has a name").toBeGreaterThan(0);
  if (domIds.every((value) => /^[0-9a-f-]{36}$/u.test(value)))
    expect.soft(domIds, "screen order = stored order").toEqual(ids);
  await expect.soft(cards.nth(1)).toContainText(secondName);

  // Away and back.
  await page.goto("/discover");
  await page.goto("/home");

  // Q answers about card 2 only if the product resolved "the second one" to
  // it: the rule matches card 2's name in what the model was shown.
  const named = escapeRegex(secondName);
  await useScript([
    SKIM_OTHER,
    READ_QUESTION,
    {
      name: "d-second-user",
      when: {
        task: "COMPANY_ANALYST",
        user: `${named}[\\s\\S]*second one|second one[\\s\\S]*${named}`,
      },
      reply: answer(`${secondName} is the second company I showed you.`),
    },
    {
      name: "d-second-instructions",
      when: { task: "COMPANY_ANALYST", instructions: named },
      reply: answer(`${secondName} is the second company I showed you.`),
    },
  ]);
  await vendorSettled();
  const mark = await vendorMark();
  await send(page, SECOND);
  const followUp = await nextSettledRun(CAST.investor, run.runId);
  const calls = await modelCallsSince(mark);
  const seen = await vendorRequestsSince(mark);
  console.log(
    `D follow-up: rules ${JSON.stringify(seen.map((r) => r.rule))} answer ${JSON.stringify(answerText(followUp).slice(0, 300))}`,
  );

  // What Q said, as the server stored it for this turn.
  const said = answerText(followUp);
  expect.soft(said, "Q names card 2").toContain(secondName);
  for (const other of ids.filter((id) => id !== second)) {
    const otherName = names.get(other) ?? "";
    // The shared local database holds several companies named alike (other
    // suites' fixtures, e.g. eight "Atoll Pay"); a namesake proves nothing.
    if (otherName !== "" && otherName !== secondName)
      expect.soft(said).not.toContain(otherName);
  }
  // Q opened card 2's own page, not a namesake's.
  if (/opening their page/iu.test(said))
    await expect.soft(page).toHaveURL(new RegExp(second, "u"), {
      timeout: 30_000,
    });
  expect
    .soft(
      seen.filter(
        (r) => r.rule === "skim-discover" || r.rule === "reader-discover",
      ).length,
      "no discovery reading for the follow-up",
    )
    .toBe(0);
  expect
    .soft(
      calls.tasks.filter(
        (task) => task === "TURN_SKIM" || task === "TURN_READER",
      ).length,
      `at most the two small reads (${calls.tasks.join(", ")})`,
    )
    .toBeLessThanOrEqual(2);
  expect
    .soft(calls.analyst, "one analyst call, no tool round")
    .toBeLessThanOrEqual(1);
  expect
    .soft(
      seen.some(
        (r) =>
          (r.input ?? "").includes(secondName) ||
          (r.input ?? "").includes(second),
      ),
      "the model was shown card 2",
    )
    .toBe(true);
  const newCards = cardCompanyIds(followUp);
  expect
    .soft(
      newCards.filter((id) => id !== second),
      "no new discovery cards",
    )
    .toEqual([]);
  await page.context().close();
});
