import { expect, test, type Page } from "@playwright/test";

/**
 * Q room W5 (R8): a deck Q is making opens in the room as a DECK surface;
 * it says the stage while it is made, then shows the slides with page
 * thumbnails and the spaces left to fill marked; a picture chosen on a
 * marked space goes up the upload path and onto that slide as a new
 * version; an edit by voice takes the surface to the slide it changed,
 * and Q's screen context names the slide and version. The `/dev/q-room`
 * harness reads everything from routes this test answers: nothing reaches
 * Q, the database, storage or a provider.
 */

const CONVERSATION = "5a1c2b4e-1d6a-4c1e-9a51-0c6b3e2a7d20";
const DECK = "00000000-0000-4000-8000-0000000000d1";
const UPLOADED = "00000000-0000-4000-8000-0000000000e1";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (minute: number) =>
  new Date(Date.UTC(2026, 9, 7, 9, minute)).toISOString();

const svg = (n: number, note = "") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"><rect width="960" height="540" fill="#f6f4ef"/><text x="64" y="120" font-size="40">Slide ${String(n)}${note}</text></svg>`;

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
const SHOW = {
  kind: "UI_INTENT",
  intent: {
    kind: "SHOW_IN_Q_ROOM",
    object: "Q_DOCUMENT",
    id: DECK,
    title: "Northstar deck",
  },
};
const CARD = {
  kind: "ARTIFACT_REFERENCE",
  artifactId: DECK,
  type: "PITCH_DECK",
  status: "READY",
  title: "Northstar deck",
};

function record(messages: readonly unknown[]) {
  return {
    conversation: {
      conversationId: CONVERSATION,
      title: "Northstar deck",
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

const T1 = [
  asked(1, "Draft my pitch deck"),
  answered(1, "I'm drafting your deck now; it opens here.", [SHOW]),
];
const T2 = [
  ...T1,
  asked(2, "Make slide 3 shorter"),
  answered(2, "Slide 3 is shorter now.", [
    CARD,
    {
      kind: "UI_INTENT",
      intent: { kind: "DOCUMENT_ACT", act: "GO_TO_PAGE", page: 3 },
    },
  ]),
];

async function serve(page: Page) {
  let current: unknown = record([]);
  let reads = 0;
  let version = 1;
  const filled: unknown[] = [];
  const uploads: unknown[] = [];
  await page.route("**/dev/q-room/record", (route) =>
    route.fulfill({ json: current }),
  );
  await page.route("**/dev/q-room/deck**", (route) => {
    reads += 1;
    // Being made for the first two reads, then ready.
    return route.fulfill({
      json:
        reads <= 2
          ? {
              ok: true,
              status: "PREPARING",
              title: "Northstar deck",
              type: "PITCH_DECK",
              version: null,
              companyId: uuid(1),
              progress: "Finding pictures and drawing charts from your numbers",
            }
          : {
              ok: true,
              status: "READY",
              title: "Northstar deck",
              type: "PITCH_DECK",
              version,
              companyId: uuid(1),
              progress: null,
            },
    });
  });
  await page.route("**/dev/q-room/slides**", (route) => {
    const v = Number(
      new URL(route.request().url()).searchParams.get("version"),
    );
    return route.fulfill({
      json: {
        slides: [svg(1), svg(2, v >= 2 ? " (your photo)" : ""), svg(3)],
        images: [],
        placeholders:
          v >= 2
            ? []
            : [
                {
                  slide: 1,
                  kind: "IMAGE",
                  label: "Team photo: drop yours here",
                  x: 576,
                  y: 0,
                  width: 384,
                  height: 540,
                },
              ],
      },
    });
  });
  await page.route("**/dev/q-room/upload", async (route) => {
    uploads.push(route.request().postDataJSON());
    await route.fulfill({ json: { documentId: UPLOADED } });
  });
  await page.route("**/dev/q-room/fill", async (route) => {
    filled.push(route.request().postDataJSON());
    version = 2;
    await route.fulfill({ json: { ok: true, version: 2 } });
  });
  return {
    set: (next: unknown) => {
      current = next;
    },
    filled,
    uploads,
  };
}

/** A 1x1 PNG. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("a deck being made shows its stage, then slides with thumbnails; a picture on a marked space fills it; an edit goes to its slide", async ({
  page,
}) => {
  const served = await serve(page);
  const first = page.waitForResponse("**/dev/q-room/record");
  await page.goto("/dev/q-room");
  await first;
  served.set(record(T1));
  await page.getByRole("button", { name: "Next answer" }).click();

  const deck = page.locator(`[data-q-deck="${DECK}"]`);
  await expect(page.locator("[data-q-deck-preparing]")).toContainText(
    "Finding pictures and drawing charts from your numbers",
  );
  await expect(deck).toBeVisible({ timeout: 15_000 });
  await expect(deck.locator("[data-q-deck-meta]")).toContainText(
    "Version 1 · 3 slides · 1 to fill",
  );
  await expect(deck.locator("[data-q-deck-thumb]")).toHaveCount(3);
  await expect(deck.locator("[data-q-deck-slide]")).toHaveAttribute(
    "data-q-deck-slide",
    "1",
  );

  // The marked space is on slide 2.
  await deck
    .getByRole("button", { name: "Slide 2, has a space to fill" })
    .click();
  const space = deck.locator("[data-q-deck-placeholder='IMAGE']");
  await expect(space).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await space.click();
  await (
    await chooser
  ).setFiles({
    name: "team.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await expect(deck.locator("[data-q-deck-notice]")).toHaveText(
    "Placed on slide 2.",
  );
  expect(served.uploads).toEqual([{ name: "team.png", type: "image/png" }]);
  expect(served.filled).toEqual([
    { artifactId: DECK, version: 1, slide: 2, documentId: UPLOADED },
  ]);
  await expect(deck.locator("[data-q-deck-meta]")).toContainText(
    "Version 2 · 3 slides",
  );
  await expect(deck.locator("[data-q-deck-placeholder]")).toHaveCount(0);

  // "Make slide 3 shorter": the answer's edit takes the surface there.
  served.set(record(T2));
  await page.getByRole("button", { name: "Next answer" }).click();
  await expect(deck.locator("[data-q-deck-slide]")).toHaveAttribute(
    "data-q-deck-slide",
    "3",
  );
  await page.getByRole("button", { name: "Read wire" }).click();
  const wire = page.locator("[data-harness-wire]");
  await expect(wire).toContainText(`"artifactId":"${DECK}"`);
  await expect(wire).toContainText('"artifactSlide":3');
  await expect(wire).toContainText('"artifactVersion":2');
});
