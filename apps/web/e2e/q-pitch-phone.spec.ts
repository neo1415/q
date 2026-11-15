import { expect, test } from "@playwright/test";

/**
 * Live 2026-11-15 (/q-pitch at 390): the story's narration played and its
 * pages changed, but its stage, captions and controls were hidden with
 * the phone's closed page sheet, so the viewer saw only Q's home and
 * could not pause, skip or end. The story is mounted with the page, as
 * the app's layout mounts it; on a phone the sheet is closed first.
 */
test("the story's start, captions and controls show over a closed page sheet", async ({
  page,
}, testInfo) => {
  await page.goto("/dev/workspace?ws=on&story=1&edition=investor");
  if (testInfo.project.name === "phone") {
    // Q's home on a phone: the page sheet closed, as on /home.
    await page.locator("[data-ws-back-to-q]").click();
    await expect(page.locator("[data-ws-page]")).toHaveAttribute(
      "data-ws-sheet",
      "closed",
    );
  }

  const gate = page.getByRole("dialog", { name: "Q Story" });
  await expect(gate).toBeVisible();
  const captionsOnly = gate.getByRole("button", { name: "Captions only" });
  await expect(captionsOnly).toBeEnabled({ timeout: 30_000 });
  await captionsOnly.click();

  const controls = page.getByRole("navigation", { name: "Story controls" });
  await expect(controls).toBeVisible();
  const viewport = page.viewportSize();
  const box = await controls.boundingBox();
  expect(box).not.toBeNull();
  if (box !== null && viewport !== null) {
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
  }
  await expect(page.locator(".cq-story-captions")).toBeVisible();

  // Every control a thumb can reach: 44 px at least.
  for (const name of ["Previous beat", "Pause", "Next beat", "End"]) {
    const button = controls.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    const size = await button.boundingBox();
    expect(size?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(size?.width ?? 0).toBeGreaterThanOrEqual(44);
  }

  // The controls step back while the story plays; a pointer brings them
  // back.
  await page.mouse.move(100, 300);
  await page.mouse.move(120, 320);
  await controls.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    controls.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  const count = controls.locator(".cq-story-count");
  const before = await count.textContent();
  await controls.getByRole("button", { name: "Next beat" }).click();
  await expect(count).not.toHaveText(before ?? "");
});
