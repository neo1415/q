import { expect, test, type Page } from "@playwright/test";

import { demoTop } from "../src/features/q/answer-canvas-fixtures";

/**
 * voice-cards (Zino live 2026-10-08, conversation c10b845f): "Show me the
 * top three companies..." asked on the duplex line stored three-plus cards
 * and nothing appeared on screen. The answer now reaches the screen from
 * the Q API's room feed, never from the voice model or a re-read guess.
 *
 * Simulated here: a duplex ask_q run whose answer the record does NOT
 * hold yet (the old path's failure) and the room feed (/api/q-room, served
 * by this test as the Q API publishes) does. Nothing reaches Q, the
 * database or a provider.
 */

const CONVERSATION = "c10b845f-62ec-4460-8b16-0cb6511422bf";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (offsetSeconds: number) =>
  new Date(Date.now() + offsetSeconds * 1000).toISOString();

const record = {
  conversation: {
    conversationId: CONVERSATION,
    title: "Voice",
    subjects: [],
    createdAt: at(-60),
    lastMessageAt: at(-60),
  },
  messages: [],
  latestRun: null,
};

const answer = (n: number, cards: number) => ({
  sequence: n,
  runId: uuid(200 + n),
  conversationId: CONVERSATION,
  source: "VOICE",
  message: {
    messageId: uuid(300 + n),
    runId: uuid(200 + n),
    role: "Q",
    text: `I've scored your top ${String(cards)} companies against your mandate.`,
    blocks: [demoTop(cards)],
    createdAt: at(0),
  },
});

/** The room feed: empty at first; `publish` makes the next read carry it. */
async function serve(page: Page) {
  const published: unknown[] = [];
  const reads: string[] = [];
  await page.route("**/dev/q-room/record", (route) =>
    route.fulfill({ json: record }),
  );
  await page.route("**/api/q-room**", async (route) => {
    const url = new URL(route.request().url());
    reads.push(url.search);
    const after = Number(url.searchParams.get("after") ?? "0");
    const wait = url.searchParams.get("wait") === "1";
    const fresh = () =>
      published.filter(
        (entry) => (entry as { sequence: number }).sequence > after,
      );
    // A held read, as the Q API holds it: answered when something lands.
    for (let tries = 0; wait && fresh().length === 0 && tries < 20; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await route.fulfill({
      json: { epoch: "epoch-1", cursor: published.length, entries: fresh() },
    });
  });
  return {
    reads,
    publish: (entry: unknown) => {
      published.push(entry);
    },
  };
}

test("a duplex ask_q run's cards reach the stage from the room feed, once", async ({
  page,
}) => {
  const room = await serve(page);
  await page.goto("/dev/q-room");
  await expect(page.locator("[data-q-presence-stage]")).toBeVisible();
  await expect(page.locator("[data-q-canvas]")).toHaveCount(0);

  // The voice line opens: the room is read.
  await page.locator("[data-harness-voice]").click();
  await expect.poll(() => room.reads.length).toBeGreaterThan(0);

  // Q answers on the duplex line: the Q API publishes the run's answer.
  room.publish(answer(1, 3));
  const canvas = page.locator(`[data-q-canvas="${uuid(301)}"]`);
  await expect(canvas).toBeVisible();
  // Exactly the three asked for, in order.
  await expect(canvas.locator("[data-ac-card]")).toHaveCount(3);

  // Read again (and again): the same answer is never shown twice.
  await expect.poll(() => room.reads.length).toBeGreaterThan(2);
  await expect(page.locator("[data-q-canvas]")).toHaveCount(1);

  // A second answer replaces it on the stage, keyed by its own run.
  room.publish(answer(2, 5));
  const second = page.locator(`[data-q-canvas="${uuid(302)}"]`);
  await expect(second).toBeVisible();
  await expect(second.locator("[data-ac-card]")).toHaveCount(5);
});

test("no room read happens while no voice line is open", async ({ page }) => {
  const room = await serve(page);
  await page.goto("/dev/q-room");
  await expect(page.locator("[data-q-presence-stage]")).toBeVisible();
  await page.waitForTimeout(500);
  expect(room.reads).toEqual([]);
});
