import { expect, test } from "@playwright/test";

/**
 * The Q Dock on a phone (spec §6.2): a corner inside the safe areas, above
 * the bottom navigation and clear of it, a 44 px target, and the header
 * no longer carries a second Q button.
 */
test("sits bottom-right above the navigation, clear of it", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem("cq.e2e.dock-reset") === null) {
      localStorage.removeItem("cq.q-dock.v1");
      sessionStorage.setItem("cq.e2e.dock-reset", "1");
    }
  });
  await page.goto("/profile");
  const button = page.locator("[data-q-dock] [data-q-dock-button]");
  await expect(button).toBeVisible();
  const box = await button.boundingBox();
  const nav = await page
    .getByRole("navigation", { name: "Primary" })
    .boundingBox();
  if (box === null || nav === null) throw new Error("missing");
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.y + box.height).toBeLessThanOrEqual(nav.y);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  expect(box.x).toBeGreaterThan(390 / 2);
  await expect(
    page.getByRole("banner").getByRole("button", { name: "Ask Q" }),
  ).toHaveCount(0);

  // Opening Q is a bottom sheet with the same conversation.
  await button.tap();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("dialog").getByRole("link", { name: "Open Q" }),
  ).toBeVisible();
});
