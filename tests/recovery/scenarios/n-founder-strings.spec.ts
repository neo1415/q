import { expect, test, type Page } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { send, settledAnswers } from "../support/q.js";
import { answer, reading, useScript } from "../support/script.js";
import { CAST, world } from "../support/stack.js";

/**
 * The founder's live GPT-Live session, 2026-10-09 14:35-14:47 (Zino), word
 * for word, typed into Q on the local stack. The turn reader is scripted to
 * make the same wrong reading it made live (a move to a page the words do
 * not ask for); the product must not move. Every pushState is counted.
 */
const company = world().company("ledgerfold");

async function countPushes(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const pushes: string[] = [];
    (window as unknown as { __cqPushes: string[] }).__cqPushes = pushes;
    const push = history.pushState.bind(history);
    history.pushState = (data, unused, url) => {
      if (url !== undefined && url !== null) pushes.push(String(url));
      push(data, unused, url);
    };
  });
}

function pushes(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __cqPushes: string[] }).__cqPushes,
  );
}

const WRONG_MOVES = [
  {
    say: "I can't really see anything, so you're not I guess that's fi",
    destination: "DISCOVER",
  },
  {
    say: "So no, no, you're alright. I'm on Ledgerfold's page, but I",
    destination: "DISCOVER",
  },
  {
    say: "Is there a Ledgerfold rehearsal here I can open",
    destination: "RELATIONSHIPS",
  },
] as const;

for (const wrong of WRONG_MOVES) {
  test(`"${wrong.say}" never moves the screen`, async ({ browser }) => {
    const page = await (await contextAs(browser, CAST.investor)).newPage();
    await countPushes(page);
    await useScript([
      reading("TOOL_REQUEST", {
        tool: {
          kind: "NAVIGATE",
          destination: wrong.destination,
          visibility: null,
        },
      }),
      {
        name: "plain-answer",
        when: { task: "COMPANY_ANALYST" },
        reply: answer("Understood."),
      },
    ]);
    await page.goto("/home");
    await send(page, wrong.say);
    await page.waitForTimeout(10_000);
    const moved = await pushes(page);
    console.log(
      `FOUNDER ${JSON.stringify(wrong.say)} pushes=${JSON.stringify(moved)}`,
    );
    expect(moved).toEqual([]);
    expect(new URL(page.url()).pathname).toBe("/home");
  });
}

test("'Okay, let me do a quick rehearsal with these people' still opens Rehearsals", async ({
  browser,
}) => {
  const page = await (await contextAs(browser, CAST.investor)).newPage();
  await useScript([
    reading("TOOL_REQUEST", {
      tool: { kind: "NAVIGATE", destination: "REHEARSALS", visibility: null },
    }),
  ]);
  await page.goto("/home");
  await send(page, "Okay, let me do a quick rehearsal with these people");
  await expect(page).toHaveURL(/\/rehearsals/u, { timeout: 30_000 });
});

test("a garbled name is never quoted back as a name", async ({ browser }) => {
  const page = await (await contextAs(browser, CAST.investor)).newPage();
  await useScript([
    reading("QUESTION_TO_Q", { aboutNamedOther: true }),
    {
      name: "plain-answer",
      when: { task: "COMPANY_ANALYST" },
      reply: answer("Which page would you like?"),
    },
  ]);
  await page.goto("/home");
  await send(page, "Take me to the relationship where I can review it then");
  await page.waitForTimeout(10_000);
  const said = (await settledAnswers(page).allInnerTexts()).join(" ");
  console.log(`FOUNDER garbled answer=${JSON.stringify(said.slice(0, 200))}`);
  expect(said).not.toMatch(/can't find "where I can review it then"/u);
});

test(`"${company.name.slice(0, 6)} ${company.name.slice(6)}" (spaced) opens ${company.name} at once`, async ({
  browser,
}) => {
  const spaced = `${company.name.slice(0, 6)} ${company.name.slice(6)}`;
  const page = await (await contextAs(browser, CAST.investor)).newPage();
  await countPushes(page);
  await useScript([reading("QUESTION_TO_Q", { aboutNamedOther: true })]);
  await page.goto("/home");
  await send(page, `Okay, take me to ${spaced} relationship.`);
  await expect(page).toHaveURL(
    new RegExp(`/relationships/company/${company.companyId}`, "u"),
    { timeout: 30_000 },
  );
  await page.waitForTimeout(6_000);
  const moved = await pushes(page);
  console.log(`FOUNDER spaced pushes=${JSON.stringify(moved)}`);
  expect(moved.filter((url) => url.includes(company.companyId))).toHaveLength(
    1,
  );
});
