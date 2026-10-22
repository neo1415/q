import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page, type Request } from "@playwright/test";

/**
 * Lane 8 (owner's boss, 2026-10-22): "I uploaded a document, it attached,
 * but the send button did not come alive and nothing happened."
 *
 * The real composer and attachments store on `/dev/q-attach`: attach a
 * PDF with no words typed, Send comes alive once it has landed, Q
 * summarises it; a follow-up is answered from it; a new conversation finds
 * it again as "that document". The upload and Q are fixtures here (a fake
 * model that answers from the pages it was given); the server's own read
 * of the document is proven in model-gateway's q-answer-attached-document
 * test. Nothing reaches Q, the database, storage or a provider.
 */

const EVIDENCE =
  process.env.CQ_E2E_EVIDENCE ??
  join(process.cwd(), "..", "..", "docs/ai-handoff/evidence/q-uploads");
const DOC = "d0000000-0000-4000-8000-00000000a7a1";

/** A two-page PDF built here, one line a page. */
function termSheetPdf(): Buffer {
  const lines = [
    "Series A term sheet for Ajopot. Pre-money valuation 8m USD.",
    "1x non-participating liquidation preference. Pro-rata for the lead.",
  ];
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${lines.map((_, i) => `${String(3 + i * 2)} 0 R`).join(" ")}] /Count ${String(lines.length)} >>`,
  ];
  const font = 3 + lines.length * 2;
  lines.forEach((line, i) => {
    const content = `BT /F1 12 Tf 20 100 Td (${line}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 200] /Contents ${String(4 + i * 2)} 0 R /Resources << /Font << /F1 ${String(font)} 0 R >> >> >>`,
      `<< /Length ${String(content.length)} >>\nstream\n${content}\nendstream`,
    );
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
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

/** The pages the server's read hands Q, for the fixture's fake model. */
const PAGES = [
  "Series A term sheet for Ajopot. Pre-money valuation $8m.",
  "1x non-participating liquidation preference. Pro-rata for the lead.",
];

type Asked = {
  readonly question: string;
  readonly screen: { readonly attachedDocumentIds?: readonly string[] };
};

/** Upload and Q, answered here: a fake model reading only what it is given. */
async function serve(page: Page, uploads: { name: string; at: number }[]) {
  await page.route("**/dev/q-attach/upload", async (route) => {
    // The upload takes a moment, so "Reading" and a held Send show.
    await new Promise((resolve) => setTimeout(resolve, 600));
    uploads.push({
      name: decodeURIComponent(
        route.request().headers()["x-file-name"] ?? "file",
      ),
      at: Date.now(),
    });
    await route.fulfill({ json: { documentId: DOC } });
  });
  await page.route("**/dev/q-attach/ask", async (route) => {
    const asked = route.request().postDataJSON() as Asked;
    const ids = asked.screen.attachedDocumentIds ?? [];
    // The run's read: by id when attached, else theirs by name or latest.
    const reads =
      ids.includes(DOC) ||
      (/that document|i sent/i.test(asked.question) && uploads.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 250));
    let answer = "I can't find a document of yours to read.";
    if (reads && /liquidation/i.test(asked.question)) {
      answer = `It's a 1x non-participating liquidation preference (p. 2): "${PAGES[1] ?? ""}" That is what the term sheet says, not a verified fact.`;
    } else if (reads && /valuation/i.test(asked.question)) {
      answer =
        "In the term sheet you sent earlier (term-sheet.pdf), the pre-money valuation is $8m (p. 1).";
    } else if (reads) {
      answer = [
        "This is Ajopot's Series A term sheet (2 pages).",
        "Worth knowing: a $8m pre-money valuation (p. 1); a 1x non-participating liquidation preference (p. 2); pro-rata rights for the lead (p. 2).",
        "Next: I can compare these terms with market norms for a Series A, or draft questions for the lead.",
      ].join("\n");
    }
    await route.fulfill({ json: { answer } });
  });
}

const send = (page: Page) => page.getByRole("button", { name: "Send to Q" });

