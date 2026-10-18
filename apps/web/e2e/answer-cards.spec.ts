import { mkdirSync } from "node:fs";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import type { QAnswerCardsBlock } from "@capital-q/contracts";

import {
  DEMO_COMPARE,
  demoTop,
} from "../src/features/q/answer-canvas-fixtures";

/**
 * P10: answer cards appear and disappear correctly. The Q page's stage,
 * Board and the answer chip run in the `/dev/q-cards` harness over a
 * recorded conversation this test serves; nothing reaches Q, the database
 * or a provider.
 *
 * The voice case is the founder's bug: a ranked list asked by voice is
 * still running when the screen first reads the record back, and its cards
 * must appear once the run is stored, without anything else happening.
 */

const SHOTS =
  process.env.CQ_E2E_SHOTS ??
  "/tmp/claude-0/-home-user-q/5e7a5c77-f947-52b0-88c5-5afccae36a31/scratchpad/cards-check";

const CONVERSATION = "4f1c2b4e-1d6a-4c1e-9a51-0c6b3e2a7d10";
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (minute: number) =>
  new Date(Date.UTC(2026, 9, 6, 9, minute)).toISOString();

type Message =
  | {
      messageId: string;
      runId: string;
      role: "USER";
      text: string;
      createdAt: string;
    }
  | {
      messageId: string;
      runId: string;
      role: "Q";
      text: string;
      blocks?: QAnswerCardsBlock[];
      createdAt: string;
    };

const asked = (n: number, text: string): Message => ({
  messageId: uuid(n),
  runId: uuid(100 + n),
  role: "USER",
  text,
  createdAt: at(n),
});
const answered = (
  n: number,
  text: string,
  cards?: QAnswerCardsBlock,
): Message => ({
  messageId: uuid(n),
  runId: uuid(100 + n - 1),
  role: "Q",
  text,
  ...(cards === undefined ? {} : { blocks: [cards] }),
  createdAt: at(n),
});

function record(messages: readonly Message[], running = false) {
  const last = messages.at(-1);
  return {
    conversation: {
      conversationId: CONVERSATION,
      title: "Top three for my mandate",
      subjects: [],
      createdAt: at(0),
      lastMessageAt: last?.createdAt ?? at(0),
    },
    messages,
    latestRun:
      last === undefined
        ? null
        : {
            runId: last.runId,
            conversationId: CONVERSATION,
            status: running ? "PREFLIGHT" : "COMPLETED",
            createdAt: last.createdAt,
          },
  };
}

/** The record the harness reads; each test moves it on as Q would. */
async function serve(page: Page) {
  let current: unknown = record([]);
  let reads = 0;
  await page.route("**/dev/q-cards/record", async (route) => {
    reads += 1;
    await route.fulfill({ json: current });
  });
  return {
    set: (next: unknown) => {
      current = next;
    },
    reads: () => reads,
  };
}

async function shot(page: Page, info: TestInfo, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  // Let the cards' layout spring settle: the picture is of the state, not
  // a frame mid-move. Presentation only; every assertion is made before.
  await page.waitForTimeout(800);
  await page.screenshot({
    path: `${SHOTS}/${info.project.name}-${name}.png`,
    fullPage: false,
  });
}

const TOP = demoTop(3);
const TOP_ANSWER = answered(
  2,
  "Here are the three that fit your mandate best.",
  TOP,
);

