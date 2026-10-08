import { expect, test } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import {
  duplexSent,
  emitRealtime,
  installDuplexFake,
  userSays,
} from "../support/duplex-fake.js";
import { awaits } from "../support/expected-red.js";
import { expectLastTurnTerminal } from "../support/q.js";
import { answer, useScript } from "../support/script.js";
import { CAST } from "../support/stack.js";

/**
 * SPEC §5 Scenario E: one continuous voice line across pages; interrupt Q;
 * correct; continue. The duplex transport is faked at RTCPeerConnection
 * (support/duplex-fake.ts), so the browser's own barge-in and stale-reply
 * logic is what runs (audit C-05, C-07). Needs a voice credential from the
 * local q-api, which needs request G-R2.
 */
test("Scenario E: talk across three pages without the line dropping; interrupt; correct; continue", async ({
  browser,
}) => {
  awaits(
    ["A4", "A6", "A7", "C3", "G-R3"],
    "barge-in and the stale-reply guard are A6/A7; dispositions G-R3",
  );
  const context = await contextAs(browser, CAST.founder);
  const page = await context.newPage();
  await installDuplexFake(page);
  await useScript([
    {
      name: "long",
      when: { user: "tell me about my raise" },
      reply: answer("Your raise is two and a half million dollars. ".repeat(6)),
    },
    {
      name: "correct",
      when: { user: "no, I meant the readiness" },
      reply: answer("Your readiness has three open items."),
    },
  ]);
  await page.goto("/home");
  await page
    .getByRole("button", { name: /Talk with Q/u })
    .first()
    .click();
  await expect(page.getByRole("button", { name: /^End/u })).toBeVisible({
    timeout: 60_000,
  });

  await userSays(page, "item_1", "tell me about my raise");
  await emitRealtime(page, {
    type: "output_audio_buffer.started",
    response_id: "resp_1",
  });
  // Barge in while Q is audibly speaking.
  await emitRealtime(page, {
    type: "input_audio_buffer.speech_started",
    item_id: "item_2",
    audio_start_ms: 0,
  });
  await page.waitForTimeout(600); // past BARGE_CONFIRM_MS (450 ms)
  const sent = await duplexSent(page);
  expect(sent.map((event) => event.type)).toEqual(
    expect.arrayContaining(["response.cancel", "conversation.item.truncate"]),
  );

  await userSays(page, "item_2", "no, I meant the readiness");
  await expectLastTurnTerminal(page, ["ANSWERED"]);
  // The interrupted answer is SUPERSEDED, and never spoken after the correction.
  await expect(page.locator('[data-q-disposition="SUPERSEDED"]')).toHaveCount(
    1,
  );

  // Navigate twice; the same line stays up (one peer for the whole walk).
  for (const path of ["/capital", "/documents"]) {
    await page
      .getByRole("link", { name: new RegExp(path.slice(1), "iu") })
      .first()
      .click();
    await expect(page).toHaveURL(new RegExp(path, "u"));
    await expect(page.getByRole("button", { name: /^End/u })).toBeVisible();
  }
  const peers = await page.evaluate(
    () => (window as Window & { __cqDuplexPeers?: number }).__cqDuplexPeers,
  );
  expect(peers).toBe(1);
  await context.close();
});
