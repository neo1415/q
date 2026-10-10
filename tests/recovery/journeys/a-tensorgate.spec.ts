import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { ask, recordReceipts } from "../support/q.js";
import {
  answer,
  useScript,
  vendorMark,
  vendorSettled,
  type ScriptRule,
} from "../support/script.js";
import { CAST, world } from "../support/stack.js";
import {
  READ_QUESTION,
  SKIM_OTHER,
  scheduledCallFixture,
  dayText,
  factTime,
  inputAfterSince,
  latestMessage,
  messageEventCount,
  nextScheduledMeeting,
  readBrief,
  relationshipId,
  sendMessage,
  watchMoves,
  type DbMeeting,
} from "./journey-fixtures.js";

/**
 * Journey A, "TensorGate" (founder 2026-10-09: Q said "no message has been
 * sent" while the thread held twelve messages and a booked call). The
 * investor (Savanna Seed) and Ledgerfold have a connected relationship in
 * the seed; the test adds messages from both sides (the founder's last)
 * and one SCHEDULED call, then asks Q in the browser. Each fact is read
 * three ways: the database row, the Relationship Brief Q's tool was given
 * (the fake vendor logs the tool result the model read), and the screen.
 * The model's final words are scripted; what is under test is that the
 * facts it is handed and the screen it opens agree with the database.
 */
const company = world().company(CAST.founderCompanyKey);
const investor = world().investor("savanna-seed");

let page: Page;
let relationship: string;
let meeting: DbMeeting;

test.beforeAll(async ({ browser }) => {
  relationship = relationshipId(
    company.companyId,
    investor.investorOrganisationId,
  );
  const tag = randomUUID().slice(0, 6);
  await sendMessage(CAST.investor, relationship, `G2 ${tag}: how is Q4?`);
  await sendMessage(
    CAST.founder,
    relationship,
    `G2 ${tag}: collections are up, deck attached soon.`,
  );
  const startsAt = new Date(Date.now() + 3 * 86_400_000);
  startsAt.setUTCHours(10, 0, 0, 0);
  meeting =
    nextScheduledMeeting(relationship) ??
    scheduledCallFixture(CAST.founder, relationship, startsAt);
  page = await (await contextAs(browser, CAST.investor)).newPage();
  await watchMoves(page);
  await recordReceipts(page);
});

test.afterAll(async () => {
  await page?.context().close();
});

function relationshipTurn(
  key: string,
  words: string,
  reply: string,
): ScriptRule[] {
  return [
    {
      name: `a-${key}-tool`,
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
      name: `a-${key}-answer`,
      when: {
        task: "COMPANY_ANALYST",
        user: words,
        afterTool: "get_relationship",
      },
      reply: answer(reply),
    },
  ];
}

test("A1 'what's happening with Ledgerfold?': Q's brief = DB count, latest sender and the call", async () => {
  const count = messageEventCount(relationship);
  const latest = latestMessage(relationship);
  expect(count, "the thread has messages").toBeGreaterThanOrEqual(2);
  expect(latest?.side, "the founder wrote last").toBe("COMPANY");
  const brief = await readBrief(CAST.investor, relationship);
  // The brief itself against the rows it is built from.
  expect
    .soft(brief.messages.count, "brief count = message_sent events")
    .toBe(count);
  expect.soft(brief.messages.latest.status).toBe("OK");
  const last =
    brief.messages.latest.status === "OK"
      ? brief.messages.latest.message
      : null;
  expect.soft(last?.from, "latest is the other side").toBe("OTHER_SIDE");
  expect.soft(last?.sentAt.slice(0, 19)).toBe(latest?.sentAt.slice(0, 19));
  expect.soft(brief.meetings.status).toBe("OK");
  const next =
    brief.meetings.status === "OK" ? brief.meetings.nextScheduled : null;
  expect.soft(next?.id, "brief's next call = the DB's").toBe(meeting.id);
  expect.soft(next?.startsAt.slice(0, 16)).toBe(meeting.startsAt.slice(0, 16));

  const them = brief.counterparty.name ?? company.name;
  const words = `happening with ${company.name}`;
  await useScript([
    SKIM_OTHER,
    READ_QUESTION,
    ...relationshipTurn(
      "happening",
      words,
      `${String(count)} messages so far; the latest is from ${last?.senderName ?? "them"}. A call is booked for ${factTime(meeting.startsAt)}.`,
    ),
  ]);
  await vendorSettled();
  const mark = await vendorMark();
  await page.goto("/home");
  const shown = await ask(page, `What's ${words}?`);
  const read = await inputAfterSince(mark, "a-happening-answer");
  expect(
    read.length,
    "Q's model was handed get_relationship's result",
  ).toBeGreaterThan(0);
  expect
    .soft(read, "tool: count and latest sender")
    .toContain(
      `${String(count)} message(s) in the chat with ${them}; the latest was sent by ${last?.senderName ?? "?"} at ${them} at ${factTime(latest?.sentAt ?? "")}`,
    );
  expect
    .soft(read, "tool: the booked call")
    .toContain(
      `A call is booked (scheduled) for ${factTime(meeting.startsAt)}.`,
    );
  expect
    .soft(read, "never 'none' while messages exist")
    .not.toContain("No messages have been sent");
  await expect.soft(shown).toContainText(`${String(count)} messages`);
  await expect.soft(shown).toContainText(factTime(meeting.startsAt));
});

