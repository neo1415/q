import { expect, test, type Page } from "@playwright/test";

/**
 * Q presence room (Zino, 2026-10-08): the briefing's cards beside Q (left
 * and right on a wide screen, below on a phone), every card summarised up
 * front, any words read into the same card verbs (a changed message needs
 * "Send this exact message?"), and held messages that can be sent as they
 * are or written again. Driven on /dev/briefing?variant=room over
 * fictional data with a scripted reader in place of the model; nothing
 * reaches Q, the database or a provider.
 */

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const HALYARD = uuid(1);
const ARCWELL = uuid(2);
const TENSORGATE = uuid(3);
const ARCWELL_MESSAGE =
  "Hi Ama, following up on the deck I sent. Any thoughts?";
const TENSORGATE_MESSAGE =
  "Thanks for the update. Send the data room link when it's ready.";

type Logged = { readonly kind: string } & Record<string, unknown>;

async function decisions(page: Page): Promise<Logged[]> {
  const text = (await page.locator("[data-harness-log]").textContent()) ?? "[]";
  return JSON.parse(text) as Logged[];
}

async function open(page: Page): Promise<void> {
  await page.goto("/dev/briefing?variant=room");
  await expect(page.locator("[data-arrival-summary]")).toContainText(
    "Three things:",
  );
}

test("every card in one sentence, and the cards beside Q (below on a phone)", async ({
  page,
}, info) => {
  await open(page);
  await expect(page.locator("[data-arrival-summary]")).toContainText(
    "the Arcwell Bio reply is held",
  );
  const layout = page.locator("[data-arrival-sequence]");
  if (info.project.name === "desktop") {
    await expect(layout).toHaveAttribute("data-arrival-layout", "room");
    const left = page.locator('[data-q-room-slot="left"]');
    const right = page.locator('[data-q-room-slot="right"]');
    await expect(
      left.locator(`[data-arrival-card="${HALYARD}"]`),
    ).toBeVisible();
    await expect(
      left.locator(`[data-arrival-line="${TENSORGATE}"]`),
    ).toBeVisible();
    await expect(
      right.locator(`[data-arrival-line="${ARCWELL}"]`),
    ).toBeVisible();
    // Q sits between the two columns.
    const q = await page.locator(".cq-aperture-mark").first().boundingBox();
    const l = await left.boundingBox();
    const r = await right.boundingBox();
    expect(q && l && r).toBeTruthy();
    if (q && l && r) {
      expect(l.x + l.width).toBeLessThanOrEqual(q.x + 1);
      expect(r.x).toBeGreaterThanOrEqual(q.x + q.width - 1);
    }
  } else {
    await expect(layout).toHaveAttribute("data-arrival-layout", "below");
    await expect(
      page.locator(`[data-arrival-card="${HALYARD}"]`),
    ).toBeVisible();
  }
  // A tap brings a card forward; the others stay where they are.
  await page.locator(`[data-arrival-line="${TENSORGATE}"]`).click();
  await expect(
    page.locator(`[data-arrival-card="${TENSORGATE}"]`),
  ).toBeVisible();
  await expect(page.locator(`[data-arrival-line="${HALYARD}"]`)).toBeVisible();
});

test("a held message: Send as is asks 'Send this exact message?' and sends exactly it", async ({
  page,
}) => {
  await open(page);
  await page.locator(`[data-arrival-line="${ARCWELL}"]`).click();
  const held = page.locator(`[data-arrival-card="${ARCWELL}"]`);
  for (const name of [
    "Send as is",
    "Edit & send",
    "Ask Q to try again",
    "Dismiss",
    "Later",
  ]) {
    await expect(held.getByRole("button", { name })).toBeVisible();
  }
  await held.getByRole("button", { name: "Send as is" }).click();
  await expect(held).toContainText("Send this exact message?");
  await expect(page.locator("[data-arrival-confirm]")).toHaveText(
    `What will be sent: ${ARCWELL_MESSAGE}`,
  );
  expect(await decisions(page)).toEqual([]);
  await page.getByRole("button", { name: "Yes, send this" }).click();
  await expect
    .poll(() => decisions(page))
    .toEqual([
      expect.objectContaining({
        kind: "SEND_EDITED",
        relationshipId: uuid(102),
        body: ARCWELL_MESSAGE,
      }),
    ]);
});

test("a held message: Ask Q to try again re-runs the writer and reviewer for it", async ({
  page,
}) => {
  await open(page);
  await page.locator(`[data-arrival-line="${ARCWELL}"]`).click();
  await page
    .locator(`[data-arrival-card="${ARCWELL}"]`)
    .getByRole("button", { name: "Ask Q to try again" })
    .click();
  await expect
    .poll(() => decisions(page))
    .toEqual([
      expect.objectContaining({ kind: "RETRY_HELD", draftId: ARCWELL }),
    ]);
  await expect(page.locator("[data-arrival-status]")).toContainText(
    "waiting for your approval",
  );
});

test("any words: 'send the Tensorgate one but make it warmer' shows the warmer text for its own yes", async ({
  page,
}) => {
  await open(page);
  await page
    .locator("#arrival-command")
    .fill("send the Tensorgate one but make it warmer");
  await page.getByRole("button", { name: "Do it" }).click();
  const warmer = `Thank you, I'd really enjoy that. ${TENSORGATE_MESSAGE}`;
  await expect(page.locator("[data-arrival-confirm]")).toHaveText(
    `What will be sent: ${warmer}`,
  );
  // Nothing went on the words alone.
  expect(await decisions(page)).toEqual([]);
  await page.getByRole("button", { name: "Yes, send this" }).click();
  await expect
    .poll(() => decisions(page))
    .toEqual([
      expect.objectContaining({
        kind: "SEND_EDITED",
        relationshipId: uuid(103),
        body: warmer,
        replacesApprovalId: TENSORGATE,
      }),
    ]);
});

test("any words by voice: 'ignore Arcwell' drops it; 'don't send the Tensorgate one' sends nothing", async ({
  page,
}) => {
  await open(page);
  await page.locator("[data-harness-say]").fill("ignore Arcwell, it's fine");
  await page.locator("[data-harness-say-send]").click();
  await expect(page.locator(`[data-arrival-line="${ARCWELL}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-arrival-card="${ARCWELL}"]`)).toHaveCount(0);
  await page.locator("#arrival-command").fill("don't send the Tensorgate one");
  await page.getByRole("button", { name: "Do it" }).click();
  await expect(
    page.locator(`[data-arrival-card="${TENSORGATE}"]`),
  ).toBeVisible();
  await expect(page.locator("[data-arrival-status]")).toContainText(
    "nothing was sent",
  );
  expect(
    (await decisions(page)).filter((one) => one.kind === "APPROVE"),
  ).toEqual([]);
});
