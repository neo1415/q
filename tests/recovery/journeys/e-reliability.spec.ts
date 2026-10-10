import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { runQ } from "../support/flows.js";
import { call, isRefusal, tokenFor } from "../support/http.js";
import { answerText, newestRun, nextSettledRun } from "../support/knowledge.js";
import { localSql, stack } from "../support/local-db.js";
import { operateScreen, receipts, recordReceipts, send } from "../support/q.js";
import { answer, useScript, type ScriptRule } from "../support/script.js";
import { CAST, Q_API_URL, world } from "../support/stack.js";
import {
  READ_QUESTION,
  SKIM_OTHER,
  captureAnsweredReceiptPosts,
  captureReceiptPosts,
  holdTableLock,
  inputAfter,
  messageEventCount,
  moves,
  pathOf,
  readBrief,
  relationshipId,
  uuid,
  watchMoves,
} from "./journey-fixtures.js";

/**
 * Journey E, reliability: the demo keeps telling the truth when parts of
 * the system fail. Each failure is caused on the LOCAL stack only (a q-api
 * restart, a table lock past the statement timeout, a missing control, a
 * remount mid-move, a replayed receipt, another person's record) and each
 * test reads what Q said, what the screen shows and the database.
 */
const company = world().company(CAST.founderCompanyKey);
const investor = world().investor("savanna-seed");
// The manifest marks names "(fictional)"; the product shows the display name.
const investorName = investor.name.replace(/ \(fictional\)$/u, "");
/** Where a founder's "open <their investor>" lands (named-record-request.ts pagesFor). */
const RECORD_PATH = `/relationships/investor/${investor.investorOrganisationId}`;

