import { expect, test, type Page } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { send } from "../support/q.js";
import { answer, useScript } from "../support/script.js";
import { CAST, world } from "../support/stack.js";

/**
 * C7 fast navigation ("stupid fast", founder 2026-10-09), end to end in
 * Chromium. The browser reports, for each early move, the time from the
 * final words to router.push (`cq:fast-navigation` detail.ms). Every
 * history.pushState is counted, so a second move for the same sentence
 * (Q's answer following the early move) shows as a second push.
 */
const company = world().company("ledgerfold");

type Seen = { fast: { path: string; ms: number }[]; pushes: string[] };

async function watch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const seen = { fast: [], pushes: [] } as {
      fast: unknown[];
      pushes: string[];
    };
    (window as unknown as { __cqSeen: typeof seen }).__cqSeen = seen;
    window.addEventListener("cq:fast-navigation", (event) => {
      seen.fast.push((event as CustomEvent).detail);
    });
    const push = history.pushState.bind(history);
    history.pushState = (data, unused, url) => {
      if (url !== undefined && url !== null) seen.pushes.push(String(url));
      push(data, unused, url);
    };
  });
}

function seen(page: Page): Promise<Seen> {
  return page.evaluate(
    () => (window as unknown as { __cqSeen: Seen }).__cqSeen,
  );
}

function pushesTo(all: Seen, path: string): number {
  return all.pushes.filter((url) => new URL(url, "http://x").pathname === path)
    .length;
}

const READER = {
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
};

test("a page by name moves once, fast, and Q's answer does not move again", async ({
  browser,
}) => {
  const page = await (await contextAs(browser, CAST.investor)).newPage();
  await watch(page);
  await useScript([READER]);
  await page.goto("/home");
  // Warm: the dev server compiles /discover once, outside the measurement.
  await page.request.get("/discover");
  await send(page, "open discover");
  await expect(page).toHaveURL(/\/discover/u, { timeout: 30_000 });
  // Q's answer to the same sentence has time to arrive and (not) move.
  await page.waitForTimeout(8_000);
  const all = await seen(page);
  console.log(
    `FAST page: ${JSON.stringify(all.fast)} pushes=${JSON.stringify(all.pushes)}`,
  );
  expect(all.fast).toHaveLength(1);
  expect(all.fast[0]?.path).toBe("/discover");
  expect(pushesTo(all, "/discover")).toBe(1);
});

test("a named record moves once, fast, and Q's open_page does not move again", async ({
  browser,
}) => {
  const say = `Take me to ${company.name} relationship`;
  const route = `/relationships/company/${company.companyId}`;
  const page = await (await contextAs(browser, CAST.investor)).newPage();
  await watch(page);
  await useScript([
    READER,
    {
      name: "open",
      when: { task: "COMPANY_ANALYST", user: say, afterTool: null },
      reply: {
        toolCalls: [
          {
            name: "open_page",
            arguments: { page: "RELATIONSHIP_COMPANY", name: company.name },
          },
        ],
      },
    },
    {
      name: "after-open",
      when: { task: "COMPANY_ANALYST", afterTool: "open_page" },
      reply: answer(`Here is ${company.name}.`),
    },
  ]);
  await page.goto("/home");
  await page.request.get(route);
  await send(page, say);
  await expect(page).toHaveURL(new RegExp(route, "u"), { timeout: 30_000 });
  await page.waitForTimeout(8_000);
  const all = await seen(page);
  console.log(
    `FAST record: ${JSON.stringify(all.fast)} pushes=${JSON.stringify(all.pushes)}`,
  );
  expect(all.fast).toHaveLength(1);
  expect(pushesTo(all, route)).toBe(1);
});

test("'open discover no wait' never moves", async ({ browser }) => {
  const page = await (await contextAs(browser, CAST.investor)).newPage();
  await watch(page);
  await useScript([READER]);
  await page.goto("/home");
  await send(page, "open discover no wait");
  await page.waitForTimeout(8_000);
  const all = await seen(page);
  console.log(`FAST taken back: ${JSON.stringify(all)}`);
  expect(all.fast).toEqual([]);
  expect(pushesTo(all, "/discover")).toBe(0);
  expect(new URL(page.url()).pathname).not.toBe("/discover");
});
