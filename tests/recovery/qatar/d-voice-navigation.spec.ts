import { existsSync, readFileSync } from "node:fs";

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { contextAs } from "../support/auth.js";
import {
  audibleNow,
  emitLive,
  installLiveFake,
  livePeers,
  liveUserSays,
  maxAudible,
} from "../support/live-fake.js";
import { send } from "../support/q.js";
import { answer, reading, useScript } from "../support/script.js";
import { CAST, world } from "../support/stack.js";
import {
  READ_QUESTION,
  SKIM_OTHER,
  moves,
  pathOf,
  startLive,
  watchMoves,
} from "../journeys/journey-fixtures.js";
import { NAV_TIMING_FILE } from "../support/nav-timing.js";
import {
  QATAR_FIVE,
  escape,
  fakeMark,
  fakeSince,
  identityCard,
  measure,
  percentile,
  quiet,
  requireQatarStack,
  sendTimed,
  skimPerson,
  summary,
  type FakeRequest,
} from "./kit.js";

/**
 * D. Navigation by voice and by typing (R3 lifecycle: REQUESTED -> VALIDATED
 * -> EXECUTING -> VERIFIED). GPT-Live is mocked at the peer (support/
 * live-fake.ts): the test is the person's transcript, so a spoken sentence
 * goes through the product's real fast-navigation path.
 *
 * What is asserted:
 *   - each move lands (URL + the page's own marker) with exactly one VERIFIED
 *     (DONE) outcome for that path;
 *   - a known route costs NO model call by voice (the vendor log), and no
 *     analyst round when typed (the skim/reader run beside the early move);
 *   - the correction "Open Discover, no, actually Rehearsals" VERIFIES only
 *     Rehearsals and never pushes /discover;
 *   - moving while the mocked call is up leaves ONE voice line and at most
 *     one audible stream.
 * cq:navigation-timing (pushMs, commitMs, totalMs) is summarised at the end.
 * Every figure is LOCAL+MOCK.
 */
const company = world().company(CAST.founderCompanyKey);

test.beforeAll(() => {
  requireQatarStack();
});

/** One context per test: its cq:navigation-timing rows carry that test's title. */
async function fresh(browser: Browser): Promise<BrowserContext> {
  return contextAs(browser, CAST.founder);
}

const taskOf = (r: FakeRequest): string =>
  /TASK: ([A-Z_]+)/u.exec(r.input ?? "")?.[1] ?? "UNKNOWN";

async function livePage(
  context: BrowserContext,
  path = "/home",
): Promise<Page> {
  const page = await context.newPage();
  await installLiveFake(page);
  await watchMoves(page);
  await page.goto(path);
  return page;
}

async function expectVerified(page: Page, path: string): Promise<void> {
  await expect
    .poll(
      async () =>
        (await moves(page)).outcomes
          .filter((o) => pathOf(o.expected) === path)
          .map((o) => o.status),
      { timeout: 30_000, message: `one VERIFIED outcome for ${path}` },
    )
    .toEqual(["DONE"]);
  const done = (await moves(page)).outcomes.find(
    (o) => pathOf(o.expected) === path,
  );
  expect.soft(pathOf(done?.route ?? ""), "VERIFIED where it landed").toBe(path);
}

const ROUTES = [
  {
    label: "Home->Discover",
    say: "open discover",
    path: "/discover",
    heading: /Discover/u,
  },
  {
    label: "Home->Rehearsals",
    say: "open rehearsals",
    path: "/rehearsals",
    heading: /Rehearsals/u,
  },
  {
    label: "Home->Relationships",
    say: "open relationships",
    path: "/relationships",
    heading: /Relationships/u,
  },
] as const;

