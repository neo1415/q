import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import {
  emitLive,
  installLiveFake,
  liveSent,
  liveUserSays,
} from "../support/live-fake.js";
import { localSql } from "../support/local-db.js";
import {
  navigationReceipts,
  openQ,
  recordReceipts,
  send,
} from "../support/q.js";
import {
  answer,
  reading,
  useScript,
  type ScriptRule,
} from "../support/script.js";
import { CAST, STACK_GPT_LIVE, world } from "../support/stack.js";
import {
  READ_QUESTION,
  SKIM_OTHER,
  moves,
  pathOf,
  startLive,
  uuid,
  watchMoves,
} from "./journey-fixtures.js";

/**
 * Journey C, navigation (R3 lifecycle REQUESTED → VALIDATED → EXECUTING →
 * VERIFIED | FAILED). From each of five pages the founder asks Q to open a
 * route, a record and a nested tab. Each move must land (URL and the
 * page's own marker), produce one VERIFIED (DONE) outcome for that path,
 * and Q's "Opened …" must appear only after that outcome, while the
 * browser is already there. Destinations that do not exist or are not
 * theirs end FAILED with plain words and never "Opened".
 */
const company = world().company(CAST.founderCompanyKey);
const investor = world().investor("savanna-seed");
// The manifest marks names "(fictional)"; the product shows the display name.
const investorName = investor.name.replace(/ \(fictional\)$/u, "");
/** Where a founder's "open <their investor>" lands (named-record-request.ts pagesFor). */
const RECORD_PATH = `/relationships/investor/${investor.investorOrganisationId}`;

const STARTS = [
  "/home",
  "/discover",
  "/work",
  "/capital",
  "/relationships",
] as const;

type Move = {
  readonly label: string;
  readonly say: string;
  readonly path: string;
  readonly url: RegExp;
  readonly rules: readonly ScriptRule[];
  readonly marker: (page: Page) => Promise<void>;
};

function openPage(
  key: string,
  say: string,
  args: Record<string, unknown>,
  place: string,
): ScriptRule[] {
  return [
    SKIM_OTHER,
    READ_QUESTION,
    {
      name: `c-${key}`,
      when: { task: "COMPANY_ANALYST", user: say, afterTool: null },
      reply: { toolCalls: [{ name: "open_page", arguments: args }] },
    },
    {
      name: `c-${key}-answer`,
      when: { task: "COMPANY_ANALYST", afterTool: "open_page" },
      reply: answer(`Opening ${place}…`),
    },
  ];
}

function movesFrom(start: string): Move[] {
  const toRelationships = start !== "/relationships";
  const route = toRelationships
    ? {
        destination: "RELATIONSHIPS",
        path: "/relationships",
        heading: /Relationships/u,
      }
    : { destination: "CAPITAL", path: "/capital", heading: /Capital/u };
  const routeSay = `take me to ${route.path.slice(1)}`;
  return [
    {
      label: `route ${route.path}`,
      say: routeSay,
      path: route.path,
      url: new RegExp(`${route.path}(\\?|$)`, "u"),
      rules: [
        SKIM_OTHER,
        reading("TOOL_REQUEST", {
          tool: {
            kind: "NAVIGATE",
            destination: route.destination,
            visibility: null,
          },
        }),
        {
          name: "c-route-answer",
          when: { task: "COMPANY_ANALYST" },
          reply: answer(`Opening ${route.path.slice(1)}…`),
        },
      ],
      marker: async (page) => {
        await expect(
          page.getByRole("heading", { level: 1 }).first(),
        ).toHaveText(route.heading);
      },
    },
    {
      // A founder's "open <investor>" is a named-record request: their
      // counterpart's page is the relationship first (named-record-request.ts
      // pagesFor PAGE: RELATIONSHIP_INVESTOR, INVESTOR), not the model's call.
      label: "record /relationships/investor/:id",
      say: `open ${investorName}`,
      path: RECORD_PATH,
      url: new RegExp(`${RECORD_PATH}(\\?|$)`, "u"),
      rules: openPage(
        "record",
        `open ${investorName}`,
        { page: "RELATIONSHIP_INVESTOR", id: investor.investorOrganisationId },
        investorName,
      ),
      marker: async (page) => {
        await expect(page.locator("[data-relationship-hero]")).toContainText(
          investorName,
        );
      },
    },
    {
      label: "nested tab team",
      say: "open the team tab on my company",
      path: `/company/${company.companyId}`,
      url: new RegExp(`/company/${company.companyId}\\?tab=team`, "u"),
      rules: openPage(
        "tab",
        "team tab on my company",
        { page: "COMPANY_TEAM", id: company.companyId },
        `${company.name}'s team`,
      ),
      marker: async (page) => {
        // The profile's tab bar marks the open tab aria-current (profile-tabs.tsx).
        await expect(
          page.locator('[data-profile-tab="team"]').first(),
        ).toHaveAttribute("aria-current", "page");
      },
    },
  ];
}

