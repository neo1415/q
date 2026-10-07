import { expect, test, type Page } from "@playwright/test";

/**
 * Q room W3 (R3, R6): a data-room document Q opens shows in the Q room's
 * centre panel; it pages, summarises with page citations and reads aloud
 * by asking; it closes when the conversation moves on and reopens at the
 * same page when the subject comes back; a long web answer offers a PDF.
 * The `/dev/q-room` harness reads a recorded conversation, the signed read
 * and a three-page PDF this test serves; nothing reaches Q, the database,
 * storage or a provider.
 */

const CONVERSATION = "5a1c2b4e-1d6a-4c1e-9a51-0c6b3e2a7d10";
const LEDGERLINE = "00000000-0000-4000-8000-000000000001";
const CERT = "00000000-0000-4000-8000-000000000051";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (minute: number) =>
  new Date(Date.UTC(2026, 9, 6, 9, minute)).toISOString();

/** A three-page PDF with one line of text a page, built here. */
function threePagePdf(): Buffer {
  const lines = [
    "This is to certify that Ledgerline Technologies Ltd is incorporated.",
    "The company has ten million ordinary shares.",
    "Model articles apply with pre-emption rights.",
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

/** The harness has read its (empty) conversation: what follows is new. */
async function opened(page: Page) {
  const first = page.waitForResponse("**/dev/q-room/record");
  await page.goto("/dev/q-room");
  await first;
}

const asked = (n: number, text: string) => ({
  messageId: uuid(1000 + n),
  runId: uuid(2000 + n),
  role: "USER",
  text,
  createdAt: at(n * 2),
});
const answered = (n: number, text: string, blocks: unknown[] = []) => ({
  messageId: uuid(3000 + n),
  runId: uuid(2000 + n),
  role: "Q",
  text,
  ...(blocks.length === 0 ? {} : { blocks }),
  createdAt: at(n * 2 + 1),
});
const act = (intent: Record<string, unknown>) => ({
  kind: "UI_INTENT",
  intent: { kind: "DOCUMENT_ACT", ...intent },
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
      conversationId: CONVERSATION,
      title: "Ledgerline's certificate",
      subjects: [],
      createdAt: at(0),
      lastMessageAt: at(40),
    },
    messages,
    latestRun: {
      runId: uuid(2000 + messages.length),
      conversationId: CONVERSATION,
      status: "COMPLETED",
      createdAt: at(40),
    },
  };
}

async function serve(page: Page, downloadable = true) {
  let current: unknown = record([]);
  const exported: unknown[] = [];
  await page.route("**/dev/q-room/record", (route) =>
    route.fulfill({ json: current }),
  );
  await page.route("**/dev/q-room/document**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        value: {
          url: "/dev/q-room/file.pdf",
          downloadable,
          watermark: downloadable ? null : "Zino Adeyemi",
        },
      },
    }),
  );
  await page.route("**/dev/q-room/file.pdf", (route) =>
    route.fulfill({ body: threePagePdf(), contentType: "application/pdf" }),
  );
  await page.route("**/dev/q-room/export", async (route) => {
    exported.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        ok: true,
        value: {
          artifactId: uuid(77),
          type: "Q_ANSWER",
          title: "Nigerian fintech news",
          currentVersion: 1,
        },
      },
    });
  });
  return {
    set: (next: unknown) => {
      current = next;
    },
    exported,
  };
}

const T1 = [
  asked(1, "Open Ledgerline's incorporation document"),
  answered(1, "Here's the certificate of incorporation.", [OPEN]),
];
const T2 = [
  ...T1,
  asked(2, "Next page"),
  answered(2, "Page 2.", [act({ act: "NEXT_PAGE" })]),
];
const T3 = [
  ...T2,
  asked(3, "Summarise it"),
  answered(
    3,
    "- Ledgerline Technologies Ltd is incorporated (p. 1)\n- Ten million ordinary shares (p. 2)\n- Model articles with pre-emption rights (p. 3)",
    [act({ act: "SUMMARISE" })],
  ),
];
const T4 = [
  ...T3,
  asked(4, "Read page 2 to me"),
  answered(4, "The company has ten million ordinary shares.", [
    act({ act: "READ_ALOUD", page: 2 }),
  ]),
];
const T5 = [
  ...T4,
  asked(5, "How did Clearwater do last month?"),
  answered(5, "Clearwater made £41k in September."),
];
const T6 = [
  ...T5,
  asked(6, "Back to the incorporation certificate"),
  answered(6, "Here it is again."),
];

