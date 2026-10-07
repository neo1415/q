import { expect, test, type Page, type Route } from "@playwright/test";

/**
 * Q room W6 (R9): on a weak network every room surface retries a failed
 * read once, then says "Couldn't load — try again" with a button, never an
 * endless spinner; coming back online retries by itself; a dropped upload
 * says so and keeps a "Try again". The `/dev/q-room` harness reads what
 * this test serves; nothing reaches Q, the database or a provider.
 */

const LEDGERLINE = "00000000-0000-4000-8000-000000000001";
const CERT = "00000000-0000-4000-8000-000000000051";
const DECK = "00000000-0000-4000-8000-000000000090";
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
const answered = (n: number, text: string, blocks: unknown[]) => ({
  messageId: uuid(3000 + n),
  runId: uuid(2000 + n),
  role: "Q",
  text,
  blocks,
  createdAt: at(n * 2 + 1),
});
const show = (object: string, id: string, title: string) => ({
  kind: "UI_INTENT",
  intent: { kind: "SHOW_IN_Q_ROOM", object, id, title },
});
const OPEN = {
  kind: "UI_INTENT",
  intent: {
    kind: "OPEN_RECORD_PAGE",
    page: "DATA_ROOM_DOCUMENT",
    id: CERT,
    companyId: LEDGERLINE,
    title: "Certificate of Incorporation",
  },
};

function record(messages: readonly unknown[]) {
  return {
    conversation: {
      conversationId: uuid(9),
      title: "Weak network",
      subjects: [],
      createdAt: at(0),
      lastMessageAt: at(30),
    },
    messages,
    latestRun: {
      runId: uuid(2000 + messages.length),
      conversationId: uuid(9),
      status: "COMPLETED",
      createdAt: at(30),
    },
  };
}

