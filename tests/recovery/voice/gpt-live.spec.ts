import { expect, test, type Page } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import {
  emitLive,
  installLiveFake,
  livePeers,
  liveSent,
  liveUserSays,
} from "../support/live-fake.js";
import { openQ } from "../support/q.js";
import { useScript } from "../support/script.js";
import { CAST } from "../support/stack.js";

/**
 * V: GPT-Live as the product voice, on the local stack (MOCK). Needs the
 * stack started with CQ_RECOVERY_GPT_LIVE=1 (q-api CQ_VOICE_LIVE=on; the
 * fake vendor answers GPT-Live's session creation). The browser's WebRTC
 * is faked at RTCPeerConnection (support/live-fake.ts): the provider events
 * are emitted by the test; everything from the page's code to Q Brain is
 * real. Nothing here is model audio.
 */

const READER_QUESTION = {
  name: "reader-question",
  when: { task: "TURN_READER" },
  reply: {
    json: {
      kind: "QUESTION_TO_Q",
      confidence: "HIGH",
      transcript: "CLEAR",
      question: null,
      aboutNamedOther: false,
    },
  },
} as const;

async function startVoice(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /Talk with Q/u })
    .first()
    .click();
  await expect.poll(() => livePeers(page), { timeout: 30_000 }).toBe(1);
  // The data channel opens once the Q API answered the offer.
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const sent = (window as Window & { __cqLiveSent?: unknown[] })
            .__cqLiveSent;
          return Array.isArray(sent);
        }),
      { timeout: 10_000 },
    )
    .toBe(true);
  await page.waitForTimeout(500);
  await emitLive(page, {
    type: "session.started",
    session: { id: "live_fake_e2e", model: "gpt-live-1" },
  });
}

test("the Q button opens GPT-Live on /home: greeting, delegation to Q Brain, cards on screen", async ({
  browser,
}) => {
  const page = await (await contextAs(browser, CAST.investor)).newPage();
  await installLiveFake(page);
  await useScript([READER_QUESTION]);
  await page.goto("/home");
  await startVoice(page);

  // The call opens with a greeting the app asks for (GPT-Live does not
  // speak first by itself), carrying the surface's opening if there is one.
  await expect
    .poll(async () =>
      (await liveSent(page)).some(
        (e) =>
          e.type === "session.instructions.append" &&
          (e.content ?? "").includes("Greet them warmly"),
      ),
    )
    .toBe(true);

  // A spoken question, delegated: one Q run, verified facts back to the
  // voice, and the answer's cards on screen through the existing paths.
  await liveUserSays(
    page,
    "What are the top three companies that fit my mandate?",
  );
  await emitLive(page, {
    type: "session.delegation.created",
    delegation: {
      id: "dlg_e2e_top_three",
      type: "delegation",
      target: "client",
    },
  });
  // A repeat of the same id never starts a second run.
  await emitLive(page, {
    type: "session.delegation.created",
    delegation: {
      id: "dlg_e2e_top_three",
      type: "delegation",
      target: "client",
    },
  });
  await expect
    .poll(
      async () =>
        (await liveSent(page)).filter(
          (e) =>
            e.type === "session.commentary.append" &&
            e.delegation_id === "dlg_e2e_top_three" &&
            !(e.content ?? "").startsWith("Q's backend is still working"),
        ).length,
      { timeout: 60_000 },
    )
    .toBe(1);
  const answer = (await liveSent(page)).find(
    (e) =>
      e.type === "session.commentary.append" &&
      e.delegation_id === "dlg_e2e_top_three" &&
      !(e.content ?? "").startsWith("Q's backend is still working"),
  );
  expect(answer?.content).toContain("Ajopot");
  expect(answer?.content).toContain("Verified by Q's backend");
  await expect(page.getByText("Ajopot").first()).toBeVisible({
    timeout: 30_000,
  });
  await page.screenshot({
    path: ".playwright/recovery/gpt-live-home.png",
    fullPage: false,
  });
});

test("a spoken 'open discover' on GPT-Live moves the screen through C's fast path", async ({
  browser,
}) => {
  const page = await (await contextAs(browser, CAST.investor)).newPage();
  await installLiveFake(page);
  await useScript([READER_QUESTION]);
  await page.goto("/home");
  await page.request.get("/discover");
  await startVoice(page);
  await liveUserSays(page, "open discover");
  // No delegation: the utterance ends after a short quiet, and the final
  // words move the screen by themselves.
  await expect(page).toHaveURL(/\/discover/u, { timeout: 30_000 });
});

test("GPT-Live carries on across a page: the dock on another page opens it too", async ({
  browser,
}) => {
  const page = await (await contextAs(browser, CAST.investor)).newPage();
  await installLiveFake(page);
  await useScript([READER_QUESTION]);
  await page.goto("/discover");
  const briefing = page.getByRole("button", { name: "Close Q's briefing" });
  if (await briefing.isVisible().catch(() => false)) await briefing.click();
  await openQ(page);
  await startVoice(page);
  await expect
    .poll(async () =>
      (await liveSent(page)).some(
        (e) => e.type === "session.instructions.append",
      ),
    )
    .toBe(true);
});