test("E1 a q-api restart mid-run: the run ends RUN_EXPIRED with an honest message", async () => {
  test.setTimeout(300_000);
  await useScript([
    SKIM_OTHER,
    READ_QUESTION,
    {
      name: "e1-hang",
      when: { task: "COMPANY_ANALYST", user: "slow journey question" },
      reply: { hang: true },
    },
  ]);
  const response = await fetch(`${Q_API_URL}/v1/q/runs`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await tokenFor(CAST.investor)}`,
      "content-type": "application/json",
      "idempotency-key": `recovery-g2-${randomUUID()}`,
    },
    body: JSON.stringify({
      capability: "ANSWER",
      message: { text: `A slow journey question about ${company.name}` },
      modality: "TEXT",
    }),
  });
  const runId = uuid(
    String(((await response.json()) as { runId?: unknown }).runId),
  );
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  stack("stop", "q-api");
  stack("start", "q-api");
  let run: {
    status?: string;
    failure?: { code?: string; message?: string; retryable?: boolean };
  } = {};
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const reply = await call(
      CAST.investor,
      "q-api",
      "GET",
      `/v1/q/runs/${runId}`,
    ).catch(() => null);
    // An unknown body narrows to {}: every field read below is optional.
    run = reply?.body ?? {};
    if (
      ["COMPLETED", "FAILED", "CANCELLED", "EXPIRED"].includes(run.status ?? "")
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  expect(run.status, "the caught run ended, it did not hang").toBe("FAILED");
  expect
    .soft(run.failure?.code, "public projection of RUN_EXPIRED")
    .toBe("EXPIRED");
  expect.soft(run.failure?.retryable).toBe(true);
  expect
    .soft(run.failure?.message ?? "", "says it did not finish")
    .toMatch(/(didn.t finish|interrupted|try again|expired|stopped)/iu);
  expect
    .soft(run.failure?.message ?? "")
    .not.toMatch(/\bno (messages?|relationship|record)/iu);
  expect
    .soft(
      localSql(`select status from q_runtime.runs where id = '${runId}'`),
      "DB",
    )
    .toBe("FAILED");
});

test("E2 a relationship source past its statement timeout: brief UNAVAILABLE, Q says it couldn't read, never 'none'", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const relationship = relationshipId(
    company.companyId,
    investor.investorOrganisationId,
  );
  const count = messageEventCount(relationship);
  const release = holdTableLock("communication.messages", 90_000);
  try {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    const started = Date.now();
    const brief = await readBrief(CAST.investor, relationship);
    expect
      .soft(Date.now() - started, "the brief answers, bounded by the timeout")
      .toBeLessThan(30_000);
    expect
      .soft(brief.messages.latest.status, "the thread's latest is unknown")
      .toBe("UNAVAILABLE");
    expect
      .soft(brief.messages.count, "the count is still the history's")
      .toBe(count);

    const words = "where do we stand with";
    const rules: ScriptRule[] = [
      SKIM_OTHER,
      READ_QUESTION,
      {
        name: "e2-tool",
        when: { task: "COMPANY_ANALYST", user: words, afterTool: null },
        reply: {
          toolCalls: [
            {
              name: "get_relationship",
              arguments: { companyId: company.companyId },
            },
          ],
        },
      },
      {
        name: "e2-answer",
        when: { task: "COMPANY_ANALYST", afterTool: "get_relationship" },
        reply: answer("I couldn't read the chat just now."),
      },
    ];
    const run = await runQ(CAST.investor, `${words} ${company.name}?`, rules);
    const read = inputAfter(run.vendor, "e2-answer");
    expect(read.length, "get_relationship answered").toBeGreaterThan(0);
    expect.soft(read).toContain("could not be read right now");
    expect
      .soft(read, "never 'none'")
      .not.toContain("No messages have been sent");
    expect.soft(read).not.toContain("has not written in the chat yet");

    const page = await (await contextAs(browser, CAST.investor)).newPage();
    await page.goto(`/relationships/company/${company.companyId}`);
    const standing = page.locator("[data-relationship-brief]");
    await expect
      .soft(standing)
      .toContainText("couldn't be read just now", { timeout: 60_000 });
    await expect.soft(standing).not.toContainText("No messages yet");
    await page.context().close();
  } finally {
    release();
  }
});

test("E3 a control the page never registers: FAILED / TARGET_MISSING in seconds, never done, never a hang", async ({
  browser,
}) => {
  const page = await (await contextAs(browser, CAST.founder)).newPage();
  await recordReceipts(page);
  await useScript([
    SKIM_OTHER,
    READ_QUESTION,
    {
      name: "e3-act",
      when: { task: "COMPANY_ANALYST", user: "imaginary tab", afterTool: null },
      reply: { toolCalls: [operateScreen("SELECT_TAB", "tab.g2-imaginary")] },
    },
    {
      name: "e3-answer",
      when: { task: "COMPANY_ANALYST", afterTool: "operate_screen" },
      reply: answer("Opening the imaginary tab…"),
    },
  ]);
  await page.goto("/capital");
  const before = (await newestRun(CAST.founder))?.runId ?? null;
  await send(page, "open the imaginary tab");
  // Two honest endings: the page reports the control missing (the act
  // reached it), or Q's named-page reader refuses before acting (G2 gate:
  // "I can't open that yet: there's no "imaginary" page in Capital Q.").
  // Either within the turn, never a hang and never "opened".
  const run = await nextSettledRun(CAST.founder, before, 30_000);
  const said = answerText(run);
  const receipt =
    (await receipts(page)).find((r) => r.target === "tab.g2-imaginary")
      ?.status ?? null;
  expect(
    receipt === "TARGET_MISSING" ||
      receipt === "FAILED" ||
      /\b(can.?t|couldn.?t|isn.?t|no)\b/iu.test(said),
    `receipt ${String(receipt)}, Q said "${said}"`,
  ).toBe(true);
  expect.soft(said).not.toMatch(/\bopened\b/iu);
  expect
    .soft(
      (await receipts(page)).some(
        (r) => r.target === "tab.g2-imaginary" && r.status === "DONE",
      ),
    )
    .toBe(false);
  await expect
    .soft(page.locator("[data-q-answer]").last())
    .not.toContainText(/opened/iu);
  await page.context().close();
});

test("E4 the router remounts mid-move: one execution, one receipt", async ({
  browser,
}) => {
  const path = RECORD_PATH;
  const page = await (await contextAs(browser, CAST.founder)).newPage();
  await watchMoves(page);
  await recordReceipts(page);
  const posts = captureReceiptPosts(page);
  await useScript([
    SKIM_OTHER,
    READ_QUESTION,
    {
      name: "e4-open",
      when: {
        task: "COMPANY_ANALYST",
        user: "remount journey",
        afterTool: null,
      },
      reply: {
        toolCalls: [
          {
            name: "open_page",
            arguments: {
              page: "RELATIONSHIP_INVESTOR",
              id: investor.investorOrganisationId,
            },
          },
        ],
      },
    },
    {
      name: "e4-answer",
      when: { task: "COMPANY_ANALYST", afterTool: "open_page" },
      reply: answer(`Opening ${investorName}…`),
    },
  ]);
  // The destination answers slowly, so the move is still EXECUTING while
  // the dock (and the Q session holding the page's router) unmounts and
  // mounts again.
  await page.route(`**${path}**`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    await route.fallback();
  });
  // /discover has the Q dock (the Q page /home has none to remount).
  await page.goto("/discover");
  await send(page, `open ${investorName}, remount journey`);
  const dock = page.locator("[data-q-dock] [data-q-dock-button]");
  await expect
    .poll(
      async () =>
        (await moves(page)).pushes.length +
        (await page.locator("[data-q-answer]").count()),
      {
        timeout: 60_000,
      },
    )
    .toBeGreaterThan(0);
  for (let i = 0; i < 2; i += 1) {
    // The open dock can cover its own button: Escape closes it then.
    const clicked = await dock
      .click({ timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (!clicked) await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  await expect(page).toHaveURL(new RegExp(`${path}(\\?|$)`, "u"), {
    timeout: 60_000,
  });
  await page.waitForTimeout(5_000);
  const log = await moves(page);
  expect
    .soft(
      log.pushes.filter((url) => pathOf(url) === path),
      "one push",
    )
    .toHaveLength(1);
  const mine = log.outcomes.filter((o) => pathOf(o.expected) === path);
  expect
    .soft(
      mine.map((o) => o.status),
      "one outcome, VERIFIED",
    )
    .toEqual(["DONE"]);
  const intents = posts.flatMap((body) => {
    try {
      return (
        (
          JSON.parse(body) as {
            navigations?: { intentId?: string; expected?: string }[];
          }
        ).navigations ?? []
      )
        .filter((n) => pathOf(n.expected ?? "") === path)
        .map((n) => n.intentId ?? "");
    } catch {
      return [];
    }
  });
  expect.soft(new Set(intents).size, "one intent id reported").toBe(1);
  await page.context().close();
});

test("E5 a duplicate intent id: the server counts one receipt", async ({
  browser,
}) => {
  const path = RECORD_PATH;
  const page = await (await contextAs(browser, CAST.founder)).newPage();
  await watchMoves(page);
  const posts = await captureAnsweredReceiptPosts(page);
  await useScript([
    SKIM_OTHER,
    READ_QUESTION,
    {
      name: "e5-open",
      when: {
        task: "COMPANY_ANALYST",
        user: "duplicate journey",
        afterTool: null,
      },
      reply: {
        toolCalls: [
          {
            name: "open_page",
            arguments: {
              page: "RELATIONSHIP_INVESTOR",
              id: investor.investorOrganisationId,
            },
          },
        ],
      },
    },
    {
      name: "e5-answer",
      when: { task: "COMPANY_ANALYST", afterTool: "open_page" },
      reply: answer(`Opening ${investorName}…`),
    },
  ]);
  await page.goto("/home");
  await send(page, `open ${investorName}, duplicate journey`);
  await expect(page).toHaveURL(new RegExp(`${path}(\\?|$)`, "u"), {
    timeout: 60_000,
  });
  await expect
    .poll(() => posts.find((body) => body.includes(path)) ?? null, {
      timeout: 30_000,
    })
    .not.toBeNull();
  const original = posts.find((body) => body.includes(path)) ?? "";
  const navigations =
    (JSON.parse(original) as { navigations?: { intentId?: string }[] })
      .navigations ?? [];
  expect(
    navigations.every((n) => typeof n.intentId === "string"),
    "receipts carry an intent id",
  ).toBe(true);
  // The same receipt again, as a retried keepalive POST would send it.
  const replay = await page.request.post("/api/q-ui-acts", {
    data: original,
    headers: { "content-type": "application/json" },
  });
  const body = (await replay.json().catch(() => null)) as {
    accepted?: unknown;
  } | null;
  expect
    .soft(replay.status(), "the replay is accepted as a no-op")
    .toBeLessThan(300);
  expect.soft(body?.accepted, "nothing counted twice").toBe(0);
  const outcomes = (await moves(page)).outcomes.filter(
    (o) => pathOf(o.expected) === path,
  );
  expect.soft(outcomes, "one execution in the browser").toHaveLength(1);
  await page.context().close();
});

test("E6 insufficient permission: another firm's chat is refused, and Q never opens it", async ({
  browser,
}) => {
  const relationship = relationshipId(
    company.companyId,
    investor.investorOrganisationId,
  );
  const api = await call(
    CAST.unrelatedInvestor,
    "api",
    "GET",
    `/v1/relationships/${relationship}/messages`,
  );
  expect(
    isRefusal(api),
    `another firm reads the chat: ${String(api.status)}`,
  ).toBe(true);
  const brief = await call(
    CAST.unrelatedInvestor,
    "api",
    "GET",
    `/v1/network/relationships/${relationship}/brief`,
  );
  expect(
    isRefusal(brief),
    `another firm reads the brief: ${String(brief.status)}`,
  ).toBe(true);

  const target = `/relationships/company/${company.companyId}/messages`;
  const page = await (
    await contextAs(browser, CAST.unrelatedInvestor)
  ).newPage();
  await watchMoves(page);
  await recordReceipts(page);
  await useScript([
    SKIM_OTHER,
    READ_QUESTION,
    {
      name: "e6-open",
      when: { task: "COMPANY_ANALYST", user: "chat with", afterTool: null },
      reply: {
        toolCalls: [
          {
            name: "open_page",
            arguments: {
              page: "RELATIONSHIP_COMPANY_MESSAGES",
              id: company.companyId,
            },
          },
        ],
      },
    },
    {
      name: "e6-answer",
      when: { task: "COMPANY_ANALYST", afterTool: "open_page" },
      reply: answer(`Opening your chat with ${company.name}…`),
    },
  ]);
  await page.goto("/home");
  await send(page, `open my chat with ${company.name}`);
  await page.waitForTimeout(12_000);
  const log = await moves(page);
  expect
    .soft(
      log.outcomes.filter(
        (o) => pathOf(o.expected) === target && o.status === "DONE",
      ),
    )
    .toEqual([]);
  expect
    .soft(
      log.opened.map((o) => o.text),
      "Q never says it opened",
    )
    .toEqual([]);
  // Nothing of the chat is on screen, wherever the browser is.
  const body = await page.locator("body").innerText();
  expect.soft(body).not.toMatch(/G2 [0-9a-f]{6}:/u);
  await expect.soft(page.locator("[data-relationship-brief]")).toHaveCount(0);
  await page.context().close();
});