for (const route of ROUTES) {
  test(`D voice: ${route.label} by spoken words: VERIFIED, no model call`, async ({
    browser,
  }) => {
    const context = await fresh(browser);
    const page = await livePage(context);
    await page.request.get(route.path);
    await startLive(page);
    await quiet(2_500);
    const mark = await fakeMark();
    const started = Date.now();
    await liveUserSays(page, route.say);
    await expect(page).toHaveURL(new RegExp(`${route.path}(\\?|$)`, "u"), {
      timeout: 30_000,
    });
    measure(`D voice ${route.label} speech-end->URL`, Date.now() - started);
    await expectVerified(page, route.path);
    await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(
      route.heading,
    );
    await quiet(3_000);
    const rounds = (await fakeSince(mark)).filter(
      (r) => r.path === "/v1/responses",
    );
    expect(
      rounds.map((r) => `${taskOf(r)}:${r.rule ?? "unscripted"}`),
      "no model call for a known route spoken to the voice line",
    ).toEqual([]);
    await page.close();
  });

  test(`D typed: ${route.label}: VERIFIED, no analyst round`, async ({
    browser,
  }) => {
    const context = await fresh(browser);
    const page = await context.newPage();
    await watchMoves(page);
    await useScript([READ_QUESTION]);
    await page.goto("/home");
    await page.request.get(route.path);
    await quiet(1_500);
    const mark = await fakeMark();
    const started = await sendTimed(page, route.say);
    await expect(page).toHaveURL(new RegExp(`${route.path}(\\?|$)`, "u"), {
      timeout: 30_000,
    });
    measure(`D typed ${route.label} send->URL`, Date.now() - started);
    await expectVerified(page, route.path);
    const atVerified = (await fakeSince(mark))
      .filter((r) => r.path === "/v1/responses")
      .map(taskOf);
    console.log(
      `D typed ${route.label} model rounds beside the early move[LOCAL+MOCK]: ${JSON.stringify(atVerified)}`,
    );
    await quiet(5_000);
    const all = (await fakeSince(mark))
      .filter((r) => r.path === "/v1/responses")
      .map(taskOf);
    expect(
      all.filter((t) => t === "COMPANY_ANALYST"),
      "the answer needs no analyst for a page by name",
    ).toEqual([]);
    await page.close();
  });
}

test("D Q->a researched entity: ask, then 'take me to' it -> its rehearsal lobby, VERIFIED", async ({
  browser,
}) => {
  const context = await fresh(browser);
  const shadi = QATAR_FIVE[0];
  if (shadi === undefined) throw new Error("no entity");
  const page = await context.newPage();
  await watchMoves(page);
  const words = `Who is ${shadi.canonical}?`;
  await useScript([
    skimPerson(words, { name: shadi.canonical }),
    READ_QUESTION,
  ]);
  await page.goto("/home");
  const started = await sendTimed(page, words);
  const card = await identityCard(page, shadi.nameRe, started);
  const say = `Rehearse with ${shadi.canonical}`;
  await useScript([
    SKIM_OTHER,
    READ_QUESTION,
    {
      name: "d-entity",
      when: { task: "COMPANY_ANALYST", user: escape(say), afterTool: null },
      reply: {
        toolCalls: [
          {
            name: "open_page",
            arguments: { page: "EXTERNAL_REHEARSAL", id: card.key },
          },
        ],
      },
    },
    {
      name: "d-entity-answer",
      when: { task: "COMPANY_ANALYST", afterTool: "open_page" },
      reply: answer(`Opening ${shadi.canonical}…`),
    },
  ]);
  const t0 = await sendTimed(page, say);
  const path = `/rehearsals/person/${card.key}`;
  await expect(page).toHaveURL(new RegExp(`${escape(path)}$`, "u"), {
    timeout: 60_000,
  });
  measure("D Q->researched entity send->URL", Date.now() - t0);
  await expectVerified(page, path);
  await expect(
    page.getByRole("heading", { level: 1, name: /Ready to rehearse with/u }),
  ).toBeVisible({
    timeout: 60_000,
  });
  await page.close();
});

