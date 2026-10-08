import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import { expectLastTurnTerminal } from "../support/q.js";
import { CAST, RUN_PATH, STACK_MODE } from "../support/stack.js";

/**
 * LIVE voice checks: a real microphone (or the founder's recorded clips) and
 * the real OpenAI Realtime / Deepgram line, against his LOCAL stack, run by
 * him per scripts/recovery/voice/LIVE-PROCEDURE.md. The build budget for
 * live AI calls is $0, so no agent runs these: in a MOCK stack every test
 * here stops at once with "LIVE-PENDING" and results-table.mjs reports it so.
 */
test.beforeEach(() => {
  test.info().annotations.push({
    type: "live",
    description: "LIVE-PENDING unless run per LIVE-PROCEDURE.md",
  });
  if (STACK_MODE !== "live") {
    throw new Error(
      "LIVE-PENDING: this stack is MOCK; see scripts/recovery/voice/LIVE-PROCEDURE.md",
    );
  }
});

const CLIPS = process.env["CQ_LIVE_CLIPS_DIR"] ?? resolve(RUN_PATH, "clips");

test("the line opens on the realtime transport and Q answers a spoken question", async ({
  browser,
}) => {
  const page = await (await contextAs(browser, CAST.founder)).newPage();
  await page.goto("/home");
  await page
    .getByRole("button", { name: /Talk with Q/u })
    .first()
    .click();
  await expect(page.getByRole("button", { name: /^End/u })).toBeVisible({
    timeout: 30_000,
  });
  // The founder speaks (or CQ_FAKE_MIC_WAV plays) "How much am I raising?".
  await expect(page.locator('[data-q-answer="settled"]').last()).toBeVisible({
    timeout: 90_000,
  });
  await expectLastTurnTerminal(page, ["ANSWERED", "CLARIFIED"]);
});

// The bar: at most 3 words in 10 misheard. A starting threshold for the
// founder to review against the clips, not a researched standard.
const MAX_WORD_ERROR_RATE = 0.3;

test("each recorded clip is heard as the words its .txt says", () => {
  // play-clips.mjs runs one clip per browser launch (the fake mic is a launch
  // flag); this test checks its output beside the expected text.
  expect(existsSync(CLIPS), `clips in ${CLIPS}`).toBe(true);
  const results = readdirSync(CLIPS).filter((name) =>
    name.endsWith(".heard.json"),
  );
  expect(results.length, "play-clips.mjs has run").toBeGreaterThanOrEqual(5);
  for (const name of results) {
    const heard = JSON.parse(readFileSync(resolve(CLIPS, name), "utf8")) as {
      expected: string;
      heard: string;
      wordErrorRate: number | null;
    };
    expect(heard.heard.length, `${name}: something was heard`).toBeGreaterThan(
      0,
    );
    expect(
      heard.wordErrorRate ?? 1,
      `${name}: "${heard.heard}"`,
    ).toBeLessThanOrEqual(MAX_WORD_ERROR_RATE);
  }
});
