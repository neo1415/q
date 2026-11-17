import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { axe, summarise } from "../../../tests/recovery/support/axe.js";

/**
 * Decision 102 (owner, 2026-11-17), on the voice-room harness
 * (`/dev/voice-room`): once Q shows something the content takes the
 * screen, Q's presence is a small element in a corner that takes no
 * layout width, and the captions float at the bottom without covering
 * the last card's controls.
 *
 * CQ_EVIDENCE_DIR saves light and dark screenshots (JPEG, device scale 2),
 * named with CQ_EVIDENCE_PREFIX (e.g. "before" / "after").
 */

test.use({ deviceScaleFactor: 2 });

const EVIDENCE = process.env["CQ_EVIDENCE_DIR"];
const PREFIX = process.env["CQ_EVIDENCE_PREFIX"] ?? "after";

type Box = { x: number; y: number; width: number; height: number };

async function open(page: Page, query: string, theme: "light" | "dark") {
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript((choice) => {
    try {
      window.localStorage.setItem("cq.theme", choice);
    } catch {
      // A blocked store keeps the system scheme, emulated above.
    }
  }, theme);
  await page.goto(`/dev/voice-room${query}`);
  await expect(page.locator("[data-q-voice-room]")).toBeVisible();
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  const box = await page.locator(selector).first().boundingBox();
  if (box === null) throw new Error(`no box for ${selector}`);
  return box;
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

async function snap(page: Page, info: TestInfo, name: string) {
  if (EVIDENCE === undefined) return;
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({
    path: join(EVIDENCE, `${PREFIX}-${info.project.name}-${name}.jpg`),
    type: "jpeg",
    quality: 80,
  });
}

async function showResult(page: Page) {
  await page.locator("[data-harness=result]").click();
  await expect(page.locator("[data-q-voice-presence-box]")).toHaveAttribute(
    "data-q-voice-presence-box",
    "compact",
  );
  await expect(
    page.locator("[data-q-voice-content] button").first(),
  ).toBeVisible();
  // The presence's move to the corner settles (0.32 s).
  await page.waitForTimeout(700);
}

test("evidence: open, result, scrolled to the end; light and dark", async ({
  page,
}, info) => {
  for (const theme of ["light", "dark"] as const) {
    await open(page, "?speaking=1", theme);
    await page.waitForTimeout(1200);
    await snap(page, info, `${theme}-1-open`);
    await showResult(page);
    await page.waitForTimeout(1200);
    await snap(page, info, `${theme}-2-result`);
    await page
      .locator("[data-q-voice-stage-body]")
      .evaluate((element) => (element.scrollTop = element.scrollHeight));
    await page.waitForTimeout(400);
    await snap(page, info, `${theme}-3-end`);
  }
});

test("the content takes the full width: no column is kept for Q", async ({
  page,
}) => {
  await open(page, "?speaking=1", "light");
  await showResult(page);
  const room = await boxOf(page, "[data-q-voice-room]");
  const content = await boxOf(page, "[data-q-voice-content]");
  // The content spans the room: nothing reserved beside it.
  expect(Math.abs(content.x - room.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(content.width - room.width)).toBeLessThanOrEqual(1);
  // The aside takes no layout space: it is a zero-height overlay.
  const aside = await page
    .locator("[data-q-voice-aside]")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        height: element.getBoundingClientRect().height,
        position: style.position,
      };
    });
  expect(aside.height).toBe(0);
  expect(aside.position).toBe("sticky");
  // The presence is small and in the bottom-right corner of the stage.
  const presence = await boxOf(page, "[data-q-voice-presence-box]");
  const stage = await boxOf(page, "[data-q-voice-stage-body]");
  expect(presence.width).toBeLessThanOrEqual(72);
  expect(presence.x + presence.width).toBeGreaterThan(
    stage.x + stage.width - 120,
  );
  expect(presence.y + presence.height).toBeGreaterThan(
    stage.y + stage.height - 120,
  );
  // The caption floats at the bottom of the stage, at most two lines.
  const caption = await boxOf(page, "[data-q-voice-caption]");
  expect(caption.y + caption.height).toBeGreaterThan(
    stage.y + stage.height - 60,
  );
  expect(caption.y + caption.height).toBeLessThanOrEqual(
    stage.y + stage.height,
  );
  const lines = await page
    .locator("[data-q-exchange-caption]")
    .evaluate((element) => {
      const height = element.getBoundingClientRect().height;
      const line = parseFloat(getComputedStyle(element).lineHeight);
      return Math.round(height / line);
    });
  expect(lines).toBeLessThanOrEqual(2);
  // Neither the caption box nor the presence takes pointer events.
  const pointer = await page.evaluate(() =>
    ["[data-q-voice-caption]", "[data-q-voice-presence-box]"].map(
      (selector) => {
        const element = document.querySelector(selector);
        return element === null ? "" : getComputedStyle(element).pointerEvents;
      },
    ),
  );
  expect(pointer).toEqual(["none", "none"]);
  // ...but the caption's own control takes the pointer.
  const earlier = await boxOf(page, "[data-q-voice-caption] [data-q-earlier]");
  expect(earlier.height).toBeGreaterThanOrEqual(44);
  const own = await page.evaluate(
    ({ x, y }) =>
      document.elementFromPoint(x, y)?.closest("[data-q-earlier]") !== null,
    { x: earlier.x + earlier.width / 2, y: earlier.y + earlier.height / 2 },
  );
  expect(own).toBe(true);
});