test("a document opens in the room, pages, summarises with pages, reads aloud, closes on a new subject and reopens at the same page", async ({
  page,
}) => {
  const { set } = await serve(page);
  await opened(page);
  set(record(T1));
  await page.getByRole("button", { name: "Next answer" }).click();

  const viewer = page.locator("[data-q-room-document]");
  await expect(viewer).toBeVisible();
  await expect(
    page.locator("[data-q-room-document-host] [data-q-room-document]"),
  ).toHaveCount(1);
  const pageNumber = viewer.locator("[data-q-room-document-page]");
  await expect(pageNumber).toHaveAttribute("data-q-room-document-page", "1");
  await expect(viewer.locator("canvas")).toBeVisible();
  await expect(pageNumber).toContainText("3");

  set(record(T2));
  await page.getByRole("button", { name: "Next answer" }).click();
  await expect(pageNumber).toHaveAttribute("data-q-room-document-page", "2");

  set(record(T3));
  await page.getByRole("button", { name: "Next answer" }).click();
  const summary = viewer.locator("[data-q-room-document-summary]");
  await expect(summary).toContainText("Ten million ordinary shares");
  await summary.locator('[data-q-room-document-cite="3"]').click();
  await expect(pageNumber).toHaveAttribute("data-q-room-document-page", "3");

  set(record(T4));
  await page.getByRole("button", { name: "Next answer" }).click();
  await expect(viewer.locator("[data-q-room-document-reading]")).toContainText(
    "Reading aloud · page 2",
  );
  await expect(pageNumber).toHaveAttribute("data-q-room-document-page", "2");
  await expect(viewer.locator("[data-q-room-document-download]")).toBeVisible();

  set(record(T5));
  await page.getByRole("button", { name: "Next answer" }).click();
  await expect(viewer).toHaveCount(0);

  set(record(T6));
  await page.getByRole("button", { name: "Next answer" }).click();
  await expect(viewer).toBeVisible();
  await expect(pageNumber).toHaveAttribute("data-q-room-document-page", "2");

  await viewer.locator("[data-q-room-document-close]").click();
  await expect(viewer).toHaveCount(0);
});

test("a view-only document shows no download and carries the reader's name", async ({
  page,
}) => {
  const { set } = await serve(page, false);
  await opened(page);
  set(record(T1));
  await page.getByRole("button", { name: "Next answer" }).click();
  const viewer = page.locator("[data-q-room-document]");
  await expect(viewer).toContainText("View only");
  await expect(viewer.locator("[data-q-room-document-download]")).toHaveCount(
    0,
  );
  await expect(viewer.locator("[data-watermark]")).toContainText(
    "Zino Adeyemi",
  );
});

test("a long web answer offers a PDF; yes files exactly that answer", async ({
  page,
}) => {
  const { set, exported } = await serve(page);
  await opened(page);
  const long = Array.from({ length: 150 }, () => "Fintech news today.").join(
    " ",
  );
  set(
    record([
      asked(1, "What's the latest Nigerian fintech news?"),
      answered(1, long, [
        {
          kind: "PUBLIC_SOURCE",
          url: "https://example.com/fintech",
          domain: "example.com",
          title: "Fintech today",
          publishedOn: null,
          retrievedOn: "2026-10-06",
        },
      ]),
    ]),
  );
  await page.getByRole("button", { name: "Next answer" }).click();
  const offer = page.locator("[data-q-room-pdf-offer]");
  await expect(offer).toContainText("Want it as a PDF?");
  await offer.locator("[data-q-room-pdf-yes]").click();
  await expect(offer).toHaveCount(0);
  expect(exported).toEqual([{ runId: uuid(2001), messageId: uuid(3001) }]);
});