test("a ranked list asked by voice appears once its run is stored, focuses, moves to the Board, and closes", async ({
  page,
}, info) => {
  const recorded = await serve(page);
  await page.goto("/dev/q-cards");
  const stage = page.locator("[data-q-presence-stage]");
  await expect(stage).toHaveAttribute("data-q-presence-stage", "presence");
  await expect(page.locator("[data-q-canvas]")).toHaveCount(0);

  // Asked by voice: the run is still going when the screen reads back.
  const question = asked(1, "Top three for my mandate");
  recorded.set(record([question], true));
  await page.getByRole("button", { name: "Voice turn" }).click();
  await expect.poll(() => recorded.reads()).toBeGreaterThanOrEqual(3);
  await expect(page.locator("[data-q-canvas]")).toHaveCount(0);

  // The run is stored a while later: the cards come up on their own.
  recorded.set(record([question, TOP_ANSWER]));
  const canvas = page.locator(`[data-q-canvas="${uuid(2)}"]`);
  await expect(canvas).toBeVisible();
  await expect(canvas.locator("[data-ac-card]")).toHaveCount(3);
  await expect(stage).toHaveAttribute("data-q-presence-stage", "object");
  await shot(page, info, "1-voice-cards");

  // A tap on the second card focuses it.
  const second = canvas.locator("[data-ac-card]").nth(1);
  await second.locator("button[aria-expanded]").click();
  await expect(second).toHaveAttribute("data-state", "focus");
  await expect(second.locator("button[aria-expanded]")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await shot(page, info, "2-focused");

  // The conversation moves on (no card named): the cards go to the Board.
  recorded.set(
    record([
      question,
      TOP_ANSWER,
      asked(3, "What changed this week?"),
      answered(4, "Nothing new in your pipeline since Monday."),
    ]),
  );
  await page.getByRole("button", { name: "Typed answer" }).click();
  await expect(page.locator("[data-q-canvas]")).toHaveCount(0);
  await expect(page.locator("[data-q-canvas-leaving]")).toHaveCount(0);
  const board = page.getByRole("button", { name: "Board", exact: true });
  await expect(board).toHaveAttribute("data-landed", "1");
  await expect(stage).toHaveAttribute("data-q-presence-stage", "presence");
  await board.click();
  await expect(page.locator(`[data-board-entry="${uuid(2)}"]`)).toBeVisible();
  await shot(page, info, "3-on-board");
  await board.click();

  // A new answer with cards replaces the stage; X closes it.
  recorded.set(
    record([
      question,
      TOP_ANSWER,
      asked(3, "What changed this week?"),
      answered(4, "Nothing new in your pipeline since Monday."),
      asked(5, "Compare them side by side"),
      answered(6, "Side by side, on your mandate.", DEMO_COMPARE),
    ]),
  );
  await page.getByRole("button", { name: "Typed answer" }).click();
  const compare = page.locator(`[data-q-canvas="${uuid(6)}"]`);
  await expect(compare).toBeVisible();
  await shot(page, info, "4-compare");
  const closeAll = compare.locator("[data-ac-close-all]");
  if ((await closeAll.count()) > 0) {
    await closeAll.click();
  } else {
    await compare.getByRole("button", { name: "Close the comparison" }).click();
  }
  await expect(page.locator("[data-q-canvas]")).toHaveCount(0);
  await expect(stage).toHaveAttribute("data-q-presence-stage", "presence");
  await shot(page, info, "5-closed");
});

test("one card's X closes that card; the last one closes the answer", async ({
  page,
}) => {
  const recorded = await serve(page);
  recorded.set(record([asked(1, "Top three for my mandate"), TOP_ANSWER]));
  await page.goto("/dev/q-cards");
  const canvas = page.locator(`[data-q-canvas="${uuid(2)}"]`);
  await expect(canvas).toBeVisible();
  for (const card of TOP.cards.slice(0, 2)) {
    await canvas.getByRole("button", { name: `Close ${card.name}` }).click();
    await expect(canvas.locator(`[data-ac-card="${card.key}"]`)).toHaveCount(0);
  }
  const last = TOP.cards[2];
  if (last === undefined) throw new Error("fixture has three cards");
  await canvas.getByRole("button", { name: `Close ${last.name}` }).click();
  await expect(page.locator("[data-q-canvas]")).toHaveCount(0);
});

test("on another page a new answer with cards shows the chip, which opens them and dismisses", async ({
  page,
}, info) => {
  const recorded = await serve(page);
  // An answer with cards from before this page opened is not news.
  const earlier = [
    asked(1, "Top three for my mandate"),
    answered(2, "Here are the three.", TOP),
  ];
  recorded.set(record(earlier));
  await page.goto("/dev/q-cards?page=other");
  await expect.poll(() => recorded.reads()).toBeGreaterThanOrEqual(1);
  const chip = page.locator("[data-answer-chip]");
  await expect(chip).toHaveCount(0);

  // A new one, asked by voice, still running at first.
  const question = asked(3, "Top five for my mandate");
  recorded.set(record([...earlier, question], true));
  await page.getByRole("button", { name: "Voice turn" }).click();
  await expect.poll(() => recorded.reads()).toBeGreaterThanOrEqual(3);
  await expect(chip).toHaveCount(0);
  recorded.set(
    record([
      ...earlier,
      question,
      answered(4, "Here are the five.", demoTop(5)),
    ]),
  );
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("Top five ready");
  await expect(chip.getByRole("link", { name: "Open in Q" })).toHaveAttribute(
    "href",
    `/home?c=${CONVERSATION}`,
  );
  await expect(
    chip.getByRole("link", { name: "Open in the Board" }),
  ).toHaveAttribute("href", `/home?c=${CONVERSATION}&board=1`);
  await shot(page, info, "6-chip");
  await chip.getByRole("button", { name: "Dismiss" }).click();
  await expect(chip).toHaveCount(0);
});