test("D Q->a company profile, and a nested tab of it", async ({ browser }) => {
  const context = await fresh(browser);
  const page = await context.newPage();
  await watchMoves(page);
  const profile = `Open ${company.name}'s profile`;
  const tab = `open the team tab on my company`;
  await useScript([
    SKIM_OTHER,
    READ_QUESTION,
    {
      name: "d-profile",
      when: {
        task: "COMPANY_ANALYST",
        user: escape("profile"),
        afterTool: null,
      },
      reply: {
        toolCalls: [
          {
            name: "open_page",
            arguments: { page: "COMPANY", id: company.companyId },
          },
        ],
      },
    },
    {
      name: "d-tab",
      when: {
        task: "COMPANY_ANALYST",
        user: escape("team tab"),
        afterTool: null,
      },
      reply: {
        toolCalls: [
          {
            name: "open_page",
            arguments: { page: "COMPANY_TEAM", id: company.companyId },
          },
        ],
      },
    },
    {
      name: "d-after",
      when: { task: "COMPANY_ANALYST", afterTool: "open_page" },
      reply: answer("Opening it…"),
    },
  ]);
  await page.goto("/home");
  const t0 = await sendTimed(page, profile);
  await expect(page).toHaveURL(
    new RegExp(`/company/${company.companyId}(\\?|$)`, "u"),
    { timeout: 60_000 },
  );
  measure("D Q->company profile send->URL", Date.now() - t0);
  await expect(page.locator("[data-company-profile]")).toBeVisible();
  await expectVerified(page, `/company/${company.companyId}`);

  const t1 = Date.now();
  await send(page, tab);
  await expect(page).toHaveURL(
    new RegExp(`/company/${company.companyId}\\?tab=team`, "u"),
    { timeout: 60_000 },
  );
  measure("D Q->nested tab send->URL", Date.now() - t1);
  await expect(
    page.locator('[data-profile-tab="team"]').first(),
  ).toHaveAttribute("aria-current", "page");
  await page.close();
});

