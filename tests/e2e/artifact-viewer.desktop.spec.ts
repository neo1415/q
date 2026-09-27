import { expect, test } from "@playwright/test";

/**
 * R36 · artifact and media viewers.
 *
 * A document Q prepares lands as a compact card (type, title, status, Open,
 * one download control); Open shows a large modal that takes focus, keeps
 * Tab inside, closes on Escape and gives focus back to Open. A deck pages
 * with its count and the arrow keys. On the Pitch & media page a pitch is
 * a poster until Play is pressed, and nothing ever plays two at once.
 */
test("a document opens in a modal that keeps and returns focus", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/home");
  const composer = page.getByRole("textbox", { name: "Ask Q" });
  await composer.fill("Prepare a short investment brief about my company.");
  await composer.press("Enter");

  const card = page.locator('[data-q-artifact-card="READY"]').first();
  await expect(card).toBeVisible({ timeout: 180_000 });
  const open = card.getByRole("button", { name: "Open" });
  await expect(open).toBeVisible();
  // One download control: a PDF button for a brief, a menu for a deck.
  await expect(
    card
      .getByRole("link", { name: "Download PDF" })
      .or(card.getByRole("button", { name: /Download/ })),
  ).toHaveCount(1);

  await open.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.locator("[data-q-artifact-body]")).toBeVisible({
    timeout: 30_000,
  });
  // The page behind does not scroll while the modal is open.
  const locked = await page.evaluate(() =>
    [document.documentElement, document.body].some(
      (element) => getComputedStyle(element).overflow === "hidden",
    ),
  );
  expect(locked).toBe(true);

  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("Tab");
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document
              .querySelector('[role="dialog"]')
              ?.contains(document.activeElement) ?? false,
        ),
      )
      .toBe(true);
  }

  // A deck pages with the arrow keys; a brief has no pager.
  const pager = dialog.locator("[data-q-artifact-page]");
  if ((await pager.count()) > 0) {
    await expect(pager).toContainText("1");
    await dialog.getByRole("button", { name: "Next slide" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByAltText("Slide 2")).toBeVisible();
  }

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(open).toBeFocused();
});

test("a pitch on the Pitch & media page is a poster until Play", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/pitch");
  const player = page.locator("[data-pitch-player]").first();
  // A founder with no pitch yet has nothing to play; that is not a failure.
  if ((await player.count()) === 0) {
    test.skip(true, "this founder has no pitch to preview");
  }
  await expect(player).toBeVisible({ timeout: 30_000 });
  const video = player.locator("video");
  // Poster first: no media source until Play is pressed.
  await expect(video).not.toHaveAttribute("src", /.+/);
  expect(await page.locator('video[preload="auto"]').count()).toBe(0);

  await player.getByRole("button", { name: "Play" }).click();
  await expect(video).toHaveAttribute("src", /.+/, { timeout: 30_000 });
  await expect(video).toHaveJSProperty("muted", true);

  const playing = await page.evaluate(
    () =>
      [...document.querySelectorAll("video")].filter((v) => !v.paused).length,
  );
  expect(playing).toBeLessThanOrEqual(1);
});
