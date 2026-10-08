import { expect, test } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { awaits } from "../support/expected-red.js";
import { call } from "../support/http.js";
import { ask, expectLastTurnTerminal, recordReceipts } from "../support/q.js";
import {
  answer,
  useScript,
  vendorMark,
  vendorRequestsSince,
} from "../support/script.js";
import { CAST, world } from "../support/stack.js";

/**
 * SPEC §5 Scenario C: open the deck, read its financials, find
 * inconsistencies, download it, delete it with confirmation. Delete is
 * consequential: Prepare → Approve (the exact target and consequence shown)
 * → Execute, and archive is a different thing from delete (SPEC §4.2).
 */
const deck = world().company("ledgerfold").deck;

test("Scenario C: open, read, check, download, and delete only after confirming", async ({
  browser,
}) => {
  awaits(
    ["C4", "B6", "G-R1", "G-R3"],
    "document control (open/read/download/delete-confirm) through app actions is C4, not in the baseline",
  );
  expect(deck, "the seed made Ledgerfold a deck").toBeDefined();
  const title = deck?.title ?? "";
  const context = await contextAs(browser, CAST.founder, {
    acceptDownloads: true,
  });
  const page = await context.newPage();
  await recordReceipts(page);
  await page.goto("/documents");

  // Open: the document viewer shows the deck by its title.
  await useScript([
    {
      name: "open",
      when: { task: "COMPANY_ANALYST", user: "open my deck", afterTool: null },
      reply: {
        toolCalls: [
          { name: "open_page", arguments: { page: "DOCUMENT", name: title } },
        ],
      },
    },
    {
      name: "after-open",
      when: {
        task: "COMPANY_ANALYST",
        user: "open my deck",
        afterTool: "open_page",
      },
      reply: answer("Here is your deck."),
    },
  ]);
  await ask(page, "open my deck");
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  // Read: the model is given the deck's own text, as data (never as instructions).
  const mark = await vendorMark();
  await useScript([
    {
      name: "read",
      when: { task: "COMPANY_ANALYST", user: "financials" },
      reply: answer("Revenue and burn are on slides 7 and 8."),
    },
  ]);
  await ask(page, "read me the financials and tell me what is inconsistent");
  const seen = await vendorRequestsSince(mark);
  expect(
    seen.some((request) => /UNTRUSTED_CONTENT/u.test(request.input ?? "")),
    "deck text arrives inside the untrusted-content markers",
  ).toBe(true);

  // Download: a real file arrives.
  await useScript([
    {
      name: "download",
      when: { task: "COMPANY_ANALYST", user: "download it", afterTool: null },
      reply: {
        toolCalls: [
          { name: "control_document", arguments: { act: "DOWNLOAD" } },
        ],
      },
    },
    {
      name: "after-download",
      when: {
        task: "COMPANY_ANALYST",
        user: "download it",
        afterTool: "control_document",
      },
      reply: answer("Downloading."),
    },
  ]);
  const downloading = page.waitForEvent("download", { timeout: 60_000 });
  await ask(page, "download it");
  const file = await downloading;
  expect(file.suggestedFilename()).toMatch(/\.(pdf|pptx)$/u);

  // Delete: Q prepares; nothing is deleted until the person confirms on a
  // card that names the exact document and says it cannot be undone.
  await useScript([
    {
      name: "delete",
      when: {
        task: "COMPANY_ANALYST",
        user: "delete this deck",
        afterTool: null,
      },
      reply: {
        toolCalls: [{ name: "control_document", arguments: { act: "DELETE" } }],
      },
    },
    {
      name: "after-delete",
      when: {
        task: "COMPANY_ANALYST",
        user: "delete this deck",
        afterTool: "control_document",
      },
      reply: answer("Confirm on the card if you want it gone."),
    },
  ]);
  await ask(page, "delete this deck");
  const card = page.locator("[data-q-approval-card]").last();
  await expect(card).toContainText(title);
  await expect(card).toContainText(/delete/iu);
  await expect(card).toContainText(/can(no|')t be undone|permanently/iu);
  // Still there before confirming.
  const before = await call(
    CAST.founder,
    "q-api",
    "GET",
    `/v1/q/artifacts/${deck?.artifactId ?? ""}`,
  );
  expect(before.status).toBe(200);
  await card
    .getByRole("button", { name: /^(Delete|Confirm|Approve)/u })
    .click();
  await expect
    .poll(
      async () =>
        (
          await call(
            CAST.founder,
            "q-api",
            "GET",
            `/v1/q/artifacts/${deck?.artifactId ?? ""}`,
          )
        ).status,
      { timeout: 30_000 },
    )
    .toBe(404);
  await expectLastTurnTerminal(page, ["ACTED", "ANSWERED"]);
  await context.close();
});

test("archive is not delete: an archived document can be found again", async ({
  browser,
}) => {
  awaits(["C4"], "archive as a distinct app action is C4");
  const context = await contextAs(browser, CAST.otherFounder);
  const page = await context.newPage();
  const tarmacly = world().company("tarmacly").deck;
  await page.goto("/documents");
  await useScript([
    {
      name: "archive",
      when: {
        task: "COMPANY_ANALYST",
        user: "archive my deck",
        afterTool: null,
      },
      reply: {
        toolCalls: [
          {
            name: "control_document",
            arguments: { act: "ARCHIVE", name: tarmacly?.title ?? "" },
          },
        ],
      },
    },
    {
      name: "after-archive",
      when: { task: "COMPANY_ANALYST", afterTool: "control_document" },
      reply: answer("Archived; you can restore it."),
    },
  ]);
  await ask(page, "archive my deck");
  const read = await call(
    CAST.otherFounder,
    "q-api",
    "GET",
    `/v1/q/artifacts/${tarmacly?.artifactId ?? ""}`,
  );
  expect(read.status, "an archived document still exists for its owner").toBe(
    200,
  );
  expect(read.text).toMatch(/ARCHIVED/u);
  await context.close();
});