test("D navigation while the mocked GPT-Live audio is active: VERIFIED, one voice line, one audible stream", async ({
  browser,
}) => {
  const page = await livePage(await fresh(browser));
  await page.request.get("/rehearsals");
  await startLive(page);
  await expect
    .poll(() => audibleNow(page), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1);
  const started = Date.now();
  await liveUserSays(page, "open rehearsals");
  await expect(page).toHaveURL(/\/rehearsals(\?|$)/u, { timeout: 30_000 });
  measure("D nav during live audio speech-end->URL", Date.now() - started);
  await expectVerified(page, "/rehearsals");
  await page.waitForTimeout(2_000);
  expect(
    await livePeers(page),
    "the call survived the move: still one peer",
  ).toBe(1);
  expect(
    await maxAudible(page),
    "never two voices at once",
  ).toBeLessThanOrEqual(1);
  await expect(
    page
      .getByRole("button", { name: /^End/u })
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await page.close();
});

test("D correction by voice: 'Open Discover, no, actually Rehearsals' verifies only Rehearsals", async ({
  browser,
}) => {
  const page = await livePage(await fresh(browser));
  await page.request.get("/rehearsals");
  await page.request.get("/discover");
  await startLive(page);
  await quiet(2_000);
  await useScript([
    SKIM_OTHER,
    reading("TOOL_REQUEST", {
      tool: { kind: "NAVIGATE", destination: "REHEARSALS", visibility: null },
    }),
    {
      name: "d-correction-voice-answer",
      when: { task: "COMPANY_ANALYST" },
      reply: answer("Opening rehearsals…"),
    },
  ]);
  await liveUserSays(page, "Open Discover, no, actually Rehearsals");
  // As the real voice does for words it cannot act on itself: hand them to Q.
  await emitLive(page, {
    type: "session.delegation.created",
    delegation: {
      id: "dlg_qa_correction",
      type: "delegation",
      target: "client",
    },
  });
  await expect(page).toHaveURL(/\/rehearsals(\?|$)/u, { timeout: 30_000 });
  await page.waitForTimeout(5_000);
  const log = await moves(page);
  expect(
    log.outcomes.filter((o) => pathOf(o.expected) === "/discover"),
    "Discover was never an intent that ended anywhere",
  ).toEqual([]);
  expect(
    log.pushes.map((p) => pathOf(p)),
    "Discover was never pushed",
  ).not.toContain("/discover");
  await expectVerified(page, "/rehearsals");
  expect(pathOf(page.url())).toBe("/rehearsals");
  await page.close();
});

test("D correction typed: 'Open Discover, no, actually Rehearsals' verifies only Rehearsals", async ({
  browser,
}) => {
  const page = await (await fresh(browser)).newPage();
  await watchMoves(page);
  await useScript([
    SKIM_OTHER,
    reading("TOOL_REQUEST", {
      tool: { kind: "NAVIGATE", destination: "REHEARSALS", visibility: null },
    }),
    {
      name: "d-correction-answer",
      when: { task: "COMPANY_ANALYST" },
      reply: answer("Opening rehearsals…"),
    },
  ]);
  await page.goto("/home");
  await page.request.get("/rehearsals");
  await page.request.get("/discover");
  await send(page, "Open Discover, no, actually Rehearsals");
  await expect(page).toHaveURL(/\/rehearsals(\?|$)/u, { timeout: 45_000 });
  await page.waitForTimeout(6_000);
  const log = await moves(page);
  expect(
    log.outcomes.filter((o) => pathOf(o.expected) === "/discover"),
  ).toEqual([]);
  expect(log.pushes.map((p) => pathOf(p))).not.toContain("/discover");
  await expectVerified(page, "/rehearsals");
  await page.close();
});

test("D summary: cq:navigation-timing p50/p95 (LOCAL+MOCK)", () => {
  type Timing = {
    pushMs: number | null;
    commitMs: number | null;
    totalMs: number;
    status: string;
  };
  const rows: { at: string; test: string; timing: Timing }[] = existsSync(
    NAV_TIMING_FILE,
  )
    ? readFileSync(NAV_TIMING_FILE, "utf8")
        .split("\n")
        .filter((l) => l.length > 0)
        .map(
          (l) => JSON.parse(l) as { at: string; test: string; timing: Timing },
        )
        .filter(
          (r) =>
            r.at >= new Date(Date.now() - 90 * 60_000).toISOString() &&
            r.test.startsWith("D "),
        )
    : [];
  const done = rows.filter((r) => r.timing.status === "DONE");
  const pick = (f: (t: Timing) => number | null, from = done) =>
    from.map((r) => f(r.timing)).filter((v): v is number => v !== null);
  const voice = done.filter((r) =>
    /voice|live audio|correction by voice/u.test(r.test),
  );
  const typed = done.filter((r) => !voice.includes(r));
  const lines = [
    `all   pushMs ${summary(pick((t) => t.pushMs))} | commitMs ${summary(pick((t) => t.commitMs))} | totalMs ${summary(pick((t) => t.totalMs))}`,
    `voice pushMs ${summary(pick((t) => t.pushMs, voice))} | commitMs ${summary(pick((t) => t.commitMs, voice))}`,
    `typed pushMs ${summary(pick((t) => t.pushMs, typed))} | commitMs ${summary(pick((t) => t.commitMs, typed))}`,
  ];
  for (const line of lines) console.log(`NAVTIMING[LOCAL+MOCK] ${line}`);
  test.info().annotations.push({
    type: "measure",
    description: `LOCAL+MOCK cq:navigation-timing ${lines.join(" || ")}`,
  });
  expect(
    done.length,
    "cq:navigation-timing events were recorded for DONE moves",
  ).toBeGreaterThan(0);
  expect(
    percentile(
      pick((t) => t.commitMs),
      50,
    ),
    "commit p50 exists",
  ).not.toBeNull();
});