async function expectVerified(
  page: Page,
  path: string,
  sentAt?: number,
): Promise<void> {
  await expect
    .poll(
      async () =>
        (await moves(page)).outcomes.filter((o) => pathOf(o.expected) === path)
          .length,
      {
        timeout: 30_000,
        message: `a navigation outcome for ${path}`,
      },
    )
    .toBeGreaterThan(0);
  const log = await moves(page);
  console.log(
    `MOVES ${path}: ${JSON.stringify(log.outcomes)} OPENED ${JSON.stringify(log.opened)}`,
  );
  const mine = log.outcomes.filter((o) => pathOf(o.expected) === path);
  expect(
    mine.map((o) => o.status),
    "one VERIFIED outcome, no FAILED",
  ).toEqual(["DONE"]);
  const done = mine[0];
  if (sentAt !== undefined && done !== undefined)
    console.log(`VERIFIED_MS ${path} ${String(Math.round(done.at - sentAt))}`);
  expect.soft(pathOf(done?.route ?? ""), "VERIFIED where it landed").toBe(path);
  expect
    .soft(pathOf(done?.where ?? ""), "the browser was there at VERIFIED")
    .toBe(path);
  // Q's final wording: only after VERIFIED, and only once there. The typed
  // answer row (QAnswer, useMoveLine) lives in the Chat view and the dock;
  // the page Q moved to shows it once the dock is open.
  if ((await moves(page)).opened.length === 0) {
    await openQ(page);
    const chat = page
      .getByRole("button", { name: "Chat", exact: true })
      .filter({ visible: true })
      .first();
    if (
      (await chat.isVisible().catch(() => false)) &&
      (await chat.getAttribute("aria-pressed")) !== "true"
    )
      await chat.click();
  }
  await expect
    .poll(async () => (await moves(page)).opened.length, {
      timeout: 15_000,
      message: "Q's answer says it opened",
    })
    .toBeGreaterThan(0);
  for (const opened of (await moves(page)).opened) {
    expect
      .soft(opened.at, `"${opened.text}" after VERIFIED`)
      .toBeGreaterThanOrEqual(done?.at ?? Infinity);
    expect
      .soft(pathOf(opened.where), `"${opened.text}" said on the page`)
      .toBe(path);
  }
  // The receipt the server was told about (POST /api/q-ui-acts).
  await expect
    .poll(
      () =>
        navigationReceipts(page).navigations.some(
          (n) => n.status === "DONE" && pathOf(n.expected ?? "") === path,
        ),
      { timeout: 15_000, message: "a DONE receipt reached the server" },
    )
    .toBe(true);
}

for (const start of STARTS) {
  for (const move of movesFrom(start)) {
    test(`C typed, from ${start}: ${move.label} → VERIFIED, lands, then "Opened"`, async ({
      browser,
    }) => {
      const page = await (await contextAs(browser, CAST.founder)).newPage();
      await watchMoves(page);
      await recordReceipts(page);
      await useScript(move.rules);
      await page.goto(start);
      const sentAt = await page.evaluate(() => performance.now());
      await send(page, move.say);
      await expect(page).toHaveURL(move.url, { timeout: 60_000 });
      await move.marker(page);
      await expectVerified(page, move.path, sentAt);
      await page.context().close();
    });
  }
}

test.describe("C with GPT-Live connected (MOCK)", () => {
  test.beforeAll(() => {
    if (STACK_GPT_LIVE === false)
      throw new Error(
        "The running stack has GPT-Live off. Restart it with CQ_RECOVERY_GPT_LIVE=1 bash scripts/recovery/local-stack.sh start",
      );
  });

  for (const start of ["/home", "/relationships"] as const) {
    test(`C voice, from ${start}: a delegated record move is confirmed to the voice only after VERIFIED`, async ({
      browser,
    }) => {
      const say = `Open ${investorName}`;
      const path = RECORD_PATH;
      const page = await (await contextAs(browser, CAST.founder)).newPage();
      await installLiveFake(page);
      await watchMoves(page);
      await recordReceipts(page);
      await useScript(
        openPage(
          "voice",
          say,
          {
            page: "RELATIONSHIP_INVESTOR",
            id: investor.investorOrganisationId,
          },
          investorName,
        ),
      );
      await page.goto(start);
      // Off /home, Talk with Q is inside the Q dock (ADR 0017).
      if (start !== "/home") await openQ(page);
      await startLive(page);
      await liveUserSays(page, say);
      const delegation = `dlg_g2_${randomUUID().slice(0, 8)}`;
      await emitLive(page, {
        type: "session.delegation.created",
        delegation: { id: delegation, type: "delegation", target: "client" },
      });
      await expect(page).toHaveURL(new RegExp(`${path}(\\?|$)`, "u"), {
        timeout: 60_000,
      });
      await expect
        .poll(
          async () =>
            (await moves(page)).outcomes.filter(
              (o) => pathOf(o.expected) === path,
            ).length,
          {
            timeout: 30_000,
          },
        )
        .toBe(1);
      const done = (await moves(page)).outcomes.find(
        (o) => pathOf(o.expected) === path,
      );
      expect(done?.status).toBe("DONE");
      const sent = await liveSent(page);
      const said = sent
        .map((event, index) => ({ event, index }))
        .filter(
          ({ event }) =>
            event.type === "session.commentary.append" &&
            event.delegation_id === delegation &&
            /confirmed|opened|\bopen on\b/iu.test(event.content ?? ""),
        );
      expect
        .soft(
          said
            .filter(({ index }) => index < (done?.liveSentBefore ?? 0))
            .map(({ event }) => event.content),
          "nothing said as opened before VERIFIED",
        )
        .toEqual([]);
      await expect
        .poll(
          async () =>
            (await liveSent(page)).some(
              (event) =>
                event.type === "session.commentary.append" &&
                event.delegation_id === delegation &&
                /confirmed/iu.test(event.content ?? ""),
            ),
          {
            timeout: 30_000,
            message: "the voice is told the move is confirmed",
          },
        )
        .toBe(true);
    });
  }

  test("C voice: a spoken route move lands and is VERIFIED", async ({
    browser,
  }) => {
    const page = await (await contextAs(browser, CAST.founder)).newPage();
    await installLiveFake(page);
    await watchMoves(page);
    await useScript([SKIM_OTHER, READ_QUESTION]);
    await page.goto("/home");
    await page.request.get("/discover");
    await startLive(page);
    await liveUserSays(page, "open discover");
    await expect(page).toHaveURL(/\/discover(\?|$)/u, { timeout: 30_000 });
    await expect
      .poll(
        async () =>
          (await moves(page)).outcomes
            .filter((o) => pathOf(o.expected) === "/discover")
            .map((o) => o.status),
        {
          timeout: 30_000,
        },
      )
      .toEqual(["DONE"]);
  });
});