test("attach a PDF, Send comes alive, Q summarises it, follows up and finds it later", async ({
  page,
}, info) => {
  const uploads: { name: string; at: number }[] = [];
  await serve(page, uploads);
  const asks: Request[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/dev/q-attach/ask")) asks.push(request);
  });
  await page.goto("/dev/q-attach?preset=black_gold");
  const shot = (name: string) =>
    page.screenshot({
      path: join(EVIDENCE, `${info.project.name}-${name}.png`),
      fullPage: true,
    });
  mkdirSync(EVIDENCE, { recursive: true });

  // Nothing to say yet.
  await expect(send(page)).toBeDisabled();

  // Attach, no words: it reads, and Send waits for it.
  const attachedAt = Date.now();
  await page.locator('input[type="file"]').setInputFiles({
    name: "term-sheet.pdf",
    mimeType: "application/pdf",
    buffer: termSheetPdf(),
  });
  await expect(page.getByText("Reading term-sheet.pdf")).toBeVisible();
  await expect(send(page)).toBeDisabled();
  await shot("1-reading");

  // Landed: Send is live on the document alone (the reported bug).
  await expect(page.locator('[data-q-attachment="ready"]')).toHaveText(
    "term-sheet.pdf",
  );
  await expect(send(page)).toBeEnabled();
  const readyAt = Date.now();
  await shot("2-attached-send-live");

  // Send: Q says what it is and what is worth knowing.
  const sentAt = Date.now();
  await send(page).click();
  const summary = page.locator('[data-turn="q"]').first();
  await expect(summary).toContainText("Series A term sheet");
  const firstWordsAt = Date.now();
  await expect(summary).toContainText("(p. 1)");
  expect(asks[0]?.postDataJSON()).toMatchObject({
    question: expect.stringContaining('"term-sheet.pdf"'),
    screen: { attachedDocumentIds: [DOC] },
  });
  await shot("3-summary");

  // A follow-up in the same conversation is answered from it.
  const input = page.getByRole("textbox", { name: "Ask Q" });
  await input.fill("What's the liquidation preference?");
  await input.press("Enter");
  await expect(page.locator('[data-turn="q"]').nth(1)).toContainText("(p. 2)");
  expect(asks[1]?.postDataJSON()).toMatchObject({
    screen: { attachedDocumentIds: [DOC] },
  });
  await shot("4-follow-up");

  // A new conversation: nothing attached, and "that document" finds it.
  await page.getByRole("button", { name: "New chat" }).click();
  await input.fill("What did that document I sent say about valuation?");
  await input.press("Enter");
  await expect(page.locator('[data-turn="q"]').first()).toContainText("$8m");
  const later = asks[2]?.postDataJSON() as Asked | undefined;
  expect(later?.screen.attachedDocumentIds).toBeUndefined();
  await shot("5-new-conversation-finds-it");

  const timings = {
    project: info.project.name,
    uploadToSendLiveMs: readyAt - attachedAt,
    sendToFirstWordsMs: firstWordsAt - sentAt,
    uploadToFirstWordsMs: firstWordsAt - attachedAt,
    note: "Fixture upload (600 ms) and fake model (250 ms); the server's own read is timed in model-gateway q-answer-attached-document.test.ts.",
  };
  writeFileSync(
    join(EVIDENCE, `${info.project.name}-timings.json`),
    `${JSON.stringify(timings, null, 2)}\n`,
  );
  console.info(`[lane8] ${JSON.stringify(timings)}`);
  expect(uploads.map((upload) => upload.name)).toEqual(["term-sheet.pdf"]);
});

test("a file dropped on the composer is attached", async ({ page }) => {
  await serve(page, []);
  await page.goto("/dev/q-attach?preset=black_gold");
  const form = page.getByRole("form", { name: "Ask Q" });
  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(
      new File(["Board minutes, 3 October."], "minutes.txt", {
        type: "text/plain",
      }),
    );
    return transfer;
  });
  await form.dispatchEvent("dragover", { dataTransfer });
  await form.dispatchEvent("drop", { dataTransfer });
  await expect(page.locator('[data-q-attachment="ready"]')).toHaveText(
    "minutes.txt",
  );
  await expect(send(page)).toBeEnabled();
});
