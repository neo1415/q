import { expect, test, type Page } from "@playwright/test";

import { contextAs } from "../support/auth.js";
import {
  duplexSent,
  emitRealtime,
  installDuplexFake,
  setPeerState,
  userSays,
  waitForDuplexChannel,
} from "../support/duplex-fake.js";
import { awaits } from "../support/expected-red.js";
import { call } from "../support/http.js";
import { expectLastTurnTerminal, send, talk } from "../support/q.js";
import { useScript } from "../support/script.js";
import { CAST } from "../support/stack.js";

/**
 * INC-1 regression: the live "top three companies" incident of 2026-10-08
 * (docs/recovery/evidence/incident-2026-10-08-top-three.md), replayed in
 * Chromium on the local stack. $0: the fit answer is code-built (no model),
 * the turn reader is the scripted fake, and the voice transport is the
 * RTCPeerConnection fake.
 *
 * Every check reads the effect twice: in the DOM, and in the stored
 * conversation message (server state, GET /v1/q/conversations/:id).
 * Expected-red annotations name the workstream each assertion waits on.
 */
const ASK = "What are the top three companies that fit my mandate?";
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

type Card = {
  key: string;
  name: string;
  subject?: { companyId?: string } | null;
  fit?: { score: number; measured: number; of: number } | null;
  measures?: Array<{ level?: string }>;
};
type Message = {
  messageId: string;
  runId: string;
  role: string;
  text: string;
  blocks?: Array<{ kind: string; cards?: Card[] }>;
};

async function latestMessages(email: string): Promise<Message[]> {
  const list = await call(email, "q-api", "GET", "/v1/q/conversations");
  const items = (
    (
      list.body as {
        items?: Array<{ conversationId: string; lastMessageAt: string }>;
      }
    ).items ?? []
  ).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  const newest = items[0];
  if (newest === undefined) return [];
  const one = await call(
    email,
    "q-api",
    "GET",
    `/v1/q/conversations/${newest.conversationId}`,
  );
  return ((one.body as { messages?: Message[] }).messages ?? []).filter(
    (m) => m.role === "Q",
  );
}

function cardIds(message: Message | undefined): string[] {
  const cards = (message?.blocks ?? [])
    .filter((b) => b.kind === "ANSWER_CARDS")
    .flatMap((b) => b.cards ?? []);
  return cards.map((card) => card.subject?.companyId ?? card.key);
}

/** The latest stored Q message that carries answer cards. */
async function storedCards(
  email: string,
): Promise<{ ids: string[]; cards: Card[] }> {
  const messages = await latestMessages(email);
  const withCards = [...messages].reverse().find((m) => cardIds(m).length > 0);
  const cards = (withCards?.blocks ?? [])
    .filter((b) => b.kind === "ANSWER_CARDS")
    .flatMap((b) => b.cards ?? []);
  return { ids: cardIds(withCards), cards };
}

/** Card keys as rendered: the canvas cards, or the comparison table's columns. */
async function domCardKeys(page: Page): Promise<string[]> {
  return page
    .locator("[data-ac-cards] [data-ac-card]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-ac-card") ?? ""),
    );
}

async function askTopThree(page: Page): Promise<void> {
  await useScript([READER_QUESTION]);
  await page.goto("/home");
  await send(page, ASK);
  await expect(
    page.locator("[data-ac-cards] [data-ac-card]").first(),
  ).toBeVisible({ timeout: 90_000 });
}

