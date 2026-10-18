import { expect, test } from "@playwright/test";

/**
 * "Please make sure Q is persistent across navigation" (Zino, 2026-10-08).
 * The app's own Q store sits in a layout that stays while pages change; a
 * scripted voice line stands in for the provider. A line opened on the Q
 * page carries on through another page and back to a bare Q page: no
 * reconnect, the captions and the conversation kept, and no full reload.
 */

test("the voice line, its captions and the conversation survive navigation", async ({
  page,
}) => {
  await page.goto("/dev/q-nav");
  await page.locator("[data-harness-talk]").click();
  await expect(page.locator("[data-harness-voice-active]")).toHaveAttribute(
    "data-harness-voice-active",
    "on",
  );
  await page.locator("[data-harness-q-says]").click();
  const captions = page.locator("[data-harness-captions] li");
  await expect(captions).toHaveText(["Three things need you today."]);
  const conversation = await page
    .locator("[data-harness-conversation]")
    .textContent();
  expect(conversation).toMatch(/^c0ffee00-/u);
  // A marker that only survives client-side navigation.
  await page.evaluate(() => {
    (window as Window & { cqSameDocument?: boolean }).cqSameDocument = true;
  });

  await page.locator('[data-harness-link="work"]').click();
  await expect(page.locator("[data-harness-work]")).toBeVisible();
  await expect(page.locator("[data-harness-voice-active]")).toHaveAttribute(
    "data-harness-voice-active",
    "on",
  );
  await expect(captions).toHaveText(["Three things need you today."]);
  await page.locator("[data-harness-q-says]").click();
  await expect(captions).toHaveCount(2);

  // Back to a bare Q page: the conversation and its captions stay.
  await page.locator('[data-harness-link="q"]').click();
  await expect(page.locator("[data-harness-work]")).toHaveCount(0);
  await expect(captions).toHaveCount(2);
  await expect(page.locator("[data-harness-conversation]")).toHaveText(
    conversation ?? "",
  );
  await expect(page.locator("[data-harness-voice-active]")).toHaveAttribute(
    "data-harness-voice-active",
    "on",
  );
  const kept = await page.evaluate(() => {
    const own = window as Window & {
      cqSameDocument?: boolean;
      cqDevVoiceOpens?: number;
    };
    return { same: own.cqSameDocument, opens: own.cqDevVoiceOpens };
  });
  // One line the whole way (never reconnected), one document.
  expect(kept).toEqual({ same: true, opens: 1 });
});