/** An investor organisation with no relationship to the founder's company. */
function strangerInvestor() {
  const related = new Set(
    localSql(
      `select investor_organisation_id from network.relationships where company_id = '${uuid(company.companyId)}'`,
    )
      .split("\n")
      .filter(Boolean),
  );
  const found = world().investors.find(
    (one) => !related.has(one.investorOrganisationId),
  );
  if (found === undefined)
    throw new Error("every seeded investor is related to the company");
  return found;
}

async function expectHonestFailure(
  page: Page,
  target: string,
  place: string,
): Promise<void> {
  // Long enough for a move to have been made and verified, had it been.
  await page.waitForTimeout(12_000);
  const log = await moves(page);
  const mine = log.outcomes.filter((o) => pathOf(o.expected) === target);
  expect
    .soft(
      mine.filter((o) => o.status === "DONE"),
      "never VERIFIED",
    )
    .toEqual([]);
  for (const outcome of mine)
    expect
      .soft(["NOT_FOUND", "UNAUTHORIZED", "CONTROL_MISSING"])
      .toContain(outcome.reason);
  expect
    .soft(
      log.opened.map((o) => o.text),
      "Q never says it opened",
    )
    .toEqual([]);
  const said = (
    await page
      .locator("[data-q-answer]")
      .last()
      .innerText()
      .catch(() => "")
  ).trim();
  expect.soft(said, "Q's final words").not.toMatch(/\bopened\b/iu);
  if (mine.some((o) => o.status === "FAILED"))
    expect
      .soft(said, "FAILED is said plainly")
      .toContain(`${place} didn't open`);
  expect
    .soft(
      navigationReceipts(page).navigations.filter(
        (n) => n.status === "DONE" && pathOf(n.expected ?? "") === target,
      ),
      "no DONE receipt for it reached the server",
    )
    .toEqual([]);
}

test("C nonexistent record: FAILED (or refused), never 'opened'", async ({
  browser,
}) => {
  const missing = randomUUID();
  const place = "that company";
  const page = await (await contextAs(browser, CAST.founder)).newPage();
  await watchMoves(page);
  await recordReceipts(page);
  await useScript(
    openPage(
      "missing",
      "open company",
      { page: "COMPANY", id: missing },
      place,
    ),
  );
  await page.goto("/home");
  await send(page, "open company with the id I gave you");
  await expectHonestFailure(page, `/company/${missing}`, "That company");
  await expect(page.locator("[data-company-profile]")).toHaveCount(0);
});

test("C unauthorized record: a relationship that is not theirs ends FAILED, never 'opened'", async ({
  browser,
}) => {
  const stranger = strangerInvestor();
  const target = `/relationships/investor/${stranger.investorOrganisationId}`;
  const page = await (await contextAs(browser, CAST.founder)).newPage();
  await watchMoves(page);
  await recordReceipts(page);
  await useScript(
    openPage(
      "stranger",
      `relationship with ${stranger.name}`,
      { page: "RELATIONSHIP_INVESTOR", id: stranger.investorOrganisationId },
      stranger.name,
    ),
  );
  await page.goto("/home");
  await send(page, `open my relationship with ${stranger.name}`);
  await expectHonestFailure(page, target, stranger.name);
  await expect(page.locator("[data-relationship-brief]")).toHaveCount(0);
});