test.describe("INC-1 top three companies (typed, browser + server state)", () => {
  test("exactly 3 cards, 3 unique canonical company ids, in the DOM and in the stored message", async ({
    browser,
  }) => {
    awaits(
      ["E"],
      "defect G-D13: disclosable() drops ANSWER_CARDS from the stored-message views",
    );
    const page = await (await contextAs(browser, CAST.investor)).newPage();
    await askTopThree(page);
    const stored = await storedCards(CAST.investor);
    expect(stored.ids, "stored ANSWER_CARDS ids").toHaveLength(3);
    expect(new Set(stored.ids).size, "unique stored ids").toBe(3);
    for (const id of stored.ids) expect(id).toMatch(/^[0-9a-f-]{36}$/u);
    const dom = await domCardKeys(page);
    expect(dom, "rendered cards").toHaveLength(3);
    expect(new Set(dom).size).toBe(3);
    const storedKeys = stored.cards.map((card) => card.key).sort();
    expect([...dom].sort(), "the DOM shows the stored cards").toEqual(
      storedKeys,
    );
  });

  test("each card labels its score as mandate fit, with source and calculation; ties are explained", async ({
    browser,
  }) => {
    awaits(
      ["B", "E"],
      "INC-1 root cause 4: score shown as 'Fit', no 'mandate fit' label, no source/levels, ties unexplained",
    );
    const page = await (await contextAs(browser, CAST.investor)).newPage();
    await askTopThree(page);
    const stored = await storedCards(CAST.investor);
    const canvas = page.locator("[data-ac-cards]");
    const text = await canvas.innerText();
    expect(text, "labelled mandate fit, never quality").toMatch(
      /mandate fit/iu,
    );
    for (const card of stored.cards) {
      expect(card.fit, `${card.name} has a computed fit`).not.toBeNull();
      // Calculation: measured X of Y, visible, not only in an aria-label.
      expect(text).toContain(
        `${String(card.fit?.measured)} of ${String(card.fit?.of)}`,
      );
    }
    expect(text, "measure levels shown").toMatch(/Strong|Partial|Unknown/u);
    expect(text, "source stated (0 source documents is still stated)").toMatch(
      /source/iu,
    );
    const scores = stored.cards.map((card) => card.fit?.score);
    if (new Set(scores).size < scores.length) {
      expect(text, "a tie is explained").toMatch(/tied/iu);
    }
  });

  test("(d) a follow-up 'rank them' keeps the same 3 ids, not 10", async ({
    browser,
  }) => {
    awaits(
      ["B6"],
      "INC-1 root cause 2: 'them' not bound; the fit path returned 10",
    );
    const page = await (await contextAs(browser, CAST.investor)).newPage();
    await askTopThree(page);
    const first = (await storedCards(CAST.investor)).ids;
    await send(page, "Rank them for me, with the pros and cons of each.");
    await expect
      .poll(async () => (await latestMessages(CAST.investor)).length, {
        timeout: 90_000,
      })
      .toBeGreaterThan(1);
    const messages = await latestMessages(CAST.investor);
    const followUp = cardIds(messages.at(-1));
    expect(followUp.length, "stored follow-up cards").toBe(3);
    expect([...followUp].sort()).toEqual([...first].sort());
    await expect(page.locator("[data-ac-cards] [data-ac-card]")).toHaveCount(3);
  });

  test("(e) a newer attention (FINDING-only) turn leaves the 3 cards reachable", async ({
    browser,
  }) => {
    awaits(
      ["E"],
      "INC-1 root cause 3: a newer answer of another kind replaced the ranked cards",
    );
    const page = await (await contextAs(browser, CAST.investor)).newPage();
    await askTopThree(page);
    const names = (await storedCards(CAST.investor)).cards.map(
      (card) => card.name,
    );
    await send(page, "Find anything that needs my attention.");
    await expect
      .poll(async () => (await latestMessages(CAST.investor)).length, {
        timeout: 90_000,
      })
      .toBeGreaterThan(1);
    // Reachable: still on stage, or one click away on the Board or in history.
    const board = page.getByRole("button", { name: /^Board/u }).first();
    if (await board.isVisible().catch(() => false)) await board.click();
    for (const name of names)
      await expect(
        page.getByText(name).filter({ visible: true }).first(),
      ).toBeVisible({
        timeout: 20_000,
      });
  });
});

/**
 * Voice half: the duplex line with the transport faked at RTCPeerConnection
 * (support/duplex-fake.ts) and the credential minted by the fake vendor
 * (scripts/recovery/vendor-redirect.mjs). What the browser SENDS to the
 * realtime model is recorded, so bridges ("let me put that up") and the
 * answer hand-off can be counted.
 */
