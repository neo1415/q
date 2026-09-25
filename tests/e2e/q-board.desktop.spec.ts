import { expect, test } from "@playwright/test";

/**
 * Stage + Board (ADR 0017 F3; spec §15 UX-04): an answer lands on the
 * Board as a typed object with its exchange one press away; Now says what
 * is running and what waits on the person; the linear transcript is a
 * secondary, complete view; there is no scrolling message list on the
 * default layout.
 */
test("an answer lands on the Board as an object, and the transcript is complete", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/home");
  const board = page.locator("[data-q-board]");
  await expect(board).toBeVisible();
  await expect(page.locator("[data-q-now]")).toBeVisible();

  const composer = page.getByRole("textbox", { name: "Ask Q" });
  await composer.fill("In one sentence, what can you help me with?");
  await composer.press("Enter");
  // While Q works, Now shows the task with Stop.
  await expect(page.locator("[data-q-now-task]")).toBeVisible({
    timeout: 30_000,
  });

  const note = board.locator('[data-q-board-object="NOTE"]').first();
  await expect(note).toBeVisible({ timeout: 120_000 });
  await note.getByRole("button", { name: "Show exchange" }).click();
  await expect(note).toContainText(
    "In one sentence, what can you help me with?",
  );

  // Pinning keeps it on top; the arrangement survives a reload.
  await note.getByRole("button", { name: "Pin" }).click();
  await expect(note.getByRole("button", { name: "Unpin" })).toBeVisible();
  await page.reload();
  await expect(
    page
      .locator('[data-q-board-object="NOTE"]')
      .first()
      .getByRole("button", { name: "Unpin" }),
  ).toBeVisible({ timeout: 30_000 });

  // No scrolling message list on the default layout...
  const scrollers = await page.evaluate(
    () =>
      [...document.querySelectorAll("[data-q-voice-stage-body] ol")].filter(
        (list) => list.scrollHeight > list.clientHeight + 1,
      ).length,
  );
  expect(scrollers).toBe(0);

  // ...and the transcript view is the whole conversation, in order.
  await page.getByRole("button", { name: "Transcript" }).click();
  const transcript = page.locator("[data-q-transcript]");
  await expect(transcript).toBeVisible();
  await expect(transcript.locator("li")).toHaveCount(2);
  await expect(transcript.locator("li").first()).toContainText("You");
});