test("A2 'did they accept the meeting?': the tool says SCHEDULED at the DB's time", async () => {
  const words = "did they accept the meeting";
  await useScript([
    SKIM_OTHER,
    READ_QUESTION,
    ...relationshipTurn(
      "accept",
      words,
      `Yes. The call is booked for ${factTime(meeting.startsAt)}.`,
    ),
  ]);
  await vendorSettled();
  const mark = await vendorMark();
  await page.goto("/home");
  const shown = await ask(page, `${company.name}: ${words}?`);
  const read = await inputAfterSince(mark, "a-accept-answer");
  expect(read.length, "get_relationship answered").toBeGreaterThan(0);
  expect
    .soft(read)
    .toContain(
      `A call is booked (scheduled) for ${factTime(meeting.startsAt)}.`,
    );
  expect.soft(read).not.toContain(`No call has been booked`);
  const db = nextScheduledMeeting(relationship);
  expect.soft(db?.status).toBe("SCHEDULED");
  await expect.soft(shown).toContainText(factTime(meeting.startsAt));
});

test("A3 Q opens the conversation: the browser lands on the chat and shows the brief's count", async () => {
  const say = `Open my chat with ${company.name}`;
  const route = `/relationships/company/${company.companyId}/messages`;
  await useScript([
    SKIM_OTHER,
    READ_QUESTION,
    {
      name: "a-open-chat",
      when: { task: "COMPANY_ANALYST", user: say, afterTool: null },
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
      name: "a-open-chat-answer",
      when: { task: "COMPANY_ANALYST", afterTool: "open_page" },
      reply: answer(`Opening your chat with ${company.name}…`),
    },
  ]);
  await page.goto("/home");
  await ask(page, say);
  await expect(page).toHaveURL(new RegExp(`${route}$`, "u"), {
    timeout: 60_000,
  });
  // Page marker: the chat is a full-screen thread (no tab bar of its own).
  await expect(
    page.getByRole("log", { name: `Messages with ${company.name}` }),
  ).toBeVisible();
  const count = messageEventCount(relationship);
  // The overview's tab badge and lines say what Q's brief said.
  await page.goto(`/relationships/company/${company.companyId}`);
  await expect
    .soft(
      page
        .getByRole("navigation", { name: "Relationship" })
        .getByRole("link", { name: /Messages/u }),
      "tab badge = DB message_sent count",
    )
    .toContainText(String(count));
  const standing = page.locator("[data-relationship-brief]");
  const latest = latestMessage(relationship);
  await expect
    .soft(standing)
    .toContainText(
      `${String(count)} messages, latest from ${company.name} on ${dayText(latest?.sentAt ?? "")}`,
    );
  await expect
    .soft(standing)
    .toContainText(`Call booked for ${dayText(meeting.startsAt)}`);
  await expect.soft(standing).not.toContainText("No messages yet");
});

test("A4 Q opens their profile: the browser lands on the company's profile", async () => {
  const say = `Open ${company.name}'s profile`;
  const route = `/company/${company.companyId}`;
  await useScript([
    SKIM_OTHER,
    READ_QUESTION,
    {
      name: "a-open-profile",
      when: { task: "COMPANY_ANALYST", user: "profile", afterTool: null },
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
      name: "a-open-profile-answer",
      when: { task: "COMPANY_ANALYST", afterTool: "open_page" },
      reply: answer(`Opening ${company.name}…`),
    },
  ]);
  await page.goto("/home");
  await ask(page, say);
  await expect(page).toHaveURL(new RegExp(`${route}(\\?|$)`, "u"), {
    timeout: 60_000,
  });
  await expect(page.locator("[data-company-profile]")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 }).first()).toContainText(
    company.name,
  );
});
