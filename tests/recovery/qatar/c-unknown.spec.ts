import { randomBytes } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { useScript } from "../support/script.js";
import { CAST } from "../support/stack.js";
import { READ_QUESTION } from "../journeys/journey-fixtures.js";
import {
  cards,
  clearSearch,
  fakeMark,
  identityCard,
  latestQText,
  logMark,
  measure,
  quiet,
  requireQatarStack,
  scriptSearch,
  searchCallsSince,
  sendTimed,
  skimPerson,
  threadText,
  waitForLog,
} from "./kit.js";

/**
 * C. People who are NOT prepared. The general path (bounded parallel public
 * search) must work and say it is cold; an ambiguous name must show several
 * candidates and ask one question, never merging two people into one card.
 *
 * The index is FAKE: scripts/recovery/fake-vendors.mjs answers the people
 * search from the rules below and logs every call. Names carry a random
 * suffix so a re-run is not served from q-api's short search cache.
 * LOCAL+MOCK.
 */
const suffix = () =>
  [...randomBytes(4)].map((b) => "bcdfghklmnprstvz"[b % 16]).join("");

const COLD_NAME = `Ifeoma Okafor${suffix()}`;
const AMBIG_NAME = `Chidi Adeyemi${suffix()}`;
const slug = (name: string, tail: string) =>
  `${name.toLowerCase().replace(/[^a-z]+/gu, "-")}-${tail}`;

let context: BrowserContext;
let page: Page;

test.beforeAll(async ({ browser }) => {
  requireQatarStack();
  context = await contextAs(browser, CAST.founder);
  page = await context.newPage();
  await page.goto("/home");
});

test.afterAll(async () => {
  await clearSearch();
  await context?.close();
});

test("C1 an unknown person is found by the general search path and labelled as searched, not prepared", async () => {
  await scriptSearch([
    {
      name: "cold-profile",
      q: COLD_NAME,
      organic: [
        {
          link: `https://ng.linkedin.com/in/${slug(COLD_NAME, "7a1b22")}`,
          title: `${COLD_NAME} - Managing Partner - Lagos Angel Network | LinkedIn`,
          snippet: `Lagos, Nigeria · ${COLD_NAME} leads early-stage investing at Lagos Angel Network. Location: Lagos, Nigeria`,
        },
        {
          link: "https://www.lagosangelnetwork.example/team",
          title: `Our team - Lagos Angel Network`,
          snippet: `${COLD_NAME}, Managing Partner, Lagos Angel Network, Lagos.`,
        },
      ],
    },
  ]);
  const words = `Find ${COLD_NAME} at Lagos Angel Network in Lagos, Nigeria`;
  await useScript([
    skimPerson(words, {
      name: COLD_NAME,
      city: "Lagos",
      country: "Nigeria",
      organization: "Lagos Angel Network",
    }),
    READ_QUESTION,
  ]);
  await page.goto("/home");
  await quiet(1_500);
  const mark = await fakeMark();
  const log = logMark();
  const started = await sendTimed(page, words);
  const card = await identityCard(
    page,
    new RegExp(COLD_NAME.split(" ")[0] ?? COLD_NAME, "u"),
    started,
    60_000,
  );
  measure("C1 cold search send->card", card.ms);
  const [line] = await waitForLog(log, "q answered a person search", 1, 30_000);
  expect(line?.["outcome"]).toBe("MATCHED");
  expect(line?.["source"], "searched now, not the prepared index").toBe("WEB");
  expect(line?.["modelCalls"], "still no model writing the card").toBe(0);
  measure("C1 cold search q-api searchMs", Number(line?.["searchMs"]));

  const calls = await searchCallsSince(mark);
  expect(calls.length, "the general path really searched").toBeGreaterThan(0);
  // Only the member's own words leave: the name, the clues they gave.
  for (const call of calls) {
    expect(
      (call.q ?? "").toLowerCase(),
      "the query names the person",
    ).toContain(COLD_NAME.toLowerCase());
    expect(
      call.q ?? "",
      "no private company detail in an outgoing query",
    ).not.toMatch(/Ledgerfold|Capital Q|mandate|runway/iu);
  }
  // Labelled cold: reported, search-indexed, and not 'prepared'.
  expect(card.text).not.toMatch(/Prepared from public sources/u);
  await expect
    .poll(async () => latestQText(page), { timeout: 20_000 })
    .toMatch(/search-indexed|not independently confirmed|reportedly/iu);
  expect(await latestQText(page)).not.toMatch(/\bis verified\b/iu);
});

test("C2 an ambiguous name shows the candidates and asks one question, never merged", async () => {
  await scriptSearch([
    {
      name: "ambiguous-two",
      q: AMBIG_NAME,
      organic: [
        {
          link: `https://ng.linkedin.com/in/${slug(AMBIG_NAME, "a11")}`,
          title: `${AMBIG_NAME} - Partner - Alpha Capital Partners | LinkedIn`,
          snippet: `Lagos, Nigeria · Location: Lagos, Nigeria · Alpha Capital Partners`,
        },
        {
          link: `https://ng.linkedin.com/in/${slug(AMBIG_NAME, "b22")}`,
          title: `${AMBIG_NAME} - Chief Executive - Beta Foods | LinkedIn`,
          snippet: `Abuja, Nigeria · Location: Abuja, Nigeria · Beta Foods`,
        },
      ],
    },
  ]);
  const words = `Find ${AMBIG_NAME}`;
  await useScript([skimPerson(words, { name: AMBIG_NAME }), READ_QUESTION]);
  await page.goto("/home");
  await quiet(1_500);
  const log = logMark();
  const started = await sendTimed(page, words);
  const set = page.getByLabel("Which one?");
  await expect(set).toBeVisible({ timeout: 60_000 });
  measure("C2 ambiguous send->candidates", Date.now() - started);
  const [line] = await waitForLog(log, "q answered a person search", 1, 30_000);
  expect(line?.["outcome"]).toBe("AMBIGUOUS");
  expect(
    Number(line?.["candidates"]),
    "several candidates",
  ).toBeGreaterThanOrEqual(2);
  const shown = set.locator("[data-ac-card]");
  console.log(`C2 candidate cards rendered: ${String(await shown.count())}`);
  expect(
    await latestQText(page),
    "both candidates are named in the question",
  ).toMatch(/Alpha Capital[\s\S]*Beta Foods/u);
  expect(await latestQText(page), "Q asks a clarifying question").toContain(
    "?",
  );
  await expect(page.getByLabel("Who I found")).toHaveCount(0);
});

test("C3 the clarification picks one person; the other is not blended in", async () => {
  const words = `the one in Abuja`;
  await useScript([
    skimPerson(words, { name: AMBIG_NAME, city: "Abuja" }),
    READ_QUESTION,
  ]);
  await quiet(1_500);
  const log = logMark();
  const started = await sendTimed(page, words);
  const card = await identityCard(page, /Beta Foods/u, started, 60_000);
  const [line] = await waitForLog(log, "q answered a person search", 1, 30_000);
  expect(line?.["outcome"]).toBe("MATCHED");
  expect(card.text).not.toMatch(/Alpha Capital/u);
  expect(
    await cards(page)
      .filter({ hasText: /Beta Foods/u })
      .count(),
  ).toBeGreaterThan(0);
  expect(await threadText(page)).toContain("Abuja");
});
