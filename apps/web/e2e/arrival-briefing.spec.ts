import { expect, test, type Page } from "@playwright/test";

/**
 * The arrival briefing (Zino, 2026-10-08): "greet me according to the
 * time ... give me the lowdown, and bring up the cards and ask me about
 * each thing". Driven on /dev/briefing over fictional data: every decision
 * is recorded on the page instead of sent, and spoken replies go through
 * the voice line's own path (as if the person's words were heard). Nothing
 * reaches Q, the database or a provider.
 */

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function decisions(page: Page): Promise<unknown[]> {
  const text = (await page.locator("[data-harness-log]").textContent()) ?? "[]";
  return JSON.parse(text) as unknown[];
}

async function say(page: Page, words: string): Promise<void> {
  const before = await page.locator("[data-harness-voice]").textContent();
  await page.locator("[data-harness-say]").fill(words);
  await page.locator("[data-harness-say-send]").click();
  await expect(page.locator("[data-harness-voice]")).not.toHaveText(
    before ?? "",
  );
}

test("greets by their clock, gives the lowdown and one card at a time", async ({
  page,
}) => {
  await page.goto("/dev/briefing");
  await expect(page.locator("[data-arrival-greeting]")).toHaveText(
    "Good afternoon, Zino.",
  );
  await expect(page.locator("[data-arrival-lowdown]")).toContainText(
    "Halyard Security wrote back",
  );
  await expect(page.locator("[data-arrival-count]")).toHaveText("1 of 3");
  const card = page.locator(`[data-arrival-card="${uuid(1)}"]`);
  await expect(card).toContainText("Could we find 30 minutes next week");
  await expect(card).toContainText("Tuesday 10:00 or Thursday 15:00");

  // Approve & send: exactly what was shown.
  await card.getByRole("button", { name: "Approve & send" }).click();
  await expect(page.locator("[data-arrival-count]")).toHaveText("2 of 3");
  expect(await decisions(page)).toEqual([
    {
      kind: "APPROVE",
      approvalId: uuid(1),
      shown:
        "Happy to. Tuesday 10:00 or Thursday 15:00 both work for me. I'll bring the pilot numbers.",
    },
  ]);

  // A held draft: Edit & send, then its own "send this?".
  const held = page.locator(`[data-arrival-card="${uuid(2)}"]`);
  await held.getByRole("button", { name: "Edit & send" }).click();
  await page
    .locator("[data-arrival-editor]")
    .fill("Hi Ama, any thoughts on the deck? Happy to talk Thursday.");
  await page.getByRole("button", { name: "Review" }).click();
  await expect(page.locator("[data-arrival-confirm]")).toContainText(
    "Happy to talk Thursday.",
  );
  expect(await decisions(page)).toHaveLength(1);
  await page.getByRole("button", { name: "Yes, send this" }).click();
  await expect(page.locator("[data-arrival-count]")).toHaveText("3 of 3");
  expect((await decisions(page))[1]).toMatchObject({
    kind: "SEND_EDITED",
    relationshipId: uuid(102),
    body: "Hi Ama, any thoughts on the deck? Happy to talk Thursday.",
    replacesApprovalId: null,
  });

  // Later: nothing decided, the sequence ends.
  await page
    .locator(`[data-arrival-card="${uuid(3)}"]`)
    .getByRole("button", { name: "Later" })
    .click();
  await expect(page.locator("[data-arrival-sequence]")).toHaveCount(0);
  expect(await decisions(page)).toHaveLength(2);
});

