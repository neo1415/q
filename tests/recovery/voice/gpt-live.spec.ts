import { expect, test, type Page } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import {
  audibleNow,
  emitLive,
  installLiveFake,
  maxAudible,
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
  // The data channel opens once the Q API answered the offer; only then is
  // the page listening for the provider's events.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            (
              window as Window & { __cqLiveOpen?: () => boolean }
            ).__cqLiveOpen?.() === true,
        ),
      { timeout: 30_000 },
    )
    .toBe(true);
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
          e.type === "session.commentary.append" &&
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
        (e) => e.type === "session.commentary.append",
      ),
    )
    .toBe(true);
});

test("one voice at a time: restarting and starting voice from a second surface never leaves two audible", async ({
  browser,
}) => {
  const page = await (await contextAs(browser, CAST.investor)).newPage();
  await installLiveFake(page);
  await useScript([READER_QUESTION]);
  await page.goto("/home");
  await startVoice(page);
  await expect.poll(() => audibleNow(page), { timeout: 10_000 }).toBe(1);
  // End and talk again at once, three times: each new line stops the last.
  for (let i = 0; i < 3; i += 1) {
    const end = page.getByRole("button", { name: /^End/u }).first();
    if (await end.isVisible().catch(() => false)) await end.click();
    await page
      .getByRole("button", { name: /Talk with Q/u })
      .first()
      .click();
    await page.waitForTimeout(300);
  }
  // A second surface (the dock, over the page) opens voice too.
  await page.goto("/discover");
  const briefing = page.getByRole("button", { name: "Close Q's briefing" });
  if (await briefing.isVisible().catch(() => false)) await briefing.click();
  await openQ(page);
  await page
    .getByRole("button", { name: /Talk with Q/u })
    .first()
    .click();
  await page.waitForTimeout(2_000);
  expect(await audibleNow(page)).toBeLessThanOrEqual(1);
  expect(await maxAudible(page)).toBeLessThanOrEqual(1);
});

test("one voice at a time on /home: rapid restarts never overlap", async ({
  browser,
}) => {
  const page = await (await contextAs(browser, CAST.investor)).newPage();
  await installLiveFake(page);
  await useScript([READER_QUESTION]);
  await page.goto("/home");
  await startVoice(page);
  await expect.poll(() => audibleNow(page), { timeout: 10_000 }).toBe(1);
  for (let i = 0; i < 4; i += 1) {
    const end = page.getByRole("button", { name: /^End/u }).first();
    if (await end.isVisible().catch(() => false)) await end.click();
    await page
      .getByRole("button", { name: /Talk with Q/u })
      .first()
      .click();
  }
  await page.waitForTimeout(3_000);
  expect(await maxAudible(page)).toBeLessThanOrEqual(1);
  // Every superseded GPT-Live session was told to close.
  const peers = await page.evaluate(
    () => (window as Window & { __cqLivePeers?: number }).__cqLivePeers ?? 0,
  );
  const closes = await page.evaluate(
    () =>
      (
        (window as Window & { __cqLiveSent?: { type?: string }[] })
          .__cqLiveSent ?? []
      ).filter((e) => e.type === "session.close").length,
  );
  expect(closes).toBeGreaterThanOrEqual(Math.max(0, peers - 1));
});

test("the preview's GPT-Live call goes silent the moment it ends, before its session closes", async ({
  browser,
}) => {
  const page = await (await contextAs(browser, CAST.investor)).newPage();
  await installLiveFake(page);
  await page.goto("/dev/voice-preview");
  const opening = page.getByLabel(/Open with the briefing/u);
  if (await opening.isChecked()) await opening.uncheck();
  await page.getByRole("button", { name: "Start conversation" }).click();
  await expect.poll(() => audibleNow(page), { timeout: 15_000 }).toBe(1);
  await page.getByRole("button", { name: "End call" }).click();
  // The fake provider never sends session.closed, so the call is still
  // waiting for its final usage: its speaker must already be off.
  await page.waitForTimeout(300);
  expect(await audibleNow(page)).toBe(0);
  expect(await maxAudible(page)).toBe(1);
});