test("at the end of the stage the last card's buttons sit clear of the overlay", async ({
  page,
}) => {
  await open(page, "?speaking=1", "light");
  await showResult(page);
  await page
    .locator("[data-q-voice-stage-body]")
    .evaluate((element) => (element.scrollTop = element.scrollHeight));
  await page.waitForTimeout(300);
  const caption = await boxOf(page, "[data-q-voice-caption]");
  const presence = await boxOf(page, "[data-q-voice-presence-box]");
  const buttons = page.locator("[data-q-voice-content] button:visible");
  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);
  const last = await buttons.nth(count - 1).boundingBox();
  if (last === null) throw new Error("no last button");
  for (let n = 0; n < count; n += 1) {
    const button = await buttons.nth(n).boundingBox();
    if (button === null) continue;
    expect(overlaps(caption, button), `button ${String(n)}`).toBe(false);
    expect(overlaps(presence, button), `button ${String(n)}`).toBe(false);
  }
  // And the last button is really pressable there: nothing above it.
  const hit = await page.evaluate(
    ({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      return element?.closest("[data-q-voice-content]") !== null;
    },
    { x: last.x + last.width / 2, y: last.y + last.height / 2 },
  );
  expect(hit).toBe(true);
});

test("phone: the cards are one full-width column and keep their words", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "phone", "phone layout");
  await open(page, "?speaking=1", "light");
  await showResult(page);
  const content = await boxOf(page, "[data-q-voice-content]");
  const cards = page.locator("[data-q-voice-content] [data-ac-card]");
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(4);
  // Owner 2026-11-17: never two-up tiles in the voice room.
  await expect(page.locator("[data-q-voice-content] [data-tiles]")).toHaveCount(
    0,
  );
  for (let n = 0; n < count; n += 1) {
    const card = cards.nth(n);
    const box = await card.boundingBox();
    if (box === null) throw new Error(`no box for card ${String(n)}`);
    expect(box.width, `card ${String(n)} width`).toBeGreaterThan(
      content.width - 2,
    );
    // Its one-line description, the measures line and the score label.
    await expect(card.locator(".cq-ac-line").first()).toBeVisible();
    await expect(
      card.locator(".cq-ac-line", { hasText: "of 6 measures known" }),
    ).toBeVisible();
    await expect(card.locator(".cq-ac-score .of")).toHaveText(
      "mandate fit, out of 10",
    );
    await expect(card.locator(".cq-ac-score .of")).toBeVisible();
    // Targets stay at least 44 px: the card's own button and its close.
    const main = await card.locator(".cq-ac-head-main").boundingBox();
    const close = await card.locator(".cq-ac-x").first().boundingBox();
    if (main === null || close === null) throw new Error("no target box");
    expect(main.height).toBeGreaterThanOrEqual(44);
    expect(close.width).toBeGreaterThanOrEqual(44);
    expect(close.height).toBeGreaterThanOrEqual(44);
  }
  // One column: every card starts at the same x.
  const xs = await cards.evaluateAll((elements) =>
    elements.map((element) => Math.round(element.getBoundingClientRect().x)),
  );
  expect(new Set(xs).size).toBe(1);
});

test("the caption reads like a subtitle: about 600 px, centred, clear of Q", async ({
  page,
}, info) => {
  await open(page, "?speaking=1", "light");
  await showResult(page);
  // Let the caption grow to its two lines.
  await page.waitForTimeout(3000);
  const caption = await boxOf(page, "[data-q-voice-caption]");
  const presence = await boxOf(page, "[data-q-voice-presence-box]");
  const stage = await boxOf(page, "[data-q-voice-stage-body]");
  expect(overlaps(caption, presence)).toBe(false);
  if (info.project.name === "desktop") {
    expect(caption.width).toBeLessThanOrEqual(601);
    expect(caption.width).toBeGreaterThan(400);
    // Centred at the bottom (the corner presence's reserve shifts it a little).
    const middle = caption.x + caption.width / 2;
    const stageMiddle = stage.x + stage.width / 2;
    expect(Math.abs(middle - stageMiddle)).toBeLessThanOrEqual(48);
  } else {
    // Phone: the full width left of Q, minus the gutters.
    expect(caption.x).toBeGreaterThanOrEqual(stage.x + 16);
    expect(caption.x).toBeLessThanOrEqual(stage.x + 24);
    expect(caption.x + caption.width).toBeLessThanOrEqual(presence.x);
  }
});

test("the voice room passes axe (WCAG 2.2 AA), light and dark", async ({
  page,
}) => {
  for (const theme of ["light", "dark"] as const) {
    await open(page, "?speaking=1", theme);
    await showResult(page);
    const violations = await axe(page);
    expect(violations, `${theme}\n${summarise(violations)}`).toEqual([]);
  }
});