/** A one-page PDF with a line of text, built here. */
function onePagePdf(): Buffer {
  const content = "BT /F1 12 Tf 20 100 Td (Ledgerline is incorporated.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${String(i + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

const svg = (n: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><rect width="960" height="540" fill="#f6f4ef"/><text x="64" y="120" font-size="40">Slide ${String(n)}</text></svg>`;

/** A route that drops the connection while `down()` says so. */
function flaky(down: () => boolean, ok: (route: Route) => Promise<void>) {
  return async (route: Route) => {
    if (down()) {
      await route.abort("internetdisconnected");
      return;
    }
    await ok(route);
  };
}

async function harness(page: Page, messages: readonly unknown[]) {
  let current: unknown = record([]);
  await page.route("**/dev/q-room/record", (route) =>
    route.fulfill({ json: current }),
  );
  const first = page.waitForResponse("**/dev/q-room/record");
  await page.goto("/dev/q-room");
  await first;
  return async () => {
    current = record(messages);
    await page.getByRole("button", { name: "Next answer" }).click();
  };
}

test("a card whose read drops twice offers 'try again', which loads it", async ({
  page,
}) => {
  let down = true;
  let tries = 0;
  await page.route(
    "**/dev/q-room/card**",
    flaky(
      () => {
        tries += 1;
        return down;
      },
      (route) =>
        route.fulfill({
          json: {
            ok: true,
            view: {
              heading: "Ledgerline · Data room",
              lead: null,
              facts: [],
              items: [{ id: uuid(52), title: "Cap table", meta: null }],
              more: 0,
              href: `/company/${LEDGERLINE}?tab=dataroom`,
              open: "Open the data room",
            },
          },
        }),
    ),
  );
  const answer = await harness(page, [
    asked(1, "Open Ledgerline's data room"),
    answered(1, "Here it is.", [show("DATA_ROOM", LEDGERLINE, "Ledgerline")]),
  ]);
  await answer();
  const card = page.locator('[data-q-room-card="DATA_ROOM"]');
  await expect(card.locator("[data-q-room-failed]")).toContainText(
    "Couldn't load — try again",
  );
  expect(tries).toBe(2);
  await expect(card.locator("[data-q-room-loading]")).toHaveCount(0);
  down = false;
  await card.getByRole("button", { name: "Try again" }).click();
  await expect(card).toContainText("Cap table");
});

test("the document viewer: a dropped signed read and a dropped file each offer 'try again'", async ({
  page,
}) => {
  let readDown = true;
  let fileDown = true;
  await page.route(
    "**/dev/q-room/document**",
    flaky(
      () => readDown,
      (route) =>
        route.fulfill({
          json: {
            ok: true,
            value: {
              url: "/dev/q-room/file.pdf",
              downloadable: true,
              watermark: null,
            },
          },
        }),
    ),
  );
  await page.route(
    "**/dev/q-room/file.pdf",
    flaky(
      () => fileDown,
      (route) =>
        route.fulfill({ body: onePagePdf(), contentType: "application/pdf" }),
    ),
  );
  const answer = await harness(page, [
    asked(1, "Open the certificate"),
    answered(1, "Here is the Certificate of Incorporation.", [OPEN]),
  ]);
  await answer();
  const viewer = page.locator("[data-q-room-document]");
  await expect(viewer.locator("[data-q-room-failed]")).toBeVisible();
  readDown = false;
  await viewer.getByRole("button", { name: "Try again" }).click();
  // The signed read lands; the file itself drops twice.
  await expect(viewer.locator("[data-q-room-failed]")).toBeVisible();
  await expect(viewer.locator("[data-q-room-document-frame]")).toHaveCount(0);
  fileDown = false;
  await viewer.getByRole("button", { name: "Try again" }).click();
  await expect(viewer.locator("[data-q-pdf-page] canvas")).toBeVisible();
  await expect(viewer.locator("[data-q-room-failed]")).toHaveCount(0);
});

test("the deck: dropped slides offer 'try again'; a dropped upload says so and keeps a retry", async ({
  page,
}) => {
  let slidesDown = true;
  let uploadDown = true;
  await page.route("**/dev/q-room/deck**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        status: "READY",
        title: "Northstar deck",
        type: "PITCH_DECK",
        version: 1,
        companyId: uuid(1),
        progress: null,
      },
    }),
  );
  await page.route(
    "**/dev/q-room/slides**",
    flaky(
      () => slidesDown,
      (route) =>
        route.fulfill({
          json: { slides: [svg(1), svg(2)], images: [], placeholders: [] },
        }),
    ),
  );
  await page.route(
    "**/dev/q-room/upload",
    flaky(
      () => uploadDown,
      (route) => route.fulfill({ json: { documentId: uuid(60) } }),
    ),
  );
  const answer = await harness(page, [
    asked(1, "Show my deck"),
    answered(1, "Here's your deck.", [
      show("Q_DOCUMENT", DECK, "Northstar deck"),
    ]),
  ]);
  await answer();
  const deck = page.locator('[data-q-room-card="Q_DOCUMENT"]');
  await expect(deck.locator("[data-q-room-failed]")).toBeVisible();
  await expect(deck).not.toContainText("without slides");
  slidesDown = false;
  await deck.getByRole("button", { name: "Try again" }).click();
  await expect(deck.locator("[data-q-deck-thumb]")).toHaveCount(2);

  await deck.locator("[data-q-deck-file]").setInputFiles({
    name: "notes.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n"),
  });
  await expect(deck.locator("[data-q-deck-notice]")).toContainText(
    "the connection dropped",
  );
  await expect(deck.locator("[data-q-deck-upload]")).toBeEnabled();
  uploadDown = false;
  await deck.locator("[data-q-deck-upload-retry]").click();
  await expect(deck.locator("[data-q-deck-notice]")).toContainText(
    "Added to your data room",
  );
  await expect(deck.locator("[data-q-deck-upload-retry]")).toHaveCount(0);
});
