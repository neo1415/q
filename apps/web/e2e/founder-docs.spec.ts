import { expect, test } from "@playwright/test";

/**
 * Founder documents (2026-10-08) in a real browser, over the
 * `/dev/founder-docs` harness's fictional data: the Documents tabs, a
 * notification's deep link opening one request focused, answering inline,
 * the data room's intersection marks, and the access sheet with all eight
 * scopes in words. Nothing reaches the API, the database or a provider: a
 * server action here has no session and says so.
 */

const QUESTIONS = "00000000-0000-4000-8000-000000000501";
const ACCOUNTS = "00000000-0000-4000-8000-000000000401";

test("the Requested tab lists who asked for what, open first", async ({
  page,
}) => {
  await page.goto("/dev/founder-docs?view=requested");
  const tabs = page.getByRole("tablist", { name: "Documents" });
  await expect(tabs.getByRole("tab")).toHaveText([
    "My documents",
    /Requested.*3 open/,
    "Data room",
  ]);
  await expect(tabs.getByRole("tab", { name: /Requested/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  const first = page.locator("[data-request-item]").first();
  await expect(first).toHaveAttribute("data-request-item", ACCOUNTS);
  await expect(first).toContainText("Ada Nwosu");
  await expect(first).toContainText("before our IC on the 14th");
  await expect(
    first.getByRole("button", { name: "Upload and share" }),
  ).toBeVisible();
  // Every control is a comfortable target.
  const box = await first
    .getByRole("button", { name: "Upload and share" })
    .boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  await page.getByRole("button", { name: "Declined · 1" }).click();
  await expect(page.locator("[data-request-item]")).toHaveCount(1);
  await expect(page.locator("[data-request-item]")).toContainText(
    "We'll share these after a term sheet.",
  );
});

test("a notification opens its item, focused, with the first question open", async ({
  page,
}) => {
  await page.goto(`/dev/founder-docs?view=requested&item=${QUESTIONS}`);
  const set = page.locator(`#request-${QUESTIONS}`);
  await expect(set).toBeFocused();
  await expect(set).toBeInViewport();
  const text = set.locator("[data-question-text]");
  await expect(text).toBeVisible();
  const send = set.getByRole("button", { name: "Send answer" });
  await expect(send).toBeDisabled();
  await text.fill("118 paid in July, 124 in August and 131 in September.");
  await expect(send).toBeEnabled();
  await expect(set).toContainText("Recorded as your claim.");
  // The answered one reads as the founder's claim, with its document.
  await expect(set.locator('[data-question-answered="true"]')).toContainText(
    "your claim, with a document",
  );
});

test("declining says plainly when it can't go through", async ({ page }) => {
  await page.goto("/dev/founder-docs?view=requested");
  const card = page.locator(`[data-request-item="${ACCOUNTS}"]`);
  await card.getByRole("button", { name: "Decline", exact: true }).click();
  await card.getByRole("textbox").fill("After a term sheet.");
  await card.getByRole("button", { name: "Decline request" }).click();
  // No session in the harness: the action refuses, in words.
  await expect(card.getByRole("alert")).toContainText("didn't go through");
});

test("the data room marks what was requested, and the access sheet names every scope", async ({
  page,
}) => {
  await page.goto("/dev/founder-docs?view=dataroom");
  await expect(page.locator("[data-requested-mark]").first()).toBeVisible();
  await expect(page.getByText(/Requested by Kiln Ventures/)).toBeVisible();
  await page
    .locator('[data-document-access="00000000-0000-4000-8000-000000000303"]')
    .click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("Who can see this document");
  await expect(sheet.locator("[data-scope-choice]")).toHaveCount(4);
  await expect(
    sheet.locator('[data-scope-choice="SHARED_ONLY"] input'),
  ).toBeChecked();
  await sheet.getByText("5 more aren't offered for company documents").click();
  await expect(sheet).toContainText("Anyone on the web");
  await expect(sheet.locator("[data-access-grant]")).toHaveCount(2);
  await expect(sheet.locator("[data-access-history]")).toContainText(
    "revoked for Harbour Lane Partners",
  );
});

test("the investor sees a decline's words and the founder's answer", async ({
  page,
}) => {
  await page.goto("/dev/founder-docs?view=investor");
  await expect(page.locator("[data-room-declined]")).toContainText(
    "after a term sheet",
  );
  await expect(
    page.locator('[data-assumption-asked="ANSWERED"]'),
  ).toContainText("Founder's answer");
  await expect(page.locator('[data-assumption-asked="WAITING"]')).toContainText(
    "waiting for an answer",
  );
});

test("before the founder accepts, the investor's data room is locked, with how to get in", async ({
  page,
}) => {
  await page.goto("/dev/founder-docs?view=locked");
  const room = page.locator('[data-data-room="investor-locked"]');
  await expect(room).toContainText(
    "Express interest to request data-room access.",
  );
  await expect(
    room.locator("[data-locked-cta]").getByRole("button").first(),
  ).toBeVisible();
  await expect(room).not.toContainText("Unit economics");
  await expect(room.locator("[data-locked-outline]")).toHaveCount(0);

  await page.goto("/dev/founder-docs?view=pending");
  const waiting = page.locator('[data-data-room="investor-locked"]');
  await expect(waiting).toContainText("Your interest is with Ledgerline");
  await expect(waiting.locator("[data-locked-outline]")).toContainText(
    "Financials",
  );
});

test("the founder shares only with connected investors, and sees who to connect first", async ({
  page,
}) => {
  await page.goto("/dev/founder-docs?view=dataroom");
  await expect(page.locator("[data-room-outline-setting]")).toContainText(
    "Before you connect",
  );
  await page.goto("/dev/founder-docs?view=access");
  const sheet = page.getByRole("dialog");
  await expect(sheet.locator("[data-access-explain]")).toHaveText(
    "You can share with investors you're connected to.",
  );
  await expect(sheet.locator("[data-access-awaiting]")).toContainText(
    "Meridian Seed (fictional)",
  );
  await expect(
    sheet.locator("[data-access-candidate] option", {
      hasText: "Meridian Seed",
    }),
  ).toHaveCount(0);
});
