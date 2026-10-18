import { expect, test } from "@playwright/test";

/**
 * Settings (R28): reached from the sidebar, holding the theme, Q motion
 * and Q's voice, with notifications honestly marked as coming later.
 */
test("Settings holds theme, Q motion, voice and notifications", async ({
  page,
}) => {
  await page.goto("/discover");
  await page
    .getByRole("complementary")
    .getByRole("link", { name: "Settings" })
    .click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(
    page.getByRole("heading", { name: "Settings", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Appearance" })).toBeVisible();
  await expect(page.getByText("Q motion", { exact: true })).toBeVisible();

  const voice = page.getByRole("group", { name: "Q's voice" });
  await voice.getByRole("button", { name: "Male voice" }).click();
  await expect(
    voice.getByRole("button", { name: "Male voice" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(
    page
      .getByRole("group", { name: "Q's voice" })
      .getByRole("button", { name: "Male voice" }),
  ).toHaveAttribute("aria-pressed", "true");

  await expect(page.getByText(/Coming soon/)).toBeVisible();
});
