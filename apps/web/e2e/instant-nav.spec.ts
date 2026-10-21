import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * Lane 7 (owner 2026-10-21): from any page, "open X", "close it", "go
 * back", "scroll down", "press Show more", "open the certificate of
 * incorporation" happen at once, by code, with no model. Measured in a
 * real Chromium on the `/dev/instant-nav` harness: the typed line is the
 * Q session's own `ask`, a spoken one is a voice line's final transcript.
 * `/api/q-navigate` (the Q API's code-only reader) answers from fixtures
 * after 30 ms (a warm hosted read is tens of ms); `/api/q-ask` (a Q run,
 * where a model may be called) is counted and refused.
 *
 * The timings are written to CQ_E2E_EVIDENCE (the audit table's source).
 */

const EVIDENCE =
  process.env.CQ_E2E_EVIDENCE ??
  join(process.cwd(), "..", "..", "docs/ai-handoff/evidence/instant-nav");

const COMPANY = "7b1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f72";
const CERT = "6a1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f71";
const BRIEF = "8c1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f73";
const NIXO = "9d1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f74";

/** The Q API's code-only reader, by the words (fixtures). */
function decide(text: string): unknown {
  const said = text.toLowerCase();
  const open = (intent: unknown) => ({ kind: "NAVIGATE", intent, ms: 4 });
  if (said.includes("northwind robotics")) {
    return open({ kind: "OPEN_RECORD_PAGE", page: "COMPANY", id: COMPANY });
  }
  if (said.includes("chat with nixo")) {
    return open({
      kind: "OPEN_RECORD_PAGE",
      page: "RELATIONSHIP_COMPANY_MESSAGES",
      id: NIXO,
    });
  }
  if (said.includes("nixo's data room")) {
    return open({
      kind: "OPEN_RECORD_PAGE",
      page: "COMPANY_DATA_ROOM",
      id: NIXO,
    });
  }
  if (
    said.includes("certificate of incorporation") ||
    said.includes("term sheet")
  ) {
    return open({
      kind: "OPEN_RECORD_PAGE",
      page: "DATA_ROOM_DOCUMENT",
      id: CERT,
      companyId: COMPANY,
      title: "Certificate of incorporation",
    });
  }
  if (said.includes("questions for priya") || said.includes("investor brief")) {
    return open({ kind: "OPEN_RECORD_PAGE", page: "DOCUMENT", id: BRIEF });
  }
  // Everything else, a document they may not open included: Q decides.
  return { kind: "LEAVE_TO_Q", ms: 3 };
}

type Counts = { asks: number; reads: number };

async function harness(page: Page, path: string): Promise<Counts> {
  const counts: Counts = { asks: 0, reads: 0 };
  await page.route("**/api/q-navigate", async (route) => {
    counts.reads += 1;
    const body = route.request().postDataJSON() as { text: string };
    await new Promise((resolve) => setTimeout(resolve, 30));
    await route.fulfill({ json: decide(body.text) });
  });
  await page.route("**/api/q-ask", async (route) => {
    counts.asks += 1;
    await route.fulfill({ status: 503, json: { message: "harness" } });
  });
  // The brand intro is seen once per tab; this tab has seen it.
  await page.addInitScript(() => {
    sessionStorage.setItem("cq.splash.seen", "1");
  });
  await page.goto(path);
  await installClock(page);
  return counts;
}

/**
 * Times from the end of the sentence (Enter, or the final transcript) to
 * the effect, in the page's own clock. A move's time is when the router
 * push was made (the fast path's event), kept in sessionStorage because
 * the move then leaves this page.
 */
async function installClock(page: Page): Promise<void> {
  await page.evaluate(() => {
    const own = window as Window & { cqT0?: number };
    document.addEventListener(
      "keydown",
      (event) => {
        if (
          event.key === "Enter" &&
          event.target instanceof HTMLElement &&
          event.target.hasAttribute("data-harness-ask")
        ) {
          own.cqT0 = performance.now();
          sessionStorage.setItem("cq-t0", String(Date.now()));
        }
      },
      true,
    );
    window.addEventListener("cq:fast-navigation", (event) => {
      const detail = (event as CustomEvent<{ path: string }>).detail;
      const t0 = Number(sessionStorage.getItem("cq-t0") ?? "0");
      sessionStorage.setItem("cq-fast-ms", String(Date.now() - t0));
      sessionStorage.setItem("cq-fast-path", detail.path);
      sessionStorage.setItem(
        "cq-fast-count",
        String(Number(sessionStorage.getItem("cq-fast-count") ?? "0") + 1),
      );
    });
  });
  await page.evaluate(() => {
    sessionStorage.removeItem("cq-fast-ms");
    sessionStorage.removeItem("cq-fast-path");
    sessionStorage.removeItem("cq-fast-count");
  });
}

async function say(
  page: Page,
  channel: "typed" | "spoken",
  text: string,
): Promise<void> {
  if (channel === "typed") {
    await page.locator("[data-harness-ask]").fill(text);
    await page.locator("[data-harness-ask]").press("Enter");
    return;
  }
  await page.evaluate((said) => {
    (window as Window & { cqT0?: number }).cqT0 = performance.now();
    sessionStorage.setItem("cq-t0", String(Date.now()));
    (
      window as Window & { cqHarnessHeard?: (text: string) => void }
    ).cqHarnessHeard?.(said);
  }, text);
}

/** Waits for the effect in the page; its time from the sentence's end. */
async function effectMs(page: Page, effect: string): Promise<number> {
  const handle = await page.waitForFunction(
    `(() => { if (!(${effect})) return false; const own = window; own.cqT1 ??= performance.now(); return own.cqT1 - own.cqT0; })()`,
    undefined,
    { polling: "raf", timeout: 5_000 },
  );
  const ms = (await handle.jsonValue()) as number;
  await page.evaluate(() => {
    delete (window as Window & { cqT1?: number }).cqT1;
  });
  return Math.round(ms);
}

type Row = {
  readonly id: number;
  readonly said: string;
  readonly page: string;
  readonly channel: "typed" | "spoken";
  readonly kind: string;
  readonly ms: number | null;
  /** Q runs started (each may call a model). */
  readonly runs: number;
  /** Reads of the Q API's code-only reader. */
  readonly reads: number;
  /** Moves or opens the screen made for this one sentence. */
  readonly moves: number;
  readonly outcome: string;
};

/** sessionStorage, read through a move that may be replacing the page. */
async function stored(page: Page, key: string): Promise<string | null> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return await page.evaluate((name) => sessionStorage.getItem(name), key);
    } catch {
      await page.waitForTimeout(50);
    }
  }
  return null;
}

