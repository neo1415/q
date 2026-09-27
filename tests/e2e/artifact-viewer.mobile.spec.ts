import { expect, test } from "@playwright/test";

/**
 * R36 · on a phone the document viewer is a full-screen sheet that can be
 * pulled down by its header to close.
 */
test("the document sheet fills the phone and closes when pulled down", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.goto("/home");
  const composer = page.getByRole("textbox", { name: "Ask Q" });
  await composer.fill("Prepare a short investment brief about my company.");
  await composer.press("Enter");

  // The answer's card, on the page or on the Board sheet.
  const card = page.locator('[data-q-artifact-card="READY"]').first();
  await expect(card).toBeVisible({ timeout: 180_000 });
  await card.getByRole("button", { name: "Open" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box?.width).toBe(viewport?.width);
  expect(box?.y).toBe(0);

  // Pull the header down, as a finger would.
  const header = dialog.locator("header[data-cq-sheet-drag]");
  const at = await header.boundingBox();
  if (at === null) throw new Error("no header");
  const x = at.x + at.width / 2;
  const y = at.y + 10;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 80, { steps: 4 });
  await page.mouse.move(x, y + 220, { steps: 4 });
  await page.mouse.up();
  await expect(dialog).toHaveCount(0);
});