/**
 * What each response.create asked for, by the instruction the browser sent
 * (apps/web/src/features/voice: the opener, the "short aside" bridge, the
 * answer "say this … briefly", and BARE = no instructions, the realtime
 * model left to improvise).
 */
type Said = "OPENER" | "BRIDGE" | "ANSWER" | "BARE" | "OTHER";
function classify(sent: ReadonlyArray<{ type?: string }>): Said[] {
  return sent.filter(isResponseCreate).map((event) => {
    const text =
      (event as { response?: { instructions?: string } }).response
        ?.instructions ?? "";
    if (text.trim().length === 0) return "BARE";
    if (/^Open the call/u.test(text)) return "OPENER";
    if (/short aside/u.test(text)) return "BRIDGE";
    if (/^Say this to the person/u.test(text)) return "ANSWER";
    return "OTHER";
  });
}

/** What the browser asked the realtime model to say, for failure messages. */
function summarise(sent: ReadonlyArray<{ type?: string }>): string {
  return JSON.stringify(
    sent.filter(isResponseCreate).map((event) => {
      const response = (event as { response?: { instructions?: string } })
        .response;
      const text = (response?.instructions ?? "")
        .replace(/\s+/gu, " ")
        .slice(0, 90);
      return text.length > 0 ? text : JSON.stringify(event).slice(0, 220);
    }),
  );
}

const isResponseCreate = (event: { type?: string }) =>
  event.type === "response.create";

async function voiceTopThree(
  page: Page,
  options: { delayRelayMs?: number } = {},
): Promise<void> {
  await installDuplexFake(page);
  await useScript([READER_QUESTION]);
  if (options.delayRelayMs !== undefined) {
    const delay = options.delayRelayMs;
    // (a) the result arrives late: every server action is held back.
    await page.route("**/*", async (route) => {
      if (
        route.request().method() !== "POST" ||
        route.request().headers()["next-action"] === undefined
      ) {
        return route.fallback();
      }
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, delay));
      return route.fulfill({ response });
    });
  }
  await page.goto("/home");
  await talk(page);
  await expect(page.getByRole("button", { name: /^End/u }).first()).toBeVisible(
    { timeout: 60_000 },
  );
  await waitForDuplexChannel(page);
  await userSays(page, "item_top3", ASK);
}

