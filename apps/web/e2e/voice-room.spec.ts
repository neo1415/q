import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

/**
 * Owner audit 2026-11-15, Phase 4 (A-C), on the voice-room harness
 * (`/dev/voice-room`): a simulated line, no audio or provider.
 *
 * A: Q's presence is large with nothing shown and compact once a result
 *    is up, without covering the result's controls.
 * B: scrolling while Q speaks stays where the person put it.
 * C: the speaking motion is smooth and bounded, moves nothing on the
 *    page, and is static under reduced motion.
 *
 * CQ_EVIDENCE_DIR saves the screenshots (JPEG, device scale 2).
 */

test.use({ deviceScaleFactor: 2 });

const EVIDENCE = process.env["CQ_EVIDENCE_DIR"];

async function snap(page: Page, info: TestInfo, name: string) {
  if (EVIDENCE === undefined) return;
  mkdirSync(EVIDENCE, { recursive: true });
  await page.screenshot({
    path: join(EVIDENCE, `${info.project.name}-${name}.jpg`),
    type: "jpeg",
    quality: 80,
  });
}

async function open(page: Page, query = "") {
  await page.goto(`/dev/voice-room${query}`);
  await expect(page.locator("[data-q-voice-room]")).toBeVisible();
}

async function boxOf(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox();
  if (box === null) throw new Error(`no box for ${selector}`);
  return box;
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

test("1. a session with nothing shown: Q's presence is large", async ({
  page,
}, info) => {
  await open(page);
  await expect(page.locator("[data-q-voice-presence-box]")).toHaveAttribute(
    "data-q-voice-presence-box",
    "full",
  );
  const box = await boxOf(page, "[data-q-voice-presence-box]");
  expect(box.width).toBeGreaterThanOrEqual(200);
  await page.waitForTimeout(900);
  await snap(page, info, "1-open-large-presence");
});

test("2. a result appears: compact presence, the content leads, captions cover nothing", async ({
  page,
}, info) => {
  await open(page, "?speaking=1");
  await page.locator("[data-harness=result]").click();
  const presence = page.locator("[data-q-voice-presence-box]");
  await expect(presence).toHaveAttribute(
    "data-q-voice-presence-box",
    "compact",
  );
  await expect(
    page.locator("[data-q-voice-content] button").first(),
  ).toBeVisible();
  await page.waitForTimeout(600);
  const box = await boxOf(page, "[data-q-voice-presence-box]");
  expect(box.width).toBeLessThanOrEqual(112);
  // The result starts near the top of the stage, not under Q.
  const content = await boxOf(page, "[data-q-voice-content]");
  const stage = await boxOf(page, "[data-q-voice-stage-body]");
  expect(content.y - stage.y).toBeLessThan(
    info.project.name === "phone" ? 80 : 60,
  );
  // The result is in view: no "New result" cue.
  await expect(page.locator("[data-q-new-result]")).toHaveCount(0);
  await snap(page, info, "2-result-compact-presence");

  // At any scroll end, no control of the result sits under the aside.
  const body = page.locator("[data-q-voice-stage-body]");
  for (const where of ["top", "bottom"] as const) {
    await body.evaluate((element, end) => {
      element.scrollTop = end === "top" ? 0 : element.scrollHeight;
    }, where);
    await page.waitForTimeout(150);
    const aside = await boxOf(page, "[data-q-voice-aside]");
    const buttons = page.locator("[data-q-voice-content] button:visible");
    const count = await buttons.count();
    for (let n = 0; n < count; n += 1) {
      const button = await buttons.nth(n).boundingBox();
      if (button === null) continue;
      // Only what is on screen counts (off screen is reached by scrolling).
      if (
        button.y + button.height < stage.y ||
        button.y > stage.y + stage.height
      )
        continue;
      if (where === "bottom" || info.project.name === "desktop") {
        expect(overlaps(aside, button), `button ${String(n)} at ${where}`).toBe(
          false,
        );
      }
    }
  }
});

test("3. scrolling while Q speaks stays where the person put it", async ({
  page,
}, info) => {
  // A shorter window, so the result is taller than the stage and scrolls.
  const size = page.viewportSize();
  await page.setViewportSize({
    width: size?.width ?? 390,
    height: info.project.name === "phone" ? 600 : 560,
  });
  await open(page, "?result=1&speaking=1");
  await expect(page.locator("[data-q-voice-presence-box]")).toHaveAttribute(
    "data-q-voice-presence-box",
    "compact",
  );
  const body = page.locator("[data-q-voice-stage-body]");
  await expect(
    page.locator("[data-q-voice-content] button").first(),
  ).toBeVisible();
  await page.waitForTimeout(500);
  const target = await body.evaluate((element) => {
    element.scrollTop = Math.round(
      (element.scrollHeight - element.clientHeight) / 2,
    );
    return element.scrollTop;
  });
  expect(target).toBeGreaterThan(0);
  const captions = page.locator("[data-q-exchange-caption]");
  const firstCaption = await captions.textContent();
  const samples: number[] = [];
  for (let n = 0; n < 12; n += 1) {
    await page.waitForTimeout(250);
    samples.push(await body.evaluate((element) => element.scrollTop));
  }
  // The captions really were updating over those 3 s.
  expect(await captions.textContent()).not.toBe(firstCaption);
  expect(samples.every((top) => top === target)).toBe(true);
  await snap(page, info, "3-scrolled-while-speaking");
});

test("4. the speaking motion is smooth, bounded and moves nothing", async ({
  page,
}, info) => {
  await open(page, "?speaking=1");
  await page.waitForTimeout(300);
  const result = await page.evaluate(async () => {
    const scaleBox = document.querySelector<HTMLElement>(
      "[data-q-voice-presence-scale]",
    );
    const box = document.querySelector<HTMLElement>(
      "[data-q-voice-presence-box]",
    );
    if (scaleBox === null || box === null) throw new Error("no presence");
    const shifts: number[] = [];
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as {
        value: number;
        sources?: { node?: Node | null }[];
      }[]) {
        const fromPresence = (entry.sources ?? []).some(
          (source) =>
            source.node !== null &&
            source.node !== undefined &&
            box.contains(source.node),
        );
        if (fromPresence) shifts.push(entry.value);
      }
    });
    observer.observe({ type: "layout-shift", buffered: false });
    const scales: number[] = [];
    const times: number[] = [];
    const rects: string[] = [];
    const start = performance.now();
    await new Promise<void>((resolve) => {
      const frame = (now: number) => {
        const match = /scale\(([\d.]+)\)/.exec(scaleBox.style.transform);
        scales.push(Number(match?.[1] ?? Number.NaN));
        times.push(now);
        const rect = box.getBoundingClientRect();
        rects.push(`${rect.x},${rect.y},${rect.width},${rect.height}`);
        if (performance.now() - start < 2000) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    observer.disconnect();
    return { scales, times, rects, shifts };
  });
  const { scales, times, rects, shifts } = result;
  expect(scales.length).toBeGreaterThan(30);
  // Frame-to-frame change, bounded by the time between frames: the swell
  // moves at most 3% x 4 levels a second (the envelope's slew limit), so
  // even a late frame is a small step, never a jump.
  let largest = 0;
  let fastest = 0;
  for (let n = 1; n < scales.length; n += 1) {
    const step = Math.abs((scales[n] ?? 0) - (scales[n - 1] ?? 0));
    const ms = Math.max(1, (times[n] ?? 0) - (times[n - 1] ?? 0));
    largest = Math.max(largest, step);
    fastest = Math.max(fastest, step / Math.min(ms, 100));
  }
  // Moving with the voice, in small steps, within a 3% swell.
  expect(Math.max(...scales)).toBeGreaterThan(1.005);
  expect(Math.max(...scales)).toBeLessThanOrEqual(1.03 + 1e-6);
  expect(Math.min(...scales)).toBeGreaterThanOrEqual(1);
  expect(fastest).toBeLessThanOrEqual((0.03 * 4) / 1000 + 1e-5);
  expect(largest).toBeLessThan(0.0125);
  // Transform only: the presence's layout box never moves or resizes.
  expect(new Set(rects).size).toBe(1);
  expect(shifts.reduce((sum, value) => sum + value, 0)).toBe(0);
  console.log(
    `[${info.project.name}] motion frames=${String(scales.length)} maxDelta=${largest.toFixed(5)} maxPerMs=${fastest.toFixed(6)}`,
  );
  info.annotations.push({
    type: "motion",
    description: `frames=${String(scales.length)} maxDelta=${largest.toFixed(5)} maxPerMs=${fastest.toFixed(6)} peak=${Math.max(...scales).toFixed(4)}`,
  });
  await snap(page, info, "4-speaking-large-presence");
});

test("5. reduced motion: a static presence while Q speaks", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "?result=1&speaking=1");
  await expect(page.locator("[data-q-voice-presence-box]")).toHaveAttribute(
    "data-q-voice-presence-box",
    "compact",
  );
  const scale = page.locator("[data-q-voice-presence-scale]");
  const first = await scale.evaluate((element) => element.style.transform);
  for (let n = 0; n < 5; n += 1) {
    await page.waitForTimeout(200);
    expect(await scale.evaluate((element) => element.style.transform)).toBe(
      first,
    );
  }
  await expect(page.locator("[data-q-voice-status] [role=status]")).toHaveText(
    "Speaking",
  );
  await snap(page, info, "5-reduced-motion");
});