test("spoken replies map to the same actions; an edit needs a yes", async ({
  page,
}) => {
  await page.goto("/dev/briefing");
  await expect(page.locator("[data-arrival-count]")).toHaveText("1 of 3");
  await say(page, "change the second sentence to Thursday at 3pm works best");
  await expect(page.locator("[data-arrival-confirm]")).toContainText(
    "Happy to. Thursday at 3pm works best. I'll bring the pilot numbers.",
  );
  await expect(page.locator("[data-harness-voice]")).toContainText(
    "send this?",
  );
  expect(await decisions(page)).toEqual([]);

  await say(page, "yes");
  await expect(page.locator("[data-arrival-count]")).toHaveText("2 of 3");
  expect(await decisions(page)).toEqual([
    expect.objectContaining({
      kind: "SEND_EDITED",
      relationshipId: uuid(101),
      body: "Happy to. Thursday at 3pm works best. I'll bring the pilot numbers.",
      replacesApprovalId: uuid(1),
    }),
  ]);
  await expect(page.locator("[data-harness-voice]")).toContainText(
    "Arcwell Bio",
  );

  await say(page, "skip");
  await expect(page.locator("[data-arrival-count]")).toHaveText("3 of 3");
  await say(page, "let's talk about something else");
  await expect(page.locator("[data-arrival-sequence]")).toHaveCount(0);
  await expect(
    page.getByText("Anything left is in Needs you on Work"),
  ).toBeVisible();
  expect(await decisions(page)).toHaveLength(1);
});

test("a bare yes never sends the original; dismiss declines it", async ({
  page,
}) => {
  await page.goto("/dev/briefing");
  await expect(page.locator("[data-arrival-count]")).toHaveText("1 of 3");
  await say(page, "yes");
  await expect(page.locator("[data-harness-voice]")).toContainText(
    "A plain yes doesn't send it",
  );
  expect(await decisions(page)).toEqual([]);
  await say(page, "dismiss it");
  await expect(page.locator("[data-arrival-count]")).toHaveText("2 of 3");
  expect(await decisions(page)).toEqual([
    { kind: "DISMISS_APPROVAL", approvalId: uuid(1) },
  ]);
});

test("a card that changed since it was shown is not approved", async ({
  page,
}) => {
  await page.goto("/dev/briefing?fail=changed");
  const card = page.locator(`[data-arrival-card="${uuid(1)}"]`);
  await card.getByRole("button", { name: "Approve & send" }).click();
  await expect(page.locator("[data-arrival-status]")).toContainText(
    "It changed since you saw it",
  );
  await expect(page.locator("[data-arrival-count]")).toHaveText("1 of 3");
});

test("a quiet day is one line; another zone, another greeting", async ({
  page,
}) => {
  await page.goto("/dev/briefing?state=quiet");
  await expect(page.locator("[data-arrival-greeting]")).toHaveText(
    "Good afternoon, Zino.",
  );
  await expect(page.locator("[data-arrival-lowdown]")).toContainText(
    "nothing needs you",
  );
  await expect(page.locator("[data-arrival-sequence]")).toHaveCount(0);
});

test("by the person's own zone, and only once per session", async ({
  page,
}) => {
  await page.goto("/dev/briefing?tz=America/New_York");
  await expect(page.locator("[data-arrival-greeting]")).toHaveText(
    "Good morning, Zino.",
  );
  // Another page in the same session: the page's own welcome, no briefing.
  await page.reload();
  await expect(page.locator("[data-harness-fallback]")).toBeVisible();
  await expect(page.locator("[data-arrival-greeting]")).toHaveCount(0);
});

test("the compact version beside the dock: a line, one card, the same verbs", async ({
  page,
}) => {
  await page.goto("/dev/briefing?variant=dock");
  const dock = page.locator("[data-arrival-dock]");
  await expect(dock).toContainText("Good afternoon, Zino.");
  await expect(dock.locator("[data-arrival-count]")).toHaveText("1 of 3");
  await dock.getByRole("button", { name: "Approve & send" }).click();
  await expect(dock.locator("[data-arrival-count]")).toHaveText("2 of 3");
  await dock.getByRole("button", { name: "Not now" }).click();
  await expect(dock.locator("[data-arrival-sequence]")).toHaveCount(0);
});
