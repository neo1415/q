import { expect, test, type Page } from "@playwright/test";

/**
 * Founder P5: "Q, clear all cards" is presentation only.
 *
 * Meant for the lead to run against a signed-in session on production
 * (a baseURL and storage state for a person with Needs You items). It
 * types the phrases into the Q composer and checks that:
 *  - the cards leave the screen and take no layout space;
 *  - no approval, decision, message, document or meeting request is sent;
 *  - the hiding holds across in-app navigation and returns on "show me the
 *    cards again" or the Show again button.
 * It skips itself on an account with no cards on the Q page.
 */

const CARDS =
  "[data-arrival-needs] article, [data-arrival-matches] article, [data-arrival-attention-item], [data-ac-card], [data-q-calendar-connect]";

async function say(page: Page, words: string) {
  const composer = page.locator("[data-q-composer-input]").first();
  await composer.fill(words);
  await composer.press("Enter");
}

test("clearing cards by words is presentation only and reversible", async ({
  page,
}) => {
  const writes: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() !== "GET" &&
      /approv|decid|reject|delete|cancel|meeting|document|message/iu.test(
        url.pathname,
      )
    ) {
      writes.push(`${request.method()} ${url.pathname}`);
    }
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const cards = page.locator(CARDS);
  test.skip((await cards.count()) === 0, "no cards on this account's Q page");
  const before = await cards.count();
  expect(before).toBeGreaterThan(0);

  // By typed words (the voice path reads the same sentence by the same code).
  await say(page, "Q, clear all cards");
  await expect(cards).toHaveCount(0);
  await expect(page.locator("[data-q-cards-show]")).toBeVisible();

  // Holds across in-app navigation, then returns on the Q page.
  await page.evaluate(() => {
    (window as Window & { cqSameDocument?: boolean }).cqSameDocument = true;
  });
  await page.locator('a[href^="/work"]').first().click();
  await page.locator('a[href="/"]').first().click();
  await expect(cards).toHaveCount(0);

  // Restore by words.
  await say(page, "show me the cards again");
  await expect(cards).toHaveCount(before);

  // Click twins.
  await page.locator("[data-q-cards-clear]").click();
  await expect(cards).toHaveCount(0);
  await page.locator("[data-q-cards-show]").click();
  await expect(cards).toHaveCount(before);

  // A category, by words.
  await say(page, "hide the connection cards");
  await say(page, "show me the cards again");
  await expect(cards).toHaveCount(before);

  // Nothing was approved, rejected, deleted or cancelled on the way.
  expect(writes).toEqual([]);
});