test.describe("INC-1 top three companies (voice, duplex fake)", () => {
  test("(a) a late result: at most one bridge, none after the result is ready, and the cards arrive", async ({
    browser,
  }) => {
    awaits(
      ["A"],
      "INC-1 root cause 1: bridge narration not cancelled when the result lands (3 bridges live)",
    );
    const page = await (await contextAs(browser, CAST.investor)).newPage();
    await voiceTopThree(page, { delayRelayMs: 4_000 });
    await expect(page.locator("[data-ac-cards] [data-ac-card]")).toHaveCount(
      3,
      { timeout: 90_000 },
    );
    await page.waitForTimeout(5_000);
    const sent = await duplexSent(page);
    const said = classify(sent);
    const what = summarise(sent);
    // A bridge is anything said while Q works: the scripted "short aside",
    // or a BARE response.create (tool_choice none, no instructions) in which
    // the realtime model words its own holding line, as the incident's
    // "let me find the top three…" was. Founder 2026-10-09 (A, for G): no
    // sound at all while Q works, so none per turn (was at most one), and
    // none once the answer has been handed over.
    const isBridge = (k: Said) => k === "BRIDGE" || k === "BARE";
    expect(said.filter(isBridge).length, `bridges: ${what}`).toBe(0);
    const answerAt = said.indexOf("ANSWER");
    expect(
      answerAt,
      `the answer was handed to the line: ${what}`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      said.slice(answerAt + 1).filter(isBridge),
      `bridges after the answer: ${what}`,
    ).toEqual([]);
    expect(said.filter((k) => k === "ANSWER").length, `answers: ${what}`).toBe(
      1,
    );
  });

  test("(b)+(c) duplicate assistant messages and narration while cards show: one answer line, cards stay", async ({
    browser,
  }) => {
    awaits(
      ["A", "E", "G-R3"],
      "one line per turn (A6) and card stability (E); turn ids are G-R3",
    );
    const page = await (await contextAs(browser, CAST.investor)).newPage();
    await voiceTopThree(page);
    await expect(page.locator("[data-ac-cards] [data-ac-card]")).toHaveCount(
      3,
      { timeout: 90_000 },
    );
    for (const id of ["resp_dup_1", "resp_dup_2"]) {
      await emitRealtime(page, { type: "response.created", response: { id } });
      await emitRealtime(page, {
        type: "response.output_audio_transcript.done",
        response_id: id,
        item_id: `it_${id}`,
        transcript: "Here are the three companies.",
      });
      await emitRealtime(page, {
        type: "response.done",
        response: { id, status: "completed", output: [] },
      });
    }
    await emitRealtime(page, {
      type: "response.output_audio_transcript.delta",
      response_id: "resp_narr",
      item_id: "it_narr",
      delta: "Let me put that up.",
    });
    await expect(page.locator("[data-ac-cards] [data-ac-card]")).toHaveCount(3);
    // Two assistant messages for one turn are never both shown.
    expect(
      await page.getByText("Here are the three companies.").count(),
    ).toBeLessThanOrEqual(1);
    // Only Q turns carry data-q-turn-id: the voice turn ends in one terminal
    // disposition, whatever extra assistant messages arrived.
    await expectLastTurnTerminal(page, ["ANSWERED", "ACTED"], 30_000);
  });

  test("(f) the voice final fails: exactly one terminal line or error, and a terminal disposition", async ({
    browser,
  }) => {
    awaits(
      ["A4", "G-R3"],
      "INC-1: 'voice stopped without a final answer' with no terminal state; SPOKEN logged without audio",
    );
    const page = await (await contextAs(browser, CAST.investor)).newPage();
    await voiceTopThree(page);
    await expect(page.locator("[data-ac-cards] [data-ac-card]")).toHaveCount(
      3,
      { timeout: 90_000 },
    );
    await emitRealtime(page, {
      type: "response.created",
      response: { id: "resp_final" },
    });
    await emitRealtime(page, {
      type: "response.done",
      response: {
        id: "resp_final",
        status: "failed",
        status_details: { error: { message: "scripted" } },
      },
    });
    await emitRealtime(page, {
      type: "error",
      error: { type: "server_error", message: "scripted" },
    });
    const terminal = page
      .locator('[role="alert"], [role="status"]')
      .filter({ hasText: /couldn't|didn't|try again|error/iu });
    await expect(terminal).toHaveCount(1, { timeout: 30_000 });
    await expectLastTurnTerminal(page, ["ANSWERED", "FAILED"], 30_000);
    // The cards are the answer and stay, even when speaking it failed.
    await expect(page.locator("[data-ac-cards] [data-ac-card]")).toHaveCount(3);
  });

  test("(g) a reconnect with the arrival replay keeps the cards", async ({
    browser,
  }) => {
    awaits(
      ["A5", "E"],
      "INC-1: reconnect replayed the arrival greeting; cards must not vanish",
    );
    const page = await (await contextAs(browser, CAST.investor)).newPage();
    await voiceTopThree(page);
    await expect(page.locator("[data-ac-cards] [data-ac-card]")).toHaveCount(
      3,
      { timeout: 90_000 },
    );
    const keys = await domCardKeys(page);
    const before = (await duplexSent(page)).length;
    await setPeerState(page, "failed");
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              (window as Window & { __cqDuplexPeers?: number })
                .__cqDuplexPeers ?? 0,
          ),
        { timeout: 60_000 },
      )
      .toBeGreaterThan(1);
    await page.waitForTimeout(3_000);
    expect(await domCardKeys(page)).toEqual(keys);
    const sent = await duplexSent(page);
    // No stale bridge or improvised reply for the old question after the
    // reconnect (the incident spoke one 40 s late, after two newer turns).
    const afterReconnect = classify(sent.slice(before));
    expect(
      afterReconnect.filter((k) => k === "BRIDGE" || k === "BARE"),
      `after the reconnect: ${summarise(sent.slice(before))}`,
    ).toEqual([]);
  });
});
