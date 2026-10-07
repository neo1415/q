import { expect, test, type Page } from "@playwright/test";

/**
 * Q room W2: a card Q brings into the room (R4) opens, closes on its own
 * when the conversation moves to a new subject with a quiet note, reopens
 * when the subject comes back, and closes on "close it"; the page tells Q
 * what it shows as ids only, an open modal included (R1). The `/dev/q-room`
 * harness reads a recorded conversation and card contents this test
 * serves; nothing reaches Q, the database or a provider.
 */

const CONVERSATION = "5a1c2b4e-1d6a-4c1e-9a51-0c6b3e2a7d10";
const LEDGERLINE = "00000000-0000-4000-8000-000000000001";
const PREVIEW = "00000000-0000-4000-8000-000000000002";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (minute: number) =>
  new Date(Date.UTC(2026, 9, 6, 9, minute)).toISOString();

const asked = (n: number, text: string) => ({
  messageId: uuid(1000 + n),
  runId: uuid(2000 + n),
  role: "USER",
  text,
  createdAt: at(n * 2),
});
const answered = (n: number, text: string, show = false) => ({
  messageId: uuid(3000 + n),
  runId: uuid(2000 + n),
  role: "Q",
  text,
  ...(show
    ? {
        blocks: [
          {
            kind: "UI_INTENT",
            intent: {
              kind: "SHOW_IN_Q_ROOM",
              object: "DATA_ROOM",
              id: LEDGERLINE,
              title: "Ledgerline",
            },
          },
        ],
      }
    : {}),
  createdAt: at(n * 2 + 1),
});

function record(messages: readonly unknown[]) {
  return {
    conversation: {
      conversationId: CONVERSATION,
      title: "Ledgerline's data room",
      subjects: [],
      createdAt: at(0),
      lastMessageAt: at(30),
    },
    messages,
    latestRun: {
      runId: uuid(2000 + messages.length),
      conversationId: CONVERSATION,
      status: "COMPLETED",
      createdAt: at(30),
    },
  };
}

async function serve(page: Page) {
  let current: unknown = record([]);
  await page.route("**/dev/q-room/record", async (route) => {
    await route.fulfill({ json: current });
  });
  await page.route("**/dev/q-room/card**", async (route) => {
    await route.fulfill({
      json: {
        ok: true,
        view: {
          heading: "Ledgerline · Data room",
          lead: "3 documents you can see.",
          facts: [],
          items: [
            {
              id: uuid(51),
              title: "Certificate of incorporation",
              meta: "Open to you",
            },
            {
              id: uuid(52),
              title: "Bank statements, September",
              meta: "On request",
            },
            { id: uuid(53), title: "Cap table", meta: "On request" },
          ],
          more: 0,
          href: `/company/${LEDGERLINE}?tab=dataroom`,
          open: "Open the data room",
        },
      },
    });
  });
  return (next: unknown) => {
    current = next;
  };
}

const T1 = [
  asked(1, "Open Ledgerline's data room"),
  answered(
    1,
    "Here's Ledgerline's data room. Three files are shared with you.",
    true,
  ),
];
const T2 = [
  ...T1,
  asked(2, "How did Clearwater do last month?"),
  answered(2, "Clearwater made £41k in September."),
];
const T3 = [
  ...T2,
  asked(3, "Back to Ledgerline: is the cap table there?"),
  answered(3, "Yes, on request."),
];
const T4 = [...T3, asked(4, "Close it"), answered(4, "Closed.")];

test("a card opens in the room, closes as we move on, reopens on return, and closes on 'close it'", async ({
  page,
}) => {
  const set = await serve(page);
  set(record(T1));
  await page.goto("/dev/q-room");
  const card = page.locator('[data-q-room-card="DATA_ROOM"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText("Certificate of incorporation");
  await expect(card.locator("[data-q-room-open]")).toHaveAttribute(
    "href",
    `/company/${LEDGERLINE}?tab=dataroom`,
  );
  await expect(page.locator("[data-q-can-see]").first()).toContainText(
    "Ledgerline · Data room open",
  );

  set(record(T2));
  await page.getByRole("button", { name: "Next answer" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator("[data-q-room-note]")).toHaveText(
    "Closed Ledgerline's data room as we moved on",
  );

  set(record(T3));
  await page.getByRole("button", { name: "Next answer" }).click();
  await expect(card).toBeVisible();
  await expect(card).toContainText("Cap table");

  set(record(T4));
  await page.getByRole("button", { name: "Next answer" }).click();
  await expect(card).toHaveCount(0);
});

test("the close button closes the card by hand", async ({ page }) => {
  const set = await serve(page);
  set(record(T1));
  await page.goto("/dev/q-room");
  const card = page.locator('[data-q-room-card="DATA_ROOM"]');
  await expect(card).toBeVisible();
  await card.locator("[data-q-room-close]").click();
  await expect(card).toHaveCount(0);
});

test("the page tells Q what it shows as ids only, the open modal on top", async ({
  page,
}) => {
  const set = await serve(page);
  set(record([]));
  await page.goto("/dev/q-room");
  await expect(page.locator("[data-q-can-see]").first()).toContainText(
    "2 waiting approvals",
  );
  await page.getByRole("button", { name: "Open preview" }).click();
  await expect(page.locator("[data-q-can-see]").first()).toContainText(
    "window: Clearwater preview",
  );
  await page.getByRole("button", { name: "Read wire" }).click();
  const wire = page.locator("[data-harness-wire]");
  await expect(wire).toContainText(PREVIEW);
  await expect(wire).toContainText("COMPANY_PREVIEW");
  await expect(wire).toContainText("APPROVAL_LIST");
  await expect(wire).not.toContainText("Clearwater preview");
  await expect(wire).not.toContainText("waiting approvals");
});

test("'Q can see' follows a part hidden from Q and an unregistered window at once (W7)", async ({
  page,
}) => {
  const set = await serve(page);
  set(record([]));
  await page.goto("/dev/q-room");
  const line = page.locator("[data-q-can-see]").first();
  await expect(line).toContainText("2 waiting approvals");
  // Hidden by the page itself (no registry call): well under the old 1.5 s.
  await page.evaluate(() => {
    document
      .querySelector('[data-q-section="approvals"]')
      ?.setAttribute("data-q-hidden", "");
  });
  await expect(line).not.toContainText("2 waiting approvals", {
    timeout: 500,
  });
  await page.evaluate(() => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-label", "Unregistered sheet");
    dialog.id = "w7-dialog";
    document.body.append(dialog);
  });
  await expect(line).toContainText("window: Unregistered sheet", {
    timeout: 500,
  });
  await page.evaluate(() => document.getElementById("w7-dialog")?.remove());
  await expect(line).not.toContainText("Unregistered sheet", { timeout: 500 });
});