const FEED = "/dev/instant-nav";
const COMPANY_PAGE = `/dev/instant-nav/company/${COMPANY}`;
const WORK = "/dev/instant-nav/work";

type Case = {
  readonly id: number;
  readonly said: string;
  readonly page: string;
  readonly channel: "typed" | "spoken";
  readonly kind: string;
  /** What has to be open or done before the sentence. */
  readonly setup?: ((page: Page) => Promise<void>) | undefined;
  /**
   * An in-page condition; or "MOVE" (the fast path's router push) or
   * "NONE" (nothing may happen by code).
   */
  readonly effect: string;
  /** A Q run is expected (the request is Q's to answer). */
  readonly toQ: boolean;
};

const openNotifications = async (page: Page) => {
  await page.getByRole("button", { name: "Notifications" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
};
const showCards = async (page: Page) => {
  await page.evaluate(() =>
    (
      window as Window & { cqHarnessShowCards?: (title: string) => void }
    ).cqHarnessShowCards?.("Top three for your mandate"),
  );
  await expect(page.locator("[data-q-show-modal]")).toBeVisible();
};
const moveOnce = async (page: Page) => {
  await page.locator('[data-harness-link="work"]').click();
  await expect(page.locator('[data-harness-page="work"]')).toBeVisible();
};

const NO_DIALOG = `document.querySelector('[role="dialog"]') === null`;
const SCROLLED = `(document.scrollingElement?.scrollTop ?? 0) > 0`;

const CASES: readonly Case[] = [
  // Pages, by name (read in the browser).
  {
    id: 1,
    said: "open discover",
    page: FEED,
    channel: "typed",
    kind: "page",
    effect: "MOVE",
    toQ: true,
  },
  {
    id: 2,
    said: "take me to relationships",
    page: COMPANY_PAGE,
    channel: "typed",
    kind: "page",
    effect: "MOVE",
    toQ: true,
  },
  {
    id: 3,
    said: "go to my settings",
    page: WORK,
    channel: "typed",
    kind: "page",
    effect: "MOVE",
    toQ: true,
  },
  {
    id: 4,
    said: "open my notification settings",
    page: FEED,
    channel: "typed",
    kind: "page",
    effect: "MOVE",
    toQ: true,
  },
  {
    id: 5,
    said: "okay, show me the work page",
    page: FEED,
    channel: "spoken",
    kind: "page",
    effect: "MOVE",
    toQ: false,
  },
  {
    id: 6,
    said: "take me back to discover",
    page: COMPANY_PAGE,
    channel: "spoken",
    kind: "page",
    effect: "MOVE",
    toQ: false,
  },
  // Records, by name (the Q API's reader, as the person).
  {
    id: 7,
    said: "open Northwind Robotics",
    page: FEED,
    channel: "typed",
    kind: "record",
    effect: "MOVE",
    toQ: true,
  },
  {
    id: 8,
    said: "open my chat with Nixo",
    page: WORK,
    channel: "typed",
    kind: "record",
    effect: "MOVE",
    toQ: true,
  },
  {
    id: 9,
    said: "show me Nixo's data room",
    page: FEED,
    channel: "spoken",
    kind: "record+tab",
    effect: "MOVE",
    toQ: false,
  },
  // Tabs of the record on screen.
  {
    id: 10,
    said: "open the data room",
    page: COMPANY_PAGE,
    channel: "typed",
    kind: "tab",
    effect: `document.querySelector('[data-harness-selected]')?.textContent === "dataroom"`,
    toQ: true,
  },
  {
    id: 11,
    said: "now the pitch deck",
    page: COMPANY_PAGE,
    channel: "spoken",
    kind: "tab",
    effect: `document.querySelector('[data-harness-selected]')?.textContent === "deck"`,
    toQ: false,
  },
  {
    id: 12,
    said: "show me the team tab",
    page: COMPANY_PAGE,
    channel: "typed",
    kind: "tab by name",
    effect: `document.querySelector('[data-harness-selected]')?.textContent === "team"`,
    toQ: false,
  },
  {
    id: 13,
    said: "open the Saved tab",
    page: FEED,
    channel: "typed",
    kind: "tab by name",
    effect: `document.querySelector('[data-harness-tab="saved"]')?.getAttribute("aria-selected") === "true"`,
    toQ: false,
  },
  {
    id: 14,
    said: "switch to the For you tab",
    page: FEED,
    channel: "spoken",
    kind: "tab by name",
    setup: async (page) => page.locator('[data-harness-tab="saved"]').click(),
    effect: `document.querySelector('[data-harness-tab="for-you"]')?.getAttribute("aria-selected") === "true"`,
    toQ: false,
  },
  // Close / dismiss.
  {
    id: 15,
    said: "close it",
    page: FEED,
    channel: "typed",
    kind: "close",
    setup: openNotifications,
    effect: NO_DIALOG,
    toQ: false,
  },
  {
    id: 16,
    said: "close that",
    page: COMPANY_PAGE,
    channel: "typed",
    kind: "close",
    setup: showCards,
    effect: `document.querySelector("[data-q-show-modal]") === null`,
    toQ: false,
  },
  {
    id: 17,
    said: "okay, dismiss this",
    page: WORK,
    channel: "spoken",
    kind: "close",
    setup: showCards,
    effect: `document.querySelector("[data-q-show-modal]") === null`,
    toQ: false,
  },
  {
    id: 18,
    said: "close the document",
    page: FEED,
    channel: "typed",
    kind: "close (nothing open)",
    effect: "NONE",
    toQ: true,
  },
  // Back and scroll.
  {
    id: 19,
    said: "go back",
    page: FEED,
    channel: "typed",
    kind: "back",
    setup: moveOnce,
    effect: `location.pathname === "/dev/instant-nav"`,
    toQ: false,
  },
  {
    id: 20,
    said: "take me back",
    page: FEED,
    channel: "spoken",
    kind: "back",
    setup: moveOnce,
    effect: `location.pathname === "/dev/instant-nav"`,
    toQ: false,
  },
  {
    id: 21,
    said: "scroll down",
    page: FEED,
    channel: "typed",
    kind: "scroll",
    effect: SCROLLED,
    toQ: false,
  },
  {
    id: 22,
    said: "Q, scroll down a bit please",
    page: COMPANY_PAGE,
    channel: "spoken",
    kind: "scroll",
    effect: SCROLLED,
    toQ: false,
  },
  {
    id: 23,
    said: "scroll to the bottom",
    page: FEED,
    channel: "typed",
    kind: "scroll",
    effect: SCROLLED,
    toQ: false,
  },
  {
    id: 24,
    said: "back to the top",
    page: FEED,
    channel: "spoken",
    kind: "scroll",
    setup: async (page) => page.evaluate(() => window.scrollTo(0, 900)),
    effect: `(document.scrollingElement?.scrollTop ?? 1) === 0`,
    toQ: false,
  },
  {
    id: 25,
    said: "scroll up",
    page: WORK,
    channel: "typed",
    kind: "scroll (no room)",
    effect: "NONE",
    toQ: true,
  },
  // Buttons by their visible name.
  {
    id: 26,
    said: "press Show more",
    page: FEED,
    channel: "typed",
    kind: "button",
    effect: `document.querySelector("[data-harness-more]")?.textContent === "More shown"`,
    toQ: false,
  },
  {
    id: 27,
    said: "click Notifications",
    page: FEED,
    channel: "typed",
    kind: "button",
    effect: `document.querySelector('[role="dialog"]') !== null`,
    toQ: false,
  },
  {
    id: 28,
    said: "tap the notifications button",
    page: FEED,
    channel: "spoken",
    kind: "button",
    effect: `document.querySelector('[role="dialog"]') !== null`,
    toQ: false,
  },
  {
    id: 29,
    said: "press express interest",
    page: FEED,
    channel: "typed",
    kind: "consequential (never by code)",
    effect: "NONE",
    toQ: true,
  },
  {
    id: 30,
    said: "press approve",
    page: FEED,
    channel: "spoken",
    kind: "consequential (never by code)",
    effect: "NONE",
    toQ: false,
  },
  // Documents by name, in the viewer over the page.
  {
    id: 31,
    said: "open the certificate of incorporation",
    page: COMPANY_PAGE,
    channel: "typed",
    kind: "document (data room)",
    effect: `sessionStorage.getItem("cq-fast-path") === "#document"`,
    toQ: false,
  },
  {
    id: 32,
    said: "show me Halyard's term sheet",
    page: FEED,
    channel: "spoken",
    kind: "document (data room)",
    effect: `sessionStorage.getItem("cq-fast-path") === "#document"`,
    toQ: false,
  },
  {
    id: 33,
    said: "open the questions for Priya",
    page: WORK,
    channel: "typed",
    kind: "document (Q made)",
    effect: `document.querySelector('[role="dialog"]') !== null`,
    toQ: false,
  },
  {
    id: 34,
    said: "open my investor brief",
    page: FEED,
    channel: "typed",
    kind: "document (Q made)",
    effect: `document.querySelector('[role="dialog"]') !== null`,
    toQ: false,
  },
  {
    id: 35,
    said: "open the secret cap table",
    page: COMPANY_PAGE,
    channel: "typed",
    kind: "document (not theirs)",
    effect: "NONE",
    toQ: true,
  },
  // Theme, cards, language, things only Q can answer.
  {
    id: 36,
    said: "switch to dark mode",
    page: FEED,
    channel: "typed",
    kind: "theme",
    effect: `document.documentElement.getAttribute("data-theme") === "dark"`,
    toQ: false,
  },
  {
    id: 37,
    said: "light mode please",
    page: WORK,
    channel: "spoken",
    kind: "theme",
    effect: `document.documentElement.getAttribute("data-theme") === "light"`,
    toQ: false,
  },
  {
    id: 38,
    said: "clear all cards",
    page: FEED,
    channel: "typed",
    kind: "cards",
    effect: "NONE",
    toQ: true,
  },
  {
    id: 39,
    said: "change the language to French",
    page: FEED,
    channel: "typed",
    kind: "language (Q)",
    effect: "NONE",
    toQ: true,
  },
  {
    id: 40,
    said: "show me my top three companies",
    page: COMPANY_PAGE,
    channel: "typed",
    kind: "show cards (Q)",
    effect: "NONE",
    toQ: true,
  },
  {
    id: 41,
    said: "compare Nixo and Halyard",
    page: WORK,
    channel: "typed",
    kind: "show comparison (Q)",
    effect: "NONE",
    toQ: true,
  },
  // Spoken shapes: a pause split, a take-back, lead-ins.
  {
    id: 42,
    said: "uh, open the data room",
    page: COMPANY_PAGE,
    channel: "spoken",
    kind: "tab",
    effect: `document.querySelector('[data-harness-selected]')?.textContent === "dataroom"`,
    toQ: false,
  },
  {
    id: 43,
    said: "open discover, no wait",
    page: FEED,
    channel: "spoken",
    kind: "taken back",
    effect: "NONE",
    toQ: false,
  },
  {
    id: 44,
    said: "um, close it.",
    page: FEED,
    channel: "spoken",
    kind: "close",
    setup: openNotifications,
    effect: NO_DIALOG,
    toQ: false,
  },
  {
    id: 45,
    said: "scroll down",
    page: FEED,
    channel: "spoken",
    kind: "scroll",
    effect: SCROLLED,
    toQ: false,
  },
];

for (const one of CASES) {
  test(`#${String(one.id)} ${one.channel}: "${one.said}" on ${one.page.replace("/dev/instant-nav", "") || "/feed"}`, async ({
    page,
  }, info) => {
    // One project measures; the other only checks the outcome.
    const measure = info.project.name === "desktop";
    const counts = await harness(page, one.page);
    if (one.setup !== undefined) await one.setup(page);
    await say(page, one.channel, one.said);
    let ms: number | null = null;
    if (one.effect === "MOVE") {
      await expect
        .poll(() => stored(page, "cq-fast-ms"), { timeout: 5_000 })
        .not.toBeNull();
      ms = Number(await stored(page, "cq-fast-ms"));
    } else if (one.effect !== "NONE") {
      ms = await effectMs(page, one.effect);
    }
    // Long enough for a second move, a run or a late open to show.
    await page.waitForTimeout(700);
    const moves = Number((await stored(page, "cq-fast-count")) ?? "0");
    if (one.effect === "NONE") {
      // Nothing moved or opened by code: the request is Q's.
      expect(moves).toBe(0);
    } else {
      expect(moves).toBeLessThanOrEqual(1);
    }
    if (one.channel === "typed") {
      expect(counts.asks).toBe(one.toQ ? 1 : 0);
    }
    if (one.kind.startsWith("consequential")) {
      await expect(page.locator("[data-harness-pressed]")).toHaveText("");
    }
    if (one.kind === "document (not theirs)") {
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator("body")).not.toContainText(/cap table/iu);
    }
    if (measure) {
      const row: Row = {
        id: one.id,
        said: one.said,
        page: one.page.replace("/dev/instant-nav", "") || "/feed",
        channel: one.channel,
        kind: one.kind,
        ms,
        runs: counts.asks,
        reads: counts.reads,
        moves,
        outcome:
          one.effect === "NONE"
            ? "left to Q"
            : one.effect === "MOVE"
              ? `moved (${(await stored(page, "cq-fast-path")) ?? "?"})`
              : "done on screen",
      };
      mkdirSync(join(EVIDENCE, "rows"), { recursive: true });
      writeFileSync(
        join(EVIDENCE, "rows", `${String(one.id).padStart(2, "0")}.json`),
        // Two-space JSON is what Prettier keeps; one line failed format:check.
        `${JSON.stringify(row, null, 2)}\n`,
      );
    }
  });
}

// The one modal surface, on three pages, light and dark (each project is
// one width: 390 px phone, 1440 px desktop).
for (const [name, path] of [
  ["feed", FEED],
  ["company", COMPANY_PAGE],
  ["work", WORK],
] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`modal over the ${name} page, ${scheme}`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await harness(page, path);
      await showCards(page);
      const modal = page.locator("[data-q-show-modal]");
      // Settled (its entrance scales from 0.98), then measured.
      await page.waitForTimeout(400);
      // Focus is inside the modal, its close is a 44 px target.
      const close = modal.locator("[data-q-close]");
      const box = await close.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.activeElement?.closest('[role="dialog"]') !== null,
          ),
        )
        .toBe(true);
      mkdirSync(EVIDENCE, { recursive: true });
      await page.screenshot({
        path: join(
          EVIDENCE,
          `modal-${name}-${scheme}-${info.project.name}.png`,
        ),
      });
      // Escape closes it; then the button, then a click outside.
      await page.keyboard.press("Escape");
      await expect(modal).toHaveCount(0);
      await showCards(page);
      await modal.locator("[data-q-close]").click();
      await expect(modal).toHaveCount(0);
      // A click outside it closes it too (a phone's sheet fills the screen:
      // it is pulled down instead).
      if (info.project.name === "desktop") {
        await showCards(page);
        await page.mouse.click(5, 5);
        await expect(modal).toHaveCount(0);
      }
    });
  }
}
