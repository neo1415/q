import { expect, test, type Page } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import {
  duplexSent,
  emitRealtime,
  installDuplexFake,
  setPeerState,
  userSays,
  type DuplexMode,
} from "../support/duplex-fake.js";
import { awaits } from "../support/expected-red.js";
import {
  failServerActions,
  loseMicrophone,
  trackMicrophones,
} from "../support/faults.js";
import { expectLastTurnTerminal } from "../support/q.js";
import { answer, useScript } from "../support/script.js";
import { CAST } from "../support/stack.js";

/**
 * SPEC §5 Scenario H, the voice half, on the duplex line with the transport
 * faked at RTCPeerConnection. Every case ends in something the person can
 * see or hear: a terminal disposition, a fallback that says so, or a notice.
 * All need a voice credential from local q-api (request G-R2).
 */
async function openLine(
  page: Page,
  mode: DuplexMode = "connect",
): Promise<void> {
  await trackMicrophones(page);
  await installDuplexFake(page, mode);
  await page.goto("/home");
  await page
    .getByRole("button", { name: /Talk with Q/u })
    .first()
    .click();
  // Realtime events sent before the data channel is open are lost: wait
  // for the line to be up (its End control) unless the test is about it
  // never coming up.
  if (mode === "connect") {
    await expect(
      page.getByRole("button", { name: /^End/u }).first(),
    ).toBeVisible({ timeout: 60_000 });
  }
}

const notice = (page: Page) => page.locator('[role="status"], [role="alert"]');

test.describe("duplex voice failures", () => {
  test("lost microphone permission: the line says Q can't hear, and offers to fix it", async ({
    browser,
  }) => {
    awaits(["A4", "A9"], "mic-loss notice on duplex");
    const page = await (await contextAs(browser, CAST.founder)).newPage();
    await openLine(page);
    await expect(page.getByRole("button", { name: /^End/u })).toBeVisible({
      timeout: 60_000,
    });
    await loseMicrophone(page);
    await expect(
      notice(page)
        .filter({ hasText: /microphone|can't hear|cannot hear/iu })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("failed transcript: Q asks again instead of going silent (audit B-01)", async ({
    browser,
  }) => {
    awaits(
      ["A4", "B-01"],
      "a failed transcription must CLARIFY, not stay silent",
    );
    const page = await (await contextAs(browser, CAST.founder)).newPage();
    await openLine(page);
    await emitRealtime(page, {
      type: "input_audio_buffer.speech_started",
      item_id: "item_f",
      audio_start_ms: 0,
    });
    await emitRealtime(page, {
      type: "input_audio_buffer.speech_stopped",
      item_id: "item_f",
      audio_end_ms: 900,
    });
    await emitRealtime(page, {
      type: "input_audio_buffer.committed",
      item_id: "item_f",
      previous_item_id: null,
    });
    await emitRealtime(page, {
      type: "conversation.item.input_audio_transcription.failed",
      item_id: "item_f",
      error: { message: "scripted" },
    });
    await expectLastTurnTerminal(page, ["CLARIFIED", "FAILED"], 30_000);
  });

  test("realtime connect timeout: falls back to the standard line and says so", async ({
    browser,
  }) => {
    awaits(
      ["A4", "A5"],
      "fallback notice (audit 04 §2.4: the person is never told)",
    );
    const page = await (await contextAs(browser, CAST.founder)).newPage();
    await openLine(page, "never-answer");
    // DUPLEX_CONNECT_MS = 10 s, one retry: allow both.
    await expect(
      notice(page)
        .filter({ hasText: /standard|reconnect|connection/iu })
        .first(),
    ).toBeVisible({ timeout: 45_000 });
  });

  test("relay failure: a heard turn whose relay is lost still ends visibly (audit C-08)", async ({
    browser,
  }) => {
    awaits(["A4", "A8"], "deadline-bounded relay");
    const page = await (await contextAs(browser, CAST.founder)).newPage();
    await openLine(page);
    await expect(page.getByRole("button", { name: /^End/u })).toBeVisible({
      timeout: 60_000,
    });
    await failServerActions(page, 1, "hang");
    await userSays(page, "item_r", "what is my raise?");
    await expectLastTurnTerminal(page, ["FAILED", "ANSWERED"], 60_000);
  });

  test("playback loss: an answer whose audio never starts is shown as text, and the turn ends", async ({
    browser,
  }) => {
    awaits(["A4", "C-06"], "no duplex Thinking watchdog today");
    const page = await (await contextAs(browser, CAST.founder)).newPage();
    await useScript([
      {
        name: "pb",
        when: { task: "COMPANY_ANALYST", user: "playback check" },
        reply: answer("Here is the playback answer."),
      },
    ]);
    await openLine(page);
    await userSays(page, "item_p", "playback check");
    // The response is created but output audio never starts.
    await emitRealtime(page, {
      type: "response.created",
      response: { id: "resp_p" },
    });
    await expect(page.getByText("Here is the playback answer.")).toBeVisible({
      timeout: 30_000,
    });
    await expectLastTurnTerminal(page, ["ANSWERED", "FAILED"], 30_000);
  });

  test("network loss: the line rejoins, and an answer in flight is not lost (audit C-04)", async ({
    browser,
  }) => {
    awaits(["A5"], "result recovery across rejoin");
    const page = await (await contextAs(browser, CAST.founder)).newPage();
    await useScript([
      {
        name: "slow",
        when: { task: "COMPANY_ANALYST", user: "slow question" },
        reply: answer("The slow answer arrived.", {}, 4_000),
      },
    ]);
    await openLine(page);
    await userSays(page, "item_n", "slow question");
    await setPeerState(page, "disconnected");
    await page.waitForTimeout(2_000);
    await setPeerState(page, "connected");
    await expect(page.getByText("The slow answer arrived.")).toBeVisible({
      timeout: 60_000,
    });
  });

  test("barge-in during generation, before any audio, does not lose the answer (audit C-07)", async ({
    browser,
  }) => {
    awaits(["A7"], "repair after a cough during generation");
    const page = await (await contextAs(browser, CAST.founder)).newPage();
    await openLine(page);
    await userSays(page, "item_b", "what is my raise?");
    await emitRealtime(page, {
      type: "response.created",
      response: { id: "resp_b" },
    });
    // A 200 ms blip: below BARGE_CONFIRM_MS, so not an interruption.
    await emitRealtime(page, {
      type: "input_audio_buffer.speech_started",
      item_id: "item_c",
      audio_start_ms: 0,
    });
    await page.waitForTimeout(200);
    await emitRealtime(page, {
      type: "input_audio_buffer.speech_stopped",
      item_id: "item_c",
      audio_end_ms: 200,
    });
    const sent = (await duplexSent(page)).map((event) => event.type);
    expect(sent).not.toContain("response.cancel");
  });
});
