import { expect, test } from "@playwright/test";

/**
 * The Q page is the voice stage (founder direction, 2026-09-25): the
 * aperture, Q's words as a caption, Talk as the way in and typing beside
 * it, never a chat log. Without a microphone already granted the page
 * never asks for one on arrival -- Talk does.
 */

test("opens as the voice stage, with Talk first and typing beside it", async ({
  page,
}) => {
  const asked: string[] = [];
  await page.addInitScript(() => {
    const original = navigator.mediaDevices?.getUserMedia?.bind(
      navigator.mediaDevices,
    );
    if (original === undefined) return;
    navigator.mediaDevices.getUserMedia = (constraints) => {
      Reflect.set(window, "__askedForMic", true);
      return original(constraints);
    };
  });
  page.on("dialog", (dialog) => {
    asked.push(dialog.message());
    void dialog.dismiss();
  });
  await page.goto("/home");
  const stage = page.locator("[data-q-workspace]");
  await expect(stage).toHaveAttribute("data-q-stage", "ready");
  await expect(page.locator("[data-q-workspace] .cq-aperture")).toBeVisible();
  await expect(page.getByRole("button", { name: "Talk with Q" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ask Q" })).toBeVisible();
  // No microphone was requested just by arriving.
  await page.waitForTimeout(1500);
  expect(
    await page.evaluate(() => Reflect.get(window, "__askedForMic") === true),
  ).toBe(false);
  expect(asked).toEqual([]);
  // The stage is the page: it fills the workspace, and there is no thread
  // of message bubbles on it.
  const box = await page.locator(".cq-q-home").boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(
    (page.viewportSize()?.height ?? 900) - 2,
  );
  await expect(page.locator("[data-q-workspace] ol[aria-live]")).toHaveCount(0);
});

test("keeps an answer's evidence behind one closed disclosure", async ({
  page,
}) => {
  await page.goto("/home");
  // Evidence, where an answer has any, starts closed.
  for (const details of await page.locator("[data-q-evidence]").all()) {
    expect(await details.getAttribute("open")).toBeNull();
  }
});
